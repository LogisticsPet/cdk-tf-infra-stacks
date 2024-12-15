import { Construct } from 'constructs';
import CloudFlareDnsRecords from '../stacks/cloudflare/CloudFlareDnsRecords';
import Route53HostedZone from '../stacks/aws/Route53HostedZone';
import ElasticKubernetesService from '../stacks/aws/ElasticKubernetesService';
import VirtualPrivateCloud from '../stacks/aws/VirtualPrivateCloud';
import { S3Backend } from 'cdktf';
import { HelmProvider } from '@cdktf/provider-helm/lib/provider';
import { DataAwsEksClusterAuth } from '@cdktf/provider-aws/lib/data-aws-eks-cluster-auth';
import ArgoCDStack from '../stacks/helm/ArgoCDStack';

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

    [route53HostedZone, cloudFlareDnsRecords, vpc, eks].forEach((stack) => {
      new S3Backend(stack, {
        bucket: props.backend.bucket,
        dynamodbTable: props.backend.dynamodbTable,
        key: `${props.stage}/${secrets.aws.region}/core/${stack.node.id.split(`${id}-`)[1]}.tfstate`,
        region: secrets.aws.region,
      });
    });

    const kubernetesAuth = new DataAwsEksClusterAuth(
      this,
      `${id}-${eks.outputs.clusterName}-auth`,
      {
        name: eks.outputs.clusterName,
      }
    );

    new HelmProvider(this, `${id}-${eks.outputs.clusterName}-helm-provider`, {
      kubernetes: {
        host: eks.outputs.clusterInfo.endpoint,
        token: kubernetesAuth.token,
        clusterCaCertificate: eks.outputs.clusterInfo.ca,
      },
    });

    new ArgoCDStack(this, `${id}-${eks.outputs.clusterName}-argo-cd`, {
      domain: `argo.${props.stage}.${props.rootDomain}`,
      certIssuer: 'issuer',
    });
  }
}
