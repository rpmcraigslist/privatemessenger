import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from '../functions/pre-sign-up/resource';

/**
 * Username-only UX with synthetic Cognito login ids ({user}@messenger.local).
 * Public self-sign-up is disabled in the UI; admins create accounts via admin-ops.
 * First account is created by bootstrapAdmin (empty user pool).
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  triggers: {
    preSignUp,
  },
  groups: ['Admin'],
  multifactor: {
    mode: 'OFF',
  },
  userAttributes: {
    preferredUsername: {
      required: true,
      mutable: true,
    },
    phoneNumber: {
      required: false,
      mutable: true,
    },
  },
});
