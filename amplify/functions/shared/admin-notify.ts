import type { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { LOGIN_DOMAIN } from './cognito';

type DataClient = ReturnType<typeof generateClient<Schema>>;

/** Real contact emails for admin profiles (used for operational notifications). */
export async function listAdminNotificationEmails(
  client: DataClient,
): Promise<string[]> {
  const profiles = await client.models.UserProfile.list({
    filter: { role: { eq: 'admin' } },
    authMode: 'iam',
  });

  const emails = new Set<string>();
  for (const profile of profiles.data) {
    const email = profile.contactEmail?.trim().toLowerCase();
    if (!email || email.endsWith(LOGIN_DOMAIN)) continue;
    emails.add(email);
  }
  return [...emails];
}
