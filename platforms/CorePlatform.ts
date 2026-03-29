import { Construct } from 'constructs';
import { S3Backend } from 'cdktf';
import CloudFlareDnsRecords from '../stacks/cloudflare/CloudFlareDnsRecords';
import Route53HostedZone from '../stacks/aws/Route53HostedZone';
import ElasticKubernetesService from '../stacks/aws/ElasticKubernetesService';
import VirtualPrivateCloud from '../stacks/aws/VirtualPrivateCloud';
import IamRoleForKubernetesSA from '../stacks/aws/IamRoleForKubernetesSA';
import FluxStack from '../stacks/kubernetes/FluxStack';
import FluxConfigStack from '../stacks/kubernetes/FluxConfigStack';
import CustomTerraformStack from '../stacks/CustomTerraformStack';
import {
  CERT_MANAGER_CLUSTER_ISSUER_NAME,
  CIDR_MAPPINGS,
  CORE_CLUSTER_NAME,
  GITOPS_PLATFORM_PATH,
  NAMESPACES,
  ROLE_NAMES,
  SERVICE_ACCOUNTS,
} from '../util/constants';

interface CorePlatformProps {
  stage: string;
  rootDomain: string;
  backend: {
    bucket: string;
  };
}

interface CorePlatformSecrets {
  cloudflare: { apiToken: string };
  aws: {
    /** AWS account ID — used to construct deterministic IAM ARNs. */
    accountId: string;
    region: string;
    roleArn: string;
  };
  github: {
    /** SSH URL of the GitOps repository, e.g. ssh://git@github.com/owner/repo */
    gitopsRepoUrl: string;
    /** AWS SM secret ID (name or ARN) for the Flux SSH private key. */
    sshPrivateKeySecretId: string;
    /** AWS SM secret ID (name or ARN) for the Flux SSH known_hosts content. */
    sshKnownHostsSecretId: string;
  };
  acme: { email: string; server: string };
}

