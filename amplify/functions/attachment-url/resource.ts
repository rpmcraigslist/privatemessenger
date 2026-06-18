import { defineFunction } from '@aws-amplify/backend';

/** Issues short-lived S3 URLs only after verifying conversation membership. */
export const attachmentUrl = defineFunction({
  name: 'attachment-url',
  resourceGroupName: 'data',
});
