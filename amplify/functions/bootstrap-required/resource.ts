import { defineFunction } from '@aws-amplify/backend';

export const bootstrapRequired = defineFunction({
  name: 'bootstrap-required',
  resourceGroupName: 'data',
  entry: './handler.ts',
});
