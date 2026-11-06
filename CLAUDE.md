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
js/units.js         temperature, length, mass, shoe size — constant, no network
js/exchange.js      the only code in the project that touches the network
js/app.js           every piece of DOM wiring, for all three screens
js/history.js       the tape
js/feedback.js      key sounds (Web Audio, synthesised)
js/haptics.js       the haptics that iOS mostly refuses to give us
js/update.js        the service-worker update handshake
sw.js               the service worker
version.js          the single source of truth for the version
scripts/bundle.mjs  assembles www/ for the native shell
test/               node:test, no runner, no framework
```

`www/` is generated and git-ignored. The repo root is the web root, and it also
holds `.git`, `node_modules` and the tests, so Capacitor's `webDir` cannot
point at it — `npm run bundle` copies out just the files that ship. It takes
the list from `sw.js`'s precache block rather than keeping a second one, so the
two cannot drift.

The split that matters: **everything except `js/app.js` is pure**. No DOM, no
network, no globals. That is what makes the tests cheap and it is worth
defending. When a change wants to reach into the document from `growth.js` or
`rates.js`, the answer is nearly always to return a value and let `app.js`
render it.

## Running and testing

```sh
npm test            # node --test 'test/*.test.js' — 204 tests, under a second
npm start           # serves the folder on :8080
npm run bundle      # assemble www/ — only the files that ship — for the shell
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
- **An author `display:` rule outranks the UA's `[hidden]`,** because an
  attribute selector and a class have the same specificity and author styles
  win. Setting `el.hidden = true` then does nothing visible. Every element in
  here that is both styled with `display:` and hidden from script restates it —
  `.fxpad[hidden]`, `.history__toggle[hidden]`, `.chart__cursor[hidden]`,
  `.cats[hidden]`. This is listed here because it was fallen into a fourth
  time, with three worked examples already in the stylesheet: a new
  `display:`-carrying element that script hides needs its own line.
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

## The Convert screen

Money and units share one screen, one list and one set of rows. `js/app.js`
renders money through `renderRates` and everything else through `renderUnits`;
the row building is common to both.

**Every unit carries a `to`/`from` pair, never a multiplier.** °F = °C × 9/5 + 32
is affine, so a factor cannot express it — and temperature is the whole point of
the feature. The pair makes Fahrenheit ordinary instead of a special case, and
`ratio()` keeps the boring units short. A new unit follows that shape even where
a factor would do.

**Each category holds its own figure, in its own unit.** `held` in `js/app.js`
maps a category to `{ unit, amount }`, seeded from the category's `start` and
`startValue` and persisted. Carrying one number between categories was the
first version's behaviour and it was nonsense: 27 °C became shoe size 27.

**A unit whose written form is not a single number carries four hooks.** Feet
and inches is the only one so far. `parse` turns what was typed into the unit's
number, `entry` turns it into what the row being typed into shows, `display`
turns a converted number into what a row shows, and `raw` turns one back into
something typeable, for when that row is tapped and becomes the entry. Ordinary
units define none of them and fall back to plain numbers. The decimal key is
the separator — 5 . 1 0 is five foot ten — so no new key had to appear.

Length's units are ordered by what people reach for, not by system, because
only about seven rows fit on a phone and feet-and-inches must not sit below the
fold. The currency list does the same thing through `COMMON` in `js/rates.js`.

The action key on the shared numpad does a different job per category: money can
be refreshed, so it is `↻`; a unit cannot, so it is `±`, which temperature
genuinely needs and money never does.

Only money has a source line. `renderRatesSource` unhides that element and the
unit categories hide it again, so whichever drew last owns it.

Shoe sizes are a convention, not a measurement. The spine is foot length in cm;
UK steps by a barleycorn and EU by a Paris point, and the men's/women's switch
moves only the US column, because UK and EU do not change between them. The
screen carries a visible "approximate" note and should keep it.

## Decisions so far

Each of these has the full reasoning on its card; this is the line a future
session needs so it does not reopen a settled question.

**The shell is Capacitor** (decided 2026-10-03). It suits an app that is
already offline-first with local assets, and it keeps one codebase behind the
web app, iOS and eventually Android. Levi also wants to learn the tool, so
routing around it for expedience would miss half the point. A Capacitor app
*is* a Swift app — `npx cap add ios` generates a real Xcode project that gets
committed — so this rules nothing native out. Rejected: TWA (Android only) and
a native rewrite (throws away the tested parser and caret model). Accepted
costs: slower cold start, webview scroll that never quite matches native, and
inherited WebKit bugs. Capacitor 8 creates iOS projects with Swift Package
Manager by default, so there is nothing to opt into; with SPM the project to
open is `ios/App/App.xcodeproj`, not an `.xcworkspace`.

**Native scope for App Review 4.2 is haptics plus App Intents** (decided
2026-10-03). Enough to answer "what does this give me that the website
doesn't": it is felt in the hand, and it integrates with Siri and Shortcuts. A
home-screen widget was considered and deferred — not ruled out if a reviewer
pushes back anyway.

**The real 4.2 risk is "the ten-thousandth calculator", not "a website in a
box".** Calcutron is not a web clipping: it is wholly offline and there is no
site it fronts. The weaker spot is the *"not particularly useful, unique"*
clause, and no amount of Swift answers that — the listing copy and the review
notes have to, by leading with offline, the three tools and the caret editor.

## Rules only this project has

**No bundler, and native code must not change that.** Capacitor's plugins are
reached through `globalThis.Capacitor?.Plugins?.X` at runtime, never by
importing `@capacitor/...`. An import would pull in a package, a package would
pull in a bundler, and the app would stop being files a browser can load
directly. `js/haptics.js` is the worked example. A new plugin follows it.

**Detect the bridge per call, not once at module load.** Capacitor injects its
bridge into the webview, so what is true when a module first evaluates is not
a safe thing to cache. A property lookup per keypress costs nothing.

## Still open

- **Individual or company enrolment.** Sets the seller name, hard to change
  later, and a company needs a D-U-N-S number with a long lead time. It also
  decides whether Play needs twelve testers — see the next line.
- **Google Play's closed-testing rule**: 12 testers for 14 continuous days
  before production, for personal accounts created after 13 November 2023.
  **Organization accounts are exempt**, which ties this to the decision above.
  A calendar constraint, not a work item.
