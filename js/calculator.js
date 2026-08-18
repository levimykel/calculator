/**
 * Calcutron expression engine.
 *
 * The calculator holds an expression as a list of tokens rather than
 * evaluating as you go: pressing an operator appends to the expression, and
 * nothing is computed until `=`. Evaluation is a recursive-descent parse, so
 * × and ÷ bind tighter than + and −, and parentheses group.
 *
 * Pure: no DOM, no globals. The UI feeds it presses and renders `state()`.
 */

const MAX_ENTRY_DIGITS = 12;
const MAX_TOKENS = 240;
const PRECISION = 15;

export const OPERATORS = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

const ADDITIVE = new Set(['add', 'subtract']);

/** Kill binary-float artifacts (0.1 + 0.2 -> 0.30000000000000004). */
function clean(n) {
  if (!Number.isFinite(n)) return n;
  const rounded = Number(n.toPrecision(PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/* ------------------------------------------------------------------ parsing */

class ParseError extends Error {}

/**
 * Grammar, loosest binding first:
 *
 *   expression := term (('+' | '−') term)*
 *   term       := unary (('×' | '÷' | juxtaposition) unary)*
 *   unary      := ('−' | '+') unary | postfix
 *   postfix    := primary '%'*
 *   primary    := number | '(' expression ')'
 *
 * Juxtaposition is implicit multiplication: "2(3+4)" and "(1+2)(3)". The UI
 * inserts an explicit × for those, but the parser accepts them regardless so
 * that a hand-built token list cannot produce a surprise.
 */
export function parse(tokens) {
  const state = { tokens, at: 0 };
  const node = parseExpression(state);
  if (state.at < tokens.length) throw new ParseError('trailing tokens');
  return node;
}

const peek = (s) => s.tokens[s.at];
const take = (s) => s.tokens[s.at++];

function parseExpression(s) {
  let left = parseTerm(s);
  while (peek(s)?.type === 'operator' && ADDITIVE.has(peek(s).op)) {
    const { op } = take(s);
    left = { type: 'binary', op, left, right: parseTerm(s) };
  }
  return left;
}

function parseTerm(s) {
  let left = parseUnary(s);
  for (;;) {
    const next = peek(s);
    if (next?.type === 'operator' && !ADDITIVE.has(next.op)) {
      const { op } = take(s);
      left = { type: 'binary', op, left, right: parseUnary(s) };
    } else if (next?.type === 'open' || next?.type === 'number') {
      left = { type: 'binary', op: 'multiply', left, right: parseUnary(s) };
    } else {
      return left;
    }
  }
}

function parseUnary(s) {
  const next = peek(s);
  if (next?.type === 'operator' && ADDITIVE.has(next.op)) {
    take(s);
    const operand = parseUnary(s);
    return next.op === 'subtract' ? { type: 'negate', operand } : operand;
  }
  return parsePostfix(s);
}

function parsePostfix(s) {
  let node = parsePrimary(s);
  while (peek(s)?.type === 'percent') {
    take(s);
    node = { type: 'percent', operand: node };
  }
  return node;
}

function parsePrimary(s) {
  const token = take(s);
  if (!token) throw new ParseError('unexpected end of expression');

  if (token.type === 'number') {
    const value = Number(token.text);
    if (!Number.isFinite(value)) throw new ParseError('bad number');
    return { type: 'number', value };
  }

  if (token.type === 'open') {
    const inner = parseExpression(s);
    if (peek(s)?.type === 'close') take(s);
    return inner; // Grouping only affects parsing, so no node of its own.
  }

  throw new ParseError(`unexpected ${token.type}`);
}

/* -------------------------------------------------------------- evaluation */

export function evaluate(node) {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'negate':
      return -evaluate(node.operand);
    case 'percent':
      return evaluate(node.operand) / 100;
    case 'binary':
      return applyBinary(node);
    default:
      throw new ParseError(`unknown node ${node.type}`);
  }
}

function applyBinary(node) {
  const left = evaluate(node.left);

  // "200 + 10%" means 200 + 10% *of 200*, matching how phone calculators
  // behave. Against × and ÷ a percent is just the plain fraction.
  const right = ADDITIVE.has(node.op) && node.right.type === 'percent'
    ? left * (evaluate(node.right.operand) / 100)
    : evaluate(node.right);

  switch (node.op) {
    case 'add': return left + right;
    case 'subtract': return left - right;
    case 'multiply': return left * right;
    case 'divide': return left / right;
    default: throw new ParseError(`unknown operator ${node.op}`);
  }
}

/**
 * Make a token list evaluable: drop a trailing operator or open paren, and
 * close any parens left open. Typing is allowed to be mid-thought; this is
 * what makes "12 × (3 +" previewable as 12 × 3.
 */
export function normalize(tokens) {
  const out = tokens.slice();

  while (out.length) {
    const last = out[out.length - 1];
    if (last.type === 'operator' || last.type === 'open') out.pop();
    else break;
  }

  let depth = 0;
  for (const token of out) {
    if (token.type === 'open') depth += 1;
    else if (token.type === 'close') depth -= 1;
  }
  for (let i = 0; i < depth; i += 1) out.push({ type: 'close' });

  return out;
}

/** @returns {number|null} null when the expression cannot be evaluated yet. */
export function valueOf(tokens) {
  const normalized = normalize(tokens);
  if (!normalized.length) return null;
  try {
    const result = clean(evaluate(parse(normalized)));
    return Number.isFinite(result) ? result : NaN;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the machine */

export class Calculator {
  constructor() {
    this.reset();
  }

  reset() {
    this.tokens = [];
    this.committed = null;   // the expression text that produced a result
    this.errored = false;
  }

  get last() {
    return this.tokens[this.tokens.length - 1];
  }

  get openDepth() {
    let depth = 0;
    for (const token of this.tokens) {
      if (token.type === 'open') depth += 1;
      else if (token.type === 'close') depth -= 1;
    }
    return depth;
  }

  state() {
    const preview = this.committed === null ? valueOf(this.tokens) : null;
    return {
      tokens: this.tokens,
      expression: formatTokens(this.tokens),
      committed: this.committed,
      preview: preview === null || Number.isNaN(preview) ? null : preview,
      errored: this.errored,
      isEmpty: this.tokens.length === 0,
      openDepth: this.openDepth,
    };
  }

  /** After `=`, the next keypress either starts over or builds on the result. */
  continueFromResult(keepResult) {
    if (this.committed === null) return;
    this.committed = null;
    if (!keepResult) this.tokens = [];
  }

  full() {
    return this.tokens.length >= MAX_TOKENS;
  }

  digit(d) {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    const last = this.last;
    if (last?.type === 'number') {
      if (countDigits(last.text) >= MAX_ENTRY_DIGITS) return this;
      last.text = last.text === '0' ? d : last.text + d;
      return this;
    }

    // A number straight after ")" or "%" means multiplication; make it visible
    // rather than leaving the parser to infer it.
    if (last?.type === 'close' || last?.type === 'percent') this.push({ type: 'operator', op: 'multiply' });
    return this.push({ type: 'number', text: d });
  }

  decimal() {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    const last = this.last;
    if (last?.type === 'number') {
      if (!last.text.includes('.')) last.text += '.';
      return this;
    }
    if (last?.type === 'close' || last?.type === 'percent') this.push({ type: 'operator', op: 'multiply' });
    return this.push({ type: 'number', text: '0.' });
  }

  operator(op) {
    if (this.errored) return this;
    this.continueFromResult(true);

    const last = this.last;

    // Nothing to operate on yet: only a leading minus makes sense.
    if (!last || last.type === 'open') {
      return op === 'subtract' ? this.push({ type: 'operator', op }) : this;
    }

    if (last.type === 'operator') {
      // "5 × −" is a real thing to type, so a minus after an operator is kept
      // as a unary sign. Anything else replaces the operator.
      if (op === 'subtract' && !ADDITIVE.has(last.op)) return this.push({ type: 'operator', op });
      last.op = op;
      return this;
    }

    return this.push({ type: 'operator', op });
  }

  openParen() {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    const last = this.last;
    if (last?.type === 'number' || last?.type === 'close' || last?.type === 'percent') {
      this.push({ type: 'operator', op: 'multiply' });
    }
    return this.push({ type: 'open' });
  }

  closeParen() {
    if (this.errored) return this;
    if (this.committed !== null) return this;

    // Only closeable when something is open and the group has content in it.
    if (this.openDepth <= 0) return this;
    const last = this.last;
    if (!last || last.type === 'operator' || last.type === 'open') return this;

    return this.push({ type: 'close' });
  }

  /**
   * The keypad has one parenthesis key. It closes when there is a group open
   * with something in it, and opens otherwise — which is what you want the
   * overwhelming majority of the time.
   */
  paren() {
    const last = this.last;
    const closeable = this.openDepth > 0
      && this.committed === null
      && (last?.type === 'number' || last?.type === 'close' || last?.type === 'percent');
    return closeable ? this.closeParen() : this.openParen();
  }

  /**
   * Flip the sign of the number just typed, by adding or removing a unary
   * minus in front of it. Reusing the sign token means "12 + −5" parses and
   * renders through the same path as a minus you typed yourself.
   */
  negate() {
    if (this.errored) return this;
    this.continueFromResult(true);

    if (this.last?.type !== 'number') return this;

    const signIndex = this.tokens.length - 2;
    const sign = this.tokens[signIndex];
    const isSign = sign?.type === 'operator'
      && ADDITIVE.has(sign.op)
      && isUnaryAt(this.tokens, signIndex);

    if (isSign) {
      if (sign.op === 'subtract') this.tokens.splice(signIndex, 1);
      else sign.op = 'subtract';
      return this;
    }

    this.tokens.splice(this.tokens.length - 1, 0, { type: 'operator', op: 'subtract' });
    return this;
  }

  percent() {
    if (this.errored) return this;
    this.continueFromResult(true);

    const last = this.last;
    if (last?.type !== 'number' && last?.type !== 'close' && last?.type !== 'percent') return this;
    return this.push({ type: 'percent' });
  }

  equals() {
    if (this.errored) return this;
    if (this.committed !== null) return this; // Already a result; nothing to redo.
    if (!this.tokens.length) return this;

    const expression = formatTokens(normalize(this.tokens));
    const result = valueOf(this.tokens);

    if (result === null) return this;
    if (Number.isNaN(result)) {
      this.reset();
      this.errored = true;
      return this;
    }

    this.tokens = [{ type: 'number', text: String(result) }];
    this.committed = expression;
    return this;
  }

  backspace() {
    if (this.errored) { this.reset(); return this; }

    // Backspacing a result drops it and returns to an empty expression rather
    // than letting you edit digits that were computed, not typed.
    if (this.committed !== null) { this.reset(); return this; }

    const last = this.last;
    if (!last) return this;

    if (last.type === 'number' && last.text.length > 1) {
      last.text = last.text.slice(0, -1);
      if (last.text === '-') this.tokens.pop();
      return this;
    }

    this.tokens.pop();
    return this;
  }

  clearAll() {
    this.reset();
    return this;
  }

  push(token) {
    if (this.full()) return this;
    this.tokens.push(token);
    return this;
  }
}

function countDigits(text) {
  return text.replace(/[^0-9]/g, '').length;
}

/* ------------------------------------------------------------- formatting */

/** True when a +/− at this position is a sign rather than an operation. */
function isUnaryAt(tokens, index) {
  if (index === 0) return true;
  const before = tokens[index - 1];
  return before.type === 'operator' || before.type === 'open';
}

export function formatTokens(tokens) {
  let out = '';
  tokens.forEach((token, index) => {
    switch (token.type) {
      case 'number':
        out += formatNumber(token.text);
        break;
      case 'operator':
        out += isUnaryAt(tokens, index)
          ? OPERATORS[token.op]
          : ` ${OPERATORS[token.op]} `;
        break;
      case 'open':
        out += '(';
        break;
      case 'close':
        out += ')';
        break;
      case 'percent':
        out += '%';
        break;
      default:
        break;
    }
  });
  return out;
}

/** Render one number: grouped, sane length, sane exponents. */
export function formatNumber(entry) {
  const text = typeof entry === 'number' ? String(entry) : entry;
  const n = Number(text);
  if (!Number.isFinite(n)) return 'Error';

  const sign = text.startsWith('-') ? '-' : '';
  const body = sign ? text.slice(1) : text;

  // Plain notation whenever it fits. Mid-typing values keep their exact shape,
  // so "1.50" stays "1.50" and a lone "0." keeps its trailing point.
  if (!/[eE]/.test(body) && significantDigits(body) <= 15) {
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
