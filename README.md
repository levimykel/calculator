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
- An `fx` handle on the expression line opens a row of extra functions —
  `xʸ`, `x²`, `√`, `1/x` and `π` — and remembers whether you wanted it
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
unary      := ('−' | '+') unary | power
power      := postfix ('^' unary)?
postfix    := primary ('%' | '²' | '⁻¹')*
primary    := number | constant | function '(' expression ')' | '(' expression ')'
```

Precedence falls out of the nesting: `term` binds tighter than `expression`, so
× and ÷ are applied before + and −, and parentheses restart the cycle.

`power` sits between `unary` and `postfix`, which gives it the two conventions
people expect from writing it on paper: it binds tighter than × so `2 × 3^2` is
18, and `−2²` is −4 because the sign applies to the result. Its right operand is
a `unary`, so it is right-associative — `2^3^2` is 512, not 64 — and `2^−1` is
typeable.

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
  you type `2(`, and the parser accepts the bare form too. `π` counts as a
  value, so `2π` becomes `2 × π`.
- **A function takes the value you have already entered.** Pressing `√` after
  typing `9` gives `√(9)`, not a new bracket beside it — and only that value, so
  `2 + 9` then `√` is `2 + √(9)`. It takes postfixes with it (`5²` becomes
  `√(5²)`), reuses brackets a group already has, and wraps a finished result
  rather than discarding it. With nothing to take, it opens its bracket and
  waits for an argument.
- **`x²` and `1/x` are postfixes**, so they modify the value just entered the
  way `%` does, and they stack: `5²⁻¹` is a twenty-fifth.
- **One press, one delete.** `√(` arrives as a pair and backspaces as a pair.

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

### The fx row

The grid is full, and the five extra functions are not wanted often enough to
displace anything on it. So they live behind an `fx` handle in the space to the
left of the expression, which was empty — the handle costs no height, and the
choice is remembered between launches.

```
xʸ   x²   √   1/x   π
```

Open, the row comes *out of* the keypad's height budget rather than on top of
it, so the block below the display is the same size either way and the keys
never shift. In a short landscape window height is the scarce thing and width is
not, so the same five keys stand in a column beside the keypad instead, where
they cost nothing at all.

From a keyboard: `^` for the power, `r` for the root, `p` for pi.

## History

Every completed calculation becomes a row above the display, newest at the
bottom, showing the result with the expression beneath it. Operators are drawn
as small chips so a long expression stays scannable.

- **Expand the list** with the chevron beside Clear. The keypad collapses to
  nothing — deliberately not `display: none`, so it is never torn out of the
  layout and rebuilt — and the history takes its room, which turns roughly one visible row into eight.
  The display stays, so the working calculation is still in view while you look
  back. It collapses again on the chevron, on recalling a row, or on the next
  thing you type — all of which mean you want the keypad back.
- **Each row has two targets, and they do what they show.** Tapping the number
  drops that value into whatever you are typing — landing on a closed group or
  another number inserts a `×` first. Tapping the expression underneath loads
  the calculation itself, ready to edit and run again; the tokens are copied on
  the way out, so editing cannot reach back into the stored entry.
- **Star a row** — from the row itself or the `☆` key, which acts on the most
  recent calculation. A star means *keep this*: it is the only thing the star
  does, and it does it in two ways.
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
- **In the installed app the bottom margin is a constant, not `env()`.**
  Deriving it from the inset means the keypad drops to the screen edge if iOS
  ever reports that inset differently mid-session. Same 20px, one fewer thing
  that can change underneath it.
- **Restate `display: none` for `[hidden]` on anything you gave a `display`.**
  The expand control is `display: grid`, which outranks the user-agent rule for
  the `hidden` attribute, so it stayed on screen with an empty history until the
  rule was added back.
- **Park a short history list with `margin-top: auto`, not `justify-content`.**
  Flex end-alignment pushes overflow out of the top of a scroll container,
  where it cannot be scrolled back to.
- **The status bar style decides where the bottom of the app lands, and
  `black-translucent` gets it wrong.** Measured on an iPhone 16 Pro with that
  style: `viewport 812` against `screen 874`, app filling `0→812`, zero slack
  under the keypad, `inset t62`. iOS positions the web view at the top of the
  screen but sizes it as though it started below the status bar, so the missing
  62px falls off the bottom, outside the page, where nothing can paint. The
  magenta canvas tint is what proved it: it appeared *below* a keypad the
  numbers said was already flush. `black` instead starts the view below the
  status bar, so its height reaches the screen bottom. **iOS reads this meta at
  install time — changing it needs a delete-and-re-add.** With the view finally
  ending where the screen does, the home-indicator inset means something again,
  and `--safe-bottom` honours it (capped at 20px) to leave the keypad sitting
  just clear of the indicator.
- **The app is `position: fixed; inset: 0`** rather than `height: 100dvh`,
  since an installed app can report a `dvh` shorter than the area it paints.
  `.keypad` carries `margin-top: auto` so no arrangement of the bands above it
  can leave slack underneath.
- **Safe areas are CSS variables** so the fit tests can substitute real device
  values and check the layout against them — Playwright reports every inset as
  zero, which is why a whole class of iOS spacing bugs was invisible to them.
  The substitution happens in an init script, *before* any page script runs, so
  the app boots into the layout a real device gives it. Applying it after load
  once hid a bug where load-time code ate the bottom margin.
- **Long-press the header** for the layout numbers: viewport and screen
  height, where the app box and keypad end, any slack under the keypad, the
  measured safe-area insets, and whether iOS considers this a standalone app.
  These values cannot be inspected on a phone, and the differences between them
  are what iOS spacing bugs look like — comparing `viewport` against `screen` is
  what finally identified the status bar style as the cause of the band under
  the keypad.
- **The viewport meta carries no scale locking.** `maximum-scale` and
  `user-scalable=no` can affect how iOS sizes a standalone web view, so they
  are gone; `touch-action: pan-y` on `.app` refuses pinch-zoom instead, while
  leaving the history scrollable.
- **A key that centres its label centres each child separately.** `.key` is a
  `display: grid` with `place-items: center`, so `x<sup>y</sup>` put the `y`
  *underneath* the `x` as a second grid item. Wrap a multi-part label in one
  span.
- **An auto top margin behaves differently in a row.** `.keypad` uses
  `margin-top: auto` to pin itself to the bottom of the app's column. In the
  landscape layout, where it sits in a row beside the fx column, that same
  margin pushes it *across* the cross axis instead of filling it, and the keys
  collapsed to a third of their height until it was reset to 0 there.
- **`display: contents` is how the fx wrapper stays invisible in portrait.**
  The `.pads` div exists only so landscape can stand the two blocks side by
  side; in portrait it dissolves, and the column layout is byte-identical to
  what it was before the wrapper existed.
- **`.app` already has a flex `gap`**, so a margin between two of its children
  adds to it rather than replacing it. The fx row's spacing comes from the gap
  alone, and the keypad's height subtracts that gap along with the row.
- **Icons** are generated from `icons/calcutron.svg`. If the artwork changes,
  re-export the PNGs at 32, 180, 192, and 512 px, plus the maskable 512 variant.
