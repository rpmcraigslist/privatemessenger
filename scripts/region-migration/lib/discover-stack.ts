import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  ListStacksCommand,
  type StackResourceSummary,
} from '@aws-sdk/client-cloudformation';
import type { ModelName } from './types.js';
import { MODEL_TABLE_HINTS } from './types.js';

export type DiscoveredBackend = {
  stackName: string;
  tables: Partial<Record<ModelName, string>>;
  bucketName: string | null;
};

async function listActiveStacks(client: CloudFormationClient): Promise<string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(
      new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: [
          'CREATE_COMPLETE',
          'UPDATE_COMPLETE',
          'UPDATE_ROLLBACK_COMPLETE',
        ],
      }),
    );
    for (const stack of page.StackSummaries ?? []) {
      if (stack.StackName) names.push(stack.StackName);
    }
    nextToken = page.NextToken;
  } while (nextToken);

  return names;
}

async function stackResources(
  client: CloudFormationClient,
  stackName: string,
): Promise<StackResourceSummary[]> {
  const resources: StackResourceSummary[] = [];
  let nextToken: string | undefined;

  do {
    const page = await client.send(
      new DescribeStackResourcesCommand({
        StackName: stackName,
        NextToken: nextToken,
      }),
    );
    resources.push(...(page.StackResources ?? []));
    nextToken = page.NextToken;
  } while (nextToken);

  return resources;
}

function matchModelTable(tableName: string): ModelName | null {
  for (const model of MODEL_TABLE_HINTS) {
    if (tableName.includes(model)) return model;
  }
  return null;
}

export async function discoverBackendFromUserPool(
  region: string,
  userPoolId: string,
  expectedBucket?: string,
): Promise<DiscoveredBackend> {
  const client = new CloudFormationClient({ region });
  const stackNames = await listActiveStacks(client);

  for (const stackName of stackNames) {
    const resources = await stackResources(client, stackName);
    const hasPool = resources.some(
      (resource) =>
        resource.ResourceType === 'AWS::Cognito::UserPool' &&
        resource.PhysicalResourceId === userPoolId,
    );
    if (!hasPool) continue;

    const tables: Partial<Record<ModelName, string>> = {};
    let bucketName: string | null = null;

    for (const resource of resources) {
      if (
        resource.ResourceType === 'AWS::DynamoDB::Table' &&
        resource.PhysicalResourceId
      ) {
        const model = matchModelTable(resource.PhysicalResourceId);
        if (model) tables[model] = resource.PhysicalResourceId;
      }
      if (
        resource.ResourceType === 'AWS::S3::Bucket' &&
        resource.PhysicalResourceId
      ) {
        if (!expectedBucket || resource.PhysicalResourceId === expectedBucket) {
          bucketName = resource.PhysicalResourceId;
        }
      }
    }

    return { stackName, tables, bucketName };
  }

  throw new Error(
    `Could not find CloudFormation stack for user pool ${userPoolId} in ${region}`,
  );
}

export async function emptyBucket(
  region: string,
  bucketName: string,
): Promise<void> {
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import(
    '@aws-sdk/client-s3'
  );
  const client = new S3Client({ region });
  let continuationToken: string | undefined;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (listed.Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => !!key);
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
          },
        }),
      );
    }
    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);
}

export async function deleteBackendStack(
  region: string,
  stackName: string,
  bucketName?: string | null,
): Promise<void> {
  const { CloudFormationClient, DeleteStackCommand } = await import(
    '@aws-sdk/client-cloudformation'
  );
  if (bucketName) {
    await emptyBucket(region, bucketName);
  }
  const client = new CloudFormationClient({ region });
  await client.send(new DeleteStackCommand({ StackName: stackName }));
}
