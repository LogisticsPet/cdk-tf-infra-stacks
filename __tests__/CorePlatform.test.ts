import { Testing } from 'cdktf';
import CorePlatform from '../platforms/CorePlatform';
import FluxConfigStack from '../stacks/kubernetes/FluxConfigStack';
import CleanupStack from '../stacks/kubernetes/CleanupStack';
import { CORE_CLUSTER_NAME, GITOPS_PLATFORM_PATH } from '../util/constants';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const TEST_STAGE = 'core';

const TEST_PROPS = {
  stage: TEST_STAGE,
  rootDomain: 'example.com',
  backend: { bucket: 'test-state-bucket' },
};

const TEST_SECRETS = {
  aws: {
    region: 'eu-central-1',
    roleArn: 'arn:aws:iam::123456789012:role/test-role',
    accountId: '123456789012',
  },
  cloudflare: { apiToken: 'test-cf-token' },
  github: {
    gitopsRepoUrl: 'ssh://git@github.com/LogisticsPet/gitops-seed',
    sshPrivateKeySecretId: 'logistics/flux/ssh-private-key',
    sshKnownHostsSecretId: 'logistics/flux/ssh-known-hosts',
  },
  acme: {
    email: 'test@example.com',
    server: 'https://acme-staging-v02.api.letsencrypt.org/directory',
  },
};

const FLUX_CONFIG_PROPS = {
  clusterName: CORE_CLUSTER_NAME,
  region: 'eu-central-1',
  gitRepoUrl: 'ssh://git@github.com/LogisticsPet/gitops-seed',
  gitBranch: 'main',
  gitPath: GITOPS_PLATFORM_PATH(TEST_STAGE),
};

const CLEANUP_PROPS = {
  clusterName: CORE_CLUSTER_NAME,
  region: 'eu-central-1',
};

// ─── CorePlatform: structural tests ──────────────────────────────────────────

describe('CorePlatform stack composition', () => {
  test('creates 9 child stacks with expected IDs', () => {
    const app = Testing.app();
    new CorePlatform(app, 'core', TEST_PROPS, TEST_SECRETS);

    const core = app.node.findChild('core');
    const childIds = core.node.children.map((c) => c.node.id).sort();

    expect(childIds).toEqual([
      'core-cleanup',
      'core-cloudflare-dns',
      'core-core-eks',
      'core-crossplane-aws-iam-role',
      'core-flux',
      'core-flux-config',
      'core-flux-image-iam-role',
      'core-route53-zone',
      'core-vpc',
    ]);
  });

  test('enforces destroy order: cleanup → flux-config → flux', () => {
    const app = Testing.app();
    new CorePlatform(app, 'core', TEST_PROPS, TEST_SECRETS);

    const core = app.node.findChild('core');
    const cleanup = core.node.findChild('core-cleanup') as CleanupStack;
    const fluxConfig = core.node.findChild(
      'core-flux-config'
    ) as FluxConfigStack;

    const cleanupDepIds = cleanup.dependencies.map((d) => d.node.id);
    expect(cleanupDepIds).toContain('core-flux-config');

    const fluxConfigDepIds = fluxConfig.dependencies.map((d) => d.node.id);
    expect(fluxConfigDepIds).toContain('core-flux');
  });

  test('gitops platform path resolves stage into directory name', () => {
    expect(GITOPS_PLATFORM_PATH('core')).toBe('./platforms/core/platform');
    expect(GITOPS_PLATFORM_PATH('dev')).toBe('./platforms/dev/platform');
  });
});

// ─── FluxConfigStack: 5-tier kustomization snapshot ──────────────────────────

