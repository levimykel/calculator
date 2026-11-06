import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, categoryOf, unitsOf, unitOf, defaultVariant,
  convert, formatValue, formatEntry, accepts, valueOf, display, rawOf,
} from '../js/units.js';

const pick = (categoryKey, code, variant = null) =>
  unitOf(categoryOf(categoryKey), variant, code);

const between = (categoryKey, from, to, value, variant = null) =>
  convert(value, pick(categoryKey, from, variant), pick(categoryKey, to, variant));

const close = (actual, expected, within, what) =>
  assert.ok(Math.abs(actual - expected) <= within,
    `${what}: expected about ${expected}, got ${actual}`);

/* ------------------------------------------------------------ temperature */

test('the temperatures everyone knows', () => {
  close(between('temperature', '°C', '°F', 0), 32, 1e-9, 'freezing');
  close(between('temperature', '°C', '°F', 100), 212, 1e-9, 'boiling');
  close(between('temperature', '°F', '°C', 98.6), 37, 1e-9, 'body heat');
  close(between('temperature', '°C', 'K', 0), 273.15, 1e-9, 'absolute');
});

test('minus forty is the same in both', () => {
  // The one place the two scales cross, and a good check that the offset is
  // applied on the right side of the multiply.
  close(between('temperature', '°C', '°F', -40), -40, 1e-9, 'the crossing');
});

test('temperature is affine, so doubling the input does not double the output', () => {
  // This is the property a plain multiplier would get wrong.
  const ten = between('temperature', '°C', '°F', 10);
  const twenty = between('temperature', '°C', '°F', 20);
  assert.notEqual(twenty, ten * 2);
  close(ten, 50, 1e-9, '10C');
  close(twenty, 68, 1e-9, '20C');
});

/* ----------------------------------------------------------- length, mass */

test('the definitions length is built on', () => {
  close(between('length', 'in', 'cm', 1), 2.54, 1e-9, 'an inch');
  close(between('length', 'ft', 'in', 1), 12, 1e-9, 'a foot');
  close(between('length', 'mi', 'm', 1), 1609.344, 1e-9, 'a mile');
  close(between('length', 'yd', 'ft', 1), 3, 1e-9, 'a yard');
});

test('the definitions mass is built on', () => {
  close(between('mass', 'lb', 'g', 1), 453.59237, 1e-9, 'a pound');
  close(between('mass', 'lb', 'oz', 1), 16, 1e-9, 'a pound in ounces');
  close(between('mass', 'st', 'lb', 1), 14, 1e-9, 'a stone');
});

test('a person-sized sanity check', () => {
  close(between('length', 'cm', 'ft', 180), 5.905, 0.001, '180cm in feet');
  close(between('mass', 'kg', 'lb', 75), 165.347, 0.001, '75kg in pounds');
});

/* ------------------------------------------------------------ shoe sizes */

test("men's and women's differ only in the US column", () => {
  const foot = (variant) => between('shoe', 'UK', 'cm', 9, variant);
  close(foot('men'), foot('women'), 1e-9, 'UK 9 is one foot either way');
  close(between('shoe', 'UK', 'EU', 9, 'men'),
        between('shoe', 'UK', 'EU', 9, 'women'), 1e-9, 'EU does not move');

  close(between('shoe', 'UK', 'US', 9, 'men'), 10, 1e-9, "men's US");
  close(between('shoe', 'UK', 'US', 9, 'women'), 11, 1e-9, "women's US");
});

test('a UK 9 lands where the tables put it', () => {
  close(between('shoe', 'UK', 'cm', 9), 27.0, 0.05, 'foot length');
  close(between('shoe', 'UK', 'EU', 9), 43, 0.5, 'EU size');
});

test('one UK size is one barleycorn', () => {
  const nine = between('shoe', 'UK', 'cm', 9);
  const ten = between('shoe', 'UK', 'cm', 10);
  close(ten - nine, 2.54 / 3, 1e-9, 'a third of an inch');
});

test('shoe sizes are shown to the half, not to three decimals', () => {
  const us = pick('shoe', 'US', 'men');
  assert.equal(formatValue(10.3, us), '10.5');
  assert.equal(formatValue(10.1, us), '10');
  assert.equal(formatValue(42.4, pick('shoe', 'EU')), '42');
});

test('the shoe category says it is approximate', () => {
  assert.match(categoryOf('shoe').caveat, /approximate/i);
});

test("men's is where the shoe screen starts", () => {
  assert.equal(defaultVariant(categoryOf('shoe')), 'men');
});

/* ------------------------------------------------------- every category */

test('every unit survives a round trip through its base', () => {
  for (const category of CATEGORIES) {
    const variant = defaultVariant(category);
    for (const unit of unitsOf(category, variant)) {
      for (const value of [1, 7.5, 100, 0]) {
        const back = convert(convert(value, unit, unit), unit, unit);
        close(back, value, 1e-9, `${category.key} ${unit.code} round trip`);
      }
    }
  }
});

test('converting to and from any pair returns the original', () => {
  for (const category of CATEGORIES) {
    const variant = defaultVariant(category);
    const units = unitsOf(category, variant);
    for (const from of units) {
      for (const to of units) {
        const there = convert(10, from, to);
        const back = convert(there, to, from);
        close(back, 10, 1e-6, `${category.key}: ${from.code} -> ${to.code} -> back`);
      }
    }
  }
});

