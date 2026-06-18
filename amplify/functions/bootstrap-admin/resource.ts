import { defineFunction } from '@aws-amplify/backend';

export const bootstrapAdmin = defineFunction({
  name: 'bootstrap-admin',
  resourceGroupName: 'data',
  entry: './handler.ts',
});
