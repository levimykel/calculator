import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES, DEFAULT_BASE, readRates, fromFrankfurter, fromOpenExchange,
  convert, order, formatAmount, formatEntry, formatRate, formatDay, currencyName,
} from '../js/rates.js';

const SNAP = { base: 'USD', date: '2026-09-12', rates: { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 147 } };

test('a payload is only believed when every part of it holds up', () => {
  assert.ok(readRates(SNAP));
  assert.equal(readRates({ ...SNAP, base: 'dollars' }), null, 'the base must be a code');
  assert.equal(readRates({ ...SNAP, date: '12/09/2026' }), null, 'the date must be an ISO day');
  assert.equal(readRates({ ...SNAP, date: undefined }), null, 'and must be there at all');
  assert.equal(readRates({ ...SNAP, rates: {} }), null, 'rates with nothing in them are no rates');
  assert.equal(readRates({ ...SNAP, rates: 'nope' }), null);
});

test('rates that could not be true are dropped rather than shown', () => {
  const { rates } = readRates({
    ...SNAP,
    rates: { EUR: 0.92, GBP: 0, JPY: -3, CHF: NaN, AUD: '1.5', euro: 0.9, CAD: 1.35 },
  });
  assert.deepEqual(Object.keys(rates).sort(), ['CAD', 'EUR', 'USD'].sort());
  assert.equal(rates.USD, 1, 'the base is always worth one of itself');
});

test('a payload of nothing but rubbish is refused outright', () => {
  assert.equal(readRates({ ...SNAP, rates: { EUR: 0, GBP: -1 } }), null);
});

test('the ECB shape is read', () => {
  const snapshot = fromFrankfurter({
    amount: 1, base: 'USD', date: '2026-09-12', rates: { EUR: 0.92, GBP: 0.79 },
  });
  assert.equal(snapshot.base, 'USD');
  assert.equal(snapshot.date, '2026-09-12');
  assert.equal(snapshot.rates.EUR, 0.92);
  assert.equal(fromFrankfurter(null), null);
  assert.equal(fromFrankfurter('<html>an error page</html>'), null);
});

test('the open-exchange shape is read, dating it from the timestamp', () => {
  const snapshot = fromOpenExchange({
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: Date.UTC(2026, 8, 12, 0, 2, 31) / 1000,
    rates: { EUR: 0.92, GBP: 0.79 },
  });
  assert.equal(snapshot.date, '2026-09-12', 'the unix seconds, not the prose version');
  assert.equal(snapshot.rates.GBP, 0.79);
});

test('an open-exchange failure is not mistaken for rates', () => {
  assert.equal(fromOpenExchange({ result: 'error', 'error-type': 'unsupported-code' }), null);
  assert.equal(fromOpenExchange({ base_code: 'USD', rates: { EUR: 0.9 } }), null, 'no success, no rates');
  assert.equal(fromOpenExchange({
    result: 'success', base_code: 'USD', rates: { EUR: 0.9 },
  }), null, 'and no timestamp means no date to stand behind');
});

test('converting to and from the base', () => {
  assert.equal(convert(100, 'USD', 'EUR', SNAP), 92);
  assert.equal(Math.round(convert(92, 'EUR', 'USD', SNAP)), 100);
  assert.equal(convert(5, 'USD', 'USD', SNAP), 5, 'a currency is worth itself');
});

test('converting between two currencies that are not the base', () => {
  // 100 EUR is 108.70 USD is 85.87 GBP — via the base, which is what lets the
  // list be re-based without fetching anything.
  const gbp = convert(100, 'EUR', 'GBP', SNAP);
  assert.equal(Math.round(gbp * 100) / 100, 85.87);
  assert.equal(Math.round(convert(gbp, 'GBP', 'EUR', SNAP)), 100, 'and back again');
});

test('a currency that was not quoted converts to nothing, not to zero', () => {
  assert.equal(convert(10, 'USD', 'XYZ', SNAP), null);
  assert.equal(convert(10, 'XYZ', 'USD', SNAP), null);
  assert.equal(convert(NaN, 'USD', 'EUR', SNAP), null);
});

test('the list leads with the base, then the ones people reach for', () => {
  const codes = order('USD', { EUR: 1, ZAR: 1, GBP: 1, AAA: 1, JPY: 1, USD: 1 });
  assert.equal(codes[0], 'USD', 'what you are converting from comes first');
  assert.deepEqual(codes.slice(1, 4), ['EUR', 'GBP', 'JPY']);
  assert.deepEqual(codes.slice(4), ['AAA', 'ZAR'], 'the rest alphabetically');
});

test('re-basing the list moves the base to the top', () => {
  assert.equal(order('JPY', { EUR: 1, GBP: 1, JPY: 1 })[0], 'JPY');
  assert.equal(order('USD', {}).length, 1, 'with no rates there is still a base');
});

test('an amount is shown in its own currency, with its own decimals', () => {
  assert.equal(formatAmount(921.3, 'EUR'), '€921.30');
  assert.equal(formatAmount(86.12, 'CHF'), 'CHF\u202f86.12', 'a symbol of letters gets air');
  assert.equal(formatAmount(1234.5, 'USD'), '$1,234.50');
  assert.equal(formatAmount(147200, 'JPY'), '¥147,200', 'yen have no decimals');
  assert.equal(formatAmount(1000, 'XYZ'), '1,000.00', 'an unknown code shows the number alone');
  assert.equal(formatAmount(-40, 'USD'), '-$40.00', 'the sign goes outside the symbol');
  assert.equal(formatAmount(Infinity, 'USD'), '—');
});

test('the rate line carries figures in proportion to the rate', () => {
  assert.equal(formatRate('USD', 'EUR', SNAP), '1 USD = 0.92 EUR');
  assert.equal(formatRate('USD', 'JPY', SNAP), '1 USD = 147 JPY', 'a big rate needs no decimals');
  assert.equal(formatRate('JPY', 'USD', SNAP), '1 JPY = 0.006803 USD', 'a small one needs several');
  assert.equal(formatRate('USD', 'XYZ', SNAP), '', 'and one that is not quoted says nothing');
});

test('the day is written out, or not written at all', () => {
  assert.equal(formatDay('2026-09-12'), '12 September 2026');
  assert.equal(formatDay('2026-01-01'), '1 January 2026');
  assert.equal(formatDay('not a day'), '');
  assert.equal(formatDay(undefined), '');
});

test('every currency in the table is usable', () => {
  assert.ok(CURRENCIES[DEFAULT_BASE], 'including the one everything is quoted against');
  for (const [code, entry] of Object.entries(CURRENCIES)) {
    assert.match(code, /^[A-Z]{3}$/, `${code} is a currency code`);
    assert.ok(entry.name, `${code} has a name`);
    assert.equal(currencyName(code), entry.name);
    assert.ok(entry.decimals === undefined || entry.decimals === 0, `${code}'s decimals are sane`);
  }
  assert.equal(currencyName('XYZ'), 'XYZ', 'and anything else is its own name');
});

test('the amount being typed is shown as typed', () => {
  // A trailing point has to survive, or the key that put it there looks broken.
  assert.equal(formatEntry('100.', 'USD'), '$100.');
  assert.equal(formatEntry('1234', 'USD'), '$1,234');
  assert.equal(formatEntry('', 'EUR'), '€0', 'an emptied amount is nothing, not blank');
  assert.equal(formatEntry('50', 'CHF'), 'CHF\u202f50');
});
