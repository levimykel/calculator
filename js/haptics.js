/**
 * Light haptic feedback on key presses, where the platform allows it.
 *
 * Android and other Vibration API browsers get a real pulse. iOS gets nothing,
 * and that is not an oversight:
 *
 *   - Safari does not implement the Vibration API on any platform, so
 *     `navigator.vibrate` does not exist on an iPhone or iPad.
 *   - The one haptic Safari does emit is a side effect of a *person* toggling
 *     a native `<input type="checkbox" switch>`. Two attempts to drive a hidden
 *     switch from script were made here and neither produced a haptic on real
 *     hardware, which fits the theory that the haptic requires a genuine touch
 *     landing on the switch itself rather than a programmatic click. Getting
 *     that would mean putting a real switch under every key and giving up the
 *     keypad's buttons, focus behaviour and accessibility — too high a price
 *     for a side effect Apple never documented and could remove.
 *
 * So on iOS, presses are silent to the touch. A native shell (a WKWebView app,
 * or Capacitor) is the only route to real haptics there, since UIKit's
 * feedback generators are not reachable from a web page.
 */

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function hapticsAvailable() {
  return supported;
}

export function tap() {
  // Short enough to read as a tick rather than a buzz.
  if (supported) navigator.vibrate(8);
}
