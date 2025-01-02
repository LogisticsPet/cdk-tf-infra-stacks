import { Construct } from 'constructs';
import CloudFlareDnsRecords from '../stacks/cloudflare/CloudFlareDnsRecords';
import Route53HostedZone from '../stacks/aws/Route53HostedZone';
import ElasticKubernetesService from '../stacks/aws/ElasticKubernetesService';
import VirtualPrivateCloud from '../stacks/aws/VirtualPrivateCloud';
import { S3Backend } from 'cdktf';
import ArgoCDStack from '../stacks/kubernetes/ArgoCDStack';
import {
  ARGO_TOOLING_PROJECT_NAME,
  CERT_MANAGER_CLUSTER_ISSUER_NAME,
  CORE_CLUSTER_NAME,
  NAMESPACES,
  SERVICE_ACCOUNTS,
} from '../util/constants';
import IamRoleForKubernetesSA from '../stacks/aws/IamRoleForKubernetesSA';
import GitOpsRepo from '../stacks/github/GitOpsRepo';
import CustomTerraformStack from '../stacks/CustomTerraformStack';
import ArgoProvisioner from '../stacks/kubernetes/ArgoProvisioner';
import * as jsyaml from 'js-yaml';

interface CorePlatformProps {
  stage: string;
  rootDomain: string;
  eksConfig: {
    instanceType: string;
    nodeGroupMaxSize: number;
    nodeGroupMinSize: number;
    nodeGroupDesiredSize: number;
  };
  backend: {
    bucket: string;
    dynamodbTable: string;
  };
}

interface CorePlatformSecrets {
  cloudflare: {
    apiToken: string;
  };
  aws: {
    region: string;
  };
  github: {
    owner: string;
    token: string;
  };
  acme: {
    email: string;
    server: string;
  };
}

