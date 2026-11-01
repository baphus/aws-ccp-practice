# AWS CCP Practice

A fast, mobile-first reviewer for the **AWS Certified Cloud Practitioner** exam.
1,142 practice questions, works offline, installs as an app, and stores your scores
**only on your device**.

Live: https://baphus.github.io/aws-ccp-practice/

## What it does

Two ways to study:

- **Mock Exam** (`index.html`) — pick 10 / 25 / 50 / 65, any **custom amount** from 1 to the
  full bank, or all of it. Questions are drawn at random, so every mock is different.
- **Practice Sets** (`sets.html`) — the 23 published exam sets in their original order,
  each with your last and best score.

Both share one question runner:

- One question per screen, sticky Back / Next bar, progress bar, elapsed stopwatch.
- Tap the `n / total` counter for a **numbered answer grid** — see what you have answered
  and jump anywhere before submitting.
- Single-choice questions use radios; multi-choice ("Choose TWO") use checkboxes and score
  **all-or-nothing**, exactly like the real exam.
- Skipping is allowed. Submitting with blanks asks for confirmation first.
- Results show your score, time, and a full **review with the answer text** — the correct
  option(s) highlighted, your pick marked, plus an explanation or reference link where the
  source has one.

## Your data stays local

Scores live in `localStorage` under one key (`ccp:progress:v1`). No accounts, no network
calls, no analytics.

Stored per mode: last and best score, the IDs of questions you missed (so "Practice my
missed" survives a restart), and the last 20 attempts.

The footer on both pages has three controls:

- **Export my progress** — downloads a JSON backup.
- **Import a backup** — restores a backup (validated and normalised on the way in).
- **Reset all my data** — after a confirmation, deletes every score, best result,
  missed-question list and attempt history on this device. The current screen updates
  immediately.

Clearing site data in the browser also deletes everything.

## Tech

Plain HTML, CSS and vanilla JavaScript. No framework, no bundler, no build step, no runtime
dependencies. The deployed site is exactly the files in this repo.

### Design system

The interface follows the [AWS Cloudscape](https://cloudscape.design/) design system visual
foundation. We do not ship Cloudscape's React component library — the components here are
custom DOM — but they follow its specs and tokens:

- `style.css` opens with CSS custom properties mirroring Cloudscape's CTI token names
  (`--color-background-button-primary-default`, `--border-radius-container`, …). Values are
  copied from the official `@cloudscape-design/design-tokens` package, not eyeballed.
  **Reference the variables; never hard-code hex values in component styles.**
- Blue is the primary colour (`#006ce0` light / `#42b4ff` dark). AWS orange appears only in
  the logo mark, never as an action colour.
- Pill buttons (20px radius), 16px containers, 8px inputs, 14px Open Sans body text.
- One primary action per page. Destructive confirmations use a normal button with danger
  styling rather than the primary variant.
- Full light and dark parity via `prefers-color-scheme`, using Cloudscape's paired values.

| File | Purpose |
| --- | --- |
| `index.html` | Mock exam page |
| `sets.html` | Practice sets page |
| `app.js` | Runner, results, storage |
| `style.css` | All styling |
| `manifest.webmanifest`, `sw.js` | PWA + offline |
| `data/questions.json`, `data/exams.json` | Pre-built question bank (committed) |
| `tools/sync.mjs` | Re-scrape and rebuild the question bank |

## Refreshing the questions

The question data is scraped from the upstream repo and committed, so the site itself never
talks to GitHub. To pull updates:

```bash
node tools/sync.mjs
```

This fetches all 23 source files, parses them, validates every question, prints a report
(per-set counts, answer-shape histogram, duplicate stems, warnings), and rewrites
`data/*.json`. **It refuses to write anything if validation fails** or if it parses
suspiciously few questions, so a bad scrape can never silently corrupt the bank.

After refreshing, bump `VERSION` in `sw.js` so installed clients pick up the new data.

### Why the parser is fussy

The source is Markdown prose, not machine-readable data, and it is inconsistent:

- The answer is buried in an HTML `<details>` block, in **two different layouts** — some
  files put the value on the next line, others leave a blank line first.
- Multi-answers appear as `B, E`, `AB` and `A,B`.
- Exam 13 numbers every question `1.`, so numbering cannot be used as an identifier;
  questions are delimited by `<details>` blocks instead.
- Some explanations are bare URLs in angle brackets, which a naive HTML-tag strip deletes.
- Exam 12 is truncated at 42 questions upstream (shown honestly in the UI).

`tools/sync.mjs` handles all of the above and asserts that every answer letter is a real
option.

## Tests

```bash
node tools/test-logic.mjs        # scoring rules, data integrity, debris checks
node tools/test-custom-count.mjs # custom question-count parsing and range validation
node tools/test-credit.mjs       # credit floater toggle state machine
node tools/audit.mjs             # spot-checks parsed answers against the raw Markdown
```

## Local preview

A service worker needs HTTP (`file://` will not register one):

```bash
node tools/serve.cjs . 8099
# open http://localhost:8099/
```

## Deployment

GitHub Pages, branch `master`, root folder. Every path is relative, so the site works on a
project subpath, on localhost, and on a custom domain without changes.

## Credits and licence

Questions are from
[kananinirav/AWS-Certified-Cloud-Practitioner-Notes](https://github.com/kananinirav/AWS-Certified-Cloud-Practitioner-Notes),
MIT licensed, © 2022 kananinirav. The upstream notice is kept in
[`tools/LICENSE-upstream`](tools/LICENSE-upstream).

Not affiliated with, endorsed by, or authorised by Amazon. AWS and all AWS service names are
trademarks of Amazon.com, Inc.

This project is MIT licensed — see [LICENSE](LICENSE).
