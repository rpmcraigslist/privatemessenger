import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import bundledOutputs from '../../amplify_outputs.json';

type DataOutputs = {
  api_key?: string;
  model_introspection?: { queries?: Record<string, unknown> };
};

type OutputsRecord = Record<string, unknown>;

function readBackendFlags(config: OutputsRecord): {
  configured: boolean;
  adminReady: boolean;
} {
  const configured = Boolean(
    (config as { auth?: { user_pool_id?: string } }).auth?.user_pool_id,
  );
  const data = (config as { data?: DataOutputs }).data;
  const adminReady = Boolean(
    data?.api_key && data?.model_introspection?.queries?.bootstrapRequired,
  );
  return { configured, adminReady };
}

export let isBackendConfigured = false;
export let isAdminBackendDeployed = false;

/** Strongly-typed AppSync GraphQL client (queries, mutations, subscriptions). */
export let client!: ReturnType<typeof generateClient<Schema>>;

/**
 * Prefer live `/amplify_outputs.json` (written by Amplify Hosting after backend
 * deploy). Fall back to the bundled copy for local dev / first paint.
 */
export async function initAmplify(): Promise<void> {
  let config: OutputsRecord = bundledOutputs as OutputsRecord;

  try {
    const response = await fetch(`/amplify_outputs.json?ts=${Date.now()}`, {
      cache: 'no-store',
    });
    if (response.ok) {
      const live = (await response.json()) as OutputsRecord;
      if ((live as { auth?: { user_pool_id?: string } }).auth?.user_pool_id) {
        config = live;
      }
    }
  } catch {
    // Bundled outputs are enough for local dev when fetch is unavailable.
  }

  const flags = readBackendFlags(config);
  isBackendConfigured = flags.configured;
  isAdminBackendDeployed = flags.adminReady;

  if (isBackendConfigured) {
    Amplify.configure(config as Parameters<typeof Amplify.configure>[0]);
    client = generateClient<Schema>({ authMode: 'userPool' });
  }
}

export type ConversationModel = Schema['Conversation']['type'];
export type MessageModel = Schema['Message']['type'];
export type UserProfileModel = Schema['UserProfile']['type'];
export type ConversationReadStateModel =
  Schema['ConversationReadState']['type'];