export default class CorePlatform extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: CorePlatformProps,
    secrets: CorePlatformSecrets
  ) {
    super(scope, id);

    const route53HostedZone = new Route53HostedZone(
      this,
      `${id}-route53-zone`,
      {
        domain: `${props.stage}.${props.rootDomain}`,
      }
    );

    const cloudFlareDnsRecords = new CloudFlareDnsRecords(
      this,
      `${id}-cloudflare-dns`,
      {
        rootDomain: props.rootDomain,
        stage: props.stage,
        records: route53HostedZone.outputs.nameServers,
      }
    );

    const vpc = new VirtualPrivateCloud(this, `${id}-vpc`, {
      stack: props.stage,
    });

    const eks = new ElasticKubernetesService(
      this,
      `${id}-${CORE_CLUSTER_NAME}`,
      {
        stage: props.stage,
        clusterName: CORE_CLUSTER_NAME,
        network: {
          vpcId: vpc.outputs.vpcId,
          publicSubnetIds: vpc.outputs.publicSubnetsIds,
          privateSubnetIds: vpc.outputs.privateSubnetsIds,
          intraSubnetIds: vpc.outputs.intraSubnetsIds,
        },
        node: {
          instanceType: props.eksConfig.instanceType,
          groupMaxSize: props.eksConfig.nodeGroupMaxSize,
          groupMinSize: props.eksConfig.nodeGroupMinSize,
          groupDesiredSize: props.eksConfig.nodeGroupDesiredSize,
        },
      }
    );

    const argoCd = new ArgoCDStack(this, `${id}-argo-cd`, {
      domain: `${props.stage}.${props.rootDomain}`,
      certIssuer: `${props.stage}-${CERT_MANAGER_CLUSTER_ISSUER_NAME}`,
      clusterName: eks.outputs.clusterName,
      namespace: 'argocd',
    });

    const certManagerIamRole = new IamRoleForKubernetesSA(
      this,
      `${id}-cert-manager-iam-role`,
      {
        name: `${id}-cert-manager-iam-role`,
        policies: ['attach_cert_manager_policy'],
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespace: NAMESPACES.certManager,
        serviceAccountName: SERVICE_ACCOUNTS.certManager,
        additionalVars: {
          cert_manager_hosted_zone_arns: [route53HostedZone.outputs.zoneArn],
        },
      }
    );

    const clusterAutoscalerIamRole = new IamRoleForKubernetesSA(
      this,
      `${id}-cluster-autoscaler-iam-role`,
      {
        name: `${id}-cluster-autoscaler-iam-role`,
        policies: ['attach_cluster_autoscaler_policy'],
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespace: NAMESPACES.clusterAutoscaler,
        serviceAccountName: SERVICE_ACCOUNTS.clusterAutoscaler,
        additionalVars: {
          cluster_autoscaler_cluster_names: [eks.outputs.clusterName],
        },
      }
    );

    const externalDnsIamRole = new IamRoleForKubernetesSA(
      this,
      `${id}-external-dns-iam-role`,
      {
        name: `${id}-external-dns-iam-role`,
        policies: ['attach_external_dns_policy'],
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespace: NAMESPACES.externalDns,
        serviceAccountName: SERVICE_ACCOUNTS.externalDns,
        additionalVars: {
          external_dns_hosted_zone_arns: [route53HostedZone.outputs.zoneArn],
        },
      }
    );

    const eksIngressIamRole = new IamRoleForKubernetesSA(
      this,
      `${id}-eks-ingress-iam-role`,
      {
        name: `${id}-eks-ingress-iam-role`,
        policies: [
          'attach_load_balancer_controller_policy',
          'attach_load_balancer_controller_targetgroup_binding_only_policy',
        ],
        oidcProviderArn: eks.outputs.oidc.providerArn,
        namespace: NAMESPACES.ingressController,
        serviceAccountName: SERVICE_ACCOUNTS.ingressController,
      }
    );

    const gitopsRepo = new GitOpsRepo(
      this,
      `${id}-${ARGO_TOOLING_PROJECT_NAME}-gitops-repo`,
      {
        platform: 'core',
        templateVariables: {
          argo_namespace: argoCd.namespace,
          project_name: ARGO_TOOLING_PROJECT_NAME,
          apps: {
            certmanager: {
              name: 'cert-manager',
              namespace: NAMESPACES.certManager,
              values: jsyaml.dump({
                installCRDs: true,
                serviceAccount: {
                  name: SERVICE_ACCOUNTS.certManager,
                  annotations: {
                    'eks.amazonaws.com/role-arn':
                      certManagerIamRole.outputs.iamRoleArn,
                    'eks.amazonaws.com/sts-regional-endpoints': 'true',
                  },
                },
              }),
            },
            cluster_autoscaler: {
              name: 'cluster-autoscaler',
              namespace: NAMESPACES.clusterAutoscaler,
              values: jsyaml.dump({
                awsRegion: secrets.aws.region,
                autoDiscovery: {
                  clusterName: eks.outputs.clusterName,
                },
                rbac: {
                  create: 'true',
                  serviceAccount: {
                    create: 'true',
                    name: SERVICE_ACCOUNTS.clusterAutoscaler,
                    annotations: {
                      'eks.amazonaws.com/role-arn':
                        clusterAutoscalerIamRole.outputs.iamRoleArn,
                      'eks.amazonaws.com/sts-regional-endpoints': 'true',
                    },
                  },
                },
              }),
            },
            aws_lb_controller: {
              name: 'aws-load-balancer-controller',
              namespace: NAMESPACES.ingressController,
              values: jsyaml.dump({
                fullnameOverride: 'aws-lb-controller',
                clusterName: eks.outputs.clusterName,
                region: secrets.aws.region,
                serviceAccount: {
                  name: SERVICE_ACCOUNTS.ingressController,
                  annotations: {
                    'eks.amazonaws.com/role-arn':
                      eksIngressIamRole.outputs.iamRoleArn,
                    'eks.amazonaws.com/sts-regional-endpoints': 'true',
                  },
                },
                vpcId: vpc.outputs.vpcId,
              }),
            },
            nginx_ingress_controller: {
              name: 'nginx-ingress-controller',
              namespace: NAMESPACES.ingressController,
              values: jsyaml.dump({
                fullnameOverride: 'nginx-ingress',
                controller: {
                  kind: 'Deployment',
                  extraArgs: {
                    'enable-ssl-passthrough': 'true',
                  },
                  service: {
                    annotations: {
                      'service.beta.kubernetes.io/aws-load-balancer-type':
                        'nlb-ip',
                      'service.beta.kubernetes.io/aws-load-balancer-nlb-target-type':
                        'ip',
                      'service.beta.kubernetes.io/aws-load-balancer-scheme':
                        'internet-facing',
                    },
                  },
                },
              }),
            },
            external_dns: {
              name: 'external-dns',
              namespace: NAMESPACES.externalDns,
              values: jsyaml.dump({
                fullnameOverride: 'external-dns',
                policy: 'sync',
                serviceAccount: {
                  name: SERVICE_ACCOUNTS.externalDns,
                  annotations: {
                    'eks.amazonaws.com/role-arn':
                      externalDnsIamRole.outputs.iamRoleArn,
                    'eks.amazonaws.com/sts-regional-endpoints': 'true',
                  },
                },
              }),
            },
          },
          objects: {
            issuer: JSON.stringify({
              name: `${props.stage}-${CERT_MANAGER_CLUSTER_ISSUER_NAME}`,
              email: secrets.acme.email,
              server: secrets.acme.server,
              region: secrets.aws.region,
              zoneId: route53HostedZone.outputs.zoneId,
              secretRef: `${props.stage}-letsencrypt-private-key`,
            }),
          },
        },
      }
    );

    const argoProvision = new ArgoProvisioner(
      this,
      `${id}-${ARGO_TOOLING_PROJECT_NAME}-argo-apps`,
      {
        clusterName: CORE_CLUSTER_NAME,
        argoNamespace: argoCd.namespace,
        project: {
          name: ARGO_TOOLING_PROJECT_NAME,
          description: 'Project for auxiliary tooling resources.',
          destinations: [
            {
              server: 'https://kubernetes.default.svc',
              namespace: '*',
            },
          ],
        },
        applications: [
          {
            name: 'applicationsets',
            path: './applicationsets',
            git: {
              repository: gitopsRepo.outputs.url,
              organization: secrets.github.owner,
              token: secrets.github.token,
            },
            destination: {
              server: 'https://kubernetes.default.svc',
              namespace: '*',
            },
            wave: 0,
          },
          {
            name: 'objects',
            path: './objects',
            git: {
              repository: gitopsRepo.outputs.url,
              organization: secrets.github.owner,
              token: secrets.github.token,
            },
            destination: {
              server: 'https://kubernetes.default.svc',
              namespace: '*',
            },
            wave: 1,
          },
        ],
        helmRepositories: [
          {
            name: 'aws-eks-charts',
            url: 'https://aws.github.io/eks-charts',
          },
          {
            name: 'cluster-autoscaler',
            url: 'https://kubernetes.github.io/autoscaler',
          },
          {
            name: 'external-dns',
            url: 'https://kubernetes-sigs.github.io/external-dns',
          },
          {
            name: 'jetstack',
            url: 'https://charts.jetstack.io',
          },
          {
            name: 'nginx-ingress-controller',
            url: 'https://kubernetes.github.io/ingress-nginx',
          },
        ],
      }
    );

    [
      route53HostedZone,
      cloudFlareDnsRecords,
      vpc,
      eks,
      argoCd,
      gitopsRepo,
      argoProvision,
      certManagerIamRole,
      clusterAutoscalerIamRole,
      externalDnsIamRole,
      eksIngressIamRole,
    ].forEach((stack: CustomTerraformStack) => {
      new S3Backend(stack, {
        bucket: props.backend.bucket,
        dynamodbTable: props.backend.dynamodbTable,
        key: `${props.stage}/${secrets.aws.region}/${stack.node.id}.tfstate`,
        region: secrets.aws.region,
      });
    });
  }
}
