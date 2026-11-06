/**
 * Unit conversions: temperature, length, mass and shoe size.
 *
 * Pure: no DOM, no network, no state. `js/app.js` feeds it a number and a
 * unit and renders what comes back.
 *
 * Unlike the currency rates next door, none of this ever goes stale. There is
 * nothing to fetch, nothing to cache, no date to print and nothing that stops
 * working offline.
 *
 * **Every unit carries a `to`/`from` pair rather than a multiplier.** That is
 * the whole design, and it exists because of Fahrenheit: °C = (°F − 32) × 5/9
 * is affine, not a ratio, so a single factor cannot express it. Giving every
 * unit the pair makes temperature ordinary instead of a special case, and
 * `ratio()` keeps the boring units short.
 */

/** A unit that is just a multiple of the base — which is most of them. */
function ratio(factor) {
  return { to: (v) => v * factor, from: (v) => v / factor };
}

/* ------------------------------------------------------------- shoe sizes */

/**
 * Shoe sizes are a convention, not a measurement, so these are honest
 * approximations rather than conversions.
 *
 * The spine is foot length in centimetres, because that is the only figure
 * underneath that means anything. The rest are encodings of it:
 *
 *   - UK sizes step by one barleycorn, a third of an inch — 0.8467 cm. That
 *     part is exact; the offset is fitted so a UK 9 lands on 27.0 cm, which
 *     is where the common tables put it.
 *   - EU sizes step by a Paris point, two thirds of a centimetre, measured on
 *     the last rather than the foot — hence the constant, which is the lasting
 *     allowance.
 *   - US sizes are UK sizes shifted, and the shift is the one thing that
 *     differs between men's and women's. UK and EU do not change, which is why
 *     the toggle only has to move one row.
 */
const BARLEYCORN = 2.54 / 3;
const UK_ZERO = 19.38;
/** Men's US runs one size above UK, women's two. */
const US_OFFSET = { men: 1, women: 2 };

const ukToFoot = (uk) => UK_ZERO + uk * BARLEYCORN;
const footToUk = (cm) => (cm - UK_ZERO) / BARLEYCORN;

function shoeUnits(variant) {
  const shift = US_OFFSET[variant] ?? US_OFFSET.men;
  return [
    { code: 'UK', name: 'United Kingdom', step: 0.5, decimals: 1,
      to: ukToFoot, from: footToUk },
    { code: 'US', name: 'United States', step: 0.5, decimals: 1,
      to: (us) => ukToFoot(us - shift), from: (cm) => footToUk(cm) + shift },
    { code: 'EU', name: 'Europe', step: 1, decimals: 0,
      to: (eu) => (eu - 2.5) / 1.5, from: (cm) => cm * 1.5 + 2.5 },
    { code: 'cm', name: 'Foot length', decimals: 1,
      to: (v) => v, from: (v) => v },
  ];
}

/* ------------------------------------------------------------ the tables */

export const CATEGORIES = [
  {
    key: 'temperature',
    label: 'Temp',
    name: 'Temperature',
    start: '°C',
    units: [
      { code: '°C', name: 'Celsius', decimals: 1, to: (v) => v, from: (v) => v },
      { code: '°F', name: 'Fahrenheit', decimals: 1,
        to: (v) => (v - 32) * 5 / 9, from: (v) => v * 9 / 5 + 32 },
      { code: 'K', name: 'Kelvin', decimals: 2,
        to: (v) => v - 273.15, from: (v) => v + 273.15 },
    ],
  },
  {
    key: 'length',
    label: 'Length',
    name: 'Length',
    start: 'cm',
    units: [
      { code: 'mm', name: 'Millimetre', decimals: 0, ...ratio(0.001) },
      { code: 'cm', name: 'Centimetre', decimals: 1, ...ratio(0.01) },
      { code: 'm', name: 'Metre', decimals: 2, ...ratio(1) },
      { code: 'km', name: 'Kilometre', decimals: 3, ...ratio(1000) },
      { code: 'in', name: 'Inch', decimals: 1, ...ratio(0.0254) },
      { code: 'ft', name: 'Foot', decimals: 2, ...ratio(0.3048) },
      { code: 'yd', name: 'Yard', decimals: 2, ...ratio(0.9144) },
      { code: 'mi', name: 'Mile', decimals: 3, ...ratio(1609.344) },
    ],
  },
  {
    key: 'mass',
    label: 'Mass',
    name: 'Mass',
    start: 'kg',
    units: [
      { code: 'g', name: 'Gram', decimals: 0, ...ratio(0.001) },
      { code: 'kg', name: 'Kilogram', decimals: 2, ...ratio(1) },
      { code: 'oz', name: 'Ounce', decimals: 1, ...ratio(0.028349523125) },
      { code: 'lb', name: 'Pound', decimals: 2, ...ratio(0.45359237) },
      { code: 'st', name: 'Stone', decimals: 2, ...ratio(6.35029318) },
    ],
  },
  {
    key: 'shoe',
    label: 'Shoes',
    name: 'Shoe size',
    start: 'UK',
    /** Shown under the rows: these numbers are a guide, and should say so. */
    caveat: 'Approximate — brands vary by half a size',
    variants: [
      { key: 'men', label: "Men's" },
      { key: 'women', label: "Women's" },
    ],
    units: shoeUnits,
  },
];

export function categoryOf(key) {
  return CATEGORIES.find((category) => category.key === key) ?? CATEGORIES[0];
}

/** A category's units, built for `variant` where the category has them. */
export function unitsOf(category, variant) {
  return typeof category.units === 'function' ? category.units(variant) : category.units;
}

export function unitOf(category, variant, code) {
  return unitsOf(category, variant).find((unit) => unit.code === code) ?? null;
}

/** The variant to start on, for a category that has them. */
export function defaultVariant(category) {
  return category.variants?.[0]?.key ?? null;
}

/* ----------------------------------------------------------- conversion */

/**
 * `value`, expressed in `from`, read as `to`. Goes through the category's
 * base the same way currency goes through its base currency.
 *
 * @returns {number|null} null when the figure is not something to show
 */
export function convert(value, from, to) {
  if (!Number.isFinite(value) || !from || !to) return null;
  const converted = to.from(from.to(value));
  return Number.isFinite(converted) ? converted : null;
}

/**
 * Rounded the way the unit is actually quoted — shoe sizes to the half, EU
 * sizes to the whole — then fixed to its decimals.
 */
export function formatValue(value, unit) {
  if (value === null || !Number.isFinite(value)) return '—';
  const stepped = unit.step ? Math.round(value / unit.step) * unit.step : value;
  const places = unit.decimals ?? 2;
  // Past this a float is not carrying the decimals it appears to.
  const fixed = Math.abs(stepped) >= 1e15 ? String(stepped) : stepped.toFixed(places);
  return trimZeros(fixed);
}

/** Trailing zeros past the point read as precision the figure does not have. */
function trimZeros(text) {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * What the row being typed into shows.
 *
 * Just the figure: the unit is already in the row's own first column, and
 * repeating it reads badly where the code is a place rather than a unit —
 * "9 UK" for a shoe size, when the row already says UK. The entry is told
 * apart by its colour and its marker, the same way the currency list does it.
 */
export function formatEntry(raw) {
  return raw === '' ? '0' : raw;
}

/** True while `raw` is something a unit field is allowed to hold. */
export function accepts(raw) {
  if (raw === '') return true;
  if (!/^-?\d*\.?\d*$/.test(raw)) return false;
  const [, decimals = ''] = raw.split('.');
  return decimals.length <= 4;
}
