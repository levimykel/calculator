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
let host = null;

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
    // The switch must render as a real, native switch control — that native
    // control is what produces the haptic. So it keeps its default appearance
    // and its natural size, and is hidden by clipping it inside a 1px box
    // rather than by restyling or resizing the control itself.
    //
    // The first version of this set `appearance: none` and forced the switch
    // to 1x1, which stripped the native control and produced no haptic at all.
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:fixed;bottom:0;left:0;width:1px;height:1px;overflow:hidden;' +
      'opacity:0.01;pointer-events:none;z-index:-1;';

    iosSwitch = document.createElement('input');
    iosSwitch.type = 'checkbox';
    iosSwitch.setAttribute('switch', '');
    iosSwitch.id = 'calcutron-haptic-switch';
    iosSwitch.tabIndex = -1;

    iosLabel = document.createElement('label');
    iosLabel.setAttribute('for', iosSwitch.id);

    host.append(iosSwitch, iosLabel);
    document.body.append(host);
  } catch {
    iosSwitch = null;
    iosLabel = null;
  }
}
