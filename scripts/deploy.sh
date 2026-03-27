#!/bin/bash
set -e
export AWS_PAGER=""

# Setup vars
REGION="us-east-1"
ACCOUNT_ID=$(aws sts get-caller-identity --region $REGION --query Account --output text)
ECR_REPO_NAME="market-insights-engine"
STACK_NAME="market-insights-stack"
IMAGE_TAG="latest"

echo "Deploying Phase 2 to AWS account $ACCOUNT_ID in $REGION..."

# 1. Ensure ECR repository exists
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $REGION || aws ecr create-repository --repository-name $ECR_REPO_NAME --region $REGION

# 2. Login Docker to AWS ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# 3. Build docker image
echo "Building the Docker image..."
docker build -t $ECR_REPO_NAME .

# 4. Tag and Push to ECR
IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG"
docker tag $ECR_REPO_NAME:$IMAGE_TAG $IMAGE_URI
echo "Pushing image to ECR..."
docker push $IMAGE_URI

# 5. Deploy CloudFormation stack
echo "Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ImageUrl=$IMAGE_URI \
  --region $REGION

echo "Deployment complete! Your cluster is running on AWS ECS Fargate."
