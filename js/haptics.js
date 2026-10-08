/**
 * Light haptic feedback on key presses.
 *
 * Three worlds, in order of preference:
 *
 *   1. Inside the native shell, Capacitor's Haptics plugin reaches UIKit's
 *      feedback generators, so an iPhone finally ticks under a key. Half the
 *      reason the app is being shipped natively at all — see the App Review
 *      4.2 decision on the board.
 *   2. A browser that implements the Vibration API — Android Chrome and
 *      friends — gets a short pulse.
 *   3. iOS Safari and the desktop get nothing, and that is not an oversight:
 *
 *      - Safari implements no Vibration API on any platform, so
 *        `navigator.vibrate` does not exist on an iPhone or iPad.
 *      - The one haptic Safari does emit is a side effect of a *person*
 *        toggling a native `<input type="checkbox" switch>`. Two attempts to
 *        drive a hidden switch from script were made here and neither produced
 *        a haptic on real hardware, which fits the theory that it needs a
 *        genuine touch landing on the switch itself rather than a programmatic
 *        click. Getting it would mean a real switch under every key, giving up
 *        the keypad's buttons, focus behaviour and accessibility — too high a
 *        price for a side effect Apple never documented and could remove.
 */

/**
 * Capacitor's own value for a light impact. The published enum is
 * `ImpactStyle.Light = 'LIGHT'`; this is that string, written out.
 *
 * Importing the enum would mean importing the package, and importing the
 * package would mean a bundler. This project does not have one, on purpose.
 */
const LIGHT = 'LIGHT';

/**
 * The plugin, when the app is running inside the native shell.
 *
 * Read off the global rather than imported, for the reason above: Capacitor
 * injects its bridge into the webview before the page's own scripts run, so
 * the plugin is simply there to be found. That keeps the web app a pile of
 * plain files that a browser can still load directly.
 *
 * Looked up on every press rather than cached once. A keypress is rare enough
 * that a property lookup costs nothing, and caching would freeze whatever
 * happened to be true at the instant this module first ran — which, for
 * something injected by a host we do not control, is a bet with no upside.
 */
function nativeHaptics() {
  const plugin = globalThis.Capacitor?.Plugins?.Haptics;
  return typeof plugin?.impact === 'function' ? plugin : null;
}

function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** True where a press will actually be felt. */
export function hapticsAvailable() {
  return Boolean(nativeHaptics()) || canVibrate();
}

export function tap() {
  const native = nativeHaptics();
  if (native) {
    // The plugin answers with a promise. A key press is not worth breaking
    // over a haptic that did not fire, and an unhandled rejection in here
    // would surface as a console error on every tap.
    Promise.resolve(native.impact({ style: LIGHT })).catch(() => {});
    return;
  }

  // Short enough to read as a tick rather than a buzz.
  if (canVibrate()) navigator.vibrate(8);
}
