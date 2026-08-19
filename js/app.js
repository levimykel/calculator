import { Calculator, formatNumber, tokenParts, isPlainNumber } from './calculator.js';
import {
  FIELDS, DEFAULTS, project, milestones, formatMoney, formatField, valueOfField, accepts,
} from './growth.js';
import { History } from './history.js';
import { play, warmUp, soundLevel, cycleSoundLevel } from './feedback.js';
import { tap } from './haptics.js';
import { initUpdates, STATUS } from './update.js';

const calc = new Calculator();
const resultEl = document.getElementById('result');
const entryLineEl = document.getElementById('entryLine');
const clearKey = document.getElementById('clearKey');
const starKey = document.getElementById('starKey');
const historyEl = document.getElementById('historyScroll');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const clearHistoryBtn = document.getElementById('clearHistory');
const expandBtn = document.getElementById('expandHistory');
const appEl = document.querySelector('.app');

const history = new History();
const keypad = document.getElementById('keypad');
const fxPad = document.getElementById('fxPad');
const fxToggle = document.getElementById('fxToggle');
const growthPad = document.getElementById('growthPad');
const modeToggle = document.getElementById('modeToggle');
const growthFieldsEl = document.getElementById('growthFields');
const growthBalanceEl = document.getElementById('growthBalance');
const growthSplitEl = document.getElementById('growthSplit');
const growthMarksEl = document.getElementById('growthMarks');
const soundToggle = document.getElementById('soundToggle');
const versionChip = document.getElementById('versionChip');

// Looked up once: render() runs on every keypress and should not be querying.
const keysByAction = new Map();
const keysByDigit = new Map();
const growthByDigit = new Map();
const growthByAction = new Map();

function indexKeys(selector, digits, actions) {
  for (const key of document.querySelectorAll(selector)) {
    if (key.dataset.digit) digits.set(key.dataset.digit, key);
    else if (key.dataset.op) actions.set(`op:${key.dataset.op}`, key);
    else if (key.dataset.constant) actions.set(`const:${key.dataset.constant}`, key);
    else actions.set(key.dataset.action, key);
  }
}

// Two indexes rather than one: both pads carry a "7", and a physical key
// should light the one that is on screen.
indexKeys('.keypad .key, .fxpad .key', keysByDigit, keysByAction);
indexKeys('.growthpad .key', growthByDigit, growthByAction);

let lastResult = null;
let lastEntry = null;
let lastClearMode = null;

function render() {
  const state = calc.state();

  // The big line is always a value, and the small line always the expression
  // behind it — the same shape as the history rows above.
  const result = state.errored
    ? 'Error'
    : state.preview !== null
      ? formatNumber(state.preview)
      : state.committed !== null
        ? formatNumber(state.tokens[0].text)
        : '0';

  if (result !== lastResult) {
    resultEl.textContent = result;
    resultEl.dataset.len = lengthBucket(result.length);
    resultEl.scrollLeft = resultEl.scrollWidth;
    lastResult = result;
  }

  // A caret that has moved changes the line without changing its text, so it
  // is part of what decides whether to redraw.
  const caret = showCaret(state) ? state.caret : null;
  const entry = state.errored ? '' : `${caret}\u0000${state.expression}`;
  if (entry !== lastEntry) {
    entryLineEl.replaceChildren(state.errored ? '' : expressionNodes(state.tokens, caret, true));
    scrollToCaret();
    lastEntry = entry;
  }

  resultEl.classList.toggle('is-error', state.errored);

  const newest = history.newest();
  starKey.disabled = newest === null;
  starKey.dataset.on = String(Boolean(newest && newest.favourite));

  // The bottom-left key deletes while there is something to delete, and is a
  // full clear otherwise. A committed result and an error both reset wholesale
  // rather than being editable, so those read as AC too.
  const mode = canBackspace(state) ? 'back' : 'clear';
  if (mode !== lastClearMode) {
    clearKey.dataset.mode = mode;
    clearKey.setAttribute('aria-label', mode === 'back' ? 'Delete' : 'All clear');
    lastClearMode = mode;
  }
}

