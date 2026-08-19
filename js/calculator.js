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
  power: '^',
};

const ADDITIVE = new Set(['add', 'subtract']);
const MULTIPLICATIVE = new Set(['multiply', 'divide']);

export const CONSTANTS = {
  pi: { symbol: 'π', value: Math.PI },
};

export const FUNCTIONS = {
  sqrt: { symbol: '√', apply: Math.sqrt },
};

/** Token types that stand for a value, and so can start one. */
const VALUE_TOKENS = new Set(['number', 'constant', 'function', 'open']);
/** Token types that complete a value, and so can be followed by a postfix. */
const VALUE_ENDINGS = new Set(['number', 'constant', 'close', 'percent', 'square', 'reciprocal']);

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
 *   unary      := ('−' | '+') unary | power
 *   power      := postfix ('^' unary)?
 *   postfix    := primary ('%' | '²' | '⁻¹')*
 *   primary    := number | constant | function '(' expression ')' | '(' expression ')'
 *
 * Power sits between unary and postfix, which gives it the two conventions
 * people expect: it binds tighter than × so 2 × 3^2 is 18, and −2² is −4
 * because the minus applies to the result. Its right operand is a `unary`, so
 * it is right-associative (2^3^2 is 512) and 2^−1 is typeable.
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
    if (next?.type === 'operator' && MULTIPLICATIVE.has(next.op)) {
      const { op } = take(s);
      left = { type: 'binary', op, left, right: parseUnary(s) };
    } else if (next && VALUE_TOKENS.has(next.type)) {
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
  return parsePower(s);
}

function parsePower(s) {
  const base = parsePostfix(s);
  const next = peek(s);
  if (next?.type === 'operator' && next.op === 'power') {
    take(s);
    // The exponent is a `unary`, which is what makes this right-associative
    // and lets a sign follow the caret.
    return { type: 'binary', op: 'power', left: base, right: parseUnary(s) };
  }
  return base;
}

const POSTFIX_NODES = { percent: 'percent', square: 'square', reciprocal: 'reciprocal' };
const POSTFIX_TYPES = new Set(Object.keys(POSTFIX_NODES));

function parsePostfix(s) {
  let node = parsePrimary(s);
  for (;;) {
    const kind = POSTFIX_NODES[peek(s)?.type];
    if (!kind) return node;
    take(s);
    node = { type: kind, operand: node };
  }
}

