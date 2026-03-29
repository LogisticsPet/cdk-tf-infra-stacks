![build](https://github.com/LogisticsPet/cdk-tf-infra-stacks/actions/workflows/build.yml/badge.svg?branch=main)

## CDKTF Infrastructure Stack

CDKTF (TypeScript) managing all AWS cloud resources for the Logistics platform.
In-cluster workloads are managed by **Flux** (see `infra/flux/`), not by this stack.

---

## What This Stack Owns

| Resource | Module |
|---|---|
| VPC (subnets, NAT, route tables) | `terraform-aws-vpc` |
| EKS cluster + managed node groups | `terraform-aws-eks` |
| Route53 hosted zone | `terraform-aws-route53` |
| Cloudflare NS delegation records | `terraform-cloudflare-dns-records` |
| IRSA role — Flux image-reflector (ECR read) | `IamRoleForKubernetesSA` |
| IRSA role — Crossplane AWS provider (IAM manage) | `IamRoleForKubernetesSA` |
| Flux controllers bootstrap (Helm) | `FluxStack` |
| Flux GitRepository + Kustomization CRDs | `FluxStack` |
| platform-vars ConfigMap (IRSA ARNs, cluster info) | `FluxStack` |

**Not in this stack:** cert-manager, cluster-autoscaler, external-dns, NGINX.
Those live in `infra/flux/platform/` and are reconciled by Flux + Crossplane.

---

## Directory Structure

```
cdk-tf-infra-stack/
  main.ts                         Entry point — reads env vars, boots providers
  platforms/
    CorePlatform.ts               Top-level orchestrator (all stacks in order)
  stacks/
    aws/
      VirtualPrivateCloud.ts      VPC stack
      ElasticKubernetesService.ts EKS stack
      Route53HostedZone.ts        Route53 stack
      IamRoleForKubernetesSA.ts   Generic IRSA role factory
    cloudflare/
      CloudFlareDnsRecords.ts     Cloudflare NS records
    kubernetes/
      FluxStack.ts                Flux bootstrap (Helm + CRDs + ConfigMap)
  util/
    constants.ts                  Namespace, SA, and role name constants
```

---

## Bootstrap Sequence

```
1.  Set required env vars (see below)
2.  cdktf synth              → generates Terraform JSON in cdktf.out/
3.  node deployer.js deploy  → applies stacks in dependency order:
      route53 → cloudflare → vpc → eks → irsa-roles → flux
4.  Flux reconciles infra/flux/platform/:
      crossplane → cert-manager/autoscaler/external-dns/nginx (with IAM) → cert-manager-issuer
5.  Flux reconciles infra/flux/apps/ (empty initially)
```

---

## Required Environment Variables

| Variable | Description | Example |
|---|---|---|
| `AWS_REGION` | EKS region | `us-east-2` |
| `AWS_ROLE_ARN` | IAM role for CDKTF to assume | `arn:aws:iam::123:role/deployer` |
| `AWS_ACCOUNT_ID` | AWS account ID (for deterministic IAM ARNs) | `044964284165` |
| `STAGE` | Deployment stage | `core` |
| `ROOT_DOMAIN` | Apex domain (Cloudflare) | `example.com` |
| `S3_BACKEND_BUCKET` | Terraform state bucket | `my-tf-state` |
| `S3_BACKEND_LOCK_TABLE` | DynamoDB lock table | `tf-lock` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | `...` |
| `GITHUB_OWNER` | GitHub org or user | `LogisticsPet` |
| `GITOPS_REPO_URL` | HTTPS URL of this monorepo (Flux source) | `https://github.com/LogisticsPet/logistics` |
| `ACME_EMAIL` | Let's Encrypt contact email | `ops@example.com` |
| `ACME_SERVER` | Let's Encrypt server URL | `https://acme-v02.api.letsencrypt.org/directory` |

---

## Flux Migration from ArgoCD

ArgoCD (`terraform-aws-argo-cd`, `terraform-helm-argo-provisioner`, `root-gitops/`) is deprecated.

### Cutover Steps

```bash
# 1. Deploy the Flux stack
node deployer.js deploy  # applies FluxStack and the two new IRSA roles

# 2. Verify Flux is healthy
kubectl -n flux-system get pods
flux get all -n flux-system

# 3. Watch platform reconcile
flux get kustomizations -n flux-system --watch

# 4. Verify all HelmReleases are Ready
flux get helmreleases -A

# 5. Once confirmed, remove ArgoCD state (do NOT run cdktf destroy on other stacks)
cd infra/terraform-aws-argo-cd
terraform init && terraform destroy -auto-approve

cd infra/terraform-helm-argo-provisioner
terraform init && terraform destroy -auto-approve

# 6. Delete the ArgoCD namespace
kubectl delete namespace argocd

# 7. Delete the ArgoCD GitOps GitHub repo (created by terraform-gitops-repo)
#    or leave it as an archive — it is no longer tracked by CDKTF.
```

### Crossplane Notes

All platform IRSA roles are now managed by Crossplane inside `infra/flux/platform/`.

**The one pre-requisite** is the AWS Load Balancer Controller IAM policy document, which
must be created once in your account (it exceeds the inline policy size limit):

```bash
curl -O https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json
aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam_policy.json
```

After that, Crossplane manages the `RolePolicyAttachment` automatically.

---

## Adding a New Platform Tool

1. Create `infra/flux/platform/<tool-name>/` with:
   - `kustomization.yaml`
   - `iam.yaml` (Crossplane `Role` + `Policy` + `RolePolicyAttachment`)
   - `helmrelease.yaml` (Flux `HelmRepository` + `HelmRelease`)
2. Add `- <tool-name>` to `infra/flux/platform/kustomization.yaml`
3. In `helmrelease.yaml`, add `dependsOn: [{name: crossplane}]` so the IAM role exists first
4. Reference the role ARN as `arn:aws:iam::${AWS_ACCOUNT_ID}:role/<role-name>` — no CDKTF change needed

No changes to `CorePlatform.ts` or `constants.ts` required.

---

## Local Development

```bash
node --version   # must match engines.node in package.json
npm install
npm run synth    # verify synthesis works without credentials
```