function canBackspace(state) {
  // Nothing behind the caret is nothing to delete, so the key reads as AC.
  return !state.isEmpty && state.caret > 0 && state.committed === null && !state.errored;
}

/** A finished answer is not being edited, and neither is an empty line. */
function showCaret(state) {
  return !state.errored && !state.isEmpty && state.committed === null;
}

/** Keep the edit point in view, which for a fresh expression is its tail. */
function scrollToCaret() {
  const bar = entryLineEl.querySelector('.caret');
  if (!bar) {
    entryLineEl.scrollLeft = entryLineEl.scrollWidth;
    return;
  }
  const line = entryLineEl.getBoundingClientRect();
  const box = bar.getBoundingClientRect();
  const margin = 14;
  if (box.right > line.right - margin) entryLineEl.scrollLeft += box.right - line.right + margin;
  else if (box.left < line.left + margin) entryLineEl.scrollLeft -= line.left - box.left + margin;
}

function lengthBucket(length) {
  if (length <= 8) return 'lg';
  if (length <= 12) return 'md';
  if (length <= 16) return 'sm';
  return 'xs';
}

const SILENT = new Set(['caretLeft', 'caretRight', 'caretHome', 'caretEnd']);

/** What the growth screen answers to, and what only it answers to. */
const FIELD_ACTIONS = new Set(['nextField', 'previousField']);
const GROWTH_ACTIONS = new Set([
  'digit', 'decimal', 'backspace', 'clearOrBack', 'clearAll', 'equals', ...FIELD_ACTIONS,
]);

/** Which sound a key should make, or none for moving about. */
function voiceFor(action) {
  if (SILENT.has(action)) return null;
  if (action === 'equals') return 'equals';
  if (action === 'operator') return 'operator';
  if (action === 'digit' || action === 'decimal') return 'key';
  return 'fn';
}

function perform(action, dataset = {}) {
  if (mode === 'growth') return performGrowth(action, dataset);

  switch (action) {
    case 'digit': calc.digit(dataset.digit); break;
    case 'decimal': calc.decimal(); break;
    case 'operator': calc.operator(dataset.op); break;
    case 'equals': {
      const before = calc.state().committed;
      calc.equals();
      const after = calc.state();
      // Only a fresh evaluation is worth recording; pressing = on a result
      // that is already committed does nothing.
      if (after.committed !== null && after.committed !== before && !after.errored) {
        history.add({
          tokens: after.committedTokens,
          expression: after.committed,
          result: Number(after.tokens[0].text),
        });
        renderHistory();
      }
      break;
    }
    case 'clearAll': calc.clearAll(); break;
    case 'negate': calc.negate(); break;
    case 'percent': calc.percent(); break;
    case 'paren': calc.paren(); break;
    case 'star': starNewest(); break;
    case 'clearOrBack':
      if (canBackspace(calc.state())) calc.backspace();
      else calc.clearAll();
      break;
    case 'square': calc.square(); break;
    case 'reciprocal': calc.reciprocal(); break;
    case 'sqrt': calc.call('sqrt'); break;
    case 'constant': calc.constant(dataset.constant); break;
    case 'caretLeft': calc.moveCaret(-1); break;
    case 'caretRight': calc.moveCaret(1); break;
    case 'caretHome': calc.caretHome(); break;
    case 'caretEnd': calc.caretEnd(); break;
    case 'openParen': calc.openParen(); break;
    case 'closeParen': calc.closeParen(); break;
    case 'backspace': calc.backspace(); break;
    default: return;
  }
  render();
}

/** A key press: feedback first so it lands with the touch, then the maths. */
function activate(action, dataset, withHaptics) {
  const voice = voiceFor(action);
  if (voice) play(voice);
  if (withHaptics && voice) tap();
  setHistoryExpanded(false);
  perform(action, dataset);
}

