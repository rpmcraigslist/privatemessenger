import { defineFunction } from '@aws-amplify/backend';

export const messageAlerts = defineFunction({
  name: 'message-alerts',
  resourceGroupName: 'data',
  entry: './handler.ts',
});
