import { App } from 'cdktf';
import CorePlatform from './platforms/CorePlatform';
import { CloudflareProvider } from '@cdktf/provider-cloudflare/lib/provider';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { GithubProvider } from '@cdktf/provider-github/lib/provider';

const app = new App({
  skipValidation: true,
});

const context = app.node.getAllContext();

const stackProps = {
  stage: process.env.STAGE || context.stage,
  rootDomain: process.env.ROOT_DOMAIN || context.rootDomain,
  backend: {
    bucket: process.env.S3_BACKEND_BUCKET || context.s3backend.bucket,
    dynamodbTable:
      process.env.S3_BACKEND_LOCK_TABLE || context.s3backend.dynamodbTable,
  },
  eksConfig: context.eksConfig,
};

const stackSecrets = {
  aws: {
    region: process.env.AWS_REGION || '',
    roleArn: process.env.AWS_ROLE_ARN || '',
  },
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  },
  github: {
    owner: process.env.GITHUB_OWNER || '',
    token: process.env.GITHUB_TOKEN || '',
  },
  acme: {
    email: process.env.ACME_EMAIL || '',
    server: process.env.ACME_SERVER || '',
  },
};

new CloudflareProvider(app, `${stackProps.stage}-cloudflare-provider`, {
  apiToken: stackSecrets.cloudflare.apiToken,
});

new AwsProvider(
  app,
  `${stackProps.stage}-${stackSecrets.aws.region}-aws-provider`,
  {
    region: stackSecrets.aws.region,
  }
);

new GithubProvider(app, 'github', {
  owner: stackSecrets.github.owner,
  token: stackSecrets.github.token,
});

new CorePlatform(app, 'core', stackProps, stackSecrets);

app.synth();
