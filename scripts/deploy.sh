#!/bin/bash
set -e
export AWS_PAGER=""

# Configuration
REGION="us-east-1"
ECR_REPO_NAME="market-insights-engine"
STACK_NAME="market-insights-stack"
IMAGE_TAG="latest"

echo "========================================================="
echo "   Cost-Aware Market Insights Engine - Deployment Agent  "
echo "========================================================="

# 0. Prerequisites Check
if ! command -v aws &> /dev/null; then
    echo "❌ Error: aws CLI is not installed."
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Error: docker is not installed."
    exit 1
fi

# Fetch Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --region $REGION --query Account --output text)
if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to fetch AWS Account ID. Ensure you are logged in (aws configure)."
    exit 1
fi

echo "🚀 Target: Account $ACCOUNT_ID in Region $REGION"

# 1. Ensure ECR repository exists
echo "📦 Ensuring ECR repository '$ECR_REPO_NAME' exists..."
aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $REGION || aws ecr create-repository --repository-name $ECR_REPO_NAME --region $REGION

# 2. Login Docker to AWS ECR
echo "🔑 Logging in to ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# 3. Build docker image
# We use the local Dockerfile which is already tuned for production
echo "🏗️  Building Production Docker image (Alpha-DAG enabled)..."
docker build --platform linux/arm64 -t $ECR_REPO_NAME .

# 4. Tag and Push to ECR
IMAGE_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG"
docker tag $ECR_REPO_NAME:$IMAGE_TAG $IMAGE_URI
echo "⬆️  Pushing Production image to ECR: $IMAGE_URI"
docker push $IMAGE_URI

# 5. Deploy CloudFormation stack
# This stack includes VPC, Fargate, DynamoDB, and CloudWatch Alarms
echo "☁️  Updating Cloud Infrastructure via CloudFormation..."
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ImageUrl=$IMAGE_URI \
  --region $REGION

# 6. Force ECS update to pick up new image immediately
# We refresh the service to ensure the new LangGraph logic and Daily Agent are live
echo "🔄 Refreshing ECS Fargate Service to load newest code..."
aws ecs update-service \
  --cluster market-insights-dev \
  --service market-insights-dev-service \
  --force-new-deployment \
  --region $REGION

echo "✅ Deployment complete! Your engine is live and updated."
echo "   URL: http://$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`ALBDNSName`].OutputValue' --output text)"
