import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

const version = read('version.js').match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];

test('version.js declares a semver version', () => {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/);
});

test('package.json matches version.js', () => {
  assert.equal(JSON.parse(read('package.json')).version, version);
});

test('the visible version chip matches version.js', () => {
  const chip = read('index.html').match(/id="versionChip"[^>]*>v([\d.]+)</)?.[1];
  assert.equal(chip, version, 'the fallback text in index.html has drifted');
});

test('the service worker version matches version.js', () => {
  // The worker carries its own copy so its bytes change every release, which
  // is what triggers update detection. Drift here means no update is offered.
  const sw = read('sw.js');
  assert.equal(sw.match(/const VERSION = '([^']+)'/)?.[1], version);
  assert.match(sw, /const CACHE = `calcutron-\$\{VERSION\}`/);
});

test('every script and style the page loads is precached', () => {
  const html = read('index.html');
  const assets = read('sw.js');
  const referenced = [
    ...html.matchAll(/(?:src|href)="((?!https?:|#)[^"]+)"/g),
  ].map((m) => m[1]).filter((p) => !p.startsWith('data:'));

  // js/app.js pulls the rest of the modules in, so check those too.
  const modules = [...read('js/app.js').matchAll(/from '\.\/([^']+)'/g)].map((m) => `js/${m[1]}`);

  for (const path of new Set([...referenced, ...modules])) {
    assert.ok(
      assets.includes(`'${path}'`),
      `${path} is loaded by the app but missing from the service worker ASSETS list`
    );
  }
});
