/**
 * Compound growth: what a pot of money becomes when it is left to grow and
 * added to every month.
 *
 * Monthly compounding with the contribution landing at the end of each month —
 * an ordinary annuity, which is the convention every retirement calculator
 * uses and the conservative reading of "I put £500 in each month".
 *
 * Pure: no DOM. The UI feeds it four numbers and renders what comes back.
 */

import { formatNumber } from './calculator.js';

/** The app is not localised; this is the one place the symbol is decided. */
export const CURRENCY = '$';

/** What the fields hold, and what they will not hold. */
export const FIELDS = [
  {
    key: 'principal',
    label: 'Starting amount',
    kind: 'money',
    max: 100_000_000,
    decimals: 2,
  },
  {
    key: 'monthly',
    label: 'Monthly contribution',
    kind: 'money',
    max: 1_000_000,
    decimals: 2,
  },
  {
    key: 'rate',
    label: 'Return, a year',
    kind: 'percent',
    // Above this it stops being a projection and starts being a fantasy, and
    // the numbers grow past anything the display can say usefully.
    max: 30,
    decimals: 2,
  },
  {
    key: 'years',
    label: 'For',
    kind: 'years',
    max: 75,
    decimals: 0,
  },
];

/** A first run that shows the thing working, rather than four zeroes. */
export const DEFAULTS = {
  principal: 10000,
  monthly: 500,
  rate: 7,
  years: 30,
};

const MONTHS = 12;

/**
 * @returns {{balance: number, contributed: number, growth: number,
 *            series: number[]}} `series` is the balance at the end of each
 *            year, starting with year zero — the money you began with.
 */
export function project({ principal, monthly, rate, years }) {
  const start = clamp(principal, 0, field('principal').max);
  const perMonth = clamp(monthly, 0, field('monthly').max);
  const annual = clamp(rate, 0, field('rate').max);
  const term = clamp(years, 0, field('years').max);

  const months = Math.round(term * MONTHS);
  const monthlyRate = annual / 100 / MONTHS;

  const series = [start];
  let balance = start;
  for (let month = 1; month <= months; month += 1) {
    balance = balance * (1 + monthlyRate) + perMonth;
    if (month % MONTHS === 0) series.push(balance);
  }
  // A term that is not whole years still ends where it ends.
  if (months % MONTHS !== 0) series.push(balance);

  const contributed = start + perMonth * months;
  return { balance, contributed, growth: balance - contributed, series };
}

/**
 * The balance at each round decade inside the term, and at the end of it —
 * which is the "what if I stopped five years earlier" question, answered
 * without having to retype anything.
 */
export function milestones({ series }) {
  const last = series.length - 1;
  const marks = [];
  for (let year = 10; year < last; year += 10) marks.push(year);
  if (last > 0) marks.push(last);
  return marks.map((year) => ({ year, balance: series[year] }));
}

function field(key) {
  return FIELDS.find((entry) => entry.key === key);
}

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}

/* ------------------------------------------------------------- formatting */

/** Whole units. Cents are noise next to a thirty-year projection. */
export function formatMoney(amount) {
  if (!Number.isFinite(amount)) return '—';
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${CURRENCY}${formatNumber(Math.abs(rounded))}`;
}

/** What a field shows: the digits typed into it, dressed as what they mean. */
export function formatField(kind, raw) {
  const text = raw === '' ? '0' : raw;
  switch (kind) {
    case 'money':
      return CURRENCY + formatNumber(text);
    case 'percent':
      return `${formatNumber(text)}%`;
    case 'years':
      return `${formatNumber(text)} ${Number(text) === 1 ? 'year' : 'years'}`;
    default:
      return formatNumber(text);
  }
}

/** The number behind what was typed, as the projection will read it. */
export function valueOfField(raw) {
  const value = Number(raw === '' ? '0' : raw);
  return Number.isFinite(value) ? value : 0;
}

/** True while `raw` is something this field is allowed to hold. */
export function accepts(fieldKey, raw) {
  const spec = field(fieldKey);
  if (!spec) return false;
  if (raw === '') return true;
  if (!/^\d*\.?\d*$/.test(raw)) return false;

  const [, decimals = ''] = raw.split('.');
  if (decimals.length > spec.decimals) return false;
  if (spec.decimals === 0 && raw.includes('.')) return false;

  return Number(raw) <= spec.max;
}
