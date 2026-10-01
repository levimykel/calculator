# Working on Calcutron

Notes for whoever — or whatever — picks this up next. The README explains the
app to a reader; this file explains the project to someone about to change it.
Read both. Where they overlap the README wins, because it is the one users see.

The rules shared by all of Levi's apps are in
[.claude/rules/base.md](.claude/rules/base.md), which loads with this file.
What follows is only what's specific to Calcutron.

## The shape of it

A calculator PWA with no build step. Plain HTML, CSS and ES modules, served as
files. There is no bundler, no transpiler and no framework, and adding one
would cost more than it is worth: the whole app is about 2,500 lines and it
loads instantly because there is nothing between the source and the browser.

```
index.html          the whole document; three screens live inside it
css/styles.css      one stylesheet
js/calculator.js    the expression engine — parser, evaluator, caret model
js/growth.js        compound growth arithmetic
js/chart.js         chart geometry
js/rates.js         currencies, conversion, formatting, reading a rates payload
js/exchange.js      the only code in the project that touches the network
js/app.js           every piece of DOM wiring, for all three screens
js/history.js       the tape
js/feedback.js      key sounds (Web Audio, synthesised)
js/haptics.js       the haptics that iOS mostly refuses to give us
js/update.js        the service-worker update handshake
sw.js               the service worker
version.js          the single source of truth for the version
test/               node:test, no runner, no framework
```

The split that matters: **everything except `js/app.js` is pure**. No DOM, no
network, no globals. That is what makes the tests cheap and it is worth
defending. When a change wants to reach into the document from `growth.js` or
`rates.js`, the answer is nearly always to return a value and let `app.js`
render it.

## Running and testing

```sh
npm test            # node --test 'test/*.test.js' — 166 tests, under a second
npm start           # serves the folder on :8080
npm run set-version 4.3.0
```

`npm test` is the whole gate. CI (`.github/workflows/pages.yml`) runs it and
refuses to deploy if it fails, so a red test is a broken release, not a
warning.

### The version is written in four places

`version.js`, `sw.js`, `package.json` and a fallback string in `index.html`.
**Never edit them by hand** — run `npm run set-version <x.y.z>`, which does all
four and fails loudly if any one has drifted. `test/version.test.js` checks all
four agree, and also checks that every script the page loads appears in the
service worker's `ASSETS` list. **A new file under `js/` must be added to
`ASSETS` in `sw.js`** or it will be missing offline; the test will catch it.

Bump the version on every user-visible change. The service worker's bytes have
to differ for the browser to notice an update at all, so shipping without a
bump means nobody gets the change.

## Release

Deployed from `main` to GitHub Pages. A push to `main` is a release.

## Checking it in a real browser

The unit tests do not touch the DOM, so anything about layout, gestures or the
three-screen switching has to be checked in Chromium via Playwright.

Suites have been built in the scratchpad rather than committed, because
Playwright is not a dependency of this repo and the app has no server. The
scratchpad does not survive a container restart, so expect to rebuild it. What
that harness needs to get right, learned the hard way:

- **Serve under a path, not the root.** Pages hosts the app at
  `/calculator/`, and the service worker's scope depends on it.
- **Kill the old server before starting a new one.** A stale server keeps the
  port, and because it read the version at boot it will make update tests fail
  for reasons that have nothing to do with the change under test. This cost
  two long debugging sessions. Match the process by its actual argv — it is
  `node server.mjs`, not the path you launched it with — and wait for the port
  to free before rebinding.
- **Scope every locator to `.keypad`.** There are two keypads in the document
  (the calculator's and the growth screen's numpad) and both carry a `7`. An
  unscoped `[data-digit]` is a Playwright strict-mode violation.
- **Test visibility with `getClientRects().length`, not `hidden`.** The growth
  pad is hidden by CSS, not the attribute.
- **Inject safe-area insets with `addInitScript`,** before load, or the layout
  you measure is not the one the phone gets.
- **Stub the rates API with `ctx.route()`** — see the next section for why it
  cannot be reached for real.

## The network, in this sandbox

