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
  /** Name of the EC2 node IAM role created by the module for Auto Mode nodes. */
  nodeRoleName: string;
}

export default class ElasticKubernetesService extends CustomTerraformStack {
  public readonly outputs: EksClusterOutputs;

  constructor(scope: Construct, id: string, props: EksClusterProps) {
    super(scope, id);

    const module = new TerraformHclModule(this, 'eks-cluster', {
      source: 'github.com/LogisticsPet/terraform-aws-eks?ref=0.0.16',
      variables: {
        stack: props.stage,
        cluster_name: props.clusterName,
        vpc_id: props.network.vpcId,
        public_subnet_ids: props.network.publicSubnetIds,
        private_subnet_ids: props.network.privateSubnetIds,
        intra_subnet_ids: props.network.intraSubnetIds,
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
      nodeRoleName: module.getString('node_iam_role_name'),
    };
  }
}
