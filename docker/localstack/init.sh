#!/bin/sh
# Bootstraps LocalStack resources for exploration (NOT a full Amplify backend).
set -eu

echo "Waiting for LocalStack..."
until awslocal s3 ls >/dev/null 2>&1; do sleep 2; done

awslocal s3 mb s3://messenger-attachments-local 2>/dev/null || true

awslocal dynamodb create-table \
  --table-name Conversation \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true

awslocal dynamodb create-table \
  --table-name Message \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true

awslocal dynamodb create-table \
  --table-name UserProfile \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  2>/dev/null || true

echo "LocalStack bootstrap complete."
echo "NOTE: Cognito + AppSync (real-time GraphQL) are NOT emulated here."
echo "Use 'npm run sandbox' against a free AWS account for the full messenger."
