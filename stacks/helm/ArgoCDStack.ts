import { Construct } from 'constructs';
import { release } from '@cdktf/provider-helm';
import CustomTerraformStack from '../CustomTerraformStack';
import * as yaml from 'js-yaml';

interface ArgoCDStackProps {
  domain: string;
  certIssuer: string;
}

export default class ArgoCDStack extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: ArgoCDStackProps) {
    super(scope, id);

    new release.Release(this, 'argo-cd-helm-release', {
      repository: 'https://argoproj.github.io/argo-helm',
      chart: 'argo-cd',
      name: 'argo-cd',
      version: '7.7.10',
      namespace: 'argo-cd',
      atomic: true,
      values: [
        yaml.dump({
          fullNameOverride: 'argo-cd',
          crds: {
            keep: false,
          },
          'redis-ha': {
            enabled: true,
          },
          controller: {
            replicas: 1,
          },
          repoServer: {
            autoscaling: {
              enabled: true,
              minReplicas: 2,
            },
          },
          applicationSet: {
            replicas: 2,
          },
          global: {
            domain: props.domain,
          },
          server: {
            autoscaling: {
              enabled: true,
              minReplicas: 2,
            },
            ingress: {
              enabled: true,
              ingressClassName: 'nginx',
              annotations: {
                'kubernetes.io/ingress.allow-http': false,
                'nginx.ingress.kubernetes.io/backend-protocol': 'HTTPS',
                'nginx.ingress.kubernetes.io/force-ssl-redirect': true,
                'nginx.ingress.kubernetes.io/auth-tls-verify-client': 'off',
                'nginx.ingress.kubernetes.io/auth-tls-pass-certificate-to-upstream':
                  false,
                'cert-manager.io/cluster-issuer': props.certIssuer,
                'external-dns.alpha.kubernetes.io/hostname': props.domain,
              },
            },
          },
        }),
      ],
    });
  }
}
