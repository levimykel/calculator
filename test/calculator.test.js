import test from 'node:test';
import assert from 'node:assert/strict';
import { Calculator, formatDisplay } from '../js/calculator.js';

/** Drive the calculator with a compact script: "12+3=" */
function run(script) {
  const calc = new Calculator();
  for (const ch of script) {
    if (ch >= '0' && ch <= '9') calc.digit(ch);
    else if (ch === '.') calc.decimal();
    else if (ch === '+') calc.operator('add');
    else if (ch === '-') calc.operator('subtract');
    else if (ch === '*') calc.operator('multiply');
    else if (ch === '/') calc.operator('divide');
    else if (ch === '=') calc.equals();
    else if (ch === '%') calc.percent();
    else if (ch === '~') calc.negate();
    else if (ch === '<') calc.backspace();
    else if (ch === 'c') calc.clear();
    else throw new Error(`unknown token ${ch}`);
  }
  return calc;
}

const shows = (script, expected) =>
  assert.equal(run(script).entry, expected, `${script} should show ${expected}`);

test('arithmetic', () => {
  shows('2+3=', '5');
  shows('9-4=', '5');
  shows('6*7=', '42');
  shows('84/2=', '42');
  shows('10/4=', '2.5');
});

test('chained operations evaluate left to right as typed', () => {
  shows('2+3*4=', '20');
  shows('1+2+3+4=', '10');
});

test('float artifacts are cleaned up', () => {
  shows('.1+.2=', '0.3');
  shows('4.2*3=', '12.6');
});

test('repeated equals repeats the last operation', () => {
  shows('2+3==', '8');
  shows('2*3===', '54');
});

test('pressing an operator twice replaces it rather than stacking', () => {
  const calc = run('5+');
  calc.operator('multiply');
  calc.digit('3');
  calc.equals();
  assert.equal(calc.entry, '15');
});

test('equals with no pending operation is a no-op', () => {
  shows('7=', '7');
});

test('decimal point handling', () => {
  shows('1.5', '1.5');
  shows('..5', '0.5');
  shows('1..5', '1.5');
  shows('.', '0.');
  assert.equal(formatDisplay(run('.').entry), '0.');
});

test('leading zeros are not accumulated', () => {
  shows('000', '0');
  shows('007', '7');
});

test('negate toggles sign but leaves a bare zero alone', () => {
  shows('5~', '-5');
  shows('5~~', '5');
  shows('~', '0');
  shows('3~+8=', '5');
});

test('percent is relative to the pending left-hand side for + and -', () => {
  shows('200+10%=', '220');
  shows('200-10%=', '180');
  shows('50%', '0.5');
  shows('80*50%=', '40');
});

test('backspace removes the last typed character only', () => {
  shows('123<', '12');
  shows('123<<<', '0');
  shows('5~<', '0');
  shows('2+3=<', '5'); // results are not editable
});

test('clear acts as C then AC', () => {
  const calc = run('5+3');
  calc.clear();
  assert.equal(calc.entry, '0');
  calc.digit('4').equals();
  assert.equal(calc.entry, '9', 'C keeps the pending 5 +');

  const calc2 = run('5+3');
  calc2.clear();
  calc2.clear(); // now AC
  calc2.digit('4').equals();
  assert.equal(calc2.entry, '4');
});

test('divide by zero errors and recovers on the next input', () => {
  const calc = run('5/0=');
  assert.equal(calc.entry, 'Error');
  assert.equal(calc.state().errored, true);
  calc.digit('7');
  assert.equal(calc.entry, '7');
  assert.equal(calc.state().errored, false);
});

test('entry length is capped', () => {
  const calc = run('1234567890123456789');
  assert.equal(calc.entry.replace(/[^0-9]/g, '').length, 12);
});

test('expression line tracks the pending operation', () => {
  assert.equal(run('12+').state().expression, '12 +');
  assert.equal(run('12+5').state().expression, '12 + 5');
  assert.equal(run('12+5=').state().expression, '');
});

test('display formatting groups thousands', () => {
  assert.equal(formatDisplay('1234567'), '1,234,567');
  assert.equal(formatDisplay('-9876.5'), '-9,876.5');
  assert.equal(formatDisplay('0.5'), '0.5');
  assert.equal(formatDisplay('1.50'), '1.50', 'trailing zeros survive while typing');
  assert.equal(formatDisplay('Error'), 'Error');
});

test('long but exact results stay in plain notation', () => {
  assert.equal(formatDisplay(run('987654321*123456=').entry), '121,931,851,853,376');
  assert.equal(formatDisplay(run('1/3=').entry), '0.333333333333333');
});

test('display falls back to exponential for huge numbers', () => {
  const calc = run('99999999999*99999999999=');
  assert.match(formatDisplay(calc.entry), /e\d+$/);
});