export default class CorePlatform extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: CorePlatformProps,
    secrets: CorePlatformSecrets
  ) {
    super(scope, id);

    // ── DNS ────────────────────────────────────────────────────────────────
    const route53HostedZone = new Route53HostedZone(
      this,
      `${id}-route53-zone`,
      { domain: `${props.stage}.${props.rootDomain}` }
    );

    const cloudFlareDnsRecords = new CloudFlareDnsRecords(
      this,
      `${id}-cloudflare-dns`,
      {
        rootDomain: props.rootDomain,
        stage: props.stage,
        records: route53HostedZone.outputs.nameServers,
      }
    );

    // ── Network ────────────────────────────────────────────────────────────
    const vpc = new VirtualPrivateCloud(this, `${id}-vpc`, {
      stack: props.stage,
      cidr: CIDR_MAPPINGS.CORE,
    });

    // ── Compute ────────────────────────────────────────────────────────────
    // Auto Mode is enabled in the Terraform module (cluster_compute_config).
    // The module creates the node IAM role and outputs its name for the NodeClass.
    const eks = new ElasticKubernetesService(
      this,
      `${id}-${CORE_CLUSTER_NAME}`,
      {
        stage: props.stage,
        clusterName: CORE_CLUSTER_NAME,
        network: {
          vpcId: vpc.outputs.vpcId,
          publicSubnetIds: vpc.outputs.publicSubnetsIds,
          privateSubnetIds: vpc.outputs.privateSubnetsIds,
          intraSubnetIds: vpc.outputs.intraSubnetsIds,
        },
      }
    );

    // ── IRSA — Flux image automation (bootstrap: must exist before FluxStack) ──
    // One of two IRSA roles created in CDKTF. Prefixed with stage so that
    // multiple environments in the same AWS account have unique role names.
    const fluxImageIamRole = new IamRoleForKubernetesSA(
      this,
      `${id}-flux-image-iam-role`,
      {
        name: `${props.stage}-${ROLE_NAMES.fluxImageReflector}`,
        rolePolicyArns: {
          ecr_readonly:
            'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
        },
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespace: NAMESPACES.flux,
        serviceAccountName: SERVICE_ACCOUNTS.fluxImageReflector,
      }
    );

    // ── IRSA — Crossplane AWS provider (bootstrap: creates all other roles) ────
    // All platform tool roles (cert-manager, etc.) are created by
    // Crossplane inside Flux.
    const crossplaneIamRole = new IamRoleForKubernetesSA(
      this,
      `${id}-crossplane-aws-iam-role`,
      {
        name: `${props.stage}-${ROLE_NAMES.crossplaneAwsProvider}`,
        rolePolicyArns: {
          admin: 'arn:aws:iam::aws:policy/AdministratorAccess',
        },
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespace: NAMESPACES.crossplane,
        serviceAccountName: SERVICE_ACCOUNTS.crossplaneAwsProvider,
      }
    );

    // ── GitOps — Flux ──────────────────────────────────────────────────────
    // Points at infra/gitops-seed/platforms/{stage}/platform in this monorepo.
    // Each platform resolves to its own path; the base/ layer is shared
    // via Kustomize resources references inside those platform directories.
    const clusterRef = {
      endpoint: eks.outputs.clusterInfo.endpoint,
      ca: eks.outputs.clusterInfo.ca,
      region: secrets.aws.region,
    };

    // Step 1: install Flux controllers + SSH secret + platform-vars ConfigMap.
    const flux = new FluxStack(this, `${id}-flux`, {
      clusterName: eks.outputs.clusterName,
      cluster: clusterRef,
      sshPrivateKeySecretId: secrets.github.sshPrivateKeySecretId,
      sshKnownHostsSecretId: secrets.github.sshKnownHostsSecretId,
      imageAutomation: true,
      platformVars: {
        ENV_PREFIX: props.stage,

        CROSSPLANE_ROLE_ARN: crossplaneIamRole.outputs.iamRoleArn,

        OIDC_PROVIDER_ARN: eks.outputs.oidc.providerArn,
        OIDC_PROVIDER_URL: eks.outputs.oidc.providerUrl,
        AWS_ACCOUNT_ID: secrets.aws.accountId,

        FLUX_IMAGE_ROLE_ARN: fluxImageIamRole.outputs.iamRoleArn,

        CLUSTER_NAME: eks.outputs.clusterName,
        AWS_REGION: secrets.aws.region,
        VPC_ID: vpc.outputs.vpcId,
        EKS_NODE_ROLE_NAME: eks.outputs.nodeRoleName,

        HOSTED_ZONE_ID: route53HostedZone.outputs.zoneId,
        HOSTED_ZONE_ARN: route53HostedZone.outputs.zoneArn,

        CERT_ISSUER_NAME: `${props.stage}-${CERT_MANAGER_CLUSTER_ISSUER_NAME}`,
        ACME_EMAIL: secrets.acme.email,
        ACME_SERVER: secrets.acme.server,
      },
    });

    // Step 2: apply Flux CRs (GitRepository + Kustomizations).
    // Uses kubectl_manifest (alekc/kubectl) which skips CRD validation at plan
    // time. Stack-level dependency ensures core-flux is fully applied first.
    // clusterName and region are plain strings (not cross-stack tokens) so that
    // addOverride's escape-hatch path resolves them correctly.
    const fluxConfig = new FluxConfigStack(this, `${id}-flux-config`, {
      clusterName: CORE_CLUSTER_NAME,
      region: secrets.aws.region,
      gitRepoUrl: secrets.github.gitopsRepoUrl,
      gitBranch: 'feature/initial',
      gitPath: GITOPS_PLATFORM_PATH(props.stage),
    });

    fluxConfig.addDependency(flux);

    // ── S3 remote state ────────────────────────────────────────────────────
    [
      route53HostedZone,
      cloudFlareDnsRecords,
      vpc,
      eks,
      flux,
      fluxConfig,
      fluxImageIamRole,
      crossplaneIamRole,
    ].forEach((stack: CustomTerraformStack) => {
      new S3Backend(stack, {
        bucket: props.backend.bucket,
        // TODO: add useLockfile: true once CDKTF adds S3BackendConfig support
        // (use_lockfile = S3 native locking, replaces deprecated dynamodb_table)
        key: `${props.stage}/${secrets.aws.region}/${stack.node.id}.tfstate`,
        region: secrets.aws.region,
      });
    });
  }
}
