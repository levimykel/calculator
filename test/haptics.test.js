import test from 'node:test';
import assert from 'node:assert/strict';
import { tap, hapticsAvailable } from '../js/haptics.js';

/**
 * `globalThis.navigator` is a getter in Node, so a plain assignment throws in
 * a module. It is configurable, though, so it can be redefined.
 */
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

/** Put the world back however the test found it. */
function sandbox(run) {
  const hadNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hadCapacitor = Object.getOwnPropertyDescriptor(globalThis, 'Capacitor');
  try {
    run();
  } finally {
    if (hadNavigator) Object.defineProperty(globalThis, 'navigator', hadNavigator);
    else delete globalThis.navigator;
    if (hadCapacitor) Object.defineProperty(globalThis, 'Capacitor', hadCapacitor);
    else delete globalThis.Capacitor;
  }
}

/** A stand-in for the Capacitor plugin that records what it was asked for. */
function fakePlugin({ rejects = false } = {}) {
  const calls = [];
  return {
    calls,
    impact(options) {
      calls.push(options);
      return rejects ? Promise.reject(new Error('no haptic engine')) : Promise.resolve();
    },
  };
}

function fakeVibrate() {
  const calls = [];
  return { calls, vibrate: (ms) => { calls.push(ms); return true; } };
}

test('inside the native shell, the press goes to the plugin', () => {
  sandbox(() => {
    const plugin = fakePlugin();
    globalThis.Capacitor = { Plugins: { Haptics: plugin } };
    const nav = fakeVibrate();
    setNavigator(nav);

    tap();

    assert.deepEqual(plugin.calls, [{ style: 'LIGHT' }]);
    // The native haptic is the better one; asking for both would double it.
    assert.deepEqual(nav.calls, [], 'vibrate should not also fire');
  });
});

test('in a browser that can vibrate, the press is a short pulse', () => {
  sandbox(() => {
    delete globalThis.Capacitor;
    const nav = fakeVibrate();
    setNavigator(nav);

    tap();

    assert.deepEqual(nav.calls, [8]);
  });
});

test('on iOS Safari, a press asks for nothing and does not throw', () => {
  sandbox(() => {
    delete globalThis.Capacitor;
    setNavigator({});           // no vibrate, which is Safari everywhere

    assert.doesNotThrow(() => tap());
    assert.equal(hapticsAvailable(), false);
  });
});

test('a plugin that rejects does not become an unhandled rejection', async () => {
  const hadCapacitor = Object.getOwnPropertyDescriptor(globalThis, 'Capacitor');
  try {
    globalThis.Capacitor = { Plugins: { Haptics: fakePlugin({ rejects: true }) } };
    tap();
    // Give the rejection a turn to go unhandled, if it is going to.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    if (hadCapacitor) Object.defineProperty(globalThis, 'Capacitor', hadCapacitor);
    else delete globalThis.Capacitor;
  }
});

test('a half-built bridge is not mistaken for a working one', () => {
  sandbox(() => {
    setNavigator({});
    // Capacitor is present but the Haptics plugin was never installed.
    globalThis.Capacitor = { Plugins: {} };
    assert.equal(hapticsAvailable(), false);
    assert.doesNotThrow(() => tap());

    // Present, but not the shape we expect.
    globalThis.Capacitor = { Plugins: { Haptics: { impact: 'not a function' } } };
    assert.equal(hapticsAvailable(), false);
    assert.doesNotThrow(() => tap());
  });
});

test('the native plugin counts as available even with no Vibration API', () => {
  sandbox(() => {
    setNavigator({});
    globalThis.Capacitor = { Plugins: { Haptics: fakePlugin() } };
    assert.equal(hapticsAvailable(), true);
  });
});
