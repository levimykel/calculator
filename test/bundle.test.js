import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shipped } from '../scripts/bundle.mjs';

const root = new URL('../', import.meta.url);
const here = (path) => existsSync(fileURLToPath(new URL(path, root)));

test('the ship list comes out of sw.js', () => {
  const paths = shipped();
  assert.ok(paths.length > 5, 'suspiciously short — did the ASSETS format change?');
  assert.ok(paths.includes('index.html'));
  assert.ok(paths.includes('js/app.js'));
});

test("'./' is not treated as a file to copy", () => {
  // It is in the precache list so a navigation hits the cache, but copying it
  // would mean copying the whole repo.
  assert.ok(!shipped().includes('./'));
});

test('every file sw.js precaches actually exists', () => {
  // version.test.js checks the other direction — that nothing the page loads
  // is missing from the list. This catches a path in the list that is a typo,
  // or a file deleted without the list being told.
  for (const path of shipped()) {
    assert.ok(here(path), `sw.js precaches ${path}, which is not in the repo`);
  }
});

test('nothing is listed twice', () => {
  const paths = shipped();
  assert.equal(new Set(paths).size, paths.length);
});
