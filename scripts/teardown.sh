#!/bin/bash
set -e
export AWS_PAGER=""

REGION="us-east-1"
ECR_REPO_NAME="market-insights-engine"
STACK_NAME="market-insights-stack"

echo "Teardown started for Cost-Aware Market Insights Engine..."

# 1. Delete the ECR repository (and all stored images)
echo "Deleting ECR repository '$ECR_REPO_NAME'..."
aws ecr delete-repository --repository-name $ECR_REPO_NAME --force --region $REGION || echo "ECR repository might not exist or already deleted."

# 2. Delete the CloudFormation stack
echo "Initiating CloudFormation stack deletion for '$STACK_NAME'..."
aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION

echo "Stack deletion initiated. This may take 5-10 minutes to complete."
echo "You can monitor the progress in your AWS Management Console or by running:"
echo "  aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION"
echo ""
echo "AWS Teardown complete. You are now back to a fully local environment."
