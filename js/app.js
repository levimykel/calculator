import { Calculator, formatDisplay } from './calculator.js';

const calc = new Calculator();
const resultEl = document.getElementById('result');
const expressionEl = document.getElementById('expression');
const clearKey = document.getElementById('clearKey');
const keypad = document.getElementById('keypad');

function render() {
  const state = calc.state();
  const text = formatDisplay(state.entry);

  resultEl.textContent = text;
  resultEl.classList.toggle('is-error', state.errored);
  expressionEl.textContent = state.expression;

  // AC wipes everything; C only clears what is being typed.
  const label = state.hasClearableEntry ? 'C' : 'AC';
  clearKey.textContent = label;
  clearKey.setAttribute('aria-label', label === 'AC' ? 'All clear' : 'Clear entry');

  // Long answers shrink to stay on one line; the CSS owns the actual sizes.
  resultEl.dataset.len = lengthBucket(text.length);

  // Highlight the operator waiting for its right-hand side.
  for (const key of keypad.querySelectorAll('[data-op]')) {
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

keypad.addEventListener('click', (event) => {
  const key = event.target.closest('.key');
  if (!key) return;
  perform(key.dataset.action, key.dataset);
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
  perform(action, payload);
  flash(action, payload);
});

/** Light up the on-screen key that matches a physical keypress. */
function flash(action, payload) {
  const selector = action === 'digit'
    ? `[data-digit="${payload.digit}"]`
    : action === 'operator'
      ? `[data-op="${payload.op}"]`
      : `[data-action="${action === 'clearAll' ? 'clear' : action}"]`;

  const key = keypad.querySelector(selector);
  if (!key) return;
  key.classList.add('is-pressed');
  setTimeout(() => key.classList.remove('is-pressed'), 110);
}

/* Swipe left/right across the display deletes the last digit, like iOS. */
let touchStartX = null;
const display = document.querySelector('.display');
display.addEventListener('touchstart', (event) => {
  touchStartX = event.changedTouches[0].clientX;
}, { passive: true });
display.addEventListener('touchend', (event) => {
  if (touchStartX === null) return;
  const dx = event.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(dx) > 40) perform('backspace');
}, { passive: true });

/* Double-tap zoom still slips through on older iOS; block the second tap. */
let lastTouchEnd = 0;
document.addEventListener('touchend', (event) => {
  const now = Date.now();
  if (now - lastTouchEnd < 300) event.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offline support is a bonus; the calculator works without it. */
    });
  });
}
