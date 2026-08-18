import { Calculator, formatDisplay } from './calculator.js';
import { play, warmUp, soundLevel, cycleSoundLevel } from './feedback.js';
import { tap } from './haptics.js';
import { initUpdates, STATUS } from './update.js';

const calc = new Calculator();
const resultEl = document.getElementById('result');
const expressionEl = document.getElementById('expression');
const clearKey = document.getElementById('clearKey');
const keypad = document.getElementById('keypad');
const soundToggle = document.getElementById('soundToggle');
const versionChip = document.getElementById('versionChip');

// Looked up once: render() runs on every keypress and should not be querying.
const opKeys = [...keypad.querySelectorAll('[data-op]')];
const keysByAction = new Map();
const keysByDigit = new Map();
for (const key of keypad.querySelectorAll('.key')) {
  if (key.dataset.digit) keysByDigit.set(key.dataset.digit, key);
  else if (key.dataset.op) keysByAction.set(`op:${key.dataset.op}`, key);
  else keysByAction.set(key.dataset.action, key);
}

let lastClearLabel = '';
let lastExpression = '';

function render() {
  const state = calc.state();
  const text = formatDisplay(state.entry);

  resultEl.textContent = text;
  resultEl.classList.toggle('is-error', state.errored);
  resultEl.dataset.len = lengthBucket(text.length);

  // Skip the writes that would otherwise dirty layout on every single press.
  if (state.expression !== lastExpression) {
    expressionEl.textContent = state.expression;
    lastExpression = state.expression;
  }

  const label = state.hasClearableEntry ? 'C' : 'AC';
  if (label !== lastClearLabel) {
    clearKey.textContent = label;
    clearKey.setAttribute('aria-label', label === 'AC' ? 'All clear' : 'Clear entry');
    lastClearLabel = label;
  }

  for (const key of opKeys) {
    const active = !state.typing && calc.pendingOp === key.dataset.op;
    key.setAttribute('aria-pressed', String(active));
  }
}

function lengthBucket(length) {
  if (length <= 8) return 'lg';
  if (length <= 11) return 'md';
  if (length <= 15) return 'sm';
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
    case 'equals': calc.equals(); break;
    case 'clear': calc.clear(); break;
    case 'clearAll': calc.clearAll(); break;
    case 'negate': calc.negate(); break;
    case 'percent': calc.percent(); break;
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
let pressedKey = null;

keypad.addEventListener('pointerdown', (event) => {
  if (event.button > 0) return;
  const key = event.target.closest('.key');
  if (!key) return;
  lastPointerAt = event.timeStamp;

  // Safari only applies :active on touch under specific conditions, so the
  // pressed look is driven from here instead of relying on it.
  pressedKey = key;
  key.classList.add('is-pressed');

  warmUp();
  activate(key.dataset.action, key.dataset, true);
}, { passive: true });

/* Listened for on the window so a finger that slides off a key still releases
   it, rather than leaving the key stuck looking pressed. */
function releaseKey() {
  if (!pressedKey) return;
  pressedKey.classList.remove('is-pressed');
  pressedKey = null;
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
  Backspace: ['backspace', {}],
  Delete: ['clearAll', {}],
  Escape: ['clearAll', {}],
  c: ['clear', {}],
  C: ['clear', {}],
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
      : keysByAction.get(action === 'clearAll' ? 'clear' : action);

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

renderSoundToggle();
setChip(STATUS.IDLE);
render();
