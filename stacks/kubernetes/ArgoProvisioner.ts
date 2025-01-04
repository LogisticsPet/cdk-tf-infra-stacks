import { Construct } from 'constructs';
import CustomTerraformStack from '../CustomTerraformStack';
import { TerraformHclModule } from 'cdktf';

interface Application {
  name: string;
  path: string;
  wave?: number;
  destination: Destination;
  git: GitRepo;
}

interface Destination {
  server: string;
  namespace: string;
}

interface GitRepo {
  repository: string;
  organization: string;
  token: string;
}

interface HelmRepo {
  name: string;
  url: string;
}

interface ArgoProvisionerProps {
  clusterName: string;
  argoNamespace: string;
  project: {
    name: string;
    description: string;
    destinations: Destination[];
  };
  helmRepositories: HelmRepo[];
  applications: Application[];
}

export default class ArgoProvisioner extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: ArgoProvisionerProps) {
    super(scope, id);

    new TerraformHclModule(this, 'argo-app-provisioner', {
      source:
        'github.com/LogisticsPet/terraform-helm-argo-provisioner?ref=0.0.4',
      variables: {
        cluster_name: props.clusterName,
        argo_namespace: props.argoNamespace,
        project: props.project,
        helm_repos: props.helmRepositories,
        applications: props.applications,
      },
    });
  }
}
