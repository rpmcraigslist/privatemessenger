#!/usr/bin/env tsx
/**
 * Ensures the CDK assets bucket exists in the deploy region before ampx pipeline-deploy.
 * If CDKToolkit is stale (stack exists but bucket was deleted during cleanup), deletes
 * CDKToolkit and re-bootstraps Ohio.
 */
import {
  CloudFormationClient,
  DescribeStacksCommand,
  DeleteStackCommand,
  waitUntilStackDeleteComplete,
} from '@aws-sdk/client-cloudformation';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { execSync } from 'node:child_process';

const DEPLOY_REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-2';
const CDK_TOOLKIT_STACK = 'CDKToolkit';

process.env.AWS_REGION = DEPLOY_REGION;
process.env.AWS_DEFAULT_REGION = DEPLOY_REGION;

async function bucketExists(bucket: string): Promise<boolean> {
  const s3 = new S3Client({ region: DEPLOY_REGION });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}

async function cdkToolkitStackExists(): Promise<boolean> {
  const cfn = new CloudFormationClient({ region: DEPLOY_REGION });
  try {
    const result = await cfn.send(
      new DescribeStacksCommand({ StackName: CDK_TOOLKIT_STACK }),
    );
    const status = result.Stacks?.[0]?.StackStatus;
    return status !== undefined && !status.includes('DELETE');
  } catch (err: unknown) {
    const name = (err as { name?: string }).name;
    if (name === 'ValidationError' || name === 'ResourceNotFoundException') {
      return false;
    }
    throw err;
  }
}

async function deleteStaleCdkToolkit(): Promise<void> {
  console.log(`Deleting stale ${CDK_TOOLKIT_STACK} stack in ${DEPLOY_REGION}…`);
  const cfn = new CloudFormationClient({ region: DEPLOY_REGION });
  await cfn.send(new DeleteStackCommand({ StackName: CDK_TOOLKIT_STACK }));
  await waitUntilStackDeleteComplete(
    { client: cfn, maxWaitTime: 600 },
    { StackName: CDK_TOOLKIT_STACK },
  );
  console.log(`${CDK_TOOLKIT_STACK} deleted.`);
}

function bootstrapCdk(accountId: string): void {
  const target = `aws://${accountId}/${DEPLOY_REGION}`;
  console.log(`Bootstrapping CDK in ${target}…`);
  execSync(`npx aws-cdk bootstrap ${target}`, {
    stdio: 'inherit',
    env: process.env,
  });
}

async function main(): Promise<void> {
  const sts = new STSClient({ region: DEPLOY_REGION });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;
  if (!accountId) {
    throw new Error('Could not resolve AWS account id from STS.');
  }

  const bucket = `cdk-hnb659fds-assets-${accountId}-${DEPLOY_REGION}`;
  console.log(`CDK assets bucket: ${bucket} (region ${DEPLOY_REGION})`);

  if (await bucketExists(bucket)) {
    console.log('CDK assets bucket OK.');
    return;
  }

  console.warn(`CDK assets bucket missing: ${bucket}`);

  if (await cdkToolkitStackExists()) {
    console.warn(
      `${CDK_TOOLKIT_STACK} exists but assets bucket is gone — likely deleted during cleanup.`,
    );
    await deleteStaleCdkToolkit();
  }

  bootstrapCdk(accountId);

  if (!(await bucketExists(bucket))) {
    throw new Error(
      `CDK bootstrap finished but bucket ${bucket} is still missing. Check IAM permissions and S3 in ${DEPLOY_REGION}.`,
    );
  }

  console.log('CDK bootstrap complete; assets bucket verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
