/**
 * Assemble `www/` — just the files the app ships — for the native shell.
 *
 * Capacitor copies a web directory into the app bundle. This repo's web root
 * is the repo root, which also holds .git, node_modules, test/ and scripts/,
 * so pointing `webDir` at "." would put all of that inside the app. Hence a
 * directory with only the real thing in it.
 *
 * The list is not maintained here. `sw.js` already names every file the app
 * ships, because the service worker has to precache exactly that set, and
 * `test/version.test.js` fails if anything the page loads is missing from it.
 * Reading it back means the two can never disagree.
 *
 *   npm run bundle
 */
import { readFileSync, cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

/**
 * Every path the app ships, read out of the service worker's precache list.
 *
 * `'./'` is in that list because a navigation to the directory has to hit the
 * cache; it is not a file, so it is not something to copy.
 */
export function shipped() {
  const sw = readFileSync(fileURLToPath(new URL('sw.js', root)), 'utf8');
  const block = sw.match(/const ASSETS = \[([\s\S]*?)\]/);
  if (!block) throw new Error('could not find the ASSETS list in sw.js');

  return [...block[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((path) => path !== './');
}

export function bundle(into = 'www') {
  const paths = shipped();

  const missing = paths.filter((path) => !existsSync(join(rootPath, path)));
  if (missing.length) {
    throw new Error(`sw.js precaches files that are not here: ${missing.join(', ')}`);
  }

  const target = join(rootPath, into);
  rmSync(target, { recursive: true, force: true });

  // The worker itself is not in its own precache list, and the shell still
  // wants it: retiring it in native builds is a separate decision with its own
  // card, and until that is made `www/` should be a faithful copy of the site.
  for (const path of [...paths, 'sw.js']) {
    const to = join(target, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(rootPath, path), to);
  }

  return { into: target, count: paths.length + 1 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { into, count } = bundle();
  console.log(`${count} files -> ${into}`);
}
