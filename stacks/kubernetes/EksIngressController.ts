import CustomTerraformStack from '../CustomTerraformStack';
import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';

interface EksIngressControllerProps {
  stack: string;
  namespace: string;
  clusterName: string;
  serviceAccountName: string;
  serviceAccountAnnotations: object;
  kubeconfig: string;
}

export default class EksIngressController extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: EksIngressControllerProps) {
    super(scope, id);

    new TerraformHclModule(this, 'eks-ingress-controller', {
      source: 'github.com/LogisticsPet/terraform-',
      variables: {
        stack: props.stack,
        cluster_name: props.clusterName,
        namespace: props.namespace,
        service_account_name: props.serviceAccountName,
        service_account_annotations: props.serviceAccountAnnotations,
        kubeconfig: props.kubeconfig,
      },
    });
  }
}
