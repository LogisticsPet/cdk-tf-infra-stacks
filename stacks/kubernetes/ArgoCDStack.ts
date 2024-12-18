import { Construct } from 'constructs';
import CustomTerraformStack from '../CustomTerraformStack';
import { TerraformHclModule } from 'cdktf';

interface ArgoCDStackProps {
  domain: string;
  certIssuer: string;
  clusterName: string;
  clusterCa: string;
  namespace: string;
}

export default class ArgoCDStack extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: ArgoCDStackProps) {
    super(scope, id);

    new TerraformHclModule(this, 'eks-ingress-controller', {
      source:
        'github.com/LogisticsPet/terraform-aws-argo-cd?ref=heads/feature/cdktf',
      variables: {
        domain: props.domain,
        certificate_issuer: props.certIssuer,
        cluster_name: props.clusterName,
        cluster_ca: props.clusterCa,
        namespace: props.namespace,
      },
    });
  }
}
