import { defineStorage } from '@aws-amplify/backend';

/**
 * Conversation-scoped attachment storage.
 *
 * Uploaders write under conversations/{conversationId}/{identityId}/...
 * Only the uploader has direct S3 access. Other participants receive presigned
 * URLs from the getAttachmentUrl Lambda after membership is verified.
 */
export const storage = defineStorage({
  name: 'messengerAttachments',
  access: (allow) => ({
    'conversations/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
    ],
  }),
});
