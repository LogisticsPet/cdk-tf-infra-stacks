import { Construct } from 'constructs';
import { Fn } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';
import { Manifest } from '@cdktf/provider-kubernetes/lib/manifest';

export interface FluxConfigStackProps {
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
   * Should be set via GITOPS_PLATFORM_PATH(stage).
   */
  gitPath: string;
}

const FLUX_NAMESPACE = 'flux-system';

/**
 * Applies the Flux CRs (GitRepository + Kustomizations) that require
 * Flux CRDs to already be installed in the cluster.
 *
 * Must be deployed AFTER FluxStack (which installs the flux2 Helm chart).
 * Splitting into a separate stack avoids the kubernetes_manifest plan-time
 * CRD validation error when Flux controllers do not yet exist.
 */
export default class FluxConfigStack extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: FluxConfigStackProps) {
    super(scope, id);

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

    // ── GitRepository source ──────────────────────────────────────────────
    new Manifest(this, 'flux-git-repository', {
      manifest: {
        apiVersion: 'source.toolkit.fluxcd.io/v1',
        kind: 'GitRepository',
        metadata: { name: 'flux-system', namespace: FLUX_NAMESPACE },
        spec: {
          interval: '1m0s',
          url: props.gitRepoUrl,
          ref: { branch: props.gitBranch ?? 'main' },
          secretRef: { name: 'flux-git-auth' },
        },
      },
    });

    // ── Platform Kustomization ────────────────────────────────────────────
    new Manifest(this, 'flux-platform-kustomization', {
      manifest: {
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
      },
    });

    // ── Apps Kustomization ────────────────────────────────────────────────
    const appsPath = props.gitPath.replace('/platform', '/apps');

    new Manifest(this, 'flux-apps-kustomization', {
      manifest: {
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
      },
    });
  }
}
