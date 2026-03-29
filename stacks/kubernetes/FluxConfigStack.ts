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

    // ── Platform Kustomization ────────────────────────────────────────────
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
        postBuild: {
          substituteFrom: [{ kind: 'ConfigMap', name: 'platform-vars' }],
        },
      },
    });

    // ── Apps Kustomization ────────────────────────────────────────────────
    const appsPath = props.gitPath.replace(/\/platform$/, '/apps');

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
