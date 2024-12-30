import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';

interface VpcVariables {
  stack: string;
  cidr?: string;
  zoneCount?: number;
  tags?: {};
}

interface VpcOutputs {
  fqn: string;
  vpcId: string;
  privateSubnetsIds: string[];
  publicSubnetsIds: string[];
  intraSubnetsIds: string[];
}

export default class VirtualPrivateCloud extends CustomTerraformStack {
  public readonly outputs: VpcOutputs;

  constructor(scope: Construct, id: string, props: VpcVariables) {
    super(scope, id);

    const module = new TerraformHclModule(this, 'vpc', {
      source: 'github.com/LogisticsPet/terraform-aws-vpc?ref=0.0.9',
      variables: {
        stack: props.stack,
      },
    });

    this.outputs = {
      fqn: module.fqn,
      vpcId: module.getString('vpc_id'),
      privateSubnetsIds: module.getList('private_subnet_ids'),
      publicSubnetsIds: module.getList('public_subnet_ids'),
      intraSubnetsIds: module.getList('intra_subnet_ids'),
    };
  }
}
