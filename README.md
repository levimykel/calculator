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
- Works with no network once installed

## Running it locally

No build step and no dependencies — it is plain HTML, CSS, and ES modules.

```sh
npm start          # serves the app at http://localhost:8080
npm test           # runs the calculator engine test suite
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

## Layout

```
index.html                app shell and keypad markup
css/styles.css            all styling, including the landscape and safe-area handling
js/calculator.js          the calculator engine — pure state machine, no DOM
js/app.js                 wires the engine to the keypad, keyboard, and display
sw.js                     service worker; precaches the app for offline use
manifest.webmanifest      PWA metadata: name, icons, colors, display mode
icons/                    robot artwork, as SVG source and rasterized PNGs
test/                     engine tests, run with `npm test`
```

The engine is deliberately separate from the UI: `js/calculator.js` has no
reference to the DOM, which is what makes it straightforward to test.

## Notes for future changes

- **Bump `CACHE` in `sw.js`** whenever assets change, or returning visitors keep
  the old cached copy.
- **Add new files to the `ASSETS` list in `sw.js`** so they are available offline.
- **Icons** are generated from `icons/calcutron.svg`. If the artwork changes,
  re-export the PNGs at 32, 180, 192, and 512 px, plus the maskable 512 variant.
