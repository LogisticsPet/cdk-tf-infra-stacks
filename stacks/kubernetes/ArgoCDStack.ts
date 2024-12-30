import { Construct } from 'constructs';
import CustomTerraformStack from '../CustomTerraformStack';
import { TerraformHclModule } from 'cdktf';

interface ArgoCDStackProps {
  domain: string;
  certIssuer: string;
  clusterName: string;
  namespace: string;
}

export default class ArgoCDStack extends CustomTerraformStack {
  public readonly namespace: string;

  constructor(scope: Construct, id: string, props: ArgoCDStackProps) {
    super(scope, id);

    const module = new TerraformHclModule(this, 'argo-cd', {
      source: 'github.com/LogisticsPet/terraform-aws-argo-cd?ref=0.0.3',
      variables: {
        domain: props.domain,
        certificate_issuer: props.certIssuer,
        cluster_name: props.clusterName,
        namespace: props.namespace,
      },
    });

    this.namespace = module.getString('namespace');
  }
}
