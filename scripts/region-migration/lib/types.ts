import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AmplifyOutputsSnapshot = {
  auth: { user_pool_id: string; aws_region: string };
  data: { aws_region: string };
  storage: { bucket_name: string; aws_region: string };
};

export function loadOutputs(path: string): AmplifyOutputsSnapshot {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as AmplifyOutputsSnapshot;
  if (!raw.auth?.user_pool_id || !raw.storage?.bucket_name) {
    throw new Error(`Invalid amplify outputs file: ${path}`);
  }
  return raw;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const migrationRoot = resolve(scriptDir, '..');
export const dataDir = resolve(migrationRoot, 'data');
export const exportDir = resolve(dataDir, 'export');

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const MODEL_TABLE_HINTS = [
  'UserProfile',
  'Conversation',
  'Message',
  'ConversationReadState',
] as const;

export type ModelName = (typeof MODEL_TABLE_HINTS)[number];

export type ExportedTable = {
  model: ModelName;
  tableName: string;
  items: Record<string, unknown>[];
};

export type MigrationManifest = {
  exportedAt: string;
  sourceRegion: string;
  sourceUserPoolId: string;
  sourceBucket: string;
  stackName: string;
  tables: Record<ModelName, string>;
  cognitoUsers: ExportedCognitoUser[];
};

export type ExportedCognitoUser = {
  loginId: string;
  username: string;
  oldSub: string;
  email: string | null;
  contactEmail: string | null;
  isAdmin: boolean;
  enabled: boolean;
};

export type SubRemap = Map<string, string>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function remapSubValue(value: string, subRemap: SubRemap): string {
  return subRemap.get(value) ?? value;
}

export function remapSubList(
  values: unknown,
  subRemap: SubRemap,
): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  return values.map((entry) =>
    typeof entry === 'string' ? remapSubValue(entry, subRemap) : String(entry),
  );
}

export function remapItemForImport(
  model: ModelName,
  item: Record<string, unknown>,
  subRemap: SubRemap,
): Record<string, unknown> {
  const next = { ...item };

  if (model === 'UserProfile' && typeof next.cognitoSub === 'string') {
    next.cognitoSub = remapSubValue(next.cognitoSub, subRemap);
  }

  if (model === 'Conversation') {
    next.participants = remapSubList(next.participants, subRemap);
  }

  if (model === 'Message') {
    next.participantUsernames = remapSubList(next.participantUsernames, subRemap);
  }

  if (model === 'ConversationReadState') {
    if (typeof next.userSub === 'string') {
      next.userSub = remapSubValue(next.userSub, subRemap);
    }
    next.ownerSubs = remapSubList(next.ownerSubs, subRemap);
  }

  return next;
}
