import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ExportedTable, ModelName } from './types.js';
import { MODEL_TABLE_HINTS } from './types.js';

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
    if (!tableName) {
      throw new Error(`Missing DynamoDB table for model ${model}`);
    }
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
