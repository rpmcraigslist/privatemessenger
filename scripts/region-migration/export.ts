#!/usr/bin/env tsx
import { resolve } from 'node:path';
import { exportCognitoUsers } from './lib/cognito.js';
import { discoverBackendFromUserPool } from './lib/discover-stack.js';
import { exportTables } from './lib/dynamodb.js';
import {
  exportDir,
  appsyncApiIdFromOutputs,
  loadOutputs,
  MODEL_TABLE_HINTS,
  type MigrationManifest,
  type ModelName,
  writeJson,
} from './lib/types.js';

const REQUIRED_MODELS: ModelName[] = ['UserProfile', 'Conversation', 'Message'];
const OPTIONAL_MODELS: ModelName[] = ['ConversationReadState'];

const sourceOutputsPath = process.argv[2] ?? resolve('amplify_outputs.json');

async function main(): Promise<void> {
  const outputs = loadOutputs(sourceOutputsPath);
  const region = outputs.auth.aws_region;
  const userPoolId = outputs.auth.user_pool_id;
  const bucketName = outputs.storage.bucket_name;
  const preferredApiId = appsyncApiIdFromOutputs(outputs);

  console.log(`Discovering ${region} backend for pool ${userPoolId}...`);
  if (preferredApiId) {
    console.log(`  AppSync API id from outputs: ${preferredApiId}`);
  }
  const backend = await discoverBackendFromUserPool(
    region,
    userPoolId,
    bucketName,
    preferredApiId,
  );
  console.log(`  Root stack: ${backend.stackName}`);
  console.log(`  Nested stacks: ${backend.nestedStackNames.length}`);
  console.log(`  Table discovery: ${backend.tableDiscovery}`);
  if (Object.keys(backend.tables).length > 0) {
    console.log(`  Tables: ${JSON.stringify(backend.tables)}`);
  }

  for (const model of REQUIRED_MODELS) {
    if (!backend.tables[model]) {
      throw new Error(
        `Could not locate DynamoDB table for ${model}.\n` +
          `Matched tables: ${JSON.stringify(backend.tables)}\n` +
          'If this persists, open CloudFormation (us-east-1), find the Amplify backend stack, ' +
          'and note DynamoDB table names under nested stacks.',
      );
    }
  }

  for (const model of OPTIONAL_MODELS) {
    if (!backend.tables[model]) {
      console.warn(`  Optional table ${model} not found — exporting empty.`);
    }
  }

  const tablesToExport: Partial<Record<ModelName, string>> = { ...backend.tables };
  for (const model of OPTIONAL_MODELS) {
    if (!tablesToExport[model]) {
      writeJson(resolve(exportDir, `${model}.json`), []);
    }
  }

  console.log(`Exporting Cognito users from ${userPoolId}...`);
  const cognitoUsers = await exportCognitoUsers(region, userPoolId);

  console.log('Scanning DynamoDB tables...');
  const tables = await exportTables(region, tablesToExport);

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
    tables: {
      ...Object.fromEntries(
        MODEL_TABLE_HINTS.map((model) => [model, backend.tables[model] ?? '']),
      ),
    } as Record<ModelName, string>,
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