/* Keys fire on pointerdown rather than click. A click only arrives once the
   browser has decided the touch was not a scroll or a double-tap, which is
   what made the keypad feel a beat behind the finger. */
let lastPointerAt = 0;
// Keyed by pointer id: two fingers on two keys means two live presses, and
// releasing one must not leave the other stuck looking pressed.
const pressedKeys = new Map();

function bindKeys(pad) {
  pad.addEventListener('pointerdown', onPadPointerDown, { passive: true });
  pad.addEventListener('click', onPadClick);
}

function onPadPointerDown(event) {
  if (event.button > 0) return;
  const key = event.target.closest('.key');
  if (!key) return;
  lastPointerAt = event.timeStamp;

  // Safari only applies :active on touch under specific conditions, so the
  // pressed look is driven from here instead of relying on it.
  pressedKeys.set(event.pointerId, key);
  key.classList.add('is-pressed');

  warmUp();
  activate(key.dataset.action, key.dataset, true);
}

/* Listened for on the window so a finger that slides off a key still releases
   it, rather than leaving the key stuck looking pressed. */
function releaseKey(event) {
  const key = pressedKeys.get(event.pointerId);
  if (key) {
    key.classList.remove('is-pressed');
    pressedKeys.delete(event.pointerId);
  }
}

window.addEventListener('pointerup', releaseKey, { passive: true });
window.addEventListener('pointercancel', releaseKey, { passive: true });

/* Still needed for Space/Enter on a focused key, which produce a click with no
   pointer event. The timestamp guard stops a real tap counting twice. */
function onPadClick(event) {
  const key = event.target.closest('.key');
  if (!key) return;
  if (event.timeStamp - lastPointerAt < 700) return;
  activate(key.dataset.action, key.dataset, false);
}

bindKeys(keypad);
bindKeys(fxPad);
bindKeys(growthPad);

/* ------------------------------------------------------------- functions */

/* The fx row is remembered between launches: someone who uses powers wants it
   there every time, and someone who does not never sees it. */
const FX_KEY = 'calcutron.fx';
let fxOpen = readFxPreference();

function readFxPreference() {
  try {
    return localStorage.getItem(FX_KEY) === 'open';
  } catch {
    return false;
  }
}

function setFxOpen(next) {
  fxOpen = next;
  fxPad.hidden = !next;
  appEl.dataset.fx = next ? 'open' : 'closed';
  fxToggle.setAttribute('aria-expanded', String(next));
  fxToggle.setAttribute('aria-label', next ? 'Hide more functions' : 'Show more functions');
  try {
    localStorage.setItem(FX_KEY, next ? 'open' : 'closed');
  } catch {
    // Private browsing with no storage: the row still works, it just forgets.
  }
}

setFxOpen(fxOpen);

fxToggle.addEventListener('click', () => {
  play('fn');
  tap();
  setFxOpen(!fxOpen);
});

/* ------------------------------------------------------------- history */

/* Expanding hands the keypad's room to the history, for looking further back. */
let historyExpanded = false;

function setHistoryExpanded(next) {
  const wanted = next && history.length > 0;
  if (wanted === historyExpanded) return;
  historyExpanded = wanted;
  appEl.dataset.history = historyExpanded ? 'expanded' : 'collapsed';
  expandBtn.setAttribute('aria-expanded', String(historyExpanded));
  expandBtn.setAttribute('aria-label', historyExpanded ? 'Show less history' : 'Show more history');
  // Keep the newest row against the display, where it was before expanding.
  historyEl.scrollTop = historyEl.scrollHeight;
}

expandBtn.addEventListener('click', () => {
  play('fn');
  tap();
  setHistoryExpanded(!historyExpanded);
});

function starNewest() {
  const newest = history.newest();
  if (!newest) return;
  history.toggleFavourite(newest.id);
  renderHistory();
}

