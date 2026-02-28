# Terraform Infrastructure

## Overview

This directory contains Terraform configuration for deploying the o11y-lab stack to AWS using ECS Fargate, Lambda, and supporting services.

## Architecture

| Component | Resource | Purpose |
|-----------|----------|---------|
| **VPC** | `aws_vpc` | Isolated network with public/private subnets across 2 AZs |
| **ECS Fargate** | `aws_ecs_cluster` + `aws_ecs_service` | Runs 4 containerized microservices |
| **Application Load Balancer** | `aws_lb` | Public HTTP entry point on port 80, routes to `api-gateway` |
| **Service Discovery** | `aws_service_discovery_private_dns_namespace` | Internal DNS (`*.o11y-lab.local`) for inter-service communication |
| **Lambda** | `aws_lambda_function` | Serverless order validation (`order-validator-lambda`) with a public Function URL |
| **SQS** | `aws_sqs_queue` | Async notification queue consumed by `notification-service` |
| **ECR** | `aws_ecr_repository` | One repository per service: `api-gateway`, `user-service`, `order-service`, `notification-service` |
| **CloudWatch Logs** | `aws_cloudwatch_log_group` | Log groups for ECS (`/ecs/o11y-lab`) and Lambda (`/aws/lambda/...`), 7-day retention |
| **IAM** | `aws_iam_role` | Separate task execution role, task role, and Lambda execution role |
| **NAT Gateway** | `aws_nat_gateway` | Allows private subnet tasks to reach the internet (e.g. OTel collector) |

## Prerequisites

1. [Terraform >= 1.0](https://developer.hashicorp.com/terraform/downloads)
2. [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) configured with credentials (`aws configure`)
3. [Docker](https://docs.docker.com/get-docker/) for building service images
4. [pnpm](https://pnpm.io/installation) for building the Lambda function
5. An AWS account with permissions to create VPC, ECS, ECR, IAM, Lambda, SQS, and CloudWatch resources

## Deployment Steps

### 1. Build the Lambda zip

The Lambda Terraform resource expects a prebuilt zip at `lambda/lambda.zip`. Use the provided script — it installs dependencies, compiles TypeScript, and packages the zip automatically (driven by the `build` + `package` scripts in `lambda/package.json`):

```bash
bash infrastructure/scripts/build-lambda.sh
```

The script can be run from the repo root or any directory. Output: `lambda/lambda.zip`.

### 2. Configure variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and set at minimum:

| Variable | Default | Notes |
|----------|---------|-------|
| `aws_region` | `us-east-1` | Target AWS region |
| `environment` | `dev` | Used for tagging |
| `otel_endpoint` | `http://jaeger:4318/v1/traces` | **Must be changed** — the default is only valid locally. Use a reachable endpoint such as Grafana Cloud OTLP or AWS X-Ray ADOT collector |

### 3. (Optional) Configure remote state backend

`backend.tf` ships with a commented-out S3 backend. For team use or persistent state, create the resources and uncomment:

```bash
# Create state bucket and lock table first
aws s3api create-bucket --bucket your-terraform-state-bucket --region us-east-1
aws dynamodb create-table \
  --table-name terraform-state-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Then uncomment the `backend "s3"` block in `backend.tf` and run `terraform init -migrate-state`.

### 4. Initialize and apply (ECR first)

ECR repositories must exist before Docker images can be pushed:

```bash
terraform init

# Create ECR repos first
terraform apply \
  -target=aws_ecr_repository.api_gateway \
  -target=aws_ecr_repository.user_service \
  -target=aws_ecr_repository.order_service \
  -target=aws_ecr_repository.notification_service
```

### 5. Build and push Docker images

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION="us-east-1"

cd ../../
bash infrastructure/scripts/build-and-push.sh
```

The script authenticates with ECR, builds each service image, and pushes it tagged as `:latest`.

### 6. Deploy the full infrastructure

```bash
cd infrastructure/terraform
terraform apply
```

## Outputs

| Output | Description |
|--------|-------------|
| `vpc_id` | ID of the created VPC |
| `alb_dns_name` | DNS name of the Application Load Balancer |
| `api_gateway_url` | `http://<alb_dns_name>` — public API entry point |
| `ecs_cluster_name` | ECS cluster name |
| `lambda_function_name` | Name of the order validator Lambda |
| `lambda_function_arn` | ARN of the order validator Lambda |
| `sqs_queue_url` | SQS notification queue URL |
| `jaeger_ui_url` | Jaeger UI URL if `enable_jaeger = true` (port 16686) |

## Testing

```bash
# Get ALB DNS after apply
export ALB_DNS=$(terraform output -raw alb_dns_name)

# Test API Gateway
curl http://$ALB_DNS/health
curl http://$ALB_DNS/api/users

# Invoke Lambda via Function URL
export LAMBDA_URL=$(aws lambda get-function-url-config \
  --function-name $(terraform output -raw lambda_function_name) \
  --query FunctionUrl --output text)

curl -X POST $LAMBDA_URL \
  -H "Content-Type: application/json" \
  -d '{"body":"{\"userId\":1,\"items\":[\"item-a\"],\"total\":99.99}"}'

# Invoke Lambda via AWS CLI
aws lambda invoke \
  --function-name $(terraform output -raw lambda_function_name) \
  --payload '{"body":"{\"userId\":1,\"items\":[\"item-a\"],\"total\":99.99}"}' \
  --cli-binary-format raw-in-base64-out \
  response.json && cat response.json
```

## Cleanup

```bash
terraform destroy
```

> **Note:** ECR repositories with images will fail to destroy. Empty them first:
> ```bash
> for repo in api-gateway user-service order-service notification-service; do
>   aws ecr batch-delete-image \
>     --repository-name o11y-lab/$repo \
>     --image-ids "$(aws ecr list-images --repository-name o11y-lab/$repo \
>       --query 'imageIds[*]' --output json)"
> done
> ```

## Cost Estimation

| Resource | Estimated cost/month |
|----------|---------------------|
| ECS Fargate (4 services, 256 CPU / 512 MB) | ~$30–50 |
| Application Load Balancer | ~$16 |
| NAT Gateway | ~$32 |
| Lambda | Free tier eligible |
| SQS | Free tier eligible |
| CloudWatch Logs | ~$1–2 |
| **Total** | **~$80–100** |

## Security Considerations

- **Lambda Function URL** is configured with `authorization_type = "NONE"` — unauthenticated public access. Add IAM auth or an API Gateway in front before using in production.
- **Jaeger UI port 16686** is open to `0.0.0.0/0` on the ALB security group. Restrict to a known CIDR to prevent exposing trace data publicly.
- **HTTPS**: The ALB listener is HTTP only. Add an ACM certificate and an HTTPS listener (port 443) for production.
- **Secrets**: OTel endpoint and other config are passed as plain environment variables. Use AWS Secrets Manager or SSM Parameter Store for sensitive values.
- **IAM**: Task roles have minimal permissions. Review and scope them down further for production.
- **ALB access logs**: Disabled by default. Enable for production auditing.
