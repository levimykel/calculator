import { Calculator, formatNumber, tokenParts } from './calculator.js';
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

const history = new History();
const keypad = document.getElementById('keypad');
const diagEl = document.getElementById('diag');

/**
 * Take back any space left under the keypad. The layout should already end
 * flush with the viewport, but iOS has been known to lay a standalone app out
 * a little short, and this costs nothing when there is nothing to reclaim.
 */
function settle() {
  keypad.style.setProperty('--pull', '0px');
  const slack = window.innerHeight - keypad.getBoundingClientRect().bottom;
  keypad.style.setProperty('--pull', `${Math.max(0, Math.round(slack))}px`);
  if (!diagEl.hidden) diagEl.textContent = layoutReport();
}

window.addEventListener('resize', settle);
window.addEventListener('orientationchange', () => setTimeout(settle, 150));

/** Measure a safe-area inset by asking the browser to size an element by it. */
function measureInset(side) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-${side})`;
  document.body.append(probe);
  const value = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return value;
}

function layoutReport() {
  const keys = keypad.getBoundingClientRect();
  const app = document.querySelector('.app').getBoundingClientRect();
  const screenH = window.screen ? window.screen.height : 0;
  return [
    `viewport ${window.innerHeight}  screen ${screenH}`,
    `app ${Math.round(app.top)}→${Math.round(app.bottom)}  keys→${Math.round(keys.bottom)}`,
    `slack ${Math.round(window.innerHeight - keys.bottom)}  inset t${measureInset('top')} b${measureInset('bottom')}`,
    `standalone ${navigator.standalone === true} / ${window.matchMedia('(display-mode: standalone)').matches}`,
  ].join('\n');
}
const soundToggle = document.getElementById('soundToggle');
const versionChip = document.getElementById('versionChip');

// Looked up once: render() runs on every keypress and should not be querying.
const keysByAction = new Map();
const keysByDigit = new Map();
for (const key of keypad.querySelectorAll('.key')) {
  if (key.dataset.digit) keysByDigit.set(key.dataset.digit, key);
  else if (key.dataset.op) keysByAction.set(`op:${key.dataset.op}`, key);
  else keysByAction.set(key.dataset.action, key);
}

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

  const entry = state.errored ? '' : state.expression;
  if (entry !== lastEntry) {
    entryLineEl.replaceChildren(state.errored ? '' : expressionNodes(state.tokens));
    // Keep the tail of a long expression in view, where the typing is.
    entryLineEl.scrollLeft = entryLineEl.scrollWidth;
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
  return !state.isEmpty && state.committed === null && !state.errored;
}

function lengthBucket(length) {
  if (length <= 8) return 'lg';
  if (length <= 12) return 'md';
  if (length <= 16) return 'sm';
  return 'xs';
}

/** Which sound a key should make. */
function voiceFor(action) {
  if (action === 'equals') return 'equals';
  if (action === 'operator') return 'operator';
  if (action === 'digit' || action === 'decimal') return 'key';
  return 'fn';
}

function perform(action, dataset = {}) {
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
    case 'openParen': calc.openParen(); break;
    case 'closeParen': calc.closeParen(); break;
    case 'backspace': calc.backspace(); break;
    default: return;
  }
  render();
}

/** A key press: feedback first so it lands with the touch, then the maths. */
function activate(action, dataset, withHaptics) {
  play(voiceFor(action));
  if (withHaptics) tap();
  perform(action, dataset);
}

/* Keys fire on pointerdown rather than click. A click only arrives once the
   browser has decided the touch was not a scroll or a double-tap, which is
   what made the keypad feel a beat behind the finger. */
let lastPointerAt = 0;
// Keyed by pointer id: two fingers on two keys means two live presses, and
// releasing one must not leave the other stuck looking pressed.
const pressedKeys = new Map();

keypad.addEventListener('pointerdown', (event) => {
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
}, { passive: true });

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
keypad.addEventListener('click', (event) => {
  const key = event.target.closest('.key');
  if (!key) return;
  if (event.timeStamp - lastPointerAt < 700) return;
  activate(key.dataset.action, key.dataset, false);
});

/* ------------------------------------------------------------- history */

function starNewest() {
  const newest = history.newest();
  if (!newest) return;
  history.toggleFavourite(newest.id);
  renderHistory();
}

/** Build one expression as text nodes plus operator chips. */
function expressionNodes(tokens) {
  const fragment = document.createDocumentFragment();
  for (const part of tokenParts(tokens)) {
    if (part.kind === 'operator' && !part.unary) {
      const chip = document.createElement('span');
      chip.className = 'chip-op';
      chip.textContent = part.text;
      fragment.append(chip);
      continue;
    }
    fragment.append(document.createTextNode(part.text));
  }
  return fragment;
}

function renderHistory() {
  const entries = history.list();

  historyEmpty.hidden = entries.length > 0;
  clearHistoryBtn.hidden = entries.length === 0;
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

    const recall = document.createElement('button');
    recall.type = 'button';
    recall.className = 'entry__recall';
    recall.dataset.recall = entry.id;
    recall.setAttribute('aria-label', `Use ${formatNumber(entry.result)} from ${entry.expression}`);

    const result = document.createElement('span');
    result.className = 'entry__result';
    result.textContent = formatNumber(entry.result);

    const expression = document.createElement('span');
    expression.className = 'entry__expression';
    expression.append(expressionNodes(entry.tokens));

    recall.append(result, expression);
    row.append(star, recall);
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

  const recall = event.target.closest('[data-recall]');
  if (!recall) return;
  const entry = history.find(recall.dataset.recall);
  if (!entry) return;
  warmUp();
  play('key');
  tap();
  calc.insertValue(entry.result);
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

  event.preventDefault();
  warmUp();
  activate(action, payload, false);
  flash(action, payload);
});

/** Light up the on-screen key that matches a physical keypress. */
function flash(action, payload) {
  const key = action === 'digit'
    ? keysByDigit.get(payload.digit)
    : action === 'operator'
      ? keysByAction.get(`op:${payload.op}`)
      : action === 'openParen' || action === 'closeParen'
        ? keysByAction.get('paren')
        : action === 'backspace' || action === 'clearAll'
          ? clearKey
          : keysByAction.get(action);

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

/* Long-press anywhere in the header for the layout numbers. The whole bar is
   the target rather than just the chip, since a small chip is easy to miss. */
let holdTimer = null;
let heldOpen = false;
const topbarEl = document.querySelector('.topbar');

topbarEl.addEventListener('pointerdown', (event) => {
  if (event.target.closest('#soundToggle')) return;
  heldOpen = false;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    heldOpen = true;
    diagEl.hidden = !diagEl.hidden;
    if (!diagEl.hidden) diagEl.textContent = layoutReport();
    tap();
  }, 500);
});

/* Only a lifted finger or an abandoned gesture ends the press. Watching
   pointerleave as well would cancel on the slightest drift off the target,
   which on a touch screen is most presses. */
for (const event of ['pointerup', 'pointercancel']) {
  window.addEventListener(event, () => clearTimeout(holdTimer));
}

versionChip.addEventListener('click', () => {
  if (heldOpen) { heldOpen = false; return; } // that press was the long-press
  tap();
  if (chipState === STATUS.READY) {
    versionChip.textContent = 'Updating…';
    versionChip.disabled = true;
    updates.apply();
    return;
  }
  updates.check();
});

renderSoundToggle();
setChip(STATUS.IDLE);
renderHistory();
render();
settle();
