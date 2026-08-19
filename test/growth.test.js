import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, DEFAULTS, project, formatMoney, formatField, valueOfField, accepts,
} from '../js/growth.js';

/** Rounded to the penny, which is as exact as money gets. */
const pennies = (n) => Math.round(n * 100) / 100;

test('money left alone grows by the rate, compounded monthly', () => {
  const { balance } = project({ principal: 1000, monthly: 0, rate: 12, years: 1 });
  // 1000 × 1.01¹² — twelve monthly periods of one percent.
  assert.equal(pennies(balance), pennies(1000 * 1.01 ** 12));
  assert.equal(pennies(balance), 1126.83);
});

test('contributions land at the end of each month', () => {
  const { balance } = project({ principal: 0, monthly: 100, rate: 12, years: 1 });
  // An ordinary annuity: 100 × ((1.01¹² − 1) / 0.01). The first payment earns
  // eleven months of interest, the last one none.
  assert.equal(pennies(balance), pennies(100 * ((1.01 ** 12 - 1) / 0.01)));
  assert.equal(pennies(balance), 1268.25);
});

test('the two add up', () => {
  const both = project({ principal: 1000, monthly: 100, rate: 12, years: 1 });
  const lump = project({ principal: 1000, monthly: 0, rate: 12, years: 1 });
  const drip = project({ principal: 0, monthly: 100, rate: 12, years: 1 });
  assert.equal(pennies(both.balance), pennies(lump.balance + drip.balance));
});

test('no return means you get out what you put in', () => {
  const { balance, contributed, growth } = project({
    principal: 500, monthly: 100, rate: 0, years: 2,
  });
  assert.equal(balance, 2900, '500 + 24 × 100');
  assert.equal(contributed, 2900);
  assert.equal(growth, 0);
});

test('no time means nothing has happened yet', () => {
  const { balance, contributed, growth } = project({
    principal: 5000, monthly: 500, rate: 7, years: 0,
  });
  assert.equal(balance, 5000);
  assert.equal(contributed, 5000);
  assert.equal(growth, 0);
});

test('growth is the part you did not pay in', () => {
  const { balance, contributed, growth } = project(DEFAULTS);
  assert.equal(contributed, 10000 + 500 * 360, 'the starting pot plus every payment');
  assert.equal(pennies(growth), pennies(balance - contributed));
  assert.equal(Math.round(balance), 691150, 'the default projection');
});

test('the series is the balance at the end of each year', () => {
  const { series } = project({ principal: 100, monthly: 0, rate: 0, years: 3 });
  assert.deepEqual(series, [100, 100, 100, 100], 'year zero is the money you began with');
  assert.equal(project({ ...DEFAULTS, years: 30 }).series.length, 31);
});

test('a part-year term still ends where it ends', () => {
  const { series } = project({ principal: 0, monthly: 100, rate: 0, years: 1.5 });
  assert.equal(series.length, 3, 'year zero, year one, and the stub');
  assert.equal(series.at(-1), 1800, 'eighteen months of payments');
});

test('a year inside the series reads the same as running the shorter projection', () => {
  // Which is what lets the chart be scrubbed without recomputing anything.
  const full = project({ ...DEFAULTS, years: 30 });
  const short = project({ ...DEFAULTS, years: 20 });
  assert.equal(pennies(full.series[20]), pennies(short.balance));
  assert.equal(pennies(full.paid[20]), pennies(short.contributed));
});

test('paid tracks the series year for year', () => {
  const { series, paid } = project({ principal: 1000, monthly: 100, rate: 5, years: 4 });
  assert.equal(series.length, paid.length);
  assert.deepEqual(paid, [1000, 2200, 3400, 4600, 5800], 'the pot plus twelve payments a year');
  assert.ok(series.every((balance, year) => balance >= paid[year]), 'growth is never negative');
});

test('the inputs are clamped rather than trusted', () => {
  const silly = project({ principal: 1e30, monthly: 1e30, rate: 900, years: 5000 });
  assert.ok(Number.isFinite(silly.balance), 'no infinity reaches the display');

  const negative = project({ principal: -100, monthly: -50, rate: -5, years: -3 });
  assert.equal(negative.balance, 0, 'and nothing counts backwards');
});

test('rubbish in gives zero rather than NaN', () => {
  const { balance } = project({ principal: NaN, monthly: undefined, rate: 7, years: 10 });
  assert.equal(balance, 0);
});

test('money is shown to the nearest whole unit', () => {
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(1234.56), '$1,235');
  assert.equal(formatMoney(691149.7), '$691,150');
  assert.equal(formatMoney(-40), '-$40', 'the sign goes outside the symbol');
  assert.equal(formatMoney(Infinity), '—');
});

test('a field shows what was typed, dressed as what it means', () => {
  assert.equal(formatField('money', '10000'), '$10,000');
  assert.equal(formatField('money', ''), '$0', 'an emptied field is worth nothing');
  assert.equal(formatField('money', '1500.5'), '$1,500.5', 'mid-typing shapes are kept');
  assert.equal(formatField('percent', '7'), '7%');
  assert.equal(formatField('years', '1'), '1 year');
  assert.equal(formatField('years', '30'), '30 years');
});

test('an empty field reads as zero', () => {
  assert.equal(valueOfField(''), 0);
  assert.equal(valueOfField('7.5'), 7.5);
  assert.equal(valueOfField('nonsense'), 0);
});

test('a field refuses what it cannot hold', () => {
  assert.ok(accepts('rate', '7.5'));
  assert.ok(!accepts('rate', '31'), 'above the cap');
  assert.ok(!accepts('rate', '7.555'), 'more decimals than it keeps');
  assert.ok(accepts('years', '75'));
  assert.ok(!accepts('years', '76'));
  assert.ok(!accepts('years', '30.5'), 'years are whole');
  assert.ok(accepts('principal', '100000000'));
  assert.ok(!accepts('principal', '100000001'));
  assert.ok(accepts('monthly', ''), 'emptying is always allowed');
  assert.ok(!accepts('monthly', '5e3'), 'digits and one point, nothing else');
  assert.ok(!accepts('nonesuch', '1'));
});

test('every field has a default, and every default is one it accepts', () => {
  for (const { key, kind } of FIELDS) {
    assert.equal(typeof DEFAULTS[key], 'number', `${key} has a default`);
    assert.ok(accepts(key, String(DEFAULTS[key])), `${key}'s default fits its own rules`);
    assert.ok(formatField(kind, String(DEFAULTS[key])).length > 0);
  }
});
