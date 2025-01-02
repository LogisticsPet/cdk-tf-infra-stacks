import CustomTerraformStack from '../CustomTerraformStack';
import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';

interface IamRoleForKubernetesSAProps {
  name: string;
  policies: string[];
  oidcProviderArn: string;
  namespace: string;
  serviceAccountName: string;
  additionalVars?: {};
}

interface IamRoleForKubernetesSAOutputs {
  iamRoleArn: string;
}

export default class IamRoleForKubernetesSA extends CustomTerraformStack {
  public readonly outputs: IamRoleForKubernetesSAOutputs;

  constructor(
    scope: Construct,
    id: string,
    props: IamRoleForKubernetesSAProps
  ) {
    super(scope, id);

    const module = new TerraformHclModule(this, id, {
      source:
        'terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks',
      version: '5.51.0',
      variables: {
        role_name: props.name,
        oidc_providers: {
          main: {
            provider_arn: props.oidcProviderArn,
            namespace_service_accounts: [
              `${props.namespace}:${props.serviceAccountName}`,
            ],
          },
        },
        ...generatePolicyStructure(props),
        ...props.additionalVars,
      },
    });

    this.outputs = {
      iamRoleArn: module.getString('iam_role_arn'),
    };
  }
}

const generatePolicyStructure = (
  props: IamRoleForKubernetesSAProps
): Record<string, boolean> => {
  return props.policies.reduce(
    (acc, policy) => {
      acc[policy] = true;
      return acc;
    },
    {} as Record<string, boolean>
  );
};
