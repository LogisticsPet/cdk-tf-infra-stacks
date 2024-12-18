import { Construct } from 'constructs';
import CloudFlareDnsRecords from '../stacks/cloudflare/CloudFlareDnsRecords';
import Route53HostedZone from '../stacks/aws/Route53HostedZone';
import ElasticKubernetesService from '../stacks/aws/ElasticKubernetesService';
import VirtualPrivateCloud from '../stacks/aws/VirtualPrivateCloud';
import { S3Backend } from 'cdktf';
import { CORE_CLUSTER_NAME } from '../util/constants';
import { DataAwsEksClusterAuth } from '@cdktf/provider-aws/lib/data-aws-eks-cluster-auth';
import { DataAwsEksCluster } from '@cdktf/provider-aws/lib/data-aws-eks-cluster';
import { KubernetesProvider } from '@cdktf/provider-kubernetes/lib/provider';

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
}

export default class AppPlatform extends Construct {
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

    const eks = new ElasticKubernetesService(this, `${id}-eks-cluster`, {
      stage: props.stage,
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
    });

    const coreCluster = new DataAwsEksCluster(this, 'core-cluster', {
      name: CORE_CLUSTER_NAME,
    });

    const coreClusterAuth = new DataAwsEksClusterAuth(
      this,
      'core-cluster-auth',
      {
        name: CORE_CLUSTER_NAME,
      }
    );

    new KubernetesProvider(this, `${props.stage}-kubernetes`, {
      host: coreCluster.endpoint,
      clusterCaCertificate: coreCluster.certificateAuthority.get(0).data,
      token: coreClusterAuth.token,
    });

    // configure new cluster in argo cd
    // new DataKubernetesSecretV1

    // const iamRoleForToolingSA = new IamRoleForKubernetesSA(this, `${id}-${eks.outputs.clusterName}-iam-role`, {
    //   policies: IAM_ROLE_ATTACH_POLICIES,
    //   oidcProviderArn: eks.outputs.oidc.providerArn,
    //   namespacedServiceAccounts: NAMESPACED_SERVICE_ACCOUNTS,
    //   additionalVars: {
    //     external_dns_hosted_zone_arns: route53HostedZone.outputs.zoneArn,
    //     cert_manager_hosted_zone_arns: route53HostedZone.outputs.zoneArn
    //   }
    // });

    // Create GitOps Repo templating all files.

    [route53HostedZone, cloudFlareDnsRecords, vpc, eks].forEach((stack) => {
      new S3Backend(stack, {
        bucket: props.backend.bucket,
        dynamodbTable: props.backend.dynamodbTable,
        key: `${props.stage}/${secrets.aws.region}/core/${stack.node.id.split(`${id}-`)[1]}.tfstate`,
        region: secrets.aws.region,
      });
    });
  }
}
