export const CORE_CLUSTER_NAME = 'core-eks';
export const CERT_MANAGER_CLUSTER_ISSUER_NAME = 'acme-cert-issuer';

// ── GitOps path ───────────────────────────────────────────────────────────────
// Path within the gitops-seed repo (github.com/LogisticsPet/gitops-seed).
// The repo root maps directly to the Flux path — no monorepo prefix.
export const GITOPS_PLATFORM_PATH = (stage: string) =>
  `./platforms/${stage}/platform`;

// ── Kubernetes namespaces ─────────────────────────────────────────────────────
export const NAMESPACES = {
  /** Flux controllers live in flux-system by Flux convention. */
  flux: 'flux-system',
  /** Crossplane controllers live in crossplane-system by convention. */
  crossplane: 'crossplane-system',
};

// ── Kubernetes service account names ─────────────────────────────────────────
export const SERVICE_ACCOUNTS = {
  /**
   * Flux image-reflector controller SA.
   * Needs ECR read access via IRSA so Flux can detect new image tags.
   * This is the only service account whose IRSA role is created in CDKTF
   * (required before Flux bootstraps Crossplane, which creates all other roles).
   */
  fluxImageReflector: 'image-reflector-controller',
  /**
   * Crossplane AWS provider controller SA.
   * Needs IAM permissions so it can create IRSA roles for platform tools.
   */
  crossplaneAwsProvider: 'provider-aws-iam',
};

// ── IAM role name suffixes ────────────────────────────────────────────────────
// Bootstrap roles (created by CDKTF) are prefixed with the stage at runtime:
//   `${stage}-${ROLE_NAMES.fluxImageReflector}` → core-flux-image-reflector-irsa
//
// Platform tool roles (created by Crossplane inside Flux) use ${ENV_PREFIX}
// substitution in iam.yaml, which resolves to the same stage value.
// This ensures role names are unique per environment in the same AWS account.
export const ROLE_NAMES = {
  fluxImageReflector: 'flux-image-reflector-irsa',
  crossplaneAwsProvider: 'crossplane-aws-provider-irsa',
};
