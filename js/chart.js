/**
 * The geometry behind the growth chart: a stacked area of what was paid in and
 * what the growth added, which together are the balance.
 *
 * Pure arithmetic, no DOM. The UI turns these numbers into paths, which keeps
 * the part that is easy to get wrong — and easy to get wrong invisibly — under
 * test.
 */

/** The surface gap that keeps the two fills from touching, plus the line under it. */
export const BAND_GAP = 3;

/**
 * One point per year: where the total sits, where the paid-in part tops out,
 * and where the growth band may start without closing the gap between them.
 *
 * @param {number[]} balances  balance at the end of each year, year zero first
 * @param {number[]} paid      what had been paid in by the same points
 */
export function points(balances, paid, { width, height, top = 0, bottom = 0 }) {
  const plotHeight = Math.max(1, height - top - bottom);
  const last = Math.max(1, balances.length - 1);
  // A flat projection still needs a scale, or every point lands on the baseline.
  const max = Math.max(...balances, 1);

  const y = (value) => top + (1 - value / max) * plotHeight;
  const baseline = top + plotHeight;

  return {
    max,
    baseline,
    at: balances.map((balance, index) => {
      const total = y(balance);
      const paidTop = y(paid[index] ?? balance);
      return {
        x: (index / last) * width,
        total,
        paidTop,
        // Never below the total: a growth band thinner than the gap has no
        // room to be drawn, and must collapse rather than turn inside out.
        growthBottom: Math.max(total, paidTop - BAND_GAP),
      };
    }),
  };
}

/** The filled shape between two edges of the same run of points. */
export function band(at, baseline, upper, lower) {
  if (at.length < 2) return '';
  const forward = at.map((p) => `${round(p.x)},${round(upper(p))}`);
  const back = [...at].reverse().map((p) => `${round(p.x)},${round(lower(p, baseline))}`);
  return `M${forward.join('L')}L${back.join('L')}Z`;
}

/** An open line along one edge. */
export function edge(at, pick) {
  if (at.length < 2) return '';
  return `M${at.map((p) => `${round(p.x)},${round(pick(p))}`).join('L')}`;
}

/** Which year the reader is pointing at. */
export function yearAt(x, width, years) {
  if (years < 1) return 0;
  const ratio = Math.min(Math.max(x / Math.max(1, width), 0), 1);
  return Math.round(ratio * years);
}

/** Decade marks that fit inside the term, and the end of it. */
export function ticks(years) {
  if (years < 1) return [];
  const step = years > 40 ? 20 : years > 12 ? 10 : years > 4 ? 5 : 1;
  const out = [];
  for (let year = step; year < years; year += step) out.push(year);
  out.push(years);
  return out;
}

/** Half-pixels blur a hairline; whole ones do not. */
function round(value) {
  return Math.round(value * 10) / 10;
}
