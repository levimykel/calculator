/**
 * Bump the app version everywhere it is written down.
 *
 *   npm run set-version 1.2.0
 *
 * The version appears in four places by necessity — the service worker needs
 * its own copy so its bytes change on release, and index.html carries a
 * fallback for the moment before scripts run — so this keeps them in step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('Usage: npm run set-version <major.minor.patch>');
  process.exit(1);
}

const root = new URL('../', import.meta.url);
const edits = [
  ['version.js', /(APP_VERSION\s*=\s*')[^']+(')/, `$1${next}$2`],
  ['sw.js', /(const VERSION = ')[^']+(')/, `$1${next}$2`],
  ['package.json', /("version":\s*")[^"]+(")/, `$1${next}$2`],
  ['index.html', /(id="versionChip"[^>]*>v)[\d.]+(<)/, `$1${next}$2`],
];

for (const [name, pattern, replacement] of edits) {
  const path = fileURLToPath(new URL(name, root));
  const before = readFileSync(path, 'utf8');
  const after = before.replace(pattern, replacement);
  if (before === after) {
    console.error(`Could not find the version in ${name} — update it by hand.`);
    process.exit(1);
  }
  writeFileSync(path, after);
  console.log(`${name} -> ${next}`);
}
