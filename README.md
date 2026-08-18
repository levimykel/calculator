# Calcutron

A friendly little calculator PWA — install it on an iPhone or iPad and it runs
full screen and offline, like a native app.

![Calcutron](icons/icon-192.png)

## What it does

- Write out a whole expression before evaluating it. Pressing an operator adds
  to the expression instead of calculating, and nothing is computed until `=`
- A running history: finished calculations stack above the display, newest
  nearest your thumb. Tap one to reuse its result, star one to keep it
- Proper order of operations: `2 + 3 × 4` is 14, not 20
- Parentheses, nested as deep as you like, from a single `( )` key that opens or
  closes depending on where you are
- The result reads large with the expression beneath it, the same shape as the
  history rows, and it updates live as you type
- The usual four operations, plus `%`, `±`, and a decimal point
- One bottom-left key that deletes while there is something to delete and
  clears everything otherwise; swiping across the display also deletes
- Full keyboard support, so it is usable with an iPad keyboard or on a desktop
- Subtle mechanical key clicks, with a weightier one on `=`. The speaker button
  cycles soft / loud / off, and the choice is remembered
- Light haptic feedback on each press, on platforms that allow it (not iOS —
  see below)
- Works with no network once installed
- Shows its version, and updates on your say-so rather than mid-calculation

## Running it locally

No build step and no dependencies — it is plain HTML, CSS, and ES modules.