/**
 * Build one expression as text nodes plus operator chips, with the caret drawn
 * in at its position. A number is emitted a character at a time so the caret
 * can land between two digits.
 *
 * `positions` gives every caret stop an element of its own, tagged with where
 * it starts, so a tap can be measured against its two edges. The live
 * expression asks for that; the history rows, which are not edited in place,
 * do not and stay as plain text.
 */
function expressionNodes(tokens, caret = null, positions = false) {
  const fragment = document.createDocumentFragment();
  const parts = tokenParts(tokens);
  let pos = 0;
  let last = null;

  const caretHere = () => {
    if (pos !== caret) return;
    const bar = document.createElement('span');
    bar.className = 'caret';
    fragment.append(bar);
  };

  const atom = (text, className) => {
    caretHere();
    if (positions || className) {
      const span = document.createElement('span');
      if (className) span.className = className;
      if (positions) span.dataset.pos = String(pos);
      span.textContent = text;
      last = span;
    } else {
      last = document.createTextNode(text);
    }
    fragment.append(last);
    pos += 1;
  };

  tokens.forEach((token, index) => {
    const part = parts[index];

    if (token.type === 'number' && isPlainNumber(token.text)) {
      for (const character of part.text) {
        // A grouping comma is not a stop of its own. It rides along with the
        // digit before it, which keeps the tappable boxes edge to edge.
        if (character === ',') {
          if (last instanceof Element) last.append(',');
          else fragment.append(',');
          continue;
        }
        atom(character);
      }
      return;
    }

    // A sign belongs to its number, and a caret to the power it makes; only
    // the operators that separate two terms get a chip of their own.
    const chip = part.kind === 'operator' && !part.unary && !part.tight;
    atom(part.text, chip ? 'chip-op' : null);
  });

  caretHere();
  return fragment;
}

/** The caret stop nearest a point across the expression, or null if empty. */
function caretPositionAt(clientX) {
  let nearest = null;
  let shortest = Infinity;

  for (const atom of entryLineEl.querySelectorAll('[data-pos]')) {
    const box = atom.getBoundingClientRect();
    const start = Number(atom.dataset.pos);
    // Either side of a stop is a place the caret can go.
    for (const [edge, position] of [[box.left, start], [box.right, start + 1]]) {
      const gap = Math.abs(edge - clientX);
      if (gap < shortest) {
        shortest = gap;
        nearest = position;
      }
    }
  }

  return nearest;
}

/* Tapping the expression puts the caret where you tapped. On pointerdown like
   the keys, since it is the same kind of press — and it clicks, where the
   arrow keys stay silent: those repeat when held, a tap does not. */
entryLineEl.addEventListener('pointerdown', (event) => {
  if (event.button > 0) return;
  const position = caretPositionAt(event.clientX);
  if (position === null) return;

  warmUp();
  play('fn');
  tap();
  calc.caretTo(position);
  render();
}, { passive: true });

function renderHistory() {
  const entries = history.list();

  historyEmpty.hidden = entries.length > 0;
  clearHistoryBtn.hidden = entries.length === 0;
  expandBtn.hidden = entries.length === 0;
  if (entries.length === 0) setHistoryExpanded(false);
  historyList.replaceChildren();

  // Oldest first, so the newest ends up nearest the display — which is also
  // where the scroll rests.
  for (const entry of [...entries].reverse()) {
    const row = document.createElement('li');
    row.className = 'entry';
    row.dataset.id = entry.id;

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'entry__star';
    star.dataset.star = entry.id;
    star.setAttribute('aria-pressed', String(entry.favourite));
    star.setAttribute('aria-label', entry.favourite ? 'Unstar this calculation' : 'Star this calculation');
    star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>';

    // Two targets, mapped to what they show: the number gives you its value,
    // the expression below gives you the calculation to edit and run again.
    const body = document.createElement('div');
    body.className = 'entry__body';

    const result = document.createElement('button');
    result.type = 'button';
    result.className = 'entry__result';
    result.dataset.useResult = entry.id;
    result.textContent = formatNumber(entry.result);
    result.setAttribute('aria-label', `Use the value ${formatNumber(entry.result)}`);

    const expression = document.createElement('button');
    expression.type = 'button';
    expression.className = 'entry__expression';
    expression.dataset.useExpression = entry.id;
    expression.setAttribute('aria-label', `Edit the calculation ${entry.expression}`);
    expression.append(expressionNodes(entry.tokens));

    body.append(result, expression);
    row.append(star, body);
    historyList.append(row);
  }

  historyEl.scrollTop = historyEl.scrollHeight;
}

