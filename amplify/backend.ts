import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { attachmentUrl } from './functions/attachment-url/resource';
import { bootstrapRequired } from './functions/bootstrap-required/resource';
import { bootstrapAdmin } from './functions/bootstrap-admin/resource';
import { adminOps } from './functions/admin-ops/resource';
import { messageAlerts } from './functions/message-alerts/resource';
import { profileSync } from './functions/profile-sync/resource';
import { readCursor } from './functions/read-cursor/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  attachmentUrl,
  bootstrapRequired,
  bootstrapAdmin,
  adminOps,
  messageAlerts,
  profileSync,
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
userPool.grant(backend.messageAlerts.resources.lambda, 'cognito-idp:ListUsers');

backend.messageAlerts.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['sns:Publish'],
    resources: ['*'],
  }),
);
