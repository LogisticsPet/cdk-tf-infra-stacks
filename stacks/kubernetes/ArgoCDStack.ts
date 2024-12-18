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
  constructor(scope: Construct, id: string, props: ArgoCDStackProps) {
    super(scope, id);

    new TerraformHclModule(this, 'argo-cd', {
      source: 'github.com/LogisticsPet/terraform-aws-argo-cd?ref=feature/cdktf',
      variables: {
        domain: props.domain,
        certificate_issuer: props.certIssuer,
        cluster_name: props.clusterName,
        namespace: props.namespace,
      },
    });
  }
}
