import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  ListStacksCommand,
  type StackResourceSummary,
} from '@aws-sdk/client-cloudformation';
import { listAllTableNames, discoverTablesByApiIdGrouping } from './dynamodb.js';
import type { ModelName } from './types.js';
import { MODEL_TABLE_HINTS } from './types.js';

export type DiscoveredBackend = {
  stackName: string;
  tables: Partial<Record<ModelName, string>>;
  bucketName: string | null;
  nestedStackNames: string[];
  tableDiscovery: 'cloudformation' | 'dynamodb-listing';
};

const MODELS_LONGEST_FIRST = [...MODEL_TABLE_HINTS].sort(
  (a, b) => b.length - a.length,
);

/** Amplify nested stack suffix, e.g. ...-auth179371D7-1VIPII2T0163D */
const AMPLIFY_NESTED_SUFFIX =
  /-(auth|data|storage|function|NestedStack)[A-Za-z0-9-]+$/i;

export function amplifyRootStackName(
  anchorStackName: string,
  allStackNames: string[],
): string {
  const withoutNested = anchorStackName.replace(AMPLIFY_NESTED_SUFFIX, '');
  if (allStackNames.includes(withoutNested)) return withoutNested;

  const prefixMatch = anchorStackName.match(
    /^(amplify-.+?)-(?:auth|data|storage|function)/i,
  );
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    if (allStackNames.includes(prefix)) return prefix;

    const candidates = allStackNames
      .filter((name) => name === prefix || name.startsWith(`${prefix}-`))
      .sort((a, b) => a.length - b.length);
    if (candidates[0]) return candidates[0];
  }

  return withoutNested !== anchorStackName ? withoutNested : anchorStackName;
}

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

async function collectStackResourcesRecursive(
  client: CloudFormationClient,
  stackName: string,
  visited: Set<string>,
): Promise<StackResourceSummary[]> {
  if (visited.has(stackName)) return [];
  visited.add(stackName);

  const resources = await stackResources(client, stackName);
  const all: StackResourceSummary[] = [...resources];

  for (const resource of resources) {
    if (
      resource.ResourceType === 'AWS::CloudFormation::Stack' &&
      resource.PhysicalResourceId
    ) {
      const nested = await collectStackResourcesRecursive(
        client,
        resource.PhysicalResourceId,
        visited,
      );
      all.push(...nested);
    }
  }

  return all;
}

function matchModelFromResource(resource: StackResourceSummary): ModelName | null {
  const logical = resource.LogicalResourceId ?? '';
  const physical = resource.PhysicalResourceId ?? '';
  const haystack = `${logical} ${physical}`;

  for (const model of MODELS_LONGEST_FIRST) {
    if (haystack.includes(model)) return model;
    if (physical.startsWith(`${model}-`)) return model;
  }
  return null;
}

function extractTablesAndBucket(
  resources: StackResourceSummary[],
  expectedBucket?: string,
): { tables: Partial<Record<ModelName, string>>; bucketName: string | null } {
  const tables: Partial<Record<ModelName, string>> = {};
  let bucketName: string | null = null;

  for (const resource of resources) {
    if (
      resource.ResourceType === 'AWS::DynamoDB::Table' &&
      resource.PhysicalResourceId
    ) {
      const model = matchModelFromResource(resource);
      if (model && !tables[model]) {
        tables[model] = resource.PhysicalResourceId;
      }
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

  return { tables, bucketName };
}

function countMatchedModels(tables: Partial<Record<ModelName, string>>): number {
  return MODEL_TABLE_HINTS.filter((model) => tables[model]).length;
}

export async function discoverBackendFromUserPool(
  region: string,
  userPoolId: string,
  expectedBucket?: string,
  preferredApiId?: string | null,
): Promise<DiscoveredBackend> {
  const client = new CloudFormationClient({ region });
  const stackNames = await listActiveStacks(client);

  let anchorStackName: string | null = null;

  for (const stackName of stackNames) {
    const visited = new Set<string>();
    const resources = await collectStackResourcesRecursive(
      client,
      stackName,
      visited,
    );
    const hasPool = resources.some(
      (resource) =>
        resource.ResourceType === 'AWS::Cognito::UserPool' &&
        resource.PhysicalResourceId === userPoolId,
    );
    if (hasPool) {
      anchorStackName = stackName;
      break;
    }
  }

  if (!anchorStackName) {
    throw new Error(
      `Could not find CloudFormation stack for user pool ${userPoolId} in ${region}`,
    );
  }

  const rootStackName = amplifyRootStackName(anchorStackName, stackNames);
  const visited = new Set<string>();
  const resources = await collectStackResourcesRecursive(
    client,
    rootStackName,
    visited,
  );

  let { tables, bucketName } = extractTablesAndBucket(resources, expectedBucket);
  let tableDiscovery: DiscoveredBackend['tableDiscovery'] = 'cloudformation';

  if (countMatchedModels(tables) === 0) {
    console.warn(
      '  No tables in CloudFormation tree — falling back to DynamoDB table listing.',
    );
    const allNames = await listAllTableNames(region);
    tables = discoverTablesByApiIdGrouping(allNames, preferredApiId);
    tableDiscovery = 'dynamodb-listing';
  }

  if (expectedBucket && !bucketName) {
    bucketName = expectedBucket;
  }

  return {
    stackName: rootStackName,
    tables,
    bucketName,
    nestedStackNames: [...visited],
    tableDiscovery,
  };
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
