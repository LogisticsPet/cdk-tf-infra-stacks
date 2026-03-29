import { Construct } from 'constructs';
import { Fn, TerraformResource } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';
import { DataAwsEksCluster } from '@cdktf/provider-aws/lib/data-aws-eks-cluster';

export interface FluxConfigStackProps {
  /** Static cluster name (e.g. CORE_CLUSTER_NAME). Must NOT be a cross-stack token. */
  clusterName: string;
  /** AWS region — used for `aws eks get-token --region`. Plain string, not a token. */
  region: string;
  /** SSH URL of the GitOps repository, e.g. ssh://git@github.com/owner/repo */
  gitRepoUrl: string;
  gitBranch?: string;
  /**
   * Path inside the repo for the platform Kustomization.
   * Should be set via GITOPS_PLATFORM_PATH(stage).
   */
  gitPath: string;
}

const FLUX_NAMESPACE = 'flux-system';

/**
 * Applies the Flux CRs (GitRepository + Kustomizations) that require
 * Flux CRDs to already be installed in the cluster.
 *
 * Uses the alekc/kubectl provider instead of kubernetes_manifest because
 * kubectl_manifest does NOT validate CRDs at plan time. This is the standard
 * workaround for bootstrapping CRD-dependent resources in Terraform.
 *
 * Must be deployed AFTER FluxStack (which installs the flux2 Helm chart).
 */
export default class FluxConfigStack extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: FluxConfigStackProps) {
    super(scope, id);

    // Resolve cluster endpoint + CA from within this stack using a data source.
    // This avoids cross-stack token references (module.eks-cluster.*) which
    // cannot be resolved by addOverride's escape-hatch serialisation path.
    const eksCluster = new DataAwsEksCluster(this, 'eks-cluster-data', {
      name: props.clusterName,
    });

    const execBlock = {
      api_version: 'client.authentication.k8s.io/v1beta1',
      command: 'aws',
      args: [
        'eks',
        'get-token',
        '--cluster-name',
        props.clusterName,
        '--region',
        props.region,
      ],
    };

    // alekc/kubectl provider — does NOT validate CRDs at plan time.
    // Registered via escape hatch because there is no @cdktf/provider-kubectl package.
    this.addOverride('terraform.required_providers.kubectl', {
      source: 'alekc/kubectl',
      version: '~> 2.0',
    });

    this.addOverride('provider.kubectl', [
      {
        host: eksCluster.endpoint,
        cluster_ca_certificate: Fn.base64decode(
          eksCluster.certificateAuthority.get(0).data
        ),
        exec: [execBlock],
      },
    ]);

    const kubectlManifest = (resourceId: string, manifest: object) => {
      const r = new TerraformResource(this, resourceId, {
        terraformResourceType: 'kubectl_manifest',
        terraformGeneratorMetadata: {
          providerName: 'kubectl',
          providerVersionConstraint: '~> 2.0',
        },
      });
      r.addOverride('yaml_body', Fn.jsonencode(manifest));
      return r;
    };

    const bootstrapPath = props.gitPath.replace(
      /\/platform$/,
      '/platform-bootstrap'
    );
    const providersPath = props.gitPath.replace(
      /\/platform$/,
      '/platform-providers'
    );
    const appsPath = props.gitPath.replace(/\/platform$/, '/apps');

    // ── GitRepository source ──────────────────────────────────────────────
    kubectlManifest('flux-git-repository', {
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      kind: 'GitRepository',
      metadata: { name: 'flux-system', namespace: FLUX_NAMESPACE },
      spec: {
        interval: '1m0s',
        url: props.gitRepoUrl,
        ref: { branch: props.gitBranch ?? 'main' },
        secretRef: { name: 'flux-git-auth' },
      },
    });

    // ── Tier 1: Bootstrap (Crossplane HelmRelease only) ──────────────────
    // Uses only Flux-native CRDs — applies on a blank cluster.
    // wait: true blocks tier 2 until the Helm chart is deployed and
    // pkg.crossplane.io CRDs are registered.
    kubectlManifest('flux-bootstrap-kustomization', {
      apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
      kind: 'Kustomization',
      metadata: { name: 'platform-bootstrap', namespace: FLUX_NAMESPACE },
      spec: {
        interval: '5m0s',
        retryInterval: '1m0s',
        path: bootstrapPath,
        prune: true,
        wait: true,
        timeout: '15m0s',
        sourceRef: { kind: 'GitRepository', name: 'flux-system' },
        postBuild: {
          substituteFrom: [{ kind: 'ConfigMap', name: 'platform-vars' }],
        },
      },
    });

    // ── Tier 2: Providers (RuntimeConfig + Provider + ProviderConfig) ─────
    // Requires pkg.crossplane.io CRDs from tier 1.
    // wait: true blocks tier 3 until provider-aws-iam is healthy and
    // iam.aws.upbound.io CRDs are registered.
    kubectlManifest('flux-providers-kustomization', {
      apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
      kind: 'Kustomization',
      metadata: { name: 'platform-providers', namespace: FLUX_NAMESPACE },
      spec: {
        interval: '5m0s',
        retryInterval: '1m0s',
        path: providersPath,
        prune: true,
        wait: true,
        timeout: '15m0s',
        sourceRef: { kind: 'GitRepository', name: 'flux-system' },
        dependsOn: [{ name: 'platform-bootstrap' }],
        postBuild: {
          substituteFrom: [{ kind: 'ConfigMap', name: 'platform-vars' }],
        },
      },
    });

    // ── Tier 3: Platform (tools + IAM resources) ──────────────────────────
    // Requires iam.aws.upbound.io CRDs from tier 2.
    kubectlManifest('flux-platform-kustomization', {
      apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
      kind: 'Kustomization',
      metadata: { name: 'platform', namespace: FLUX_NAMESPACE },
      spec: {
        interval: '5m0s',
        retryInterval: '1m0s',
        path: props.gitPath,
        prune: true,
        wait: true,
        timeout: '15m0s',
        sourceRef: { kind: 'GitRepository', name: 'flux-system' },
        dependsOn: [{ name: 'platform-providers' }],
        postBuild: {
          substituteFrom: [{ kind: 'ConfigMap', name: 'platform-vars' }],
        },
      },
    });

    // ── Apps Kustomization ────────────────────────────────────────────────

    kubectlManifest('flux-apps-kustomization', {
      apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
      kind: 'Kustomization',
      metadata: { name: 'apps', namespace: FLUX_NAMESPACE },
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
    });
  }
}
