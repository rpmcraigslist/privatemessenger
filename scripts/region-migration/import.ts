#!/usr/bin/env tsx
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { resolve } from 'node:path';
import { importCognitoUsers } from './lib/cognito.js';
import { discoverBackendFromUserPool } from './lib/discover-stack.js';
import { copyBucketObjects, importTableItems } from './lib/dynamodb.js';
import {
  exportDir,
  loadOutputs,
  readJson,
  remapItemForImport,
  type ExportedCognitoUser,
  type MigrationManifest,
  type ModelName,
  writeJson,
} from './lib/types.js';

const destOutputsPath = process.argv[2] ?? resolve('amplify_outputs.json');
const tempPassword = process.env.MIGRATION_TEMP_PASSWORD?.trim();

async function main(): Promise<void> {
  if (!tempPassword || tempPassword.length < 8) {
    throw new Error(
      'Set MIGRATION_TEMP_PASSWORD (min 8 chars). Every user must sign in and change it after migration.',
    );
  }

  const manifest = readJson<MigrationManifest>(resolve(exportDir, 'manifest.json'));
  const destOutputs = loadOutputs(destOutputsPath);
  const destRegion = destOutputs.auth.aws_region;
  const destPoolId = destOutputs.auth.user_pool_id;
  const destBucket = destOutputs.storage.bucket_name;

  if (destRegion !== 'us-east-2') {
    throw new Error(
      `Expected destination region us-east-2, got ${destRegion}. Deploy the Ohio backend first.`,
    );
  }

  console.log(`Discovering destination backend (${destPoolId})...`);
  const destBackend = await discoverBackendFromUserPool(
    destRegion,
    destPoolId,
    destBucket,
  );

  const destUsers = await new CognitoIdentityProviderClient({ region: destRegion }).send(
    new ListUsersCommand({ UserPoolId: destPoolId, Limit: 1 }),
  );
  if ((destUsers.Users?.length ?? 0) > 0) {
    throw new Error(
      'Destination user pool is not empty. Do not bootstrap admin on the Ohio URL before import.',
    );
  }

  console.log('Importing Cognito users and building sub remap...');
  const cognitoUsers = readJson<ExportedCognitoUser[]>(
    resolve(exportDir, 'cognito-users.json'),
  );
  const subRemap = await importCognitoUsers(
    destRegion,
    destPoolId,
    cognitoUsers,
    tempPassword,
  );
  writeJson(resolve(exportDir, 'sub-remap.json'), Object.fromEntries(subRemap));

  const importOrder: ModelName[] = [
    'UserProfile',
    'Conversation',
    'Message',
    'ConversationReadState',
  ];

  for (const model of importOrder) {
    const sourceItems = readJson<Record<string, unknown>[]>(
      resolve(exportDir, `${model}.json`),
    );
    const tableName = destBackend.tables[model];
    if (!tableName) {
      if (sourceItems.length === 0) {
        console.warn(`  ${model}: skipped (no destination table, empty export)`);
        continue;
      }
      throw new Error(`Missing destination table for ${model}`);
    }
    if (sourceItems.length === 0) {
      console.log(`  ${model}: skipped (0 items)`);
      continue;
    }

    const remapped = sourceItems.map((item) =>
      remapItemForImport(model, item, subRemap),
    );
    const count = await importTableItems(destRegion, tableName, remapped);
    console.log(`  ${model}: imported ${count} items into ${tableName}`);
  }

  console.log(
    `Copying S3 attachments ${manifest.sourceBucket} -> ${destBucket}...`,
  );
  const copied = await copyBucketObjects(
    manifest.sourceRegion,
    manifest.sourceBucket,
    destRegion,
    destBucket,
  );
  console.log(`  Copied ${copied} objects.`);

  console.log('');
  console.log('Import complete.');
  console.log(`Temporary password for all migrated users: ${tempPassword}`);
  console.log('Every user must sign in once and set a new password.');
  console.log('');
  console.log('After verifying the hosted app, delete the old stack:');
  console.log('  npm run migrate:teardown');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
