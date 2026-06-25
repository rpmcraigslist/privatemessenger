import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { LOGIN_DOMAIN, poolId } from './cognito';
import { findProfileForParticipant } from './profiles';

type DataClient = ReturnType<typeof generateClient<Schema>>;

const cognito = new CognitoIdentityProviderClient({});
const ADMIN_GROUP = 'Admin';

function addContactEmail(
  emails: Set<string>,
  value: string | null | undefined,
): void {
  const email = value?.trim().toLowerCase();
  if (!email || email.endsWith(LOGIN_DOMAIN)) return;
  emails.add(email);
}

async function listAllProfiles(client: DataClient) {
  const profiles: Schema['UserProfile']['type'][] = [];
  let nextToken: string | undefined;

  for (;;) {
    const page = await client.models.UserProfile.list({
      authMode: 'iam',
      limit: 100,
      nextToken,
    });
    profiles.push(...page.data);
    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }

  return profiles;
}

async function listAdminSubsFromCognito(): Promise<string[]> {
  const subs: string[] = [];
  let nextToken: string | undefined;

  do {
    const page = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: poolId(),
        GroupName: ADMIN_GROUP,
        NextToken: nextToken,
      }),
    );

    for (const user of page.Users ?? []) {
      const sub = (user.Attributes ?? []).find((attr) => attr.Name === 'sub')?.Value;
      if (sub) subs.push(sub);
    }

    nextToken = page.NextToken;
  } while (nextToken);

  return subs;
}

/** Real contact emails for admin profiles (used for operational notifications). */
export async function listAdminNotificationEmails(
  client: DataClient,
): Promise<string[]> {
  const emails = new Set<string>();
  const profiles = await listAllProfiles(client);

  for (const profile of profiles) {
    if (profile.role !== 'admin') continue;
    addContactEmail(emails, profile.contactEmail);
  }

  if (emails.size > 0) {
    return [...emails];
  }

  try {
    const adminSubs = await listAdminSubsFromCognito();
    for (const sub of adminSubs) {
      const profile = await findProfileForParticipant(client, sub);
      addContactEmail(emails, profile?.contactEmail);
    }
  } catch (err) {
    console.error('listAdminNotificationEmails: cognito admin lookup failed', err);
  }

  return [...emails];
}
