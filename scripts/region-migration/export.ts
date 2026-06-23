#!/usr/bin/env tsx
import { resolve } from 'node:path';
import { exportCognitoUsers } from './lib/cognito.js';
import { discoverBackendFromUserPool } from './lib/discover-stack.js';
import { exportTables } from './lib/dynamodb.js';
import {
  exportDir,
  loadOutputs,
  type MigrationManifest,
  type ModelName,
  writeJson,
} from './lib/types.js';

const sourceOutputsPath =
  process.argv[2] ??
  resolve('scripts/region-migration/snapshots/amplify_outputs.us-east-1.json');

async function main(): Promise<void> {
  const outputs = loadOutputs(sourceOutputsPath);
  const region = outputs.auth.aws_region;
  const userPoolId = outputs.auth.user_pool_id;
  const bucketName = outputs.storage.bucket_name;

  console.log(`Discovering ${region} backend for pool ${userPoolId}...`);
  const backend = await discoverBackendFromUserPool(region, userPoolId, bucketName);

  for (const model of ['UserProfile', 'Conversation', 'Message', 'ConversationReadState'] as ModelName[]) {
    if (!backend.tables[model]) {
      throw new Error(`Could not locate DynamoDB table for ${model}`);
    }
  }

  console.log(`Exporting Cognito users from ${userPoolId}...`);
  const cognitoUsers = await exportCognitoUsers(region, userPoolId);

  console.log('Scanning DynamoDB tables...');
  const tables = await exportTables(region, backend.tables);

  for (const table of tables) {
    const file = resolve(exportDir, `${table.model}.json`);
    writeJson(file, table.items);
    console.log(`  ${table.model}: ${table.items.length} items -> ${file}`);
  }

  const manifest: MigrationManifest = {
    exportedAt: new Date().toISOString(),
    sourceRegion: region,
    sourceUserPoolId: userPoolId,
    sourceBucket: bucketName,
    stackName: backend.stackName,
    tables: backend.tables as Record<ModelName, string>,
    cognitoUsers,
  };
  writeJson(resolve(exportDir, 'manifest.json'), manifest);
  writeJson(resolve(exportDir, 'cognito-users.json'), cognitoUsers);

  console.log('');
  console.log('Export complete.');
  console.log(`  Stack: ${backend.stackName}`);
  console.log(`  Users: ${cognitoUsers.length}`);
  console.log(`  Data dir: ${exportDir}`);
  console.log('');
  console.log('Next: push to main so Amplify deploys the us-east-2 backend, then run:');
  console.log('  npm run migrate:import -- amplify_outputs.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
