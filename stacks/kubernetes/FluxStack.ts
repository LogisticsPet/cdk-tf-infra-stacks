import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';
import { HelmProvider } from '@cdktf/provider-helm/lib/provider';
import { Release } from '@cdktf/provider-helm/lib/release';
import { Secret } from '@cdktf/provider-kubernetes/lib/secret';
import { ConfigMap } from '@cdktf/provider-kubernetes/lib/config-map';
import { Manifest } from '@cdktf/provider-kubernetes/lib/manifest';
import { DataAwsSecretsmanagerSecretVersion } from '@cdktf/provider-aws/lib/data-aws-secretsmanager-secret-version';

/**
 * Values injected into every Flux manifest at reconcile time via
 * `postBuild.substituteFrom` (platform-vars ConfigMap).
 *
 * Convention: tool IRSA role ARNs are NOT carried here.  Instead, each
 * iam.yaml in base/platform uses `${ENV_PREFIX}-<tool>-irsa` as the role
 * name, and HelmReleases construct the full ARN as
 *   arn:aws:iam::${AWS_ACCOUNT_ID}:role/${ENV_PREFIX}-<tool>-irsa
 * This keeps CDKTF decoupled from per-tool IAM decisions.
 */
export interface FluxPlatformVars {
  // ── Environment identity ──────────────────────────────────────────────
  /**
   * Short environment name (= Terraform stage), e.g. "core", "dev", "test".
   * Used as a prefix in every Crossplane-managed IAM role name so that
   * multiple environments in the same AWS account have unique role names:
   *   ${ENV_PREFIX}-cert-manager-irsa
   */
  ENV_PREFIX: string;

  // ── Crossplane bootstrap ──────────────────────────────────────────────
  /** IRSA role ARN for Crossplane's AWS IAM provider. Created in CDKTF. */
  CROSSPLANE_ROLE_ARN: string;

  // ── OIDC (used by Crossplane when generating IRSA trust policies) ─────
  /** Full ARN, e.g. arn:aws:iam::123456:oidc-provider/oidc.eks... */
  OIDC_PROVIDER_ARN: string;
  /**
   * OIDC URL without https:// prefix, e.g. oidc.eks.eu-central-1.amazonaws.com/id/XXX
   * Used as the StringEquals condition key in IAM trust policies.
   */
  OIDC_PROVIDER_URL: string;
  /** AWS account ID — used to build deterministic IAM ARNs. */
  AWS_ACCOUNT_ID: string;

  // ── Flux image automation ─────────────────────────────────────────────
  /** IRSA role ARN for Flux image-reflector + image-automation. Created in CDKTF. */
  FLUX_IMAGE_ROLE_ARN: string;

  // ── Cluster ────────────────────────────────────────────────────────────
  CLUSTER_NAME: string;
  AWS_REGION: string;
  VPC_ID: string;
  /** Name (not ARN) of the EC2 node IAM role used by EKS Auto Mode NodeClass. */
  EKS_NODE_ROLE_NAME: string;

  // ── Route53 ────────────────────────────────────────────────────────────
  HOSTED_ZONE_ID: string;
  HOSTED_ZONE_ARN: string;

  // ── cert-manager ClusterIssuer ─────────────────────────────────────────
  CERT_ISSUER_NAME: string;
  ACME_EMAIL: string;
  ACME_SERVER: string;
}

export interface FluxStackProps {
  clusterName: string;
  cluster: {
    endpoint: string;
    /** Base64-encoded cluster CA certificate. */
    ca: string;
    region: string;
  };
  /** SSH URL of the GitOps repository, e.g. ssh://git@github.com/owner/repo */
  gitRepoUrl: string;
  gitBranch?: string;
  /**
   * Path inside the repo for the platform Kustomization.
   * Defaults to ./infra/gitops-seed/platforms/core/platform
   * but should always be set explicitly via GITOPS_PLATFORM_PATH(stage).
   */
  gitPath?: string;
  /** AWS Secrets Manager secret ID (name or ARN) for the SSH private key (ed25519 PEM). */
  sshPrivateKeySecretId: string;
  /** AWS Secrets Manager secret ID (name or ARN) for the SSH known_hosts content. */
  sshKnownHostsSecretId: string;
  platformVars: FluxPlatformVars;
  imageAutomation?: boolean;
}

/** https://github.com/fluxcd-community/helm-charts/releases */
const FLUX_CHART_VERSION = '2.14.0';

export default class FluxStack extends CustomTerraformStack {
  public readonly namespace = 'flux-system';