test('every category can name a unit it starts on', () => {
  for (const category of CATEGORIES) {
    const units = unitsOf(category, defaultVariant(category));
    assert.ok(units.some((unit) => unit.code === category.start),
      `${category.key} starts on ${category.start}, which is not one of its units`);
  }
});

/* -------------------------------------------------------------- the edges */

test('nonsense in gives nothing out rather than NaN on screen', () => {
  const c = pick('temperature', '°C');
  const f = pick('temperature', '°F');
  assert.equal(convert(NaN, c, f), null);
  assert.equal(convert(Infinity, c, f), null);
  assert.equal(convert(1, null, f), null);
  assert.equal(formatValue(null, f), '—');
  assert.equal(formatValue(NaN, f), '—');
});

test('a figure is not dressed up with decimals it does not have', () => {
  assert.equal(formatValue(68, pick('temperature', '°F')), '68');
  assert.equal(formatValue(20.5, pick('temperature', '°C')), '20.5');
});

test('what a unit field will hold', () => {
  assert.ok(accepts(''));
  assert.ok(accepts('20'));
  assert.ok(accepts('20.'));
  assert.ok(accepts('-40'));
  assert.ok(!accepts('20.000005'), 'four decimals is the limit');
  assert.ok(!accepts('abc'));
  assert.ok(!accepts('1e5'));
});

test('the row being typed into shows exactly what was typed', () => {
  // A trailing point has to survive, or the key that put it there looks broken.
  assert.equal(formatEntry('20'), '20');
  assert.equal(formatEntry(''), '0');
  assert.equal(formatEntry('20.'), '20.');
  assert.equal(formatEntry('-'), '-');
});

/* ---------------------------------------------------- feet and inches */

const feet = () => pick('length', 'ft in');
const cm = () => pick('length', 'cm');

test('a height in centimetres reads as feet and inches', () => {
  assert.equal(display(convert(178, cm(), feet()), feet()), '5′ 10″');
  assert.equal(display(convert(152.4, cm(), feet()), feet()), '5′ 0″');
});

test('the decimal key separates the feet from the inches', () => {
  // 5 . 1 0 is five foot ten, not five point one feet.
  close(valueOf('5.10', feet()), 5 + 10 / 12, 1e-9, "5'10 in feet");
  close(convert(valueOf('5.10', feet()), feet(), cm()), 177.8, 0.05, "5'10 in cm");
  close(valueOf('6', feet()), 6, 1e-9, 'a round six foot');
});

test('the inch mark appears as soon as the decimal key is pressed', () => {
  // Otherwise that key looks broken: nothing visible would change.
  assert.equal(formatEntry('5', feet()), '5′');
  assert.equal(formatEntry('5.', feet()), '5′ 0″');
  assert.equal(formatEntry('5.1', feet()), '5′ 1″');
  assert.equal(formatEntry('5.10', feet()), '5′ 10″');
});

test('twelve inches is never how you write a foot', () => {
  assert.ok(accepts('5.11', feet()));
  assert.ok(!accepts('5.12', feet()), 'that is six foot');
  assert.ok(!accepts('5.123', feet()));
  assert.ok(accepts('5.', feet()), 'mid-typing');
});

test('tapping into feet and inches leaves something typeable behind', () => {
  // The row becomes the one being typed into, so what it holds has to be
  // text the keypad could have produced.
  assert.equal(rawOf(convert(178, cm(), feet()), feet()), '5.10');
  assert.equal(rawOf(convert(152.4, cm(), feet()), feet()), '5');
});

test('a rounded-up inch carries into the next foot', () => {
  // 11.6 inches must not print as 5' 12".
  const almost = convert(182.8, cm(), feet());
  assert.equal(display(almost, feet()), '6′ 0″');
});

/* ------------------------------------------------- what each one opens on */

test('every category opens on a figure, in a unit it has', () => {
  const expected = {
    temperature: ['°C', '25'],
    length: ['cm', '178'],
    mass: ['lb', '160'],
    shoe: ['US', '8.5'],
  };
  for (const category of CATEGORIES) {
    const [unit, value] = expected[category.key];
    assert.equal(category.start, unit, `${category.key} starts in the wrong unit`);
    assert.equal(category.startValue, value, `${category.key} starts on the wrong figure`);
    assert.ok(unitsOf(category, defaultVariant(category)).some((u) => u.code === unit));
  }
});

test('the figures each category opens on are sensible ones', () => {
  // A person-shaped default beats zero: the screen shows what it does.
  close(convert(25, pick('temperature', '°C'), pick('temperature', '°F')), 77, 1e-9, '25C');
  assert.equal(display(convert(178, cm(), feet()), feet()), '5′ 10″');
  close(convert(160, pick('mass', 'lb'), pick('mass', 'kg')), 72.57, 0.01, '160lb');
  close(convert(8.5, pick('shoe', 'US', 'men'), pick('shoe', 'UK', 'men')), 7.5, 1e-9, 'US 8.5');
});

test('only shoe sizes have variants to switch between', () => {
  for (const category of CATEGORIES) {
    const has = Boolean(category.variants);
    assert.equal(has, category.key === 'shoe',
      `${category.key} ${has ? 'has' : 'lacks'} variants unexpectedly`);
  }
});
