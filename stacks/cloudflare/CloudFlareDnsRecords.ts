import { Construct } from 'constructs';
import { TerraformHclModule } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';

interface CloudFlareDnsProps {
  stage: string;
  rootDomain: string;
  records: string[];
}

export default class CloudFlareDnsRecords extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: CloudFlareDnsProps) {
    super(scope, id);

    new TerraformHclModule(this, 'cloudflare-dns', {
      source:
        'github.com/LogisticsPet/terraform-cloudflare-dns-records?ref=0.0.5',
      variables: {
        root_domain: props.rootDomain,
        domain: `${props.stage}.${props.rootDomain}`,
        records: {
          NS: props.records,
        },
      },
    });
  }
}
