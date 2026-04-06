import CustomTerraformStack from '../CustomTerraformStack';
import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';

interface IamRoleForKubernetesSAProps {
  name: string;
  /** Map of { label: policyArn } attached via role_policy_arns. */
  rolePolicyArns: Record<string, string>;
  oidcProviderArn: string;
  namespace: string;
  serviceAccountName: string;
  /**
   * IAM condition test for the OIDC sub claim.
   * Use 'StringLike' with a wildcard serviceAccountName (e.g. 'provider-aws-iam*')
   * when the SA name is not known at deploy time (e.g. Crossplane adds a hash suffix).
   * Defaults to 'StringEquals'.
   */
  assumeRoleConditionTest?: 'StringEquals' | 'StringLike';
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
        role_policy_arns: props.rolePolicyArns,
        ...(props.assumeRoleConditionTest && {
          assume_role_condition_test: props.assumeRoleConditionTest,
        }),
      },
    });

    this.outputs = {
      iamRoleArn: module.getString('iam_role_arn'),
    };
  }
}
