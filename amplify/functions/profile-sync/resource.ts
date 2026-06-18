import { defineFunction } from '@aws-amplify/backend';

export const profileSync = defineFunction({
  name: 'profile-sync',
  resourceGroupName: 'data',
  entry: './handler.ts',
});
