import { defineFunction } from '@aws-amplify/backend';

export const accountRequest = defineFunction({
  name: 'account-request',
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
