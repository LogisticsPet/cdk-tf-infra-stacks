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

    const module = new TerraformHclModule(this, 'iam-role-for-sa', {
      source:
        'github.com/LogisticsPet/terraform-gitops-repo?ref=feature/initial',
      variables: {
        ...props,
      },
    });

    this.outputs = {
      url: module.getString('http_url'),
    };
  }
}
