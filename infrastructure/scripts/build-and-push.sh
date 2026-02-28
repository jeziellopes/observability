#!/bin/bash
set -e

# Build and push all Docker images to ECR
# Usage: ./build-and-push.sh

# Check required environment variables
if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_REGION" ]; then
  echo "Error: AWS_ACCOUNT_ID and AWS_REGION must be set"
  echo "Example:"
  echo "  export AWS_ACCOUNT_ID=123456789012"
  echo "  export AWS_REGION=us-east-1"
  exit 1
fi

PROJECT_NAME="o11y-lab"
SERVICES=("api-gateway" "user-service" "order-service" "notification-service")
ECR_URL="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

echo "Building and pushing Docker images to ECR..."
echo "AWS Account: $AWS_ACCOUNT_ID"
echo "AWS Region: $AWS_REGION"
echo ""

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $ECR_URL

# Build and push each service
for SERVICE in "${SERVICES[@]}"; do
  echo ""
  echo "========================================" 
  echo "Building: $SERVICE"
  echo "========================================"
  
  cd "../../services/$SERVICE"
  
  # Build image
  docker build -t $PROJECT_NAME/$SERVICE:latest .
  
  # Tag for ECR
  docker tag $PROJECT_NAME/$SERVICE:latest $ECR_URL/$PROJECT_NAME/$SERVICE:latest
  
  # Push to ECR
  echo "Pushing $SERVICE to ECR..."
  docker push $ECR_URL/$PROJECT_NAME/$SERVICE:latest
  
  echo "✓ $SERVICE pushed successfully"
done

echo ""
echo "========================================" 
echo "All images built and pushed successfully!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. cd infrastructure/terraform"
echo "2. terraform apply"
