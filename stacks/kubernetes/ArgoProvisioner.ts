import { Construct } from 'constructs';
import CustomTerraformStack from '../CustomTerraformStack';
import { TerraformHclModule } from 'cdktf';

interface ArgoProvisionerProps {
  clusterName: string;
  argoNamespace: string;
  repoUrl: string;
  projectName?: string;
  githubOrg: string;
  githubToken: string;
}

export default class ArgoProvisioner extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: ArgoProvisionerProps) {
    super(scope, id);

    new TerraformHclModule(this, 'argo-app-provisioner', {
      source:
        'github.com/LogisticsPet/terraform-helm-argo-provisioner?ref=0.0.1',
      variables: {
        cluster_name: props.clusterName,
        argo_namespace: props.argoNamespace,
        repo_url: props.repoUrl,
        project_name: props.projectName,
        github_org: props.githubOrg,
        github_token: props.githubToken,
      },
    });
  }
}