The agent proxy blocks every exchange-rate host (403 on CONNECT). `js/exchange.js`
therefore cannot be exercised end to end from here, and anything that claims to
have done so is mistaken.

The ECB source (`api.frankfurter.dev`) *is* known to work: it was proved by
accident when a test reached the live network on CI and failed on real rates
that `fromFrankfurter` had parsed correctly. **The fallback,
`open.er-api.com`, has never returned a live response and remains unverified.**

That accident also left a rule behind. `test/exchange.test.js` installs a
module-level stub:

```js
globalThis.fetch = () => { throw new Error('a test reached the network'); };
```

Keep it. And note the trap it was covering: passing `{ fetcher: undefined }`
to `new Exchange()` does **not** override a default parameter — it gets the
real `fetch`. Pass `fetcher: null` when you mean "no fetcher". The test looked
green locally only because the sandbox blocks the request; on CI it hit the
live service.

## Traps this project has already fallen into

Each of these looked like a bug in something else at first.

- **An SVG element has no `hidden` IDL property.** `el.hidden = true` silently
  does nothing on SVG; only the attribute exists. Use
  `toggleAttribute('hidden', ...)`.
- **Move the caret before you mutate the text, not after.** The caret getter
  clamps to `caretMax`, so decrementing it after shortening the expression
  moves it two stops instead of one.
- **`.key` is `display: grid; place-items: center`.** A bare `<sup>` in a label
  becomes a second grid item and lands under the character it should sit above.
  Wrap key labels in a single `<span>`.
- **`vw` units lie inside `.app`,** which is capped at `max-width: 560px`. In
  landscape use a share of the flex row (`flex: 0 0 42%`), not a viewport
  fraction.
- **`margin-top: auto` pushes across the cross axis** once `.pads` becomes a
  flex row in landscape, which flattened the keypad to 22px tall. It is reset
  there deliberately.
- **The keypad height is a budget.** `--keypad-height` is shared; anything that
  appears above the keys (the fx row) has to come out of it, or the bottom row
  of keys goes off-screen.

## Two invariants in the engine worth knowing before you touch it

`js/calculator.js` holds the caret as a count of *stops* from the left — a
number contributes one stop per character, everything else one stop. `locate()`
turns a caret into a token index and an offset.

The pair that keeps edits honest is `join()` and `separate()`. Deleting the
`+` from `2+3` has to give `23`, not `2 × 3` — an edit must never silently
change what an expression means by way of implicit multiplication. `join()`
merges two numbers that have become adjacent; `separate()` is its inverse and
runs on both seams when something is inserted into the middle of a number.
Tests cover both directions; if you are changing insertion or deletion, read
them first.

## The board

Planning for shipping this as a native app lives on Trellevi, not in the repo:
board `bdbe2bfe-0861-4f92-a961-143b8598e137`, **"Calcutron"**.

Columns, left to right: **In Progress** / Decide / Accounts & legal / Build /
Store listing / Ship / After launch / Done. Labels: iOS, Android, Blocker,
Long lead, Only you can do.

In Progress is first on purpose: the board scrolls sideways on a phone, so what
is being worked on now should be visible without scrolling to find it.

The middle columns are **stages of the launch, not states of work** — a card
sits in the stage it belongs to until someone picks it up. So the base rule
about moving a card to In Progress means moving it *out* of its stage, and it
goes back to that stage if it is put down unfinished. Done still means Levi has
used it.

Three decisions block the rest of it:

1. **Apple's 4.2 minimum-functionality rule.** A calculator wrapped from a web
   app is exactly the shape of thing App Review rejects. Decide what makes this
   one more than a website in a box before building anything.
2. **Individual or company enrolment.** It sets the seller name buyers see and
   is hard to change later; a company needs a D-U-N-S number, which has a long
   lead time.
3. **Google Play's closed-testing requirement** for new personal developer
   accounts — a fixed number of testers for a fixed number of days before
   production is even an option. It is a calendar constraint, not a work item.

Capacitor is the recommended shell (it can wrap this app as it stands, with the
service worker doing the offline work it already does) but the user has not
chosen yet. Do not assume it.
