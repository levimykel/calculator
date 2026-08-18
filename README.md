# Calcutron

A friendly little calculator PWA — install it on an iPhone or iPad and it runs
full screen and offline, like a native app.

![Calcutron](icons/icon-192.png)

## What it does

- The usual four operations, plus `%`, `±`, and a decimal point
- Chained arithmetic (`2 + 3 × 4 =`), and `=` repeats the last operation
- `AC` / `C` — the key switches itself depending on whether there is an entry to clear
- Swipe across the display to delete the last digit
- Full keyboard support, so it is usable with an iPad keyboard or on a desktop
- Soft key sounds, with a warmer two-note chime on `=`; mutable from the speaker
  button, and the choice is remembered
- Light haptic feedback on each press (see the caveat below)
- Works with no network once installed
- Shows its version, and updates on your say-so rather than mid-calculation

## Running it locally

No build step and no dependencies — it is plain HTML, CSS, and ES modules.

```sh
npm start          # serves the app at http://localhost:8080
npm test           # runs the test suite
npm run set-version 1.2.0   # bumps the version everywhere it appears
```

Opening `index.html` directly from the filesystem will not work: ES modules and
service workers both need to be served over `http://` or `https://`.

## Installing on iOS

iOS only offers "Add to Home Screen" for pages served over HTTPS, so the app
needs to be hosted somewhere first.

1. Push to `main`. The included workflow runs the tests and publishes the site.
   The one-time setup is **Settings → Pages → Source → GitHub Actions**.
2. Open the published URL in Safari on the iPhone or iPad. Other iOS browsers
   cannot install home-screen apps.
3. Tap **Share → Add to Home Screen**.

It then launches without Safari's chrome, keeps working offline, and uses the
robot icon.

## Offline and updates

Everything the app needs is precached on first visit, so after one online load
it runs with no network at all — including a cold launch from the home screen.
Assets are served cache-first, which is also why it starts instantly.

Because of that, a new version cannot simply appear. The flow is:

1. A new service worker installs in the background and waits. It does *not*
   activate on its own, so the app never swaps out from under a calculation.
2. The chip in the top right turns into **Update ready**. Tapping it activates
   the new worker and reloads.
3. Tapping the chip when no update is pending checks for one on demand; it also
   checks automatically whenever the app comes back to the foreground.

The version appears in four files, which `npm run set-version` keeps in step.
The service worker needs its own copy rather than importing one: browsers decide
whether an update exists by byte-comparing the worker file itself, so its
contents have to change each release. A test fails if the copies drift.

## A note on haptics

Safari does not implement the Vibration API on any platform, so
`navigator.vibrate` does not exist on an iPhone or iPad. The only haptic Safari
exposes to a web app is a side effect of toggling a
`<input type="checkbox" switch>` (Safari 17.4+), and that is what `js/haptics.js`
drives on iOS. It is a side effect Apple never documented as an API, so treat it
as best-effort — **this path has not been verified on real hardware**. Android,
where `navigator.vibrate` exists, uses the real API.

If a future iOS release breaks the trick, presses simply stop buzzing; nothing
else is affected.

## Layout

```
index.html                app shell and keypad markup
version.js                the version, read by both the page and the worker
css/styles.css            all styling, including the landscape and safe-area handling
js/calculator.js          the calculator engine — pure state machine, no DOM
js/app.js                 wires the engine to the keypad, keyboard, and display
js/feedback.js            synthesized key sounds (Web Audio, no audio files)
js/haptics.js             press haptics, including the iOS workaround
js/update.js              service worker registration and the update handshake
sw.js                     service worker; precaches the app for offline use
manifest.webmanifest      PWA metadata: name, icons, colors, display mode
icons/                    robot artwork, as SVG source and rasterized PNGs
scripts/set-version.mjs   bumps the version in every file that carries it
test/                     tests, run with `npm test`
```

The engine is deliberately separate from the UI: `js/calculator.js` has no
reference to the DOM, which is what makes it straightforward to test.

## Notes for future changes

- **Run `npm run set-version`** for every release. The cache name derives from
  it, so skipping it leaves returning visitors on the old cached copy.
- **Add new files to the `ASSETS` list in `sw.js`** so they are available
  offline. A test fails if the page loads something the worker does not cache.
- **Keys act on `pointerdown`, not `click`**, which is what makes them feel
  immediate; a click handler remains only for keyboard activation, guarded by a
  timestamp so a real tap cannot count twice.
- **Icons** are generated from `icons/calcutron.svg`. If the artwork changes,
  re-export the PNGs at 32, 180, 192, and 512 px, plus the maskable 512 variant.