  constructor(scope: Construct, id: string, props: FluxStackProps) {
    super(scope, id);

    // ── Kubernetes + Helm providers ───────────────────────────────────────
    // Auth via aws-cli exec so no static credentials are stored in state.
    const execConfig = {
      apiVersion: 'client.authentication.k8s.io/v1beta1',
      command: 'aws',
      args: [
        'eks',
        'get-token',
        '--cluster-name',
        props.clusterName,
        '--region',
        props.cluster.region,
      ],
    };

    new KubernetesProvider(this, 'kubernetes', {
      host: props.cluster.endpoint,
      clusterCaCertificate: Fn.base64decode(props.cluster.ca),
      exec: [execConfig],
    });

    new HelmProvider(this, 'helm', {
      kubernetes: {
        host: props.cluster.endpoint,
        clusterCaCertificate: Fn.base64decode(props.cluster.ca),
        exec: execConfig,
      },
    });

    // Strip https:// so the value stored in the ConfigMap is the bare domain
    // path (e.g. oidc.eks.eu-central-1.amazonaws.com/id/XXX), which is the
    // format required in IAM trust policy condition keys.
    const oidcProviderUrlStripped = Fn.trimprefix(
      props.platformVars.OIDC_PROVIDER_URL,
      'https://'
    );

    // ── Flux controllers ──────────────────────────────────────────────────
    const fluxRelease = new Release(this, 'flux-controllers', {
      name: 'flux2',
      repository: 'https://fluxcd-community.github.io/helm-charts',
      chart: 'flux2',
      version: FLUX_CHART_VERSION,
      namespace: this.namespace,
      createNamespace: true,
      atomic: true,
      waitForJobs: true,
      set: [
        {
          name: 'imageAutomationController.create',
          value: String(props.imageAutomation ?? true),
        },
        {
          name: 'imageReflectionController.create',
          value: String(props.imageAutomation ?? true),
        },
        {
          name: 'imageReflectionController.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn',
          value: props.platformVars.FLUX_IMAGE_ROLE_ARN,
        },
        {
          name: 'imageAutomationController.serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn',
          value: props.platformVars.FLUX_IMAGE_ROLE_ARN,
        },
      ],
    });

    // ── SSH credentials (read from AWS Secrets Manager) ───────────────────
    // Private key and known_hosts are stored in SM (not in source control or
    // env vars). Values still flow through TF state — state is IAM-gated and
    // AES256-encrypted at rest; the SSH key is read-only scoped to one repo.
    const sshPrivateKey = new DataAwsSecretsmanagerSecretVersion(
      this,
      'flux-ssh-private-key',
      { secretId: props.sshPrivateKeySecretId }
    );
    const sshKnownHosts = new DataAwsSecretsmanagerSecretVersion(
      this,
      'flux-ssh-known-hosts',
      { secretId: props.sshKnownHostsSecretId }
    );

    // ── GitHub auth secret ────────────────────────────────────────────────
    // SSH deploy key: single-repo scope, read-only, no personal account dependency.
    const gitAuthSecret = new Secret(this, 'flux-git-auth', {
      metadata: { name: 'flux-git-auth', namespace: this.namespace },
      data: {
        identity: sshPrivateKey.secretString,
        known_hosts: sshKnownHosts.secretString,
      },
    });

    // ── Platform vars ConfigMap ───────────────────────────────────────────
    // Flux postBuild.substituteFrom replaces ${VAR} in all manifests under
    // the Kustomization path at reconciled time.
    const platformVarsConfigMap = new ConfigMap(this, 'flux-platform-vars', {
      metadata: { name: 'platform-vars', namespace: this.namespace },
      data: {
        ...props.platformVars,
        OIDC_PROVIDER_URL: oidcProviderUrlStripped,
      },
    });

    // ── GitRepository source ──────────────────────────────────────────────
    new Manifest(this, 'flux-git-repository', {
      manifest: {
        apiVersion: 'source.toolkit.fluxcd.io/v1',
        kind: 'GitRepository',
        metadata: { name: 'flux-system', namespace: this.namespace },
        spec: {
          interval: '1m0s',
          url: props.gitRepoUrl,
          ref: { branch: props.gitBranch ?? 'feature/initial-seed' },
          secretRef: { name: 'flux-git-auth' },
        },
      },
      dependsOn: [fluxRelease, gitAuthSecret],
    });

    // ── Platform Kustomization ────────────────────────────────────────────
    // Points at platforms/{stage}/platform/ which in turn includes
    // base/platform/ via Kustomize resources reference.
    const platformPath =
      props.gitPath ?? './infra/gitops-seed/platforms/core/platform';

    new Manifest(this, 'flux-platform-kustomization', {
      manifest: {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'platform', namespace: this.namespace },
        spec: {
          interval: '5m0s',
          retryInterval: '1m0s',
          path: platformPath,
          prune: true,
          wait: true,
          timeout: '15m0s',
          sourceRef: { kind: 'GitRepository', name: 'flux-system' },
          postBuild: {
            substituteFrom: [{ kind: 'ConfigMap', name: 'platform-vars' }],
          },
        },
      },
      dependsOn: [fluxRelease, platformVarsConfigMap],
    });

    // ── Apps Kustomization ────────────────────────────────────────────────
    // Mirrors the platform path structure: environments/{stage}/apps/
    const appsPath = platformPath.replace('/platform', '/apps');

    new Manifest(this, 'flux-apps-kustomization', {
      manifest: {
        apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
        kind: 'Kustomization',
        metadata: { name: 'apps', namespace: this.namespace },
        spec: {
          interval: '5m0s',
          retryInterval: '1m0s',
          path: appsPath,
          prune: true,
          wait: false,
          timeout: '10m0s',
          sourceRef: { kind: 'GitRepository', name: 'flux-system' },
          dependsOn: [{ name: 'platform' }],
          postBuild: {
            substituteFrom: [{ kind: 'ConfigMap', name: 'platform-vars' }],
          },
        },
      },
      dependsOn: [fluxRelease],
    });
  }
}