historyEl.addEventListener('click', (event) => {
  const star = event.target.closest('[data-star]');
  if (star) {
    history.toggleFavourite(star.dataset.star);
    play('fn');
    tap();
    renderHistory();
    render();
    return;
  }

  const useResult = event.target.closest('[data-use-result]');
  const useExpression = event.target.closest('[data-use-expression]');
  const target = useResult || useExpression;
  if (!target) return;

  const entry = history.find(useResult ? useResult.dataset.useResult : useExpression.dataset.useExpression);
  if (!entry) return;

  warmUp();
  play('key');
  tap();
  if (useResult) calc.insertValue(entry.result);
  else calc.loadTokens(entry.tokens);
  setHistoryExpanded(false);
  render();
});

clearHistoryBtn.addEventListener('click', () => {
  history.clear();
  play('fn');
  tap();
  renderHistory();
  render();
});

/* Keyboard support, for the iPad's hardware keyboard and for desktop. */
const KEY_MAP = {
  '+': ['operator', { op: 'add' }],
  '-': ['operator', { op: 'subtract' }],
  '*': ['operator', { op: 'multiply' }],
  x: ['operator', { op: 'multiply' }],
  X: ['operator', { op: 'multiply' }],
  '/': ['operator', { op: 'divide' }],
  '=': ['equals', {}],
  Enter: ['equals', {}],
  '.': ['decimal', {}],
  ',': ['decimal', {}],
  '%': ['percent', {}],
  '(': ['openParen', {}],
  ')': ['closeParen', {}],
  Backspace: ['backspace', {}],
  Delete: ['clearAll', {}],
  Escape: ['clearAll', {}],
  c: ['clearAll', {}],
  C: ['clearAll', {}],
  n: ['negate', {}],
  N: ['negate', {}],
  ArrowLeft: ['caretLeft', {}],
  ArrowRight: ['caretRight', {}],
  Home: ['caretHome', {}],
  End: ['caretEnd', {}],
  ArrowUp: ['previousField', {}],
  ArrowDown: ['nextField', {}],
  '^': ['operator', { op: 'power' }],
  r: ['sqrt', {}],
  R: ['sqrt', {}],
  p: ['constant', { constant: 'pi' }],
  P: ['constant', { constant: 'pi' }],
};

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key;
  let action;
  let payload = {};

  if (key >= '0' && key <= '9') {
    action = 'digit';
    payload = { digit: key };
  } else if (KEY_MAP[key]) {
    [action, payload] = KEY_MAP[key];
  } else {
    return;
  }

  // Each screen answers to its own keys. Letting the others through would
  // click and flash for a press that could not do anything.
  if (mode === 'growth' ? !GROWTH_ACTIONS.has(action) : FIELD_ACTIONS.has(action)) return;

  event.preventDefault();
  warmUp();
  activate(action, payload, false);
  flash(action, payload);
});

/** Light up the on-screen key that matches a physical keypress. */
function keyFor(action, payload) {
  if (mode === 'growth') {
    return action === 'digit'
      ? growthByDigit.get(payload.digit)
      : growthByAction.get(action);
  }
  if (action === 'digit') return keysByDigit.get(payload.digit);
  if (action === 'operator') return keysByAction.get(`op:${payload.op}`);
  if (action === 'constant') return keysByAction.get(`const:${payload.constant}`);
  // Both faces of the bottom-left key answer to the one element.
  if (action === 'backspace' || action === 'clearAll') return clearKey;
  return keysByAction.get(action);
}

