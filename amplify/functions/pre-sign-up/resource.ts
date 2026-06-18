import { defineFunction } from '@aws-amplify/backend';

/** Skips email verification codes — users sign in immediately after sign-up. */
export const preSignUp = defineFunction({
  name: 'pre-sign-up',
  resourceGroupName: 'auth',
});
