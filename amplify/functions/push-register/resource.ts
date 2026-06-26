import { defineFunction } from '@aws-amplify/backend';

export const pushRegister = defineFunction({
  name: 'push-register',
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
