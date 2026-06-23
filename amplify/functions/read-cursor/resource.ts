import { defineFunction } from '@aws-amplify/backend';

export const readCursor = defineFunction({
  name: 'read-cursor',
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
