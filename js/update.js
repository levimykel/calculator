/**
 * Service worker registration plus the "an update is ready" flow.
 *
 * The worker deliberately does not call skipWaiting() during install, so a new
 * version parks in the waiting state instead of swapping itself in mid-use.
 * This module notices that, tells the UI, and activates the new worker only
 * when the user asks for it.
 */

const IDLE = 'idle';
const CHECKING = 'checking';
const CURRENT = 'current';
const READY = 'ready';

export function initUpdates(onStatus) {
  if (!('serviceWorker' in navigator)) {
    return { check: () => {}, apply: () => {}, supported: false };
  }

  let registration = null;
  let reloading = false;
  let applying = false;

  // On a first-ever visit the worker's clients.claim() also fires this event,
  // and reloading there would make the app blink on its very first launch.
  // Only an update — a controller replacing an existing one — warrants it.
  const hadController = Boolean(navigator.serviceWorker.controller);

  // The controller changing means the worker we asked to take over has done
  // so, and the page needs a reload to actually run the new assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !(hadController || applying)) return;
    reloading = true;
    window.location.reload();
  });

  const ready = () => onStatus(READY);

  const watch = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      // A worker reaching "installed" while another already controls the page
      // is by definition an update rather than a first install.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) ready();
    });
  };

  navigator.serviceWorker.register('sw.js').then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) ready();
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));

    // Catch a version published while the app sat in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {
    onStatus(IDLE);
  });

  async function check() {
    if (!registration) return;
    onStatus(CHECKING);
    try {
      await registration.update();
      // update() resolves before a discovered worker finishes installing, so
      // give the statechange listener a moment before declaring us current.
      await new Promise((resolve) => setTimeout(resolve, 900));
      if (registration.waiting && navigator.serviceWorker.controller) ready();
      else onStatus(CURRENT);
    } catch {
      onStatus(CURRENT);
    }
  }

  function apply() {
    applying = true;
    const waiting = registration && registration.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  return { check, apply, supported: true };
}

export const STATUS = { IDLE, CHECKING, CURRENT, READY };
