import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { attachmentUrl } from '../functions/attachment-url/resource';
import { accountRequest } from '../functions/account-request/resource';
import { bootstrapRequired } from '../functions/bootstrap-required/resource';
import { bootstrapAdmin } from '../functions/bootstrap-admin/resource';
import { adminOps } from '../functions/admin-ops/resource';
import { messageAlerts } from '../functions/message-alerts/resource';
import { profileSync } from '../functions/profile-sync/resource';
import { readCursor } from '../functions/read-cursor/resource';

const schema = a
  .schema({
    UserProfile: a
      .model({
        username: a.string().required(),
        cognitoSub: a.string(),
        displayName: a.string(),
        avatarColor: a.string(),
        role: a.enum(['admin', 'user']),
        phoneNumber: a.string(),
        smsNotificationsEnabled: a.boolean(),
        contactEmail: a.string(),
      })
      .secondaryIndexes((index) => [index('username'), index('cognitoSub')])
      .authorization((allow) => [
        // Directory reads go through listUserDirectory (Lambda + IAM).
        // Profile rows are created/updated only by backend Lambdas.
        allow.authenticated().to(['read']),
      ]),

    Conversation: a
      .model({
        name: a.string(),
        isGroup: a.boolean().default(false),
        participants: a.string().array().required(),
        lastMessage: a.string(),
        lastMessageAt: a.datetime(),
        messages: a.hasMany('Message', 'conversationId'),
      })
      .authorization((allow) => [
        allow
          .ownersDefinedIn('participants')
          .identityClaim('sub')
          .to(['read', 'create', 'update', 'delete']),
      ]),

    Message: a
      .model({
        conversationId: a.id().required(),
        conversation: a.belongsTo('Conversation', 'conversationId'),
        content: a.string(),
        senderUsername: a.string().required(),
        participantUsernames: a.string().array().required(),
        type: a.enum(['text', 'image', 'file']),
        attachmentKey: a.string(),
        attachmentName: a.string(),
        replyToMessageId: a.id(),
        replyToSenderUsername: a.string(),
        replyToContentPreview: a.string(),
      })
      .secondaryIndexes((index) => [index('conversationId')])
      .authorization((allow) => [
        allow
          .ownersDefinedIn('participantUsernames')
          .identityClaim('sub')
          .to(['read', 'create']),
      ]),

    ConversationReadState: a
      .model({
        userSub: a.string().required(),
        ownerSubs: a.string().array().required(),
        readScopeKey: a.string().required(),
        lastReadAt: a.datetime().required(),
        conversationId: a.id(),
      })
      .identifier(['userSub', 'readScopeKey'])
      .secondaryIndexes((index) => [index('userSub')])
      .authorization((allow) => [
        allow
          .ownersDefinedIn('ownerSubs')
          .identityClaim('sub')
          .to(['read', 'create', 'update', 'delete']),
      ]),

    ReadCursorRow: a.customType({
      readScopeKey: a.string().required(),
      lastReadAt: a.string().required(),
      conversationId: a.string(),
    }),

    AdminUser: a.customType({
      loginId: a.string().required(),
      username: a.string().required(),
      contactEmail: a.string(),
      status: a.string().required(),
    }),

    BootstrapResult: a.customType({
      username: a.string().required(),
      message: a.string().required(),
    }),

    AdminCreateUserResult: a.customType({
      username: a.string().required(),
      forcePasswordChange: a.boolean().required(),
    }),

    AdminDeleteUserResult: a.customType({
      username: a.string().required(),
      deletedMessages: a.integer().required(),
      deletedConversations: a.integer().required(),
    }),

    AdminForcePasswordChangeResult: a.customType({
      username: a.string().required(),
      message: a.string().required(),
    }),

    AdminPurgeUsersResult: a.customType({
      deleted: a.integer().required(),
    }),

    AdminClearMessagesResult: a.customType({
      deletedMessages: a.integer().required(),
      deletedConversations: a.integer().required(),
    }),

    AdminAuditCognitoUser: a.customType({
      username: a.string().required(),
      cognitoSub: a.string(),
      status: a.string().required(),
    }),

    AdminAuditProfileRow: a.customType({
      id: a.string().required(),
      username: a.string().required(),
      cognitoSub: a.string(),
      orphan: a.boolean().required(),
    }),

    AdminAuditDuplicateChat: a.customType({
      peerKey: a.string().required(),
      conversationIds: a.string().array().required(),
    }),

    AdminAuditMessengerResult: a.customType({
      cognitoUsers: a.ref('AdminAuditCognitoUser').array().required(),
      profileRows: a.ref('AdminAuditProfileRow').array().required(),
      duplicateProfileHandles: a.string().array().required(),
      duplicateDirectChats: a.ref('AdminAuditDuplicateChat').array().required(),
    }),

    AdminPurgeDirectChatResult: a.customType({
      usernameA: a.string().required(),
      usernameB: a.string().required(),
      deletedMessages: a.integer().required(),
      deletedConversations: a.integer().required(),
    }),

    AdminReconcileMessengerResult: a.customType({
      profilesConsolidated: a.integer().required(),
      orphanProfilesRemoved: a.integer().required(),
      duplicateConversationsRemoved: a.integer().required(),
      messagesRemoved: a.integer().required(),
      conversationsNormalized: a.integer().required(),
    }),

    DeleteMyMessageResult: a.customType({
      messageId: a.string().required(),
      deleted: a.boolean().required(),
    }),

    MessageAlertsResult: a.customType({
      sent: a.integer().required(),
      failed: a.integer(),
      skipped: a.integer(),
      conversationId: a.string(),
    }),

    AccountRequestResult: a.customType({
      message: a.string().required(),
      notified: a.boolean().required(),
    }),

    SyncProfileResult: a.customType({
      profileId: a.string().required(),
      username: a.string().required(),
      cognitoSub: a.string().required(),
      role: a.string().required(),
      contactEmail: a.string(),
    }),

    DirectoryUser: a.customType({
      id: a.string().required(),
      username: a.string().required(),
      cognitoSub: a.string(),
      displayName: a.string(),
      avatarColor: a.string(),
    }),

    bootstrapRequired: a
      .query()
      .returns(a.boolean())
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(bootstrapRequired)),

    bootstrapAdmin: a
      .mutation()
      .arguments({
        username: a.string().required(),
        password: a.string().required(),
        contactEmail: a.string(),
      })
      .returns(a.ref('BootstrapResult'))
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(bootstrapAdmin)),

    requestAccountAccess: a
      .mutation()
      .arguments({
        username: a.string().required(),
        contactEmail: a.string().required(),
        appUrl: a.string(),
      })
      .returns(a.ref('AccountRequestResult'))
      .authorization((allow) => [allow.publicApiKey()])
      .handler(a.handler.function(accountRequest)),

    listUserDirectory: a
      .query()
      .returns(a.ref('DirectoryUser').array())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminListUsers: a
      .query()
      .returns(a.ref('AdminUser').array())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminCreateUser: a
      .mutation()
      .arguments({
        username: a.string().required(),
        temporaryPassword: a.string().required(),
        contactEmail: a.string(),
        forcePasswordChange: a.boolean(),
      })
      .returns(a.ref('AdminCreateUserResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminDeleteUser: a
      .mutation()
      .arguments({ username: a.string().required() })
      .returns(a.ref('AdminDeleteUserResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminForcePasswordChange: a
      .mutation()
      .arguments({
        username: a.string().required(),
        temporaryPassword: a.string().required(),
      })
      .returns(a.ref('AdminForcePasswordChangeResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminPurgeUsers: a
      .mutation()
      .returns(a.ref('AdminPurgeUsersResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminClearMessages: a
      .mutation()
      .returns(a.ref('AdminClearMessagesResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminAuditMessenger: a
      .query()
      .returns(a.ref('AdminAuditMessengerResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminPurgeDirectChat: a
      .mutation()
      .arguments({
        usernameA: a.string().required(),
        usernameB: a.string().required(),
      })
      .returns(a.ref('AdminPurgeDirectChatResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    adminReconcileMessenger: a
      .mutation()
      .returns(a.ref('AdminReconcileMessengerResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    deleteMyMessage: a
      .mutation()
      .arguments({ messageId: a.id().required() })
      .returns(a.ref('DeleteMyMessageResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(adminOps)),

    sendMessageAlerts: a
      .mutation()
      .arguments({
        messageId: a.id().required(),
        appUrl: a.string(),
      })
      .returns(a.ref('MessageAlertsResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(messageAlerts)),

    syncMyProfile: a
      .mutation()
      .arguments({
        contactEmail: a.string(),
      })
      .returns(a.ref('SyncProfileResult'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(profileSync)),

    listMyReadCursors: a
      .query()
      .returns(a.ref('ReadCursorRow').array())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(readCursor)),

    upsertMyReadCursor: a
      .mutation()
      .arguments({
        readScopeKey: a.string().required(),
        lastReadAt: a.string().required(),
        conversationId: a.string(),
      })
      .returns(a.ref('ReadCursorRow'))
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(readCursor)),

    getAttachmentUrl: a
      .query()
      .arguments({
        conversationId: a.id().required(),
        attachmentKey: a.string().required(),
      })
      .returns(a.string())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(attachmentUrl)),
  })
  .authorization((allow) => [
    allow.resource(attachmentUrl),
    allow.resource(bootstrapRequired),
    allow.resource(bootstrapAdmin),
    allow.resource(accountRequest),
    allow.resource(adminOps),
    allow.resource(messageAlerts),
    allow.resource(profileSync),
    allow.resource(readCursor),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});
