import { Calculator, formatNumber } from './calculator.js';
import { play, warmUp, soundLevel, cycleSoundLevel } from './feedback.js';
import { tap } from './haptics.js';
import { initUpdates, STATUS } from './update.js';

const calc = new Calculator();
const expressionEl = document.getElementById('expression');
const previewEl = document.getElementById('preview');
const backspaceKey = document.getElementById('backspaceKey');
const keypad = document.getElementById('keypad');
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

let lastExpression = null;
let lastPreview = null;

function render() {
  const state = calc.state();

  // While typing, the big line is the expression itself; once you press equals
  // the result takes that place and the expression it came from moves below.
  const main = state.errored
    ? 'Error'
    : state.isEmpty ? '0' : state.expression;

  if (main !== lastExpression) {
    expressionEl.textContent = main;
    expressionEl.dataset.len = lengthBucket(main.length);
    lastExpression = main;
    // Keep the tail of a long expression in view, where the typing is.
    expressionEl.scrollLeft = expressionEl.scrollWidth;
  }

  const preview = state.errored
    ? ''
    : state.committed !== null
      ? `${state.committed} =`
      : state.preview === null ? '' : `= ${formatNumber(state.preview)}`;

  if (preview !== lastPreview) {
    previewEl.textContent = preview;
    previewEl.scrollLeft = previewEl.scrollWidth;
    lastPreview = preview;
  }

  expressionEl.classList.toggle('is-error', state.errored);
  expressionEl.classList.toggle('is-result', state.committed !== null);
  backspaceKey.disabled = state.isEmpty && state.committed === null && !state.errored;
}

/**
 * Size buckets for the main line. Tuned so that a full-length result — 15
 * significant digits plus separators and a sign, about 20 characters — still
 * fits the narrowest phone. Expressions longer than that scroll instead.
 */
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
    case 'equals': calc.equals(); break;
    case 'clearAll': calc.clearAll(); break;
    case 'negate': calc.negate(); break;
    case 'percent': calc.percent(); break;
    case 'paren': calc.paren(); break;
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

backspaceKey.addEventListener('pointerdown', (event) => {
  if (event.button > 0 || backspaceKey.disabled) return;
  lastPointerAt = event.timeStamp;
  warmUp();
  activate('backspace', {}, true);
}, { passive: true });

backspaceKey.addEventListener('click', (event) => {
  if (event.timeStamp - lastPointerAt < 700) return;
  activate('backspace', {}, false);
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
        : action === 'backspace'
          ? backspaceKey
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
