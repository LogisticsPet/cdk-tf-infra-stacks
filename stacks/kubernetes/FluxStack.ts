import { Construct } from 'constructs';
import { Fn, TerraformResource } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';
import { HelmProvider } from '@cdktf/provider-helm/lib/provider';
import { Release } from '@cdktf/provider-helm/lib/release';
import { Secret } from '@cdktf/provider-kubernetes/lib/secret';
import { ConfigMap } from '@cdktf/provider-kubernetes/lib/config-map';
import { Namespace } from '@cdktf/provider-kubernetes/lib/namespace';
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

    // ── Namespace ─────────────────────────────────────────────────────────
    const fluxNamespace = new Namespace(this, 'flux-namespace', {
      metadata: { name: this.namespace },
    });

    // ── Flux controllers ──────────────────────────────────────────────────
    // On destroy, strip finalizers from all Flux CRs before Helm removes the
    // CRDs.  Without this, the destroy hangs: controllers are gone so nothing
    // processes the finalizers, and Helm cannot delete the CRDs while CRs exist.
    const fluxCrds = [
      'helmreleases.helm.toolkit.fluxcd.io',
      'kustomizations.kustomize.toolkit.fluxcd.io',
      'gitrepositories.source.toolkit.fluxcd.io',
      'helmrepositories.source.toolkit.fluxcd.io',
      'helmcharts.source.toolkit.fluxcd.io',
      'ocirepositories.source.toolkit.fluxcd.io',
      'imageupdateautomations.image.toolkit.fluxcd.io',
      'imagepolicies.image.toolkit.fluxcd.io',
      'imagerepositories.image.toolkit.fluxcd.io',
    ].join(' ');

    const fluxRelease = new Release(this, 'flux-controllers', {
      name: 'flux2',
      repository: 'https://fluxcd-community.github.io/helm-charts',
      chart: 'flux2',
      version: FLUX_CHART_VERSION,
      namespace: this.namespace,
      createNamespace: false,
      atomic: true,
      waitForJobs: true,
      timeout: 900,
      dependsOn: [fluxNamespace],
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

    // ── Flux finalizer cleanup (destroy-time) ─────────────────────────────
    // Destroy provisioners may only reference `self.*` — cross-stack tokens
    // are forbidden.  terraform_data stores clusterName/region in state at
    // apply time; self.input.* resolves to the stored concrete value on destroy.
    // Depends on fluxRelease so destroy order is: this first (strips finalizers)
    // → then fluxRelease (Helm uninstall + CRD removal, no longer blocked).
    const fluxCleanup = new TerraformResource(this, 'flux-finalizer-cleanup', {
      terraformResourceType: 'terraform_data',
      dependsOn: [fluxRelease],
      provisioners: [
        {
          type: 'local-exec',
          when: 'destroy',
          interpreter: ['/bin/bash', '-c'],
          command: `
aws eks update-kubeconfig --name \${self.input.cluster_name} --region \${self.input.region}
for crd in ${fluxCrds}; do
  kubectl get "$crd" -A -o json 2>/dev/null | \\
    jq -r '.items[]? | [.metadata.namespace, .metadata.name] | @tsv' | \\
    while IFS=$'\\t' read -r ns name; do
      kubectl patch "$crd" -n "$ns" "$name" --type=merge -p '{"metadata":{"finalizers":[]}}' 2>/dev/null || true
    done
done
`.trim(),
        },
      ],
    });
    fluxCleanup.addOverride('input', {
      cluster_name: props.clusterName,
      region: props.cluster.region,
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
    new Secret(this, 'flux-git-auth', {
      metadata: { name: 'flux-git-auth', namespace: this.namespace },
      data: {
        identity: sshPrivateKey.secretString,
        known_hosts: sshKnownHosts.secretString,
      },
      dependsOn: [fluxNamespace],
    });

    // ── Platform vars ConfigMap ───────────────────────────────────────────
    // Flux postBuild.substituteFrom replaces ${VAR} in all manifests under
    // the Kustomization path at reconciled time.
    new ConfigMap(this, 'flux-platform-vars', {
      metadata: { name: 'platform-vars', namespace: this.namespace },
      data: {
        ...props.platformVars,
        OIDC_PROVIDER_URL: oidcProviderUrlStripped,
      },
      dependsOn: [fluxNamespace],
    });
  }
}
