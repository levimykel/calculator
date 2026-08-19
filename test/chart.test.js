import test from 'node:test';
import assert from 'node:assert/strict';
import { points, band, edge, yearAt, ticks, BAND_GAP } from '../js/chart.js';

const BOX = { width: 300, height: 100, top: 0, bottom: 0 };

test('the plot spans the width, one point per year', () => {
  const { at } = points([0, 50, 100], [0, 50, 100], BOX);
  assert.equal(at.length, 3);
  assert.deepEqual(at.map((p) => p.x), [0, 150, 300], 'first at the left edge, last at the right');
});

test('the tallest balance reaches the top and zero sits on the baseline', () => {
  const { at, baseline, max } = points([0, 100], [0, 100], BOX);
  assert.equal(max, 100);
  assert.equal(baseline, 100);
  assert.equal(at[1].total, 0, 'the peak is the top of the plot');
  assert.equal(at[0].total, baseline, 'and nothing is the bottom of it');
});

test('the padding is kept clear of the plot', () => {
  const { at, baseline } = points([0, 100], [0, 100], { ...BOX, top: 4, bottom: 15 });
  assert.equal(at[1].total, 4, 'the peak stops below the top edge');
  assert.equal(baseline, 85, 'and the baseline above the labels');
});

test('a flat projection still draws, rather than dividing by zero', () => {
  const { at, max } = points([0, 0], [0, 0], BOX);
  assert.equal(max, 1);
  assert.ok(at.every((p) => Number.isFinite(p.total)));
});

test('the growth band starts clear of the paid band', () => {
  // 200 paid of a 400 balance: the bands meet halfway, minus the gap.
  const { at } = points([400], [200], { ...BOX, width: 0 });
  assert.equal(at[0].paidTop, 50);
  assert.equal(at[0].growthBottom, 50 - BAND_GAP);
});

test('a growth band too thin for the gap collapses instead of inverting', () => {
  const { at } = points([100, 101], [100, 100], BOX);
  const [start, next] = at;
  assert.equal(start.growthBottom, start.total, 'no growth yet, so no band');
  assert.ok(next.growthBottom >= next.total, 'and never the wrong way up');
});

test('a band is closed, a line is not', () => {
  const { at, baseline } = points([0, 100], [0, 100], BOX);
  const filled = band(at, baseline, (p) => p.total, (p, base) => base);
  assert.ok(filled.startsWith('M') && filled.endsWith('Z'), 'the fill is a closed shape');
  const drawn = edge(at, (p) => p.total);
  assert.ok(drawn.startsWith('M') && !drawn.includes('Z'), 'the line is an open one');
  assert.equal(drawn.split('L').length, 2, 'with a point per year');
});

test('a single point draws nothing rather than a broken path', () => {
  const { at, baseline } = points([100], [100], BOX);
  assert.equal(band(at, baseline, (p) => p.total, (p, base) => base), '');
  assert.equal(edge(at, (p) => p.total), '');
});

test('a point on the chart is the year nearest it', () => {
  assert.equal(yearAt(0, 300, 30), 0);
  assert.equal(yearAt(300, 300, 30), 30);
  assert.equal(yearAt(150, 300, 30), 15);
  assert.equal(yearAt(-40, 300, 30), 0, 'a finger off the left edge is year zero');
  assert.equal(yearAt(9999, 300, 30), 30, 'and off the right, the end');
  assert.equal(yearAt(100, 300, 0), 0, 'a term of nothing has one year to point at');
});

test('the year labels thin out as the term lengthens', () => {
  assert.deepEqual(ticks(30), [10, 20, 30]);
  assert.deepEqual(ticks(25), [10, 20, 25], 'the end of the term is always marked');
  assert.deepEqual(ticks(10), [5, 10]);
  assert.deepEqual(ticks(3), [1, 2, 3]);
  assert.deepEqual(ticks(75), [20, 40, 60, 75]);
  assert.deepEqual(ticks(0), [], 'nothing has happened, so there is nothing to mark');
});
