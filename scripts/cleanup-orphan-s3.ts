#!/usr/bin/env tsx
/**
 * Lists S3 buckets that look like old Private Messenger / Amplify backend junk.
 * Does NOT delete anything — review the list, then empty + delete in the S3 console
 * or use the commands printed at the end.
 *
 * Usage:
 *   $env:AWS_PROFILE = "personal-admin"
 *   npm run cleanup:list-s3
 */
import {
  CloudFormationClient,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { GetBucketLocationCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';

const REGIONS = ['us-east-1', 'us-east-2'] as const;

/** Buckets that must never be auto-suggested for delete. */
const NEVER_DELETE = [/cdk-hnb659fds-assets/i, /^cdktoolkit-/i];

/** Likely orphaned backend junk when no parent stack exists. */
const JUNK_PATTERNS = [
  /messengerattachments/i,
  /amplify-privatemessenger/i,
  /amplify-d332i3bk71so1w.*deployment/i,
];

function bucketRegion(location: string | undefined): string {
  if (!location || location === 'EU') return 'us-east-1';
  return location;
}

async function activeAmplifyStackNames(region: string): Promise<Set<string>> {
  const client = new CloudFormationClient({ region });
  const names = new Set<string>();
  let nextToken: string | undefined;

  do {
    const page = await client.send(
      new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: [
          'CREATE_COMPLETE',
          'UPDATE_COMPLETE',
          'UPDATE_ROLLBACK_COMPLETE',
          'DELETE_IN_PROGRESS',
        ],
      }),
    );
    for (const stack of page.StackSummaries ?? []) {
      if (stack.StackName?.startsWith('amplify-')) {
        names.add(stack.StackName);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);

  return names;
}

function looksLikeJunk(name: string): boolean {
  if (NEVER_DELETE.some((re) => re.test(name))) return false;
  return JUNK_PATTERNS.some((re) => re.test(name));
}

async function main(): Promise<void> {
  const s3 = new S3Client({});
  const listed = await s3.send(new ListBucketsCommand({}));
  const buckets = listed.Buckets ?? [];

  console.log('Active amplify-* CloudFormation stacks:\n');
  for (const region of REGIONS) {
    const stacks = await activeAmplifyStackNames(region);
    console.log(`  ${region}: ${stacks.size ? [...stacks].join(', ') : '(none — good after cleanup)'}`);
  }

  console.log('\nBuckets that look like leftover backend junk:\n');

  const suspects: { name: string; region: string }[] = [];

  for (const bucket of buckets) {
    const name = bucket.Name;
    if (!name || !looksLikeJunk(name)) continue;

    const location = await s3.send(new GetBucketLocationCommand({ Bucket: name }));
    const region = bucketRegion(location.LocationConstraint as string | undefined);
    suspects.push({ name, region });
    console.log(`  [${region}] ${name}`);
  }

  if (suspects.length === 0) {
    console.log('  (none matched junk patterns — you may be clean)');
    return;
  }

  console.log('\n--- Manual delete (PowerShell) ---');
  console.log('Empty each bucket, then delete it. Example:\n');
  for (const { name, region } of suspects) {
    console.log(`# ${name}`);
    console.log(`aws s3 rm s3://${name} --recursive --region ${region}`);
    console.log(`aws s3 rb s3://${name} --region ${region}\n`);
  }

  console.log('Or: S3 console → bucket → Empty → Delete bucket');
  console.log('\nDo NOT delete buckets for a LIVE amplify-d332i3bk71so1w-main-branch stack you are using.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
