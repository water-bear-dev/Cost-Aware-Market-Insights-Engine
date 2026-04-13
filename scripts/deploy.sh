#!/bin/bash
set -e
export AWS_PAGER=""

# Setup vars
REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --region $REGION --query Account --output text)
ECR_REPO_NAME="market-insights-engine"
STACK_NAME="market-insights-stack"
IMAGE_TAG="latest"

echo "Deploying Cost-Aware Market Insights Engine (Production) to account $ACCOUNT_ID..."

# 1. Ensure ECR repository exists
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $REGION || aws ecr create-repository --repository-name $ECR_REPO_NAME --region $REGION

# 2. Login Docker to AWS ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# 3. Build docker image
echo "Building Production Docker image..."
docker build -t $ECR_REPO_NAME .

# 4. Tag and Push to ECR
IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG"
docker tag $ECR_REPO_NAME:$IMAGE_TAG $IMAGE_URI
echo "Pushing Production image to ECR..."
docker push $IMAGE_URI

# 5. Deploy CloudFormation stack
echo "Updating Cloud Infrastructure..."
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ImageUrl=$IMAGE_URI \
  --region $REGION

# 6. Force ECS update to pick up new image immediately
echo "Refreshing ECS Fargate Service to load newest code..."
aws ecs update-service \
  --cluster market-insights-dev \
  --service market-insights-dev-service \
  --force-new-deployment \
  --region $REGION

echo "Production Deployment complete! Your engine is live and updated."
