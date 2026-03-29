import { App } from 'cdktf';
import CorePlatform from './platforms/CorePlatform';
import { CloudflareProvider } from '@cdktf/provider-cloudflare/lib/provider';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';

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
    // AWS account ID — used to construct deterministic IAM ARNs for Crossplane
    // and to populate the Flux platform-vars ConfigMap.
    accountId: process.env.AWS_ACCOUNT_ID || '',
  },
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  },
  github: {
    // Must be an SSH URL: ssh://git@github.com/<owner>/<repo>
    gitopsRepoUrl: process.env.GITOPS_REPO_URL || '',
    // AWS SM secret IDs created during bootstrap (SEC-02).
    // Defaults match the names used in: aws secretsmanager create-secret --name logistics/flux/...
    sshPrivateKeySecretId:
      process.env.FLUX_SSH_PRIVATE_KEY_SECRET_ID ||
      'logistics/flux/ssh-private-key',
    sshKnownHostsSecretId:
      process.env.FLUX_SSH_KNOWN_HOSTS_SECRET_ID ||
      'logistics/flux/ssh-known-hosts',
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

new CorePlatform(app, 'core', stackProps, stackSecrets);

app.synth();
