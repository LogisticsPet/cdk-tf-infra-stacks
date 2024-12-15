export const CORE_CLUSTER_NAME = 'core-eks';
export const ARGO_NAMESPACE = 'argocd';
export const ARGO_TOOLING_PROJECT_NAME = 'tooling';
export const CERT_MANAGER_CLUSTER_ISSUER_NAME = 'acme-cert-issuer';

export const IAM_ROLE_ATTACH_POLICIES = [
  'attach_load_balancer_controller_policy',
  'attach_load_balancer_controller_targetgroup_binding_only_policy',
  'attach_cert_manager_policy',
  'attach_cluster_autoscaler_policy',
  'attach_external_dns_policy',
];

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

export const NAMESPACED_SERVICE_ACCOUNTS = [
  `${NAMESPACES.certManager}:${SERVICE_ACCOUNTS.certManager}`,
  `${NAMESPACES.ingressController}:${SERVICE_ACCOUNTS.ingressController}`,
  `${NAMESPACES.clusterAutoscaler}:${SERVICE_ACCOUNTS.clusterAutoscaler}`,
  `${NAMESPACES.externalDns}:${SERVICE_ACCOUNTS.externalDns}`,
];
