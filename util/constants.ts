export const CORE_CLUSTER_NAME = 'core-eks';
export const ARGO_TOOLING_PROJECT_NAME = 'tooling';
export const CERT_MANAGER_CLUSTER_ISSUER_NAME = 'acme-cert-issuer';

export const NAMESPACES = {
  certManager: 'cert-manager',
  ingressController: 'ingress-controller',
  clusterAutoscaler: 'cluster-autoscaler',
  externalDns: 'external-dns',
};

export const SERVICE_ACCOUNTS = {
  certManager: 'cert-manager-sa',
  ingressController: 'ingress-controller-sa',
  clusterAutoscaler: 'cluster-autoscaler-sa',
  externalDns: 'external-dns-sa',
};