function flash(action, payload) {
  const key = keyFor(action, payload);
  if (!key) return;
  key.classList.add('is-pressed');
  setTimeout(() => key.classList.remove('is-pressed'), 110);
}

/* Swipe left/right across the display deletes the last digit, like iOS. */
const display = document.querySelector('.display');
let touchStartX = null;

display.addEventListener('touchstart', (event) => {
  touchStartX = event.changedTouches[0].clientX;
}, { passive: true });

display.addEventListener('touchend', (event) => {
  if (touchStartX === null) return;
  const dx = event.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(dx) > 40) {
    play('fn');
    tap();
    perform('backspace');
  }
}, { passive: true });

/* Sound level. One button, cycling soft -> loud -> off. */
const SOUND_LABELS = {
  soft: 'Key sounds: soft. Tap for louder.',
  loud: 'Key sounds: loud. Tap to turn off.',
  off: 'Key sounds off. Tap for soft.',
};

function renderSoundToggle() {
  const current = soundLevel();
  soundToggle.dataset.level = current;
  soundToggle.setAttribute('aria-label', SOUND_LABELS[current]);
}

soundToggle.addEventListener('click', () => {
  cycleSoundLevel();
  renderSoundToggle();
  tap();
  play('fn'); // Doubles as a preview of the level just selected.
});

/* Version chip: shows the running version, checks for and applies updates. */
const VERSION = window.APP_VERSION || '0.0.0';
let chipState = STATUS.IDLE;
let revertTimer = null;

function setChip(state) {
  chipState = state;
  clearTimeout(revertTimer);

  switch (state) {
    case STATUS.CHECKING:
      versionChip.textContent = 'Checking…';
      versionChip.disabled = true;
      break;
    case STATUS.READY:
      versionChip.textContent = 'Update ready';
      versionChip.disabled = false;
      break;
    case STATUS.CURRENT:
      versionChip.textContent = 'Up to date';
      versionChip.disabled = false;
      revertTimer = setTimeout(() => setChip(STATUS.IDLE), 2200);
      break;
    default:
      versionChip.textContent = `v${VERSION}`;
      versionChip.disabled = false;
  }

  versionChip.dataset.state = state;
}

const updates = initUpdates(setChip);

versionChip.addEventListener('click', () => {
  tap();
  if (chipState === STATUS.READY) {
    versionChip.textContent = 'Updating…';
    versionChip.disabled = true;
    updates.apply();
    return;
  }
  updates.check();
});

/* ---------------------------------------------------------------- growth */

/* Four numbers, typed the same way as everything else in the app rather than
   through form fields that would bring up the system keyboard on top of a
   keypad. Each field holds the characters typed into it; the projection is
   recomputed on every press, so there is nothing to submit. */
const GROWTH_KEY = 'calcutron.growth';
const MODE_KEY = 'calcutron.mode';

const entries = FIELDS.map(({ key }) => [key, String(DEFAULTS[key])]);
let growth = Object.fromEntries(entries);
let activeField = FIELDS[0].key;
let mode = 'calc';

const fieldButtons = new Map();

function readStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing with no storage: it works, it just forgets.
  }
}

function loadGrowth() {
  try {
    const saved = JSON.parse(readStored(GROWTH_KEY, 'null'));
    if (!saved) return;
    for (const { key } of FIELDS) {
      const raw = saved[key];
      // Anything the fields would not accept today is dropped rather than
      // trusted: what is in storage was written by an older version.
      if (typeof raw === 'string' && accepts(key, raw)) growth[key] = raw;
    }
  } catch {
    growth = Object.fromEntries(entries);
  }
}

