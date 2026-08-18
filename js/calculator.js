/**
 * Calcutron calculator engine.
 *
 * Pure state machine: no DOM, no globals. The UI layer feeds it actions and
 * renders whatever `state()` reports back.
 */

const MAX_ENTRY_DIGITS = 12;
const PRECISION = 15;
const MAX_DISPLAY_DIGITS = 15;

/** Kill binary-float artifacts (0.1 + 0.2 -> 0.30000000000000004). */
function clean(n) {
  if (!Number.isFinite(n)) return n;
  const rounded = Number(n.toPrecision(PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function apply(a, op, b) {
  switch (op) {
    case 'add': return a + b;
    case 'subtract': return a - b;
    case 'multiply': return a * b;
    case 'divide': return a / b;
    default: return b;
  }
}

const OP_SYMBOLS = { add: '+', subtract: '−', multiply: '×', divide: '÷' };

export class Calculator {
  constructor() {
    this.reset();
  }

  reset() {
    this.entry = '0';        // digits the user is currently typing
    this.typing = false;     // true once entry reflects user input, not a result
    this.accumulator = null; // left-hand value of a pending operation
    this.pendingOp = null;
    this.repeatOp = null;    // remembered for pressing = repeatedly
    this.repeatOperand = null;
    this.errored = false;
  }

  /** Numeric value currently shown. */
  get value() {
    const n = parseFloat(this.entry);
    return Number.isFinite(n) ? n : 0;
  }

  state() {
    return {
      entry: this.entry,
      typing: this.typing,
      errored: this.errored,
      expression: this.expression(),
      hasClearableEntry: this.typing || this.entry !== '0',
    };
  }

  /** The small line above the result: "12 x" or "12 x 5". */
  expression() {
    if (this.errored) return '';
    if (this.accumulator === null || this.pendingOp === null) return '';
    const left = String(clean(this.accumulator));
    const symbol = OP_SYMBOLS[this.pendingOp] ?? '';
    return this.typing ? `${left} ${symbol} ${this.entry}` : `${left} ${symbol}`;
  }

  digit(d) {
    if (this.errored) this.reset();
    if (!this.typing) {
      this.entry = d === '0' ? '0' : d;
      this.typing = true;
      return this;
    }
    if (this.entry === '0') {
      if (d === '0') return this;
      this.entry = d;
      return this;
    }
    if (this.countDigits(this.entry) >= MAX_ENTRY_DIGITS) return this;
    this.entry += d;
    return this;
  }

  countDigits(s) {
    return s.replace(/[^0-9]/g, '').length;
  }

  decimal() {
    if (this.errored) this.reset();
    if (!this.typing) {
      this.entry = '0.';
      this.typing = true;
      return this;
    }
    if (!this.entry.includes('.')) this.entry += '.';
    return this;
  }

  negate() {
    if (this.errored) return this;
    if (this.entry === '0' || this.entry === '0.') return this;
    this.entry = this.entry.startsWith('-') ? this.entry.slice(1) : `-${this.entry}`;
    return this;
  }

  percent() {
    if (this.errored) return this;
    // 200 + 10% means 200 + 20, matching how phone calculators behave.
    const base = this.pendingOp === 'add' || this.pendingOp === 'subtract'
      ? (this.accumulator ?? 0)
      : 1;
    this.setResult(clean(this.value * (base / 100)));
    return this;
  }

  operator(op) {
    if (this.errored) return this;
    if (this.pendingOp !== null && this.typing) {
      const result = clean(apply(this.accumulator, this.pendingOp, this.value));
      if (!this.setResult(result)) return this;
      this.accumulator = result;
    } else {
      this.accumulator = this.value;
    }
    this.pendingOp = op;
    this.typing = false;
    this.repeatOp = null;
    this.repeatOperand = null;
    return this;
  }

  equals() {
    if (this.errored) return this;
    let op = this.pendingOp;
    let operand = this.value;

    if (op === null) {
      // Pressing = again repeats the last operation: 2 + 3 = = -> 8.
      if (this.repeatOp === null) return this;
      op = this.repeatOp;
      operand = this.repeatOperand;
      this.accumulator = this.value;
    }

    const result = clean(apply(this.accumulator ?? 0, op, operand));
    this.repeatOp = op;
    this.repeatOperand = operand;
    this.accumulator = null;
    this.pendingOp = null;
    this.setResult(result);
    return this;
  }

  backspace() {
    if (this.errored) { this.reset(); return this; }
    if (!this.typing) return this;
    const next = this.entry.slice(0, -1);
    this.entry = next === '' || next === '-' ? '0' : next;
    if (this.entry === '0') this.typing = false;
    return this;
  }

  /** AC when there is nothing to clear, otherwise C (clear the current entry). */
  clear() {
    if (this.errored || !this.state().hasClearableEntry) {
      this.reset();
      return this;
    }
    this.entry = '0';
    this.typing = false;
    return this;
  }

  clearAll() {
    this.reset();
    return this;
  }

  /** @returns {boolean} false when the result was not a usable number. */
  setResult(n) {
    if (!Number.isFinite(n)) {
      this.reset();
      this.errored = true;
      this.entry = 'Error';
      return false;
    }
    this.entry = String(n);
    this.typing = false;
    return true;
  }
}

/** Render an entry string for the display: grouped, sane length, sane exponents. */
export function formatDisplay(entry) {
  if (entry === 'Error') return 'Error';

  const n = Number(entry);
  if (!Number.isFinite(n)) return 'Error';

  const sign = entry.startsWith('-') ? '-' : '';
  const body = sign ? entry.slice(1) : entry;

  // Plain notation whenever it fits. Mid-typing values keep their exact shape,
  // so "1.50" stays "1.50" and a lone "0." keeps its trailing point.
  if (!/[eE]/.test(body) && significantDigits(body) <= MAX_DISPLAY_DIGITS) {
    const [intPart, decPart] = body.split('.');
    const grouped = groupDigits(intPart);
    return decPart === undefined ? sign + grouped : `${sign}${grouped}.${decPart}`;
  }

  return n.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e');
}

/** Digits that actually carry information, ignoring leading zeros. */
function significantDigits(body) {
  return body.replace(/[^0-9]/g, '').replace(/^0+/, '').length;
}

function groupDigits(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
