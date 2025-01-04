import CustomTerraformStack from '../CustomTerraformStack';
import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';

interface GitOpsRepoProps {
  platform: string;
  templateVariables?: {};
}

interface GitOpsRepoOutputs {
  url: string;
}

export default class GitOpsRepo extends CustomTerraformStack {
  public readonly outputs: GitOpsRepoOutputs;

  constructor(scope: Construct, id: string, props: GitOpsRepoProps) {
    super(scope, id);

    const module = new TerraformHclModule(this, 'gitops-repo', {
      source: 'github.com/LogisticsPet/terraform-gitops-repo?ref=0.0.1',
      variables: {
        platform: props.platform,
        template_variables: props.templateVariables,
      },
    });

    this.outputs = {
      url: module.getString('http_url'),
    };
  }
}
