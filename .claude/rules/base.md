# Base rules for every project

<!-- Version 1, 2026-09-30. Copied from levimykel/claude-rules (base.md).
     Don't edit this copy: change the source and sync it to every project, so
     they all stay the same. -->

These rules apply to every one of Levi's apps. Each project's CLAUDE.md adds
what's specific to it (its board, commands, stack, traps). Where the two
disagree, the project's CLAUDE.md wins.

## Who you're working with

- **Levi is usually on an iPhone or iPad, with no terminal.** Anything Levi has
  to do must work in a browser: a dashboard, GitHub, or the app itself. Never
  make a command-line step something Levi has to run. Do it through the MCP
  tools, or give dashboard steps with direct links.
- **Free plans by default.** If a suggestion costs money, say so upfront, with
  the price.
- **Several apps, one person.** Billing, accounts, Terms of Service and privacy
  policies are meant to be built once and reused. Keep that work generic, with
  the app-specific parts (which limits, which plan names) as configuration.

## Where things are written down

- **CLAUDE.md holds the permanent rules**: how to work on the project, its
  invariants, the traps already hit, and decisions every future session needs.
  Keep it true. When a rule changes, change it there in the same PR.
- **Cards hold the temporary things**: handoffs, where a piece of work stands,
  progress notes, links, and the details behind a decision.
- **Claude's tool permissions are set in Levi's account**, not committed to
  projects. Don't add a `.claude/settings.json` for them.

## The board

- **Every project has a Trellevi board**, named in its CLAUDE.md. It's the
  to-do list. If a project has none yet, ask before making one.
- Read it at the start of a session. At the start of a topic, move its card to
  **In Progress**. Leave progress notes and links as card comments. New ideas
  get a new card.
- **Done means used.** A card moves to Done only after Levi has confirmed it
  works on their own devices, not when it merges or deploys.
- **Archive, don't delete.** Delete a card, list or label only when Levi asks.

## Designing UI

- **UI goes through a design round before it's built.** Publish a workshop
  artifact titled after the feature. Show each option live over a stand-in of
  the real UI, desktop and iPhone side by side, with pros and costs, ending
  with "What I'd like from you". Link it on the card and iterate until an
  option is picked. Name the pick in the commit ("Option A from the workshop").
- **Phones are first-class.** Levi lives in the installed iPhone app. Check
  every UI change at iPhone width (390×844) as well as desktop. Pop-ups become
  bottom sheets on a phone.
- **Use the app's own design tokens**, not literal colours or one-off styles.
- **Plain, specific words in the UI.** Name what the person sees, use short
  sentences, no jargon. Match the copy already in the app.

## Pull requests and deploying

- `main` is production. A push to `main` deploys.
- **Changes reach `main` through a pull request**, not a direct push, unless
  Levi says to push straight to `main` for that change.
- **Squash merge**: one commit on `main` per PR, with the PR title as its
  subject. Merge only when Levi says to.
- **Once a PR is open, watch it** until CI is green and it's mergeable. Fix
  failures and answer review comments rather than leaving them for Levi.

## Before pushing

- Run the project's checks, listed in its CLAUDE.md. A red check is a broken
  release, not a warning.
- **Any UI change gets a browser test** that does what a person would do and
  reads back what was saved.
- **Commit messages:** a subject that says what changed for the user, then a
  body in plain sentences about why and how it was tested. Record bugs found
  along the way, including ones that were the test's fault.
- **Pull request descriptions** say what changed for the user, how it was
  tested (the commands and their results), and what Levi should try on their
  own devices. UI changes include screenshots at desktop and iPhone width.

## Checking it works

- **Green is not working.** More than one of these apps has had a green
  pipeline ship a broken app, or a job succeed while doing nothing. Check the
  deploy log, the data, or the running version, not the tick.
- **Every app shows its version or build commit** somewhere a person can read
  it. That's how to tell a failed deploy from a phone on a cached copy.
- **Say what was actually checked.** Never claim the deployed app works from a
  session that can't reach it. List what still needs Levi's device.
- **Fix what's true, not what the error points at.** When a fix doesn't change
  the symptom, the picture of the system is wrong, not the value.

## Secrets and personal data

- **No secrets in the repo, commits, PRs, cards or chat.** Keys live in the
  host's secret store (GitHub secrets, Supabase Vault, Cloudflare). Never ask
  Levi to paste one into a session.
- **Personal data is never committed** (exports, history, real entries). Tests
  build their own.
- If the app has a privacy policy, **keep it true**: new personal data or a new
  outside service gets described there in the same change.

## Cloud sessions

- **The network can't reach the deployed apps.** Check a deploy through its
  GitHub Actions run and the MCP tools (Supabase, Cloudflare), and ask Levi to
  read the version line when it matters.
- **There's no real iPhone.** Playwright at iPhone width covers layout. iOS-only
  behaviour (the installed PWA, Safari quirks, sensors, push, how files open)
  needs Levi to try it. Say so whenever a change depends on it.
- **A blocked host is blocked.** Don't route around a proxy 403. Say what's
  blocked, then use an MCP tool or ask.
- **The container is temporary**, and has been seen to roll back to an older
  copy mid-session. Commit and push promptly rather than batching, and before
  trusting the local tree, `git fetch` and compare it with the remote. A fresh
  container has no dependencies: install them first.
- **Playwright:** Chromium is at `/opt/pw-browsers/chromium`. Don't run
  `playwright install`.

## Code and writing

- **Match the code around you**: its naming, idiom and comment density.
- **Comments explain why**, especially where the code looks odd. Most exist
  because something surprised us. A comment that repeats the next line is worse
  than none.
- **Don't "clean up" something marked deliberate.** If a change contradicts a
  comment's reasoning, raise that first.
- **Plain English names**, no abbreviations a reader has to decode.

## What a project's CLAUDE.md holds

Only what's specific to the project, under these headings (skip any that would
be empty):

1. **What it is**: one paragraph, with links to the README and setup docs.
2. **Its board**: the Trellevi board's name, and its columns if they differ from
   To Do / In Progress / Done.
3. **Commands and checks**: install, dev, test, typecheck, build.
4. **Where things live**: the few paths that matter.
5. **Rules only this project has**: invariants, and anything that tightens or
   overrides a base rule.
6. **Traps already paid for**: things that look wrong but are deliberate.
7. **Decisions so far**: a line or two each, pointing at the card.