function buildFields() {
  for (const spec of FIELDS) {
    const button = document.createElement('button');
    button.className = 'field';
    button.type = 'button';
    button.dataset.field = spec.key;

    const label = document.createElement('span');
    label.className = 'field__label';
    label.textContent = spec.label;

    const value = document.createElement('span');
    value.className = 'field__value';

    button.append(label, value);
    growthFieldsEl.append(button);
    fieldButtons.set(spec.key, { button, value });
  }
}

function renderGrowth() {
  for (const spec of FIELDS) {
    const { button, value } = fieldButtons.get(spec.key);
    value.textContent = formatField(spec.kind, growth[spec.key]);
    button.setAttribute('aria-current', String(spec.key === activeField));
    button.setAttribute('aria-label', `${spec.label}: ${value.textContent}`);
  }

  const numbers = Object.fromEntries(
    FIELDS.map(({ key }) => [key, valueOfField(growth[key])]),
  );
  const result = project(numbers);

  growthBalanceEl.textContent = formatMoney(result.balance);
  growthSplitEl.textContent =
    `${formatMoney(result.contributed)} in · ${formatMoney(result.growth)} growth`;

  growthMarksEl.replaceChildren();
  for (const { year, balance } of milestones(result)) {
    const chip = document.createElement('span');
    chip.className = 'mark-chip';
    const when = document.createElement('b');
    when.textContent = `${year}y`;
    chip.append(when, formatMoney(balance));
    growthMarksEl.append(chip);
  }

  store(GROWTH_KEY, JSON.stringify(growth));
}

function focusField(key) {
  activeField = key;
  renderGrowth();
}

function stepField(by) {
  const at = FIELDS.findIndex(({ key }) => key === activeField);
  const next = (at + by + FIELDS.length) % FIELDS.length;
  focusField(FIELDS[next].key);
}

/** An edit only lands if the field will hold the result. */
function editField(rewrite) {
  const raw = rewrite(growth[activeField]);
  if (accepts(activeField, raw)) growth[activeField] = raw;
  renderGrowth();
}

function performGrowth(action, dataset) {
  switch (action) {
    // A field showing a lone zero is a field waiting to be replaced.
    case 'digit':
      editField((raw) => (raw === '0' ? dataset.digit : raw + dataset.digit));
      break;
    case 'decimal':
      editField((raw) => (raw.includes('.') ? raw : `${raw || '0'}.`));
      break;
    case 'backspace':
    case 'clearOrBack':
      editField((raw) => raw.slice(0, -1));
      break;
    case 'clearAll':
      editField(() => '');
      break;
    case 'nextField':
    case 'equals':
      stepField(1);
      break;
    case 'previousField':
      stepField(-1);
      break;
    default:
      // The calculator's own keys mean nothing here.
  }
}

growthFieldsEl.addEventListener('pointerdown', (event) => {
  if (event.button > 0) return;
  const button = event.target.closest('.field');
  if (!button) return;

  button.classList.add('is-pressed');
  pressedKeys.set(event.pointerId, button);
  warmUp();
  play('fn');
  tap();
  focusField(button.dataset.field);
}, { passive: true });

function setMode(next) {
  mode = next;
  appEl.dataset.mode = next;
  modeToggle.textContent = next === 'growth' ? 'Calc' : 'Growth';
  modeToggle.setAttribute(
    'aria-label',
    next === 'growth' ? 'Switch to the calculator' : 'Switch to the growth calculator',
  );
  store(MODE_KEY, next);
  if (next === 'growth') renderGrowth();
  else render();
}

modeToggle.addEventListener('click', () => {
  play('fn');
  tap();
  setHistoryExpanded(false);
  setMode(mode === 'growth' ? 'calc' : 'growth');
});

loadGrowth();
buildFields();
renderGrowth();

renderSoundToggle();
setChip(STATUS.IDLE);
renderHistory();
render();
setMode(readStored(MODE_KEY, 'calc') === 'growth' ? 'growth' : 'calc');
