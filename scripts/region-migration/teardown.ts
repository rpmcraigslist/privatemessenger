#!/usr/bin/env tsx
import { resolve } from 'node:path';
import { deleteBackendStack } from './lib/discover-stack.js';
import { exportDir, readJson, type MigrationManifest } from './lib/types.js';

async function main(): Promise<void> {
  if (process.env.MIGRATION_TEARDOWN_CONFIRM !== 'DELETE_US_EAST_1') {
    throw new Error(
      'Refusing to delete resources without MIGRATION_TEARDOWN_CONFIRM=DELETE_US_EAST_1',
    );
  }

  const manifest = readJson<MigrationManifest>(resolve(exportDir, 'manifest.json'));
  console.log(
    `Deleting stack ${manifest.stackName} in ${manifest.sourceRegion}...`,
  );
  await deleteBackendStack(
    manifest.sourceRegion,
    manifest.stackName,
    manifest.sourceBucket,
  );
  console.log('Delete initiated. Watch CloudFormation in us-east-1 until stack is gone.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
