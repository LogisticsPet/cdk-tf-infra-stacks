![build](https://github.com/LogisticsPet/cdk-tf-infra-stacks/actions/workflows/build.yml/badge.svg?branch=main)

## CDKTF Infrastructure Project Documentation

This repository contains a CDKTF (Cloud Development Kit for Terraform) implementation to manage infrastructure on AWS. CDKTF allows you to define your infrastructure using familiar programming languages, making it easier to manage and maintain your cloud resources.

### Overview

This project uses CDKTF to define infrastructure resources in the following structure:

- **Platforms**: Represented as classes under the `platforms` directory (e.g., `platforms/CorePlatform.ts`). Each platform contains CDKTF stacks defining infrastructure resources.
- **Stages**: The project supports deployment across multiple stages (`dev`, `test`, `prod`), allowing flexible and isolated infrastructure setups.

Currently, only the **Core Platform** is implemented, which includes the following infrastructure stacks:

### Core Platform Stacks

- [AWS VPC](https://github.com/LogisticsPet/terraform-aws-vpc)  

   Provisions a Virtual Private Cloud (VPC) in AWS to enable secure communication between resources. This stack configures subnets, route tables, and internet gateways as necessary.

- [AWS Route 53](https://github.com/LogisticsPet/terraform-aws-route53)

   Manages DNS records in AWS Route 53 stage specific sub-domain name resolution

- [AWS EKS Cluster](https://github.com/LogisticsPet/terraform-aws-eks)
   
   Sets up an Elastic Kubernetes Service (EKS) cluster for running containerized workloads. Includes worker nodes, IAM roles, and security group configurations.

-  [Cloudflare DNS Records](https://github.com/LogisticsPet/terraform-cloudflare-dns-records)
   
   Configures NS records in Cloudflare to resolve subdomain to Route 53 hosted zone. 

### CI/CD 

This project uses **GitHub Actions** for automating the deployment and destruction of infrastructure resources. The workflows are defined in the `.github/workflows` directory.
The deployment process is automated using the [deploy.yml](.github/workflows/deploy.yml) GitHub Actions workflow.

---
### Prerequisites

Before you start using this repository, you need to have the following installed:

1. **Node.js**: CDKTF is built on Node.js. You can download it from [nodejs.org](https://nodejs.org/).

2. **Terraform**: Terraform is required to apply the configurations. Download it from [terraform.io](https://www.terraform.io/downloads).
