import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

function readAppVersion(): string {
  const versionPath = path.resolve('src/lib/app-version.ts');
  const source = fs.readFileSync(versionPath, 'utf8');
  const match = source.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match?.[1] ?? '0.0.0';
}

function writeVersionFile(outDir: string, version: string): void {
  const payload = {
    version,
    builtAt: new Date().toISOString(),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'version.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Writes public/version.json + dist/version.json from APP_VERSION on each build
 * so browsers can detect a new deploy without trusting the service worker cache.
 */
export function messengerVersionJsonPlugin(): Plugin {
  return {
    name: 'messenger-version-json',
    buildStart() {
      writeVersionFile(path.resolve('public'), readAppVersion());
    },
    closeBundle() {
      writeVersionFile(path.resolve('dist'), readAppVersion());
    },
  };
}
