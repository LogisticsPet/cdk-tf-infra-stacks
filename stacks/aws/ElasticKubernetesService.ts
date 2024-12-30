import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';

interface EksClusterProps {
  stage: string;
  clusterName?: string;
  network: {
    vpcId: string;
    publicSubnetIds: string[];
    privateSubnetIds: string[];
    intraSubnetIds: string[];
  };
  node: {
    instanceType: string;
    groupMaxSize: number;
    groupMinSize: number;
    groupDesiredSize: number;
  };
}

interface EksClusterOutputs {
  clusterName: string;
  clusterInfo: {
    endpoint: string;
    ca: string;
  };
  oidc: {
    providerArn: string;
    providerUrl: string;
  };
}

export default class ElasticKubernetesService extends CustomTerraformStack {
  public readonly outputs: EksClusterOutputs;

  constructor(scope: Construct, id: string, props: EksClusterProps) {
    super(scope, id);

    const module = new TerraformHclModule(this, 'eks-cluster', {
      source: 'github.com/LogisticsPet/terraform-aws-eks?ref=0.0.15',
      variables: {
        stack: props.stage,
        cluster_name: props.clusterName,
        vpc_id: props.network.vpcId,
        public_subnet_ids: props.network.publicSubnetIds,
        private_subnet_ids: props.network.privateSubnetIds,
        intra_subnet_ids: props.network.intraSubnetIds,
        instance_type: props.node.instanceType,
        nodegroup_max_size: props.node.groupMaxSize,
        nodegroup_min_size: props.node.groupMinSize,
        nodegroup_desired_size: props.node.groupDesiredSize,
      },
    });

    this.outputs = {
      clusterName: module.getString('cluster_name'),
      oidc: {
        providerArn: module.getString('oidc_provider_arn'),
        providerUrl: module.getString('oidc_provide_url'),
      },
      clusterInfo: {
        endpoint: module.getString('cluster_endpoint'),
        ca: module.getString('cluster_ca'),
      },
    };
  }
}