describe('FluxConfigStack', () => {
  test('snapshot: full 5-tier kustomization structure', () => {
    const app = Testing.app();
    const stack = new FluxConfigStack(
      app,
      'test-flux-config',
      FLUX_CONFIG_PROPS
    );
    expect(JSON.parse(Testing.synth(stack))).toMatchSnapshot();
  });

  test('derives each tier path from the platform path by suffix replacement', () => {
    const app = Testing.app();
    const stack = new FluxConfigStack(
      app,
      'test-flux-config',
      FLUX_CONFIG_PROPS
    );
    const raw = Testing.synth(stack);

    expect(raw).toContain('./platforms/core/platform-bootstrap');
    expect(raw).toContain('./platforms/core/platform-providers');
    expect(raw).toContain('./platforms/core/platform-post');
    expect(raw).toContain('./platforms/core/apps');
    // Tier 3 is the platform path itself
    expect(raw).toContain('./platforms/core/platform');
  });

  test('tiers 1-4 have wait=true; apps tier has wait=false', () => {
    const app = Testing.app();
    const stack = new FluxConfigStack(
      app,
      'test-flux-config',
      FLUX_CONFIG_PROPS
    );
    const raw = Testing.synth(stack);

    // CDKTF renders Fn.jsonencode() as HCL syntax: "key" = value.
    // raw is a JSON string so the HCL quotes are JSON-escaped: \"wait\" = true.
    // Regex \\" matches a literal backslash followed by a quote in the raw string.
    const trueCount = (raw.match(/\\"wait\\" = true/g) ?? []).length;
    const falseCount = (raw.match(/\\"wait\\" = false/g) ?? []).length;

    expect(trueCount).toBe(4);
    expect(falseCount).toBe(1);
  });

  test('all 5 kustomizations reference platform-vars ConfigMap via postBuild.substituteFrom', () => {
    const app = Testing.app();
    const stack = new FluxConfigStack(
      app,
      'test-flux-config',
      FLUX_CONFIG_PROPS
    );
    const raw = Testing.synth(stack);

    // Every kustomization must carry the substituteFrom reference so that
    // ${VAR} placeholders in gitops-seed manifests are resolved at reconcile time.
    // HCL inside jsonencode: "name" = "platform-vars" → JSON-escaped: \"name\" = \"platform-vars\"
    const matches = raw.match(/\\"name\\" = \\"platform-vars\\"/g) ?? [];
    expect(matches.length).toBe(5);
  });
});

// ─── CleanupStack: pre-destroy script regression guards ──────────────────────

describe('CleanupStack', () => {
  test('snapshot: pre-destroy terraform_data resource', () => {
    const app = Testing.app();
    const stack = new CleanupStack(app, 'test-cleanup', CLEANUP_PROPS);
    expect(JSON.parse(Testing.synth(stack))).toMatchSnapshot();
  });

  test('CLEAN-01: suspension uses xargs, not kubectl patch --all', () => {
    const app = Testing.app();
    const stack = new CleanupStack(app, 'test-cleanup', CLEANUP_PROPS);
    const raw = Testing.synth(stack);

    // Regression guard: kubectl patch does not support --all flag.
    // The fix replaces the single patch call with: kubectl get ... -o name | xargs kubectl patch
    expect(raw).not.toMatch(/kubectl patch kustomizations/);
    expect(raw).toContain(
      'kubectl get kustomizations.kustomize.toolkit.fluxcd.io'
    );
    expect(raw).toContain('xargs -r kubectl patch');
  });

  test('CLEAN-01: LB poll uses grep | wc -l, not grep -c || echo 0', () => {
    const app = Testing.app();
    const stack = new CleanupStack(app, 'test-cleanup', CLEANUP_PROPS);
    const raw = Testing.synth(stack);

    // Regression guard: grep -c exits 1 on no matches; combined with || echo 0
    // the subshell captured both outputs ("0\n0"), making the count never equal "0".
    // raw is a JSON string so shell double-quotes are escaped as \"; avoid them in the search.
    expect(raw).not.toContain('grep -c');
    // The fix: pipe through wc -l and strip whitespace with tr -d
    expect(raw).toContain('| wc -l | tr -d');
  });

  test('passes cluster name and region into the environment block', () => {
    const app = Testing.app();
    const stack = new CleanupStack(app, 'test-cleanup', CLEANUP_PROPS);
    const raw = Testing.synth(stack);

    expect(raw).toContain('"CLUSTER_NAME"');
    expect(raw).toContain(CORE_CLUSTER_NAME);
    expect(raw).toContain('"REGION"');
    expect(raw).toContain('eu-central-1');
  });
});
