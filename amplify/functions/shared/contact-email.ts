import { LOGIN_DOMAIN } from './cognito';

/** Normalize optional real-world contact email (not messenger login ids). */
export function normalizeContactEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.endsWith(LOGIN_DOMAIN)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}
