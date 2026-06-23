import {
  DynamoDBClient,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ExportedTable, ModelName } from './types.js';
import { MODEL_TABLE_HINTS } from './types.js';

const MODELS_LONGEST_FIRST = [...MODEL_TABLE_HINTS].sort(
  (a, b) => b.length - a.length,
);

/** e.g. Conversation-bt5oxhvn6fe3jg3m44tbltr4sq-NONE */
export function apiIdFromAmplifyTableName(tableName: string): string | null {
  const match = tableName.match(/^[A-Za-z]+-([a-z0-9]+)-NONE$/i);
  return match?.[1] ?? null;
}

export function matchModelFromAmplifyTableName(tableName: string): ModelName | null {
  for (const model of MODELS_LONGEST_FIRST) {
    if (tableName.startsWith(`${model}-`)) return model;
  }
  return null;
}

export async function listAllTableNames(region: string): Promise<string[]> {
  const client = new DynamoDBClient({ region });
  const names: string[] = [];
  let startName: string | undefined;

  do {
    const page = await client.send(
      new ListTablesCommand({ ExclusiveStartTableName: startName }),
    );
    names.push(...(page.TableNames ?? []));
    startName = page.LastEvaluatedTableName;
  } while (startName);

  return names;
}

/** Group Amplify Gen 2 tables by shared API id hash in the table name. */
export function discoverTablesByApiIdGrouping(
  allTableNames: string[],
  preferredApiId?: string | null,
): Partial<Record<ModelName, string>> {
  const byApiId = new Map<string, Partial<Record<ModelName, string>>>();

  for (const name of allTableNames) {
    const model = matchModelFromAmplifyTableName(name);
    const apiId = apiIdFromAmplifyTableName(name);
    if (!model || !apiId) continue;
    if (!byApiId.has(apiId)) byApiId.set(apiId, {});
    const group = byApiId.get(apiId)!;
    if (!group[model]) group[model] = name;
  }

  if (preferredApiId && byApiId.has(preferredApiId)) {
    return byApiId.get(preferredApiId)!;
  }

  let best: Partial<Record<ModelName, string>> = {};
  let bestScore = 0;
  let bestApiId: string | null = null;

  for (const [apiId, group] of byApiId.entries()) {
    const score = MODEL_TABLE_HINTS.filter((model) => group[model]).length;
    const winsTie =
      score === bestScore &&
      preferredApiId &&
      apiId === preferredApiId &&
      bestApiId !== preferredApiId;
    if (score > bestScore || winsTie) {
      bestScore = score;
      best = group;
      bestApiId = apiId;
    }
  }

  return best;
}

function docClient(region: string): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export async function scanTable(
  region: string,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  const client = docClient(region);
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const page = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    for (const item of page.Items ?? []) {
      items.push(item as Record<string, unknown>);
    }
    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

export async function exportTables(
  region: string,
  tables: Partial<Record<ModelName, string>>,
): Promise<ExportedTable[]> {
  const exported: ExportedTable[] = [];
  for (const model of MODEL_TABLE_HINTS) {
    const tableName = tables[model];
    if (!tableName) continue;
    const items = await scanTable(region, tableName);
    exported.push({ model, tableName, items });
  }
  return exported;
}

export async function importTableItems(
  region: string,
  tableName: string,
  items: Record<string, unknown>[],
): Promise<number> {
  const client = docClient(region);
  let written = 0;

  for (let index = 0; index < items.length; index += 25) {
    const chunk = items.slice(index, index + 25);
    let request = {
      RequestItems: {
        [tableName]: chunk.map((item) => ({
          PutRequest: { Item: item },
        })),
      },
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await client.send(new BatchWriteCommand(request));
      const unprocessed = result.UnprocessedItems?.[tableName] ?? [];
      if (unprocessed.length === 0) break;
      request = { RequestItems: { [tableName]: unprocessed } };
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }

    written += chunk.length;
  }

  return written;
}

export async function copyBucketObjects(
  sourceRegion: string,
  sourceBucket: string,
  destRegion: string,
  destBucket: string,
): Promise<number> {
  const { S3Client, ListObjectsV2Command, CopyObjectCommand } = await import(
    '@aws-sdk/client-s3'
  );
  const sourceClient = new S3Client({ region: sourceRegion });
  const destClient = new S3Client({ region: destRegion });
  let copied = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await sourceClient.send(
      new ListObjectsV2Command({
        Bucket: sourceBucket,
        ContinuationToken: continuationToken,
      }),
    );
    for (const entry of listed.Contents ?? []) {
      if (!entry.Key) continue;
      const copySource = `${sourceBucket}/${entry.Key.split('/').map(encodeURIComponent).join('/')}`;
      await destClient.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: entry.Key,
          CopySource: copySource,
        }),
      );
      copied += 1;
    }
    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);

  return copied;
}
