import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { accountRequest } from './functions/account-request/resource';
import { attachmentUrl } from './functions/attachment-url/resource';
import { bootstrapRequired } from './functions/bootstrap-required/resource';
import { bootstrapAdmin } from './functions/bootstrap-admin/resource';
import { adminOps } from './functions/admin-ops/resource';
import { messageAlerts } from './functions/message-alerts/resource';
import { profileSync } from './functions/profile-sync/resource';
import { pushRegister } from './functions/push-register/resource';
import { readCursor } from './functions/read-cursor/resource';

// Backend deploy region: us-east-2 (see amplify/deployment-region.ts and amplify.yml).

const backend = defineBackend({
  auth,
  data,
  storage,
  attachmentUrl,
  bootstrapRequired,
  bootstrapAdmin,
  accountRequest,
  adminOps,
  messageAlerts,
  profileSync,
  pushRegister,
  readCursor,
});

const userPool = backend.auth.resources.userPool;
const poolId = userPool.userPoolId;

const cognitoAdminFns = [
  backend.bootstrapRequired,
  backend.bootstrapAdmin,
  backend.adminOps,
];

for (const fn of cognitoAdminFns) {
  fn.addEnvironment('USER_POOL_ID', poolId);
  userPool.grant(fn.resources.lambda, 'cognito-idp:ListUsers');
}

backend.profileSync.addEnvironment('USER_POOL_ID', poolId);
userPool.grant(backend.profileSync.resources.lambda, 'cognito-idp:ListUsers');

backend.pushRegister.addEnvironment('USER_POOL_ID', poolId);
userPool.grant(backend.pushRegister.resources.lambda, 'cognito-idp:ListUsers');

userPool.grant(
  backend.bootstrapAdmin.resources.lambda,
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminAddUserToGroup',
  'cognito-idp:AdminSetUserPassword',
);

userPool.grant(
  backend.adminOps.resources.lambda,
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminDeleteUser',
  'cognito-idp:AdminAddUserToGroup',
  'cognito-idp:AdminSetUserPassword',
);

backend.storage.resources.bucket.grantRead(
  backend.attachmentUrl.resources.lambda,
);

backend.attachmentUrl.addEnvironment(
  'STORAGE_BUCKET_NAME',
  backend.storage.resources.bucket.bucketName,
);

backend.messageAlerts.addEnvironment('USER_POOL_ID', poolId);
backend.messageAlerts.addEnvironment(
  'MESSENGER_FROM_EMAIL',
  process.env.MESSENGER_FROM_EMAIL ?? '',
);
backend.messageAlerts.addEnvironment(
  'MESSENGER_FROM_DISPLAY_NAME',
  process.env.MESSENGER_FROM_DISPLAY_NAME ?? '',
);
backend.messageAlerts.addEnvironment(
  'MESSENGER_APP_URL',
  process.env.MESSENGER_APP_URL ?? '',
);
backend.messageAlerts.addEnvironment(
  'MESSENGER_VAPID_PUBLIC_KEY',
  process.env.MESSENGER_VAPID_PUBLIC_KEY ?? '',
);
backend.messageAlerts.addEnvironment(
  'MESSENGER_VAPID_PRIVATE_KEY',
  process.env.MESSENGER_VAPID_PRIVATE_KEY ?? '',
);
backend.messageAlerts.addEnvironment(
  'MESSENGER_VAPID_SUBJECT',
  process.env.MESSENGER_VAPID_SUBJECT ?? '',
);
userPool.grant(backend.messageAlerts.resources.lambda, 'cognito-idp:ListUsers');

backend.messageAlerts.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['sns:Publish'],
    resources: ['*'],
  }),
);

backend.messageAlerts.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
  }),
);

backend.accountRequest.addEnvironment('USER_POOL_ID', poolId);
userPool.grant(
  backend.accountRequest.resources.lambda,
  'cognito-idp:ListUsersInGroup',
  'cognito-idp:ListUsers',
);
backend.accountRequest.addEnvironment(
  'MESSENGER_FROM_EMAIL',
  process.env.MESSENGER_FROM_EMAIL ?? '',
);
backend.accountRequest.addEnvironment(
  'MESSENGER_FROM_DISPLAY_NAME',
  process.env.MESSENGER_FROM_DISPLAY_NAME ?? '',
);
backend.accountRequest.addEnvironment(
  'MESSENGER_APP_URL',
  process.env.MESSENGER_APP_URL ?? '',
);
backend.accountRequest.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
  }),
);
