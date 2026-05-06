#!/bin/bash
set -e
export AWS_PAGER=""

# Configuration
REGION="us-east-1"
ECR_REPO_NAME="market-insights-engine"
STACK_NAME="market-insights-stack"

echo "========================================================="
echo "   Cost-Aware Market Insights Engine - Teardown Agent    "
echo "========================================================="

# Fetch Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --region $REGION --query Account --output text)
if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to fetch AWS Account ID. Ensure you are logged in (aws configure)."
    exit 1
fi

echo "🚀 Target: Account $ACCOUNT_ID in Region $REGION"
echo "⚠️  WARNING: This will permanently delete your Cloud Infrastructure and ECR Images."
read -p "Are you sure you want to proceed? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Teardown aborted."
    exit 1
fi

# 1. Delete the ECR repository (and all stored images)
echo "📦 Deleting ECR repository '$ECR_REPO_NAME'..."
aws ecr delete-repository --repository-name $ECR_REPO_NAME --force --region $REGION || echo "ℹ️  ECR repository might not exist or already deleted."

# 2. Delete the CloudFormation stack
echo "☁️  Initiating CloudFormation stack deletion for '$STACK_NAME'..."
aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION

echo "⏳ Waiting for stack deletion to complete (this may take several minutes)..."
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME --region $REGION

echo "✅ Teardown complete! All AWS resources for this project have been removed."
echo "   You are now back to a fully local environment."
