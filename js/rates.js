/**
 * Currencies: what the codes mean, how to convert between them, and how to
 * read what a rates service sends back.
 *
 * Pure: no DOM, no network. `js/exchange.js` does the fetching and the
 * remembering; this file is the part that can be reasoned about.
 */

import { formatNumber } from './calculator.js';

/**
 * Names and symbols for the currencies people actually reach for. Anything a
 * service returns that is not in here still works — it shows as its code,
 * which is what the code is for.
 *
 * `decimals` is how many the currency is quoted in: yen and won have none.
 */
export const CURRENCIES = {
  USD: { name: 'US dollar', symbol: '$' },
  EUR: { name: 'Euro', symbol: '€' },
  GBP: { name: 'British pound', symbol: '£' },
  JPY: { name: 'Japanese yen', symbol: '¥', decimals: 0 },
  CHF: { name: 'Swiss franc', symbol: 'CHF' },
  CAD: { name: 'Canadian dollar', symbol: 'CA$' },
  AUD: { name: 'Australian dollar', symbol: 'A$' },
  NZD: { name: 'New Zealand dollar', symbol: 'NZ$' },
  CNY: { name: 'Chinese yuan', symbol: 'CN¥' },
  HKD: { name: 'Hong Kong dollar', symbol: 'HK$' },
  SGD: { name: 'Singapore dollar', symbol: 'S$' },
  INR: { name: 'Indian rupee', symbol: '₹' },
  KRW: { name: 'South Korean won', symbol: '₩', decimals: 0 },
  SEK: { name: 'Swedish krona', symbol: 'kr' },
  NOK: { name: 'Norwegian krone', symbol: 'kr' },
  DKK: { name: 'Danish krone', symbol: 'kr' },
  PLN: { name: 'Polish złoty', symbol: 'zł' },
  CZK: { name: 'Czech koruna', symbol: 'Kč' },
  HUF: { name: 'Hungarian forint', symbol: 'Ft', decimals: 0 },
  RON: { name: 'Romanian leu', symbol: 'lei' },
  BGN: { name: 'Bulgarian lev', symbol: 'лв' },
  ISK: { name: 'Icelandic króna', symbol: 'kr', decimals: 0 },
  TRY: { name: 'Turkish lira', symbol: '₺' },
  ILS: { name: 'Israeli shekel', symbol: '₪' },
  ZAR: { name: 'South African rand', symbol: 'R' },
  MXN: { name: 'Mexican peso', symbol: 'MX$' },
  BRL: { name: 'Brazilian real', symbol: 'R$' },
  THB: { name: 'Thai baht', symbol: '฿' },
  MYR: { name: 'Malaysian ringgit', symbol: 'RM' },
  IDR: { name: 'Indonesian rupiah', symbol: 'Rp', decimals: 0 },
  PHP: { name: 'Philippine peso', symbol: '₱' },
};

/** Roughly how often people want them, so the top of the list is useful. */
const COMMON = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'NZD'];

export const DEFAULT_BASE = 'USD';

/* ---------------------------------------------------------------- reading */

/** A currency code, as the services write them. */
const CODE = /^[A-Z]{3}$/;
/** An ISO day. Anything else is not a date we are willing to put on screen. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Take whatever a service sent and return `{ base, date, rates }`, or null if
 * it is not something worth believing. Every field is checked: a rates screen
 * showing the wrong number confidently is worse than one saying it could not
 * find out.
 */
export function readRates({ base, date, rates }) {
  if (typeof base !== 'string' || !CODE.test(base)) return null;
  if (typeof date !== 'string' || !DAY.test(date)) return null;
  if (!rates || typeof rates !== 'object') return null;

  const clean = {};
  for (const [code, rate] of Object.entries(rates)) {
    // A rate must be a positive, finite number; a zero or a NaN would divide
    // the whole screen into nonsense.
    if (!CODE.test(code) || typeof rate !== 'number') continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    clean[code] = rate;
  }

  if (!Object.keys(clean).length) return null;
  return { base, date, rates: { ...clean, [base]: 1 } };
}

/** Frankfurter: `{ amount, base, date, rates }`, the ECB's daily reference set. */
export function fromFrankfurter(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return readRates({ base: payload.base, date: payload.date, rates: payload.rates });
}

/** open.er-api.com: `{ result, base_code, time_last_update_unix, rates }`. */
export function fromOpenExchange(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.result !== 'success') return null;

  const seconds = payload.time_last_update_unix;
  const date = typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().slice(0, 10)
    : null;

  return readRates({ base: payload.base_code, date, rates: payload.rates });
}

/* ------------------------------------------------------------- converting */

/**
 * Convert between any two of the currencies quoted against `base`. Going via
 * the base is what lets the list be re-based by tapping a row without
 * fetching anything again.
 */
export function convert(amount, from, to, { base, rates }) {
  if (!Number.isFinite(amount)) return null;
  const out = rateOf(to, base, rates);
  const back = rateOf(from, base, rates);
  if (out === null || back === null) return null;
  return (amount / back) * out;
}

function rateOf(code, base, rates) {
  if (code === base) return 1;
  const rate = rates?.[code];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** The codes to show, base first, then the ones people reach for, then the rest. */
export function order(base, rates) {
  const codes = Object.keys(rates ?? {}).filter((code) => code !== base);
  const rank = (code) => {
    const common = COMMON.indexOf(code);
    return common === -1 ? COMMON.length : common;
  };
  codes.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [base, ...codes];
}

/* ------------------------------------------------------------- formatting */

export function currencyName(code) {
  return CURRENCIES[code]?.name ?? code;
}

export function currencySymbol(code) {
  return CURRENCIES[code]?.symbol ?? '';
}

/** A symbol made of letters needs air before the number; "$" does not. */
function prefix(code) {
  const symbol = currencySymbol(code);
  return /[A-Za-z]$/.test(symbol) ? `${symbol}\u202f` : symbol;
}

function decimalsOf(code) {
  return CURRENCIES[code]?.decimals ?? 2;
}

/** An amount in its own currency: grouped, with that currency's decimals. */
export function formatAmount(value, code) {
  if (!Number.isFinite(value)) return '—';
  const places = decimalsOf(code);
  // Past the point where a float carries cents, the decimals are a fiction.
  const fixed = Math.abs(value) >= 1e15 ? String(value) : value.toFixed(places);
  const sign = fixed.startsWith('-') ? '-' : '';
  const body = sign ? fixed.slice(1) : fixed;
  return `${sign}${prefix(code)}${formatNumber(body)}`;
}

/**
 * The amount being typed, shown as typed — a trailing point has to stay on
 * screen or the key that put it there looks broken.
 */
export function formatEntry(raw, code) {
  return prefix(code) + formatNumber(raw === '' ? '0' : raw);
}

/**
 * "1 USD = 0.9213 EUR". Enough figures to be useful for a currency worth
 * thousands to the unit, without printing noise for one worth about one.
 */
export function formatRate(from, to, snapshot) {
  const one = convert(1, from, to, snapshot);
  if (one === null) return '';
  const places = one >= 100 ? 2 : one >= 1 ? 4 : 6;
  return `1 ${from} = ${trimZeros(one.toFixed(places))} ${to}`;
}

function trimZeros(text) {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** "12 September 2026", from the ISO day a service quotes. */
export function formatDay(day) {
  if (typeof day !== 'string' || !DAY.test(day)) return '';
  const [year, month, date] = day.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${date} ${months[month - 1]} ${year}`;
}