function parsePrimary(s) {
  const token = take(s);
  if (!token) throw new ParseError('unexpected end of expression');

  if (token.type === 'number') {
    const value = Number(token.text);
    if (!Number.isFinite(value)) throw new ParseError('bad number');
    return { type: 'number', value };
  }

  if (token.type === 'constant') {
    const constant = CONSTANTS[token.name];
    if (!constant) throw new ParseError(`unknown constant ${token.name}`);
    return { type: 'number', value: constant.value };
  }

  if (token.type === 'function') {
    if (!FUNCTIONS[token.fn]) throw new ParseError(`unknown function ${token.fn}`);
    // The keypad always inserts the opening paren with the function, but the
    // parser does not insist on it.
    if (peek(s)?.type === 'open') take(s);
    const argument = parseExpression(s);
    if (peek(s)?.type === 'close') take(s);
    return { type: 'call', fn: token.fn, argument };
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
    case 'square': {
      const value = evaluate(node.operand);
      return value * value;
    }
    case 'reciprocal':
      return 1 / evaluate(node.operand);
    case 'call':
      return FUNCTIONS[node.fn].apply(evaluate(node.argument));
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
    case 'power': return left ** right;
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
    // A function with nothing after it goes too, along with its open paren.
    if (last.type === 'operator' || last.type === 'open' || last.type === 'function') out.pop();
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

/**
 * The expression is edited at a caret, counted in stops from the left. A
 * number offers one stop per typed character, since that is what you edit;
 * every other token is one indivisible stop. A number whose display form is
 * not simply its digits — an exponential result — offers no interior stops, so
 * there is never a caret position that cannot be drawn.
 */
function tokenWidth(token) {
  return token.type === 'number' && isPlainNumber(token.text) ? token.text.length : 1;
}

/** True when a number is shown as the characters it was typed as, plus commas,
    and so can be edited a character at a time. */
export function isPlainNumber(text) {
  return numberText(text).replace(/,/g, '') === text;
}

export function caretMax(tokens) {
  return tokens.reduce((total, token) => total + tokenWidth(token), 0);
}

/**
 * Where a caret position falls. `offset` above zero means "inside that number,
 * after that many characters"; zero means "at the boundary before that token",
 * which for a number that follows another is also the end of the one before.
 */
export function locate(tokens, caret) {
  let left = caret;
  for (let index = 0; index < tokens.length; index += 1) {
    const width = tokenWidth(tokens[index]);
    if (left < width) return { index, offset: left };
    left -= width;
  }
  return { index: tokens.length, offset: 0 };
}

export class Calculator {
  constructor() {
    this.reset();
  }

  reset() {
    this.tokens = [];
    this._caret = 0;
    this.committed = null;        // the expression text that produced a result
    this.committedTokens = null;  // and its tokens, for the history to render
    this.errored = false;
  }

  /* The caret clamps on the way in and on the way out: a deletion can shorten
     the expression behind a position that was already stored. */
  get caret() {
    return Math.min(this._caret, this.caretMax);
  }

  set caret(value) {
    this._caret = Math.max(0, Math.min(value, this.caretMax));
  }

  get caretMax() {
    return caretMax(this.tokens);
  }

  at() {
    return locate(this.tokens, this.caret);
  }

  /** The token the caret sits after — what every entry rule reads. */
  get before() {
    const { index, offset } = this.at();
    return offset > 0 ? this.tokens[index] : this.tokens[index - 1];
  }

  /**
   * Groups open at the caret that nothing after it already closes — which is
   * how many closing brackets can still be typed there. Walking on past the
   * caret is what stops a `)` being added inside a group that is closed later,
   * where it would unbalance the expression.
   */
  get closableDepth() {
    const { index, offset } = this.at();
    const from = offset > 0 ? index + 1 : index;

    let depth = 0;
    for (let i = 0; i < from; i += 1) {
      if (this.tokens[i].type === 'open') depth += 1;
      else if (this.tokens[i].type === 'close') depth -= 1;
    }

    let lowest = depth;
    for (let i = from; i < this.tokens.length; i += 1) {
      if (this.tokens[i].type === 'open') depth += 1;
      else if (this.tokens[i].type === 'close') depth -= 1;
      lowest = Math.min(lowest, depth);
    }
    return lowest;
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
      committedTokens: this.committedTokens,
      preview: preview === null || Number.isNaN(preview) ? null : preview,
      errored: this.errored,
      isEmpty: this.tokens.length === 0,
      openDepth: this.openDepth,
      caret: this.caret,
      caretMax: this.caretMax,
    };
  }

  /* ------------------------------------------------------------ the caret */

  /**
   * One press, one stop: through a number that is one digit, over anything
   * else the whole token. Moving into a finished result takes it back to
   * being an expression, so its digits can be corrected.
   */
  moveCaret(delta) {
    if (this.errored) return this;
    this.continueFromResult(true);
    this.caret += delta;
    return this;
  }

  caretTo(position) {
    if (this.errored) return this;
    this.continueFromResult(true);
    this.caret = position;
    return this;
  }

  caretHome() { return this.caretTo(0); }

  caretEnd() { return this.caretTo(this.caretMax); }

  /* ------------------------------------------------------------- editing */

  /**
   * Put tokens in at the caret, splitting the number it is inside if it is
   * inside one, and leave the caret after what went in.
   */
  insert(...tokens) {
    if (this.tokens.length + tokens.length > MAX_TOKENS) return this;
    const { index, offset } = this.at();
    const start = offset > 0 ? index + 1 : index;

    if (offset > 0) {
      const number = this.tokens[index];
      this.tokens.splice(
        index,
        1,
        { type: 'number', text: number.text.slice(0, offset) },
        ...tokens,
        { type: 'number', text: number.text.slice(offset) },
      );
    } else {
      this.tokens.splice(index, 0, ...tokens);
    }

    this.caret += caretMax(tokens);

    // Close both seams, trailing one first so the indices hold.
    this.separate(start + tokens.length);
    if (this.separate(start)) this.caret += 1;
    return this;
  }

  /**
   * The inverse of join(): where an edit has left one value touching the next,
   * put the multiplication in explicitly. Two numbers side by side would read
   * on screen as a single longer number while the parser multiplied them.
   */
  separate(at) {
    const left = this.tokens[at - 1];
    const right = this.tokens[at];
    if (!endsValue(left) || !right || !VALUE_TOKENS.has(right.type)) return false;
    this.tokens.splice(at, 0, { type: 'operator', op: 'multiply' });
    return true;
  }

  /**
   * Numbers left side by side by a deletion are joined rather than left
   * touching: "2 + 3" losing its operator is 23, where juxtaposition would
   * otherwise quietly make it 2 × 3.
   */
  join(at) {
    const left = this.tokens[at - 1];
    const right = this.tokens[at];
    if (left?.type !== 'number' || right?.type !== 'number') return;
    left.text += right.text;
    this.tokens.splice(at, 1);
  }

  /** After `=`, the next keypress either starts over or builds on the result. */
  continueFromResult(keepResult) {
    if (this.committed === null) return;
    this.committed = null;
    this.committedTokens = null;
    if (!keepResult) {
      this.tokens = [];
      this.caret = 0;
    }
  }

  full() {
    return this.tokens.length >= MAX_TOKENS;
  }

  digit(d) {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    const { index, offset } = this.at();

    // Inside a number, the digit goes exactly where the caret is.
    if (offset > 0) {
      const number = this.tokens[index];
      if (countDigits(number.text) >= MAX_ENTRY_DIGITS) return this;
      number.text = number.text.slice(0, offset) + d + number.text.slice(offset);
      this.caret += 1;
      return this;
    }

    // Against either edge of a number, it extends that number.
    const left = this.tokens[index - 1];
    if (left?.type === 'number' && isPlainNumber(left.text)) {
      return this.extend(left, (text) => (text === '0' ? d : text + d), 1);
    }
    const right = this.tokens[index];
    if (right?.type === 'number' && isPlainNumber(right.text)) {
      return this.extend(right, (text) => (text === '0' ? d : d + text), 1);
    }

    // Otherwise it starts a new one, multiplying if a value just ended.
    return endsValue(left)
      ? this.insert({ type: 'operator', op: 'multiply' }, { type: 'number', text: d })
      : this.insert({ type: 'number', text: d });
  }

  /** Rewrite a number in place, keeping the caret on the far side of the edit. */
  extend(number, rewrite, digits) {
    if (digits && countDigits(number.text) >= MAX_ENTRY_DIGITS) return this;
    const before = tokenWidth(number);
    number.text = rewrite(number.text);
    this.caret += Math.max(1, tokenWidth(number) - before);
    return this;
  }

  decimal() {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    const { index, offset } = this.at();

    if (offset > 0) {
      const number = this.tokens[index];
      if (number.text.includes('.')) return this;
      number.text = `${number.text.slice(0, offset)}.${number.text.slice(offset)}`;
      this.caret += 1;
      return this;
    }

    const left = this.tokens[index - 1];
    if (left?.type === 'number' && isPlainNumber(left.text)) {
      return left.text.includes('.') ? this : this.extend(left, (text) => `${text}.`, 0);
    }
    const right = this.tokens[index];
    if (right?.type === 'number' && isPlainNumber(right.text)) {
      return right.text.includes('.') ? this : this.extend(right, (text) => `.${text}`, 0);
    }

    return endsValue(left)
      ? this.insert({ type: 'operator', op: 'multiply' }, { type: 'number', text: '0.' })
      : this.insert({ type: 'number', text: '0.' });
  }

  operator(op) {
    if (this.errored) return this;
    this.continueFromResult(true);

    const left = this.before;

    // Nothing to operate on yet: only a leading minus makes sense.
    if (!left || left.type === 'open') {
      return op === 'subtract' ? this.insert({ type: 'operator', op }) : this;
    }

    // A caret part-way through a number splits it: "12|3" then + is "12 + 3".
    if (left.type === 'operator' && !this.at().offset) {
      // "5 × −" is a real thing to type, so a minus after an operator is kept
      // as a unary sign. Anything else corrects the operator it follows.
      if (op === 'subtract' && !ADDITIVE.has(left.op)) return this.insert({ type: 'operator', op });
      left.op = op;
      return this;
    }

    return this.insert({ type: 'operator', op });
  }

  openParen() {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    return endsValue(this.before)
      ? this.insert({ type: 'operator', op: 'multiply' }, { type: 'open' })
      : this.insert({ type: 'open' });
  }

  closeParen() {
    if (this.errored) return this;
    if (this.committed !== null) return this;

    // Only closeable when a group is open at the caret and has content in it.
    if (this.closableDepth <= 0) return this;
    const left = this.before;
    if (!left || left.type === 'operator' || left.type === 'open') return this;

    return this.insert({ type: 'close' });
  }

  /**
   * The keypad has one parenthesis key. It closes when there is a group open
   * with something in it, and opens otherwise — which is what you want the
   * overwhelming majority of the time.
   */
  paren() {
    const { index, offset } = this.at();

    // Sitting just inside a bracket that is already closed, the key steps over
    // it the way it does in a text editor, rather than adding one that would
    // unbalance the expression.
    if (this.committed === null && offset === 0
      && this.tokens[index]?.type === 'close' && this.closableDepth <= 0) {
      this.caret += 1;
      return this;
    }

    const closeable = this.closableDepth > 0
      && this.committed === null
      && endsValue(this.before);
    return closeable ? this.closeParen() : this.openParen();
  }

  /**
   * Flip the sign of the number at the caret, by adding or removing a unary
   * minus in front of it. Reusing the sign token means "12 + −5" parses and
   * renders through the same path as a minus you typed yourself.
   */
  negate() {
    if (this.errored) return this;
    this.continueFromResult(true);

    const { index, offset } = this.at();
    const numberIndex = offset > 0 ? index : index - 1;
    if (this.tokens[numberIndex]?.type !== 'number') return this;

    const signIndex = numberIndex - 1;
    const sign = this.tokens[signIndex];
    const isSign = sign?.type === 'operator'
      && ADDITIVE.has(sign.op)
      && isUnaryAt(this.tokens, signIndex);

    if (isSign) {
      if (sign.op === 'subtract') {
        this.caret -= 1;
        this.tokens.splice(signIndex, 1);
      } else {
        sign.op = 'subtract';
      }
      return this;
    }

    this.tokens.splice(numberIndex, 0, { type: 'operator', op: 'subtract' });
    this.caret += 1;
    return this;
  }

  /**
   * A postfix — %, ², ⁻¹ — modifies the value the caret sits after, so it only
   * makes sense once there is one. They stack: 5²⁻¹ is a twenty-fifth.
   */
  postfix(type) {
    if (this.errored) return this;
    this.continueFromResult(true);

    if (!endsValue(this.before)) return this;
    return this.insert({ type });
  }

  percent() { return this.postfix('percent'); }

  square() { return this.postfix('square'); }

  reciprocal() { return this.postfix('reciprocal'); }

  /**
   * A constant is a value, so landing straight after another one multiplies —
   * the same way "2(3)" does.
   */
  constant(name) {
    if (!CONSTANTS[name]) return this;
    if (this.errored) this.reset();
    this.continueFromResult(false);

    return endsValue(this.before)
      ? this.insert({ type: 'operator', op: 'multiply' }, { type: 'constant', name })
      : this.insert({ type: 'constant', name });
  }

  /**
   * A function wraps the value already entered — "9" then √ is √(9), and a
   * finished result gets rooted rather than thrown away. A caret part-way
   * through a number takes that whole number rather than splitting it, since
   * half a number is not a value anyone means. With nothing to take, the
   * function opens its bracket and waits for one.
   */
  call(fn) {
    if (!FUNCTIONS[fn]) return this;
    if (this.errored) this.reset();
    this.continueFromResult(true);

    const start = this.valueStart();
    if (start === null) return this.insert({ type: 'function', fn }, { type: 'open' });
    if (this.tokens.length + 3 > MAX_TOKENS) return this;

    // A group already carries its own brackets, so the function goes in front
    // of it rather than adding a second pair.
    if (this.tokens[start].type === 'open') {
      this.tokens.splice(start, 0, { type: 'function', fn });
      this.caret += 1;
      return this;
    }

    const { index, offset } = this.at();
    const end = offset > 0 ? index + 1 : index;   // one past the value being wrapped
    this.tokens.splice(end, 0, { type: 'close' });
    this.tokens.splice(start, 0, { type: 'function', fn }, { type: 'open' });
    this.caret = caretMax(this.tokens.slice(0, end + 3));
    return this;
  }

  /**
   * Where the value the caret sits after starts, so a function can be wrapped
   * around exactly that much of it. Null when nothing there is a value.
   */
  valueStart() {
    const { index, offset } = this.at();
    let i = offset > 0 ? index : index - 1;

    // A postfix belongs to the value it modifies: √ of "5²" is √(5²).
    while (i >= 0 && POSTFIX_TYPES.has(this.tokens[i].type)) i -= 1;
    if (i < 0) return null;

    const type = this.tokens[i].type;
    if (type === 'number' || type === 'constant') return i;
    if (type !== 'close') return null;

    // A bracketed group is wrapped whole, along with the function on it.
    let depth = 0;
    for (; i >= 0; i -= 1) {
      if (this.tokens[i].type === 'close') depth += 1;
      else if (this.tokens[i].type === 'open' && (depth -= 1) === 0) break;
    }
    if (i < 0) return null;
    return i > 0 && this.tokens[i - 1].type === 'function' ? i - 1 : i;
  }

  equals() {
    if (this.errored) return this;
    if (this.committed !== null) return this; // Already a result; nothing to redo.
    if (!this.tokens.length) return this;

    const evaluated = normalize(this.tokens);
    const result = valueOf(this.tokens);

    if (result === null) return this;
    if (Number.isNaN(result)) {
      this.reset();
      this.errored = true;
      return this;
    }

    this.tokens = [{ type: 'number', text: String(result) }];
    this.caret = this.caretMax;
    this.committed = formatTokens(evaluated);
    // Kept separate from `tokens`, which now holds only the result.
    this.committedTokens = evaluated;
    return this;
  }

  /** Delete the one stop behind the caret. */
  backspace() {
    if (this.errored) { this.reset(); return this; }

    // Backspacing a result drops it and returns to an empty expression rather
    // than letting you edit digits that were computed, not typed.
    if (this.committed !== null) { this.reset(); return this; }

    const { index, offset } = this.at();

    // Each of these steps the caret back *before* shortening the expression:
    // the caret clamps to the current length on read, so moving it afterwards
    // would take it two stops instead of one.
    if (offset > 0) {
      const number = this.tokens[index];
      this.caret -= 1;
      number.text = number.text.slice(0, offset - 1) + number.text.slice(offset);
      if (!countDigits(number.text)) this.drop(index);
      return this;
    }

    if (index === 0) return this;   // the caret is already at the front

    const left = this.tokens[index - 1];
    if (left.type === 'number' && isPlainNumber(left.text) && left.text.length > 1) {
      this.caret -= 1;
      left.text = left.text.slice(0, -1);
      if (!countDigits(left.text)) this.drop(index - 1);
      return this;
    }

    this.caret -= tokenWidth(left);
    this.drop(index - 1);

    // "√(" arrived as one press, so it goes as one.
    if (left.type === 'open' && this.tokens[index - 2]?.type === 'function') {
      this.caret -= 1;
      this.drop(index - 2);
    }
    return this;
  }

  /** Take a token out, closing the gap it leaves between two numbers. */
  drop(index) {
    this.tokens.splice(index, 1);
    this.join(index);
  }

  /**
   * Replace the expression with one from elsewhere — a history row — so it can
   * be edited and run again. Tokens are copied, so editing here cannot reach
   * back into the history entry they came from.
   */
  loadTokens(tokens) {
    this.reset();
    this.tokens = tokens.slice(0, MAX_TOKENS).map((token) => ({ ...token }));
    this.caret = this.caretMax;
    return this;
  }

  /** Put a value from elsewhere — a history row — into the expression. */
  insertValue(value) {
    if (this.errored) this.reset();
    this.continueFromResult(false);

    const left = this.before;
    if (left?.type === 'number') return this; // A number is already being typed.
    return endsValue(left)
      ? this.insert({ type: 'operator', op: 'multiply' }, { type: 'number', text: String(value) })
      : this.insert({ type: 'number', text: String(value) });
  }

  clearAll() {
    this.reset();
    return this;
  }
}

function countDigits(text) {
  return text.replace(/[^0-9]/g, '').length;
}

/** True when a token completes a value, so what follows it multiplies. */
function endsValue(token) {
  return Boolean(token) && VALUE_ENDINGS.has(token.type);
}

/* ------------------------------------------------------------- formatting */

/** True when a +/− at this position is a sign rather than an operation. */
function isUnaryAt(tokens, index) {
  if (index === 0) return true;
  const before = tokens[index - 1];
  return before.type === 'operator' || before.type === 'open';
}

/**
 * The expression broken into displayable pieces. The UI uses this to draw
 * each operator as its own chip; formatTokens() joins the same pieces into
 * plain text.
 */
export function tokenParts(tokens) {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'number':
        return { kind: 'number', text: numberText(token.text) };
      case 'operator':
        return {
          kind: 'operator',
          text: OPERATORS[token.op],
          unary: isUnaryAt(tokens, index),
          // A caret reads as part of the number it lifts, so it gets no room
          // around it the way + and × do.
          tight: token.op === 'power',
        };
      case 'constant':
        return { kind: 'constant', text: CONSTANTS[token.name]?.symbol ?? '?' };
      case 'function':
        return { kind: 'function', text: FUNCTIONS[token.fn]?.symbol ?? '?' };
      case 'square':
        return { kind: 'postfix', text: '²' };
      case 'reciprocal':
        return { kind: 'postfix', text: '⁻¹' };
      case 'open':
        return { kind: 'paren', text: '(' };
      case 'close':
        return { kind: 'paren', text: ')' };
      case 'percent':
        return { kind: 'percent', text: '%' };
      default:
        return { kind: 'other', text: '' };
    }
  });
}

export function formatTokens(tokens) {
  return tokenParts(tokens)
    .map((part) => (part.kind === 'operator' && !part.unary && !part.tight ? ` ${part.text} ` : part.text))
    .join('');
}

/**
 * How a number appears inside an expression. An edit can leave one that is not
 * a number at all — deleting the operator between 1.2 and 3.4 joins them into
 * "1.23.4" — and that is shown as it stands, so it can be corrected a
 * character at a time rather than reading as the word Error.
 */
export function numberText(text) {
  return Number.isFinite(Number(text)) ? formatNumber(text) : text;
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
