import { client, type UserProfileModel } from './amplify';
import { dedupeUserProfiles, graphqlErrorMessage } from './util';

/** Load the chat directory via Lambda (works for all signed-in users). */
export async function loadUserDirectory(): Promise<UserProfileModel[]> {
  const { data, errors } = await client.queries.listUserDirectory();
  if (errors?.length || !data) {
    throw new Error(
      graphqlErrorMessage(errors, 'Could not load the user directory.'),
    );
  }
  return dedupeUserProfiles(data as UserProfileModel[]);
}
