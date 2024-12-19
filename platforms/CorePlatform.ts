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
  SERVICE_ACCOUNTS,
} from '../util/constants';
import IamRoleForKubernetesSA from '../stacks/aws/IamRoleForKubernetesSA';
import GitOpsRepo from '../stacks/github/GitOpsRepo';
import CustomTerraformStack from '../stacks/CustomTerraformStack';
import ArgoProvisioner from '../stacks/kubernetes/ArgoProvisioner';

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

    const argoCd = new ArgoCDStack(this, `${id}-argo-cd`, {
      domain: `argo.${props.stage}.${props.rootDomain}`,
      certIssuer: `${props.stage}-${CERT_MANAGER_CLUSTER_ISSUER_NAME}`,
      clusterName: eks.outputs.clusterName,
      namespace: ARGO_NAMESPACE,
    });

    const iamRoleForToolingSA = new IamRoleForKubernetesSA(
      this,
      `${id}-iam-role`,
      {
        policies: IAM_ROLE_ATTACH_POLICIES,
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespacedServiceAccounts: NAMESPACED_SERVICE_ACCOUNTS,
        additionalVars: {
          cluster_autoscaler_cluster_names: [eks.outputs.clusterName],
          external_dns_hosted_zone_arns: [route53HostedZone.outputs.zoneArn],
          cert_manager_hosted_zone_arns: [route53HostedZone.outputs.zoneArn],
        },
      }
    );

    const gitopsRepo = new GitOpsRepo(
      this,
      `${id}-${ARGO_TOOLING_PROJECT_NAME}-gitops-repo`,
      {
        platform: 'core',

        templateVariables: {
          argo_namespace: ARGO_NAMESPACE,
          project_name: ARGO_TOOLING_PROJECT_NAME,
          apps: [
            {
              certmanager: {
                service_account_name: SERVICE_ACCOUNTS.certManager,
                service_account_annotations: {
                  'eks.amazonaws.com/role-arn':
                    iamRoleForToolingSA.outputs.iamRoleArn,
                  'eks.amazonaws.com/sts-regional-endpoints': 'true',
                },
              },
            },
          ],
        },
      }
    );

    const argoProvision = new ArgoProvisioner(
      this,
      `${id}-${ARGO_TOOLING_PROJECT_NAME}-argo-apps`,
      {
        clusterName: CORE_CLUSTER_NAME,
        argoNamespace: ARGO_NAMESPACE,
        repoUrl: gitopsRepo.outputs.url,
        projectName: ARGO_TOOLING_PROJECT_NAME,
        githubOrg: secrets.github.org,
        githubToken: secrets.github.token,
      }
    );

    [
      route53HostedZone,
      cloudFlareDnsRecords,
      vpc,
      eks,
      argoCd,
      iamRoleForToolingSA,
      gitopsRepo,
      argoProvision,
    ].forEach((stack: CustomTerraformStack) => {
      new S3Backend(stack, {
        bucket: props.backend.bucket,
        dynamodbTable: props.backend.dynamodbTable,
        key: `${props.stage}/${secrets.aws.region}/core/${stack.node.id}.tfstate`,
        region: secrets.aws.region,
      });
    });
  }
}
