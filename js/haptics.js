/**
 * Light haptic feedback on key presses.
 *
 * There is no straightforward way to do this on iOS. Safari does not implement
 * the Vibration API on any platform, so `navigator.vibrate` is simply absent on
 * an iPhone. The only lever Safari exposes is a side effect: toggling a
 * `<input type="checkbox" switch>` (Safari 17.4+) plays the system switch
 * haptic. Driving a hidden switch is therefore the iOS path here.
 *
 * That is a side effect Apple never promised to keep, so treat it as
 * best-effort: if it stops working, or the phone has haptics turned off in
 * Settings, presses stay silent and nothing else breaks.
 */

let iosSwitch = null;
let iosLabel = null;

const supportsVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** Safari exposes `switch` as a property on the input element once supported. */
const supportsSwitch = (() => {
  if (typeof document === 'undefined') return false;
  try {
    return 'switch' in document.createElement('input');
  } catch {
    return false;
  }
})();

export function hapticsAvailable() {
  return supportsVibrate || supportsSwitch;
}

export function tap() {
  if (supportsVibrate) {
    // A very short pulse; long enough to feel, short enough not to buzz.
    navigator.vibrate(8);
    return;
  }
  if (supportsSwitch) toggleSwitch();
}

function toggleSwitch() {
  if (!iosLabel) build();
  if (!iosLabel) return;
  // The haptic comes from the switch changing state, so alternate every press.
  iosLabel.click();
}

function build() {
  try {
    iosSwitch = document.createElement('input');
    iosSwitch.type = 'checkbox';
    iosSwitch.setAttribute('switch', '');
    iosSwitch.id = 'calcutron-haptic-switch';
    iosSwitch.tabIndex = -1;
    iosSwitch.setAttribute('aria-hidden', 'true');

    iosLabel = document.createElement('label');
    iosLabel.setAttribute('for', iosSwitch.id);
    iosLabel.setAttribute('aria-hidden', 'true');

    // Must stay rendered — `display: none` or `hidden` kills the haptic — so
    // it is parked offscreen and made untouchable instead.
    for (const el of [iosSwitch, iosLabel]) {
      el.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;appearance:none;-webkit-appearance:none;';
    }

    document.body.append(iosSwitch, iosLabel);
  } catch {
    iosSwitch = null;
    iosLabel = null;
  }
}
