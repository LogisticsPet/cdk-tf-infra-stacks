import { Construct } from 'constructs';
import CloudFlareDnsRecords from '../stacks/cloudflare/CloudFlareDnsRecords';
import Route53HostedZone from '../stacks/aws/Route53HostedZone';
import ElasticKubernetesService from '../stacks/aws/ElasticKubernetesService';
import VirtualPrivateCloud from '../stacks/aws/VirtualPrivateCloud';
import { S3Backend } from 'cdktf';
import ArgoCDStack from '../stacks/kubernetes/ArgoCDStack';
import {
  ARGO_NAMESPACE,
  ARGO_TOOLING_PROJECT_NAME,
  CERT_MANAGER_CLUSTER_ISSUER_NAME,
  CORE_CLUSTER_NAME,
  IAM_ROLE_ATTACH_POLICIES,
  NAMESPACED_SERVICE_ACCOUNTS,
} from '../util/constants';
import IamRoleForKubernetesSA from '../stacks/aws/IamRoleForKubernetesSA';
import { GithubProvider } from '@cdktf/provider-github/lib/provider';
import GitOpsRepo from '../stacks/github/GitOpsRepo';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';
import { SecretV1 } from '@cdktf/provider-kubernetes/lib/secret-v1';
import { Manifest } from '@cdktf/provider-kubernetes/lib/manifest';
import CustomTerraformStack from '../stacks/CustomTerraformStack';
import EksClusterAuth from '../stacks/aws/EksClusterAuth';

interface CorePlatformProps {
  stage: string;
  rootDomain: string;
  eksConfig: {
    instanceType: string;
    nodeGroupMaxSize: number;
    nodeGroupMinSize: number;
  };
  backend: {
    bucket: string;
    dynamodbTable: string;
  };
}

interface CorePlatformSecrets {
  cloudflare: {
    apiToken: string;
  };
  aws: {
    region: string;
  };
  github: {
    org: string;
    token: string;
  };
}

export default class CorePlatform extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: CorePlatformProps,
    secrets: CorePlatformSecrets
  ) {
    super(scope, id);

    const route53HostedZone = new Route53HostedZone(
      this,
      `${id}-route53-zone`,
      {
        domain: `${props.stage}.${props.rootDomain}`,
      }
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

    const vpc = new VirtualPrivateCloud(this, `${id}-vpc`, {
      stack: props.stage,
    });

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
        node: {
          instanceType: props.eksConfig.instanceType,
          groupMaxSize: props.eksConfig.nodeGroupMaxSize,
          groupMinSize: props.eksConfig.nodeGroupMinSize,
        },
      }
    );

    const argoCd = new ArgoCDStack(this, `${id}-${CORE_CLUSTER_NAME}-argo-cd`, {
      domain: `argo.${props.stage}.${props.rootDomain}`,
      certIssuer: `${props.stage}-${CERT_MANAGER_CLUSTER_ISSUER_NAME}`,
      clusterName: eks.outputs.clusterName,
      clusterCa: eks.outputs.clusterInfo.ca,
      namespace: ARGO_NAMESPACE,
    });

    const iamRoleForToolingSA = new IamRoleForKubernetesSA(
      this,
      `${id}-${CORE_CLUSTER_NAME}-iam-role`,
      {
        policies: IAM_ROLE_ATTACH_POLICIES,
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespacedServiceAccounts: NAMESPACED_SERVICE_ACCOUNTS,
        additionalVars: {
          external_dns_hosted_zone_arns: route53HostedZone.outputs.zoneArn,
          cert_manager_hosted_zone_arns: route53HostedZone.outputs.zoneArn,
        },
      }
    );

    // Create GitOps Repo templating all files.
    new GithubProvider(this, `${id}-github`, {
      organization: secrets.github.org,
      token: secrets.github.token,
    });

    const gitopsRepo = new GitOpsRepo(this, `${id}-gitopsRepo`, {
      platform: 'core',
      templateVariables: {
        projectName: ARGO_TOOLING_PROJECT_NAME,
        argoNamespace: ARGO_NAMESPACE,
        serviceAccountAnnotations: {
          'eks.amazonaws.com/role-arn': iamRoleForToolingSA.outputs.iamRoleArn,
          'eks.amazonaws.com/sts-regional-endpoints': 'true',
        },
      },
    });

    const clusterAuth = new EksClusterAuth(
      this,
      `${CORE_CLUSTER_NAME}-auth`,
      CORE_CLUSTER_NAME
    );

    new KubernetesProvider(this, `${props.stage}-kubernetes`, {
      host: clusterAuth.outputs.endpoint,
      clusterCaCertificate: clusterAuth.outputs.ca,
      token: clusterAuth.outputs.token,
    });

    new SecretV1(this, `${id}-core-gitops-argo-repo`, {
      metadata: {
        namespace: ARGO_NAMESPACE,
        name: 'core-gitops-repo',
        labels: {
          'argocd.argoproj.io/secret-type': 'repository',
        },
      },
      data: {
        project: ARGO_TOOLING_PROJECT_NAME,
        type: 'git',
        url: gitopsRepo.outputs.url,
        username: secrets.github.org,
        password: secrets.github.token,
      },
    });

    new Manifest(this, `${id}-argo-app`, {
      manifest: {
        apiVersion: 'argoproj.io/v1alpha1', // Argo CD CRD API group
        kind: 'Application',
        metadata: {
          name: `${id}-argo-app`,
          namespace: ARGO_NAMESPACE,
        },
        spec: {
          project: 'default',
          source: {
            repoURL: gitopsRepo.outputs.url,
            targetRevision: 'HEAD',
            path: './',
          },
          destination: {
            server: 'https://kubernetes.default.svc',
            namespace: '*',
          },
          syncPolicy: {
            automated: {
              prune: true,
              selfHeal: true,
            },
            syncOptions: ['CreateNamespace=true'],
          },
        },
      },
    });

    [
      route53HostedZone,
      cloudFlareDnsRecords,
      vpc,
      eks,
      argoCd,
      iamRoleForToolingSA,
      gitopsRepo,
    ].forEach((stack: CustomTerraformStack) => {
      new S3Backend(stack, {
        bucket: props.backend.bucket,
        dynamodbTable: props.backend.dynamodbTable,
        key: `${props.stage}/${secrets.aws.region}/core/${stack.node.id.split(`${id}-`)[1]}.tfstate`,
        region: secrets.aws.region,
      });
    });
  }
}
