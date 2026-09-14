import test from 'node:test';
import assert from 'node:assert/strict';
import { Exchange, SOURCES } from '../js/exchange.js';

/*
 * Nothing in here may touch the network. A real request would tie the suite to
 * a third-party service being up — and, worse, let a test pass for the wrong
 * reason: `{ fetcher: undefined }` does not override a default parameter, so
 * one of these once reached the live rates service and was marked green for it.
 */
globalThis.fetch = () => { throw new Error('a test reached the network'); };

/** localStorage, as much of it as this needs. */
function fakeStorage(seed = {}) {
  const items = new Map(Object.entries(seed));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    items,
  };
}

const ECB = {
  amount: 1, base: 'USD', date: '2026-09-12', rates: { EUR: 0.92, GBP: 0.79 },
};

/** A fetcher scripted by URL: a response, or an Error to throw. */
function fakeFetch(script) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const answer = typeof script === 'function' ? script(url) : script[url];
    if (answer instanceof Error) throw answer;
    if (!answer) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => answer };
  };
  fetcher.calls = calls;
  return fetcher;
}

const both = (payload) => fakeFetch(() => payload);

test('a fetch that works is returned and remembered', async () => {
  const storage = fakeStorage();
  const exchange = new Exchange({ storage, fetcher: both(ECB), now: () => 1000 });

  const snapshot = await exchange.refresh();
  assert.equal(snapshot.date, '2026-09-12');
  assert.equal(snapshot.source, 'ECB');
  assert.equal(snapshot.fetchedAt, 1000);

  const remembered = exchange.read();
  assert.equal(remembered.date, '2026-09-12');
  assert.equal(remembered.rates.EUR, 0.92);
  assert.equal(remembered.source, 'ECB', 'including where it came from');
});

test('the first source is the only one asked when it answers', async () => {
  const fetcher = both(ECB);
  await new Exchange({ storage: fakeStorage(), fetcher }).refresh();
  assert.equal(fetcher.calls.length, 1);
  assert.equal(fetcher.calls[0], SOURCES[0].url);
});

test('a source that is down falls through to the next', async () => {
  const fetcher = fakeFetch((url) => (url === SOURCES[0].url
    ? new Error('network')
    : {
      result: 'success',
      base_code: 'USD',
      time_last_update_unix: Date.UTC(2026, 8, 11) / 1000,
      rates: { EUR: 0.93 },
    }));

  const snapshot = await new Exchange({ storage: fakeStorage(), fetcher }).refresh();
  assert.equal(fetcher.calls.length, 2, 'both were tried');
  assert.equal(snapshot.source, 'exchangerate-api');
  assert.equal(snapshot.date, '2026-09-11');
});

test('a source answering with nonsense is treated as no answer', async () => {
  // A captive portal serving its login page is the realistic version of this.
  const fetcher = fakeFetch(() => ({ message: 'upgrade to a paid plan' }));
  const exchange = new Exchange({ storage: fakeStorage(), fetcher });

  assert.equal(await exchange.refresh(), null);
  assert.equal(fetcher.calls.length, 2, 'having tried everything');
  assert.equal(exchange.read(), null, 'and nothing was written down');
});

test('being offline leaves what was already stored alone', async () => {
  const storage = fakeStorage();
  const online = new Exchange({ storage, fetcher: both(ECB), now: () => 1000 });
  await online.refresh();

  const offline = new Exchange({
    storage, fetcher: fakeFetch(() => new Error('offline')), now: () => 99_000_000,
  });
  assert.equal(await offline.refresh(), null, 'the fetch fails');
  assert.equal(offline.read().date, '2026-09-12', 'and yesterday\'s rates are still there');
});

test('stored rates are checked on the way out as well as in', async () => {
  const bad = fakeStorage({ 'calcutron.rates': '{"base":"USD","rates":{"EUR":0.9}}' });
  assert.equal(new Exchange({ storage: bad }).read(), null, 'no date, no trust');

  const broken = fakeStorage({ 'calcutron.rates': 'not json at all' });
  assert.equal(new Exchange({ storage: broken }).read(), null);

  const empty = fakeStorage();
  assert.equal(new Exchange({ storage: empty }).read(), null);
});

test('rates fetched a moment ago are not fetched again', async () => {
  const storage = fakeStorage();
  let clock = 1000;
  const fetcher = both(ECB);
  const exchange = new Exchange({ storage, fetcher, now: () => clock });

  await exchange.refresh();
  assert.equal(exchange.isFresh(), true);

  clock += 10 * 60 * 1000;
  assert.equal(exchange.isFresh(), true, 'ten minutes on, still the same rates');

  clock += 60 * 60 * 1000;
  assert.equal(exchange.isFresh(), false, 'an hour later, worth another look');
});

test('two callers at once share the one request', async () => {
  const fetcher = both(ECB);
  const exchange = new Exchange({ storage: fakeStorage(), fetcher });

  const [a, b] = await Promise.all([exchange.refresh(), exchange.refresh()]);
  assert.equal(fetcher.calls.length, 1, 'opening the screen twice is not two fetches');
  assert.equal(a.date, b.date);

  await exchange.refresh();
  assert.equal(fetcher.calls.length, 2, 'and the next one goes out as normal');
});

test('no storage at all still converts, it just forgets', async () => {
  const exchange = new Exchange({ storage: null, fetcher: both(ECB) });
  const snapshot = await exchange.refresh();
  assert.equal(snapshot.rates.EUR, 0.92);
  assert.equal(exchange.read(), null);
});

test('a browser with no fetch at all fails quietly rather than throwing', async () => {
  const exchange = new Exchange({ storage: fakeStorage(), fetcher: null });
  assert.equal(await exchange.refresh(), null);
});

test('a fetch that throws outright is just another source that did not answer', async () => {
  // The global stub above is what would be reached if a fetcher were omitted.
  const exchange = new Exchange({ storage: fakeStorage() });
  assert.equal(await exchange.refresh(), null);
});

test('both sources are public, keyless and https', () => {
  for (const source of SOURCES) {
    assert.match(source.url, /^https:\/\//, `${source.name} is over https`);
    assert.doesNotMatch(source.url, /key|token|secret/i,
      `${source.name} needs no key — this app has no server to hide one in`);
    assert.equal(typeof source.read, 'function');
    assert.ok(source.name);
  }
});