```sh
npm start          # serves the app at http://localhost:8080
npm test           # runs the test suite
npm run set-version 3.1.0   # bumps the version everywhere it appears
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

## Key sounds

Every sound is synthesized at press time — there are no audio files to download,
and the feedback keeps working offline. A voice is a burst of bandpassed noise
(the click) plus a brief low sine (the body), which is roughly how a mechanical
switch behaves. `=` gets a lower, longer version with a second tick behind it.

The speaker button cycles three levels, defaulting to soft:

| level | master gain | key click RMS |
| ----- | ----------- | ------------- |
| soft  | 0.16        | 0.00045       |
| loud  | 0.45        | 0.00120       |
| off   | 0           | silent        |

`LEVELS` in `js/feedback.js` is the dial; individual voices are in `VOICES`.

Because "quieter" and "more mechanical" are easy to get wrong by ear, the tests
render each voice through an `OfflineAudioContext` and measure it: peak, RMS,
how long it stays audible, and the ratio of energy above 1.2 kHz to energy below
500 Hz. That last number is what separates a click from a tone — the keys sit
around 2.3, and a failing change would show up as a number, not a vibe.

### Why the clicks still follow the phone's volume

They cannot do otherwise. Web Audio output is mixed into the device's media
volume, and the web platform exposes no way to opt out of that or to read what
the volume is set to. Native apps can, by playing through a system sound channel
that ignores the media slider — which is how apps like Calcbot keep a click at
one fixed level — but that is a native audio API with no web equivalent.

The levels above are the closest available substitute: pick one and it stays put,
though the phone's own volume still scales it.

## A note on haptics

Android and other browsers implementing the Vibration API get a real pulse.
**iOS gets nothing**, and that is a platform limit rather than an oversight:

- Safari does not implement the Vibration API on any platform, so
  `navigator.vibrate` does not exist on an iPhone or iPad.
- The one haptic Safari emits is a side effect of a *person* toggling a native
  `<input type="checkbox" switch>`. Two attempts to drive a hidden switch from
  script were tried here and neither fired on real hardware, which fits the
  theory that the haptic needs a genuine touch landing on the switch itself.
  Getting that would mean putting a real switch under every key and giving up
  the keypad's buttons, focus behaviour and accessibility — too high a price for
  an undocumented side effect Apple could remove at any point.

That code has been removed rather than left in place pretending to work. Real
haptics on iOS would need a native shell — a WKWebView app, or Capacitor — since
UIKit's feedback generators are not reachable from a web page.

## How the expression works

`js/calculator.js` keeps the expression as a list of tokens — numbers,
operators, parentheses, percent — and evaluates it only when asked. Evaluation
is a recursive-descent parse:

```
expression := term (('+' | '−') term)*
term       := unary (('×' | '÷' | juxtaposition) unary)*
unary      := ('−' | '+') unary | postfix
postfix    := primary '%'*
primary    := number | '(' expression ')'
```

Precedence falls out of the nesting: `term` binds tighter than `expression`, so
× and ÷ are applied before + and −, and parentheses restart the cycle.

A few behaviours that are easy to get wrong, and are pinned by tests:

- **Incomplete input is previewable.** `12 × (3 +` evaluates as `12 × 3` by
  dropping the trailing operator and closing the open group. That is what makes
  the live preview possible, and it is also what `=` does, so an unclosed
  parenthesis never blocks a result.
- **A repeated operator replaces rather than stacks.** Pressing `−` twice reads
  as a correction. A minus after `×` or `÷` is kept, though, since `5 × −3` is a
  real thing to type; `10 − −3` is written `10 − (−3)`.
- **Percent is contextual.** `200 + 10%` is 220, because against `+` and `−` a
  percent is taken of the left-hand side. Against `×` and `÷` it is just the
  fraction, so `80 × 50%` is 40.
- **`±` inserts a sign token** rather than editing digits, so `12 + −5` parses
  through the same path as a minus you typed.
- **The bottom-left key is backspace or C depending on state.** It deletes
  while an expression is being typed, and clears when there is nothing to
  delete. A committed result and an error both read as AC, since neither is
  editable a character at a time. The physical Backspace key always deletes.
- **Juxtaposition means multiplication.** The keypad inserts a visible `×` when
  you type `2(`, and the parser accepts the bare form too.

## The keypad

The arrangement follows Calcbot's: a function row on top, the operators down
the right, a `+` that runs the height of two rows, `C` bottom-left and an `=`
that runs the width of two columns.

```
±    (    )    ☆
7    8    9    ÷
4    5    6    ×
1    2    3    −
0    .    %    +
C         =         (+ continues)
```

Keys are flush with hairline seams rather than separate rounded tiles, which is
what makes the two-row `+` and two-column `=` read as one block. Because flush
keys cannot scale on press without breaking the seams, a press shows as a
colour change instead of the previous nudge.

The colours stay Calcutron's rather than Calcbot's — orange operators, teal `=`,
red `C` — so only the arrangement is borrowed.

## History

Every completed calculation becomes a row above the display, newest at the
bottom, showing the result with the expression beneath it. Operators are drawn
as small chips so a long expression stays scannable.

- **Tap a row** to drop its result into whatever you are typing. Landing on a
  closed group or another number inserts a `×` first.
- **Star a row** — from the row itself or the `☆` key, which acts on the most
  recent calculation.
- **Clear** removes everything unstarred. Starred rows stay, which is the point
  of starring; unstar one first if it should go.
- Rows persist in `localStorage` and survive a relaunch. The list holds 100;
  past that the oldest unstarred rows fall away, and starred ones never do.

`js/history.js` takes its storage as a constructor argument rather than
reaching for `localStorage` directly, which is what lets the tests drive it in
Node with a fake.

## Layout

```
index.html                app shell and keypad markup
version.js                the version, read by both the page and the worker
css/styles.css            all styling, including the landscape and safe-area handling
js/calculator.js          the engine — tokens, parser, evaluator; no DOM
js/history.js             the calculation history and its storage
js/app.js                 wires the engine to the keypad, keyboard, and display
js/feedback.js            synthesized key sounds (Web Audio, no audio files)
js/haptics.js             press haptics, where the platform provides them
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
- **The main display line scrolls rather than shrinking forever.** Its size
  buckets in `js/app.js` are tuned so a full-length *result* still fits the
  narrowest phone; expressions longer than that scroll to follow the caret.
- **Park a short history list with `margin-top: auto`, not `justify-content`.**
  Flex end-alignment pushes overflow out of the top of a scroll container,
  where it cannot be scrolled back to.
- **Icons** are generated from `icons/calcutron.svg`. If the artwork changes,
  re-export the PNGs at 32, 180, 192, and 512 px, plus the maskable 512 variant.
