#!/usr/bin/env tsx
/**
 * Local/admin helper: verify CDK bootstrap in Ohio, or repair when bucket is truly missing.
 * Do NOT run from amplify.yml — the Amplify build role cannot s3:HeadBucket on the CDK
 * assets bucket (false "missing" errors) and cannot delete CDKToolkit IAM resources.
 *
 * Usage (admin credentials):
 *   $env:AWS_PROFILE = "personal-admin"
 *   $env:AWS_REGION = "us-east-2"
 *   npm run ensure:cdk-bootstrap
 */
import { DescribeStacksCommand, CloudFormationClient } from '@aws-sdk/client-cloudformation';
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

async function cdkToolkitStackStatus(): Promise<string | null> {
  const cfn = new CloudFormationClient({ region: DEPLOY_REGION });
  try {
    const result = await cfn.send(
      new DescribeStacksCommand({ StackName: CDK_TOOLKIT_STACK }),
    );
    return result.Stacks?.[0]?.StackStatus ?? null;
  } catch (err: unknown) {
    const name = (err as { name?: string }).name;
    if (name === 'ValidationError' || name === 'ResourceNotFoundException') {
      return null;
    }
    throw err;
  }
}

function bootstrapCdk(accountId: string, force: boolean): void {
  const target = `aws://${accountId}/${DEPLOY_REGION}`;
  const forceFlag = force ? ' --force' : '';
  console.log(`Bootstrapping CDK in ${target}${force ? ' (force)' : ''}…`);
  execSync(`npx aws-cdk bootstrap ${target}${forceFlag}`, {
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

  const stackStatus = await cdkToolkitStackStatus();
  if (stackStatus === 'DELETE_FAILED') {
    throw new Error(
      `${CDK_TOOLKIT_STACK} is DELETE_FAILED in ${DEPLOY_REGION}. ` +
        'Amplify cannot repair this (no iam:DeleteRolePolicy). ' +
        'From an admin shell: aws cloudformation delete-stack --stack-name CDKToolkit --region us-east-2, ' +
        'wait for delete, then npx aws-cdk bootstrap aws://ACCOUNT/us-east-2',
    );
  }

  bootstrapCdk(accountId, stackStatus !== null);

  if (!(await bucketExists(bucket))) {
    throw new Error(
      `CDK bootstrap finished but bucket ${bucket} is still missing. ` +
        `Check CDKToolkit in ${DEPLOY_REGION} and S3 permissions.`,
    );
  }

  console.log('CDK bootstrap complete; assets bucket verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
