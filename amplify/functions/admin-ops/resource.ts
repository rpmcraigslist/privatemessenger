import { defineFunction } from '@aws-amplify/backend';

export const adminOps = defineFunction({
  name: 'admin-ops',
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
