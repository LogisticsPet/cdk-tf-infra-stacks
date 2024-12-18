import { Construct } from 'constructs';
import CustomTerraformStack from '../CustomTerraformStack';
import { DataAwsEksCluster } from '@cdktf/provider-aws/lib/data-aws-eks-cluster';
import { DataAwsEksClusterAuth } from '@cdktf/provider-aws/lib/data-aws-eks-cluster-auth';

interface EksClusterAuthOutputs {
  endpoint: string;
  ca: string;
  token: string;
}

export default class EksClusterAuth extends CustomTerraformStack {
  public readonly outputs: EksClusterAuthOutputs;

  constructor(scope: Construct, id: string, clusterName: string) {
    super(scope, id);

    const cluster = new DataAwsEksCluster(this, `${clusterName}-cluster-auth`, {
      name: clusterName,
    });

    const clusterAuth = new DataAwsEksClusterAuth(
      this,
      `${cluster}-cluster-auth`,
      {
        name: clusterName,
      }
    );

    this.outputs = {
      endpoint: cluster.endpoint,
      ca: cluster.certificateAuthority.get(0).data,
      token: clusterAuth.token,
    };
  }
}
