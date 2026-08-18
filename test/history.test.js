import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../js/history.js';
import { Calculator } from '../js/calculator.js';

/** A stand-in for localStorage that the tests can inspect. */
function fakeStorage(initial) {
  const data = new Map(initial ? [['calcutron.history', initial]] : []);
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    raw: () => data.get('calcutron.history'),
  };
}

function entryFor(script) {
  const calc = new Calculator();
  for (const ch of script) {
    if (ch >= '0' && ch <= '9') calc.digit(ch);
    else if (ch === '+') calc.operator('add');
    else if (ch === '*') calc.operator('multiply');
  }
  const state = calc.state();
  const expression = state.expression;
  calc.equals();
  return { tokens: calc.tokens, expression, result: Number(calc.tokens[0].text) };
}

test('entries are stored newest first', () => {
  const history = new History({ storage: fakeStorage() });
  history.add(entryFor('1+1'));
  history.add(entryFor('2+2'));
  assert.equal(history.list()[0].expression, '2 + 2');
  assert.equal(history.list()[1].expression, '1 + 1');
  assert.equal(history.length, 2);
});

test('entries survive a reload', () => {
  const storage = fakeStorage();
  const first = new History({ storage });
  first.add(entryFor('6*7'));

  const second = new History({ storage });
  assert.equal(second.length, 1);
  assert.equal(second.list()[0].expression, '6 × 7');
  assert.equal(second.list()[0].result, 42);
});

test('tokens are copied, not shared with the live calculator', () => {
  const history = new History({ storage: fakeStorage() });
  const source = entryFor('1+1');
  history.add(source);
  source.tokens[0].text = '999';
  assert.equal(history.list()[0].tokens[0].text, '2', 'the stored entry is unaffected');
});

test('ids are unique', () => {
  const history = new History({ storage: fakeStorage() });
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) ids.add(history.add(entryFor('1+1')).id);
  assert.equal(ids.size, 50);
});

test('favourites toggle and persist', () => {
  const storage = fakeStorage();
  const history = new History({ storage });
  const entry = history.add(entryFor('1+1'));
  assert.equal(entry.favourite, false);

  history.toggleFavourite(entry.id);
  assert.equal(history.find(entry.id).favourite, true);
  assert.equal(new History({ storage }).list()[0].favourite, true, 'and survive a reload');

  history.toggleFavourite(entry.id);
  assert.equal(history.find(entry.id).favourite, false);
});

test('toggling an unknown id is harmless', () => {
  const history = new History({ storage: fakeStorage() });
  assert.equal(history.toggleFavourite('nope'), null);
});

test('clearing keeps starred entries', () => {
  const history = new History({ storage: fakeStorage() });
  const keep = history.add(entryFor('1+1'));
  history.add(entryFor('2+2'));
  history.toggleFavourite(keep.id);

  history.clear();
  assert.equal(history.length, 1);
  assert.equal(history.list()[0].id, keep.id);
});

test('the oldest unstarred entries fall off at the limit', () => {
  const history = new History({ storage: fakeStorage(), limit: 3 });
  const a = history.add(entryFor('1+1'));
  history.toggleFavourite(a.id);
  history.add(entryFor('2+2'));
  history.add(entryFor('3+3'));
  history.add(entryFor('4+4'));

  assert.equal(history.length, 3);
  assert.ok(history.find(a.id), 'the starred entry is protected');
  assert.equal(history.list().map((e) => e.expression).join(' | '), '4 + 4 | 3 + 3 | 1 + 1');
});

test('a favourite is never evicted, even past the limit', () => {
  const history = new History({ storage: fakeStorage(), limit: 2 });
  for (let i = 0; i < 5; i += 1) history.toggleFavourite(history.add(entryFor('1+1')).id);
  assert.equal(history.length, 5, 'nothing unstarred is left to drop');
});

test('the entry just added is never the one evicted', () => {
  // With every older entry starred, the newcomer is the only eviction
  // candidate — and dropping it would make the calculation disappear.
  const history = new History({ storage: fakeStorage(), limit: 2 });
  history.toggleFavourite(history.add(entryFor('1+1')).id);
  history.toggleFavourite(history.add(entryFor('2+2')).id);
  const fresh = history.add(entryFor('3+3'));
  assert.ok(history.find(fresh.id), 'the new entry survived');
  assert.equal(history.list()[0].expression, '3 + 3');
});

test('unreadable storage starts from empty rather than throwing', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const history = new History({ storage: broken });
  assert.equal(history.length, 0);
  history.add(entryFor('1+1')); // must not throw
  assert.equal(history.length, 1);
});

test('corrupt or malformed stored entries are discarded', () => {
  assert.equal(new History({ storage: fakeStorage('not json') }).length, 0);
  assert.equal(new History({ storage: fakeStorage('{"not":"an array"}') }).length, 0);
  const mixed = JSON.stringify([
    { id: 'a', expression: '1 + 1', tokens: [], result: 2 },
    { id: 'b' },
    null,
  ]);
  assert.equal(new History({ storage: fakeStorage(mixed) }).length, 1);
});
