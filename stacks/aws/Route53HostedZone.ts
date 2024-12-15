import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';

interface Route53HostedZoneProps {
  domain: string;
}
interface Route53HostedZoneOutputs {
  nameServers: string[];
  zoneArn: string;
  zoneId: string;
}

export default class Route53HostedZone extends CustomTerraformStack {
  public readonly outputs: Route53HostedZoneOutputs;

  constructor(scope: Construct, id: string, props: Route53HostedZoneProps) {
    super(scope, id);

    const module = new TerraformHclModule(this, 'route53-hosted-zone', {
      source: 'github.com/LogisticsPet/terraform-aws-route53?ref=0.0.4',
      variables: {
        domain: props.domain,
      },
    });

    this.outputs = {
      nameServers: module.getList('nameservers'),
      zoneArn: module.getString('zone_arn'),
      zoneId: module.getString('zone_id'),
    };
  }
}
