import { Construct } from 'constructs';
import { TerraformResource } from 'cdktf';
import CustomTerraformStack from '../CustomTerraformStack';

export interface CleanupStackProps {
  clusterName: string;
  region: string;
}

/**
 * Pre-destroy cleanup script that runs before EKS/VPC are torn down.
 *
 * Handles resources that live outside Terraform state and would otherwise
 * block or orphan AWS infrastructure during destroy:
 *
 *   1. Suspend Flux kustomizations — prevents re-creation during teardown.
 *   2. Delete Crossplane IAM objects — Crossplane finalizers guarantee the
 *      actual AWS IAM roles/policies are deleted before k8s objects are removed.
 *   3. Delete istio-ingress HelmRelease — triggers Flux chart uninstall which
 *      removes the LoadBalancer Service, causing aws-lb-controller to delete the NLB.
 *   4. Poll AWS until no cluster-owned NLBs remain — prevents VPC subnet
 *      deletion from failing with DependencyViolation.
 *
 * Destroy order enforced via addDependency(fluxConfig):
 *   CleanupStack → FluxConfigStack → FluxStack → EKS → VPC
 */

const PRE_DESTROY_SCRIPT = `
set -euo pipefail
echo "=== pre-destroy: cluster=$CLUSTER_NAME region=$REGION ==="

aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$REGION"

# 1. Suspend all Flux kustomizations to prevent reconciliation during teardown
echo "--- suspending Flux kustomizations"
kubectl get kustomizations.kustomize.toolkit.fluxcd.io -n flux-system -o name 2>/dev/null | \\
  xargs -r kubectl patch -n flux-system --type=merge \\
  -p '{"spec":{"suspend":true}}' || true

# 2. Delete Crossplane IAM objects — finalizers ensure AWS resources are
#    removed by Crossplane before the k8s objects themselves are deleted
echo "--- deleting Crossplane IAM resources"
if kubectl api-resources --api-group=iam.aws.upbound.io --no-headers 2>/dev/null | grep -q .; then
  kubectl delete rolepolicyattachments.iam.aws.upbound.io,policies.iam.aws.upbound.io,roles.iam.aws.upbound.io \\
    --all --wait --timeout=120s --ignore-not-found
fi

# 3. Delete istio-ingress HelmRelease — Flux uninstalls the chart, which
#    removes the LoadBalancer Service and triggers NLB deletion via aws-lb-controller
echo "--- deleting istio-ingress HelmRelease"
if kubectl api-resources --api-group=helm.toolkit.fluxcd.io --no-headers 2>/dev/null | grep -q HelmRelease; then
  kubectl delete helmrelease istio-ingress -n istio-system --ignore-not-found || true
fi

# 4a. Wait for LoadBalancer-type Services in istio-system to disappear
echo "--- waiting for LoadBalancer Services to be removed"
for i in $(seq 1 12); do
  LB_COUNT=$(kubectl get svc -n istio-system --no-headers \\
    -o custom-columns=T:.spec.type 2>/dev/null | grep "^LoadBalancer$" | wc -l | tr -d ' ')
  echo "  LoadBalancer services remaining: $LB_COUNT (attempt $i/12)"
  [ "$LB_COUNT" = "0" ] && break
  sleep 10
done

# 4b. Safety-net: poll AWS until no cluster-owned NLBs remain
#    (covers cases where aws-lb-controller is slow or already gone)
echo "--- polling AWS for cluster-owned NLBs"
for i in $(seq 1 30); do
  NLB_COUNT=$(aws resourcegroupstaggingapi get-resources \\
    --region "$REGION" \\
    --tag-filters "Key=kubernetes.io/cluster/$CLUSTER_NAME,Values=owned" \\
    --resource-type-filters "elasticloadbalancing:loadbalancer" \\
    --query "length(ResourceTagMappingList)" \\
    --output text 2>/dev/null || echo 0)
  echo "  NLBs remaining: $NLB_COUNT (attempt $i/30)"
  [ "$NLB_COUNT" = "0" ] && break
  sleep 10
done

echo "=== pre-destroy cleanup complete ==="
`.trim();

export default class CleanupStack extends CustomTerraformStack {
  constructor(scope: Construct, id: string, props: CleanupStackProps) {
    super(scope, id);

    // terraform_data is a Terraform built-in (>= 1.4) — no provider needed.
    // The input value is stored in state so a change forces re-creation,
    // which re-runs the destroy provisioner on the old value before creating new.
    const cleanup = new TerraformResource(this, 'pre-destroy-cleanup', {
      terraformResourceType: 'terraform_data',
    });

    cleanup.addOverride('input', {
      cluster_name: props.clusterName,
      region: props.region,
    });

    cleanup.addOverride('provisioner', [
      {
        'local-exec': {
          when: 'destroy',
          command: PRE_DESTROY_SCRIPT,
          interpreter: ['/bin/bash', '-c'],
          environment: {
            CLUSTER_NAME: props.clusterName,
            REGION: props.region,
          },
        },
      },
    ]);
  }
}
