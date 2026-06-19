import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { client, type UserProfileModel } from './amplify';
import { dedupeUserProfiles, graphqlErrorMessage } from './util';

async function assertSignedIn(): Promise<void> {
  await getCurrentUser();
  const session = await fetchAuthSession();
  if (!session.tokens?.accessToken) {
    throw new Error('Not authenticated');
  }
}

/** Load the chat directory via Lambda (works for all signed-in users). */
export async function loadUserDirectory(): Promise<UserProfileModel[]> {
  await assertSignedIn();

  try {
    const { data, errors } = await client.queries.listUserDirectory({
      authMode: 'userPool',
    });
    if (!errors?.length && data) {
      return dedupeUserProfiles(data as UserProfileModel[]);
    }
  } catch (err) {
    console.warn('listUserDirectory failed, falling back to UserProfile.list', err);
  }

  const res = await client.models.UserProfile.list({ authMode: 'userPool' });
  if (res.errors?.length) {
    throw new Error(graphqlErrorMessage(res.errors, 'Could not load the user directory.'));
  }
  return dedupeUserProfiles(res.data);
}
