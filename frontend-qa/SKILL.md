---
name: frontend-qa
description: >-
  Verify a web page or app actually works by driving it in a real browser —
  clicking the flows, watching the console and network, checking three viewport
  widths — and report what is broken with evidence. Use after building or
  changing a front end, and whenever someone asks to test/QA/verify a site, check
  that a feature works, find why a button or form does nothing, review before
  shipping, or check responsive and accessibility basics — "테스트해줘",
  "동작 확인해줘", "QA 좀", "배포 전에 확인", "이거 왜 안 눌려". Also use on your own
  work before calling it done: a change you have not clicked is not verified.
  NOT for writing unit or E2E test suites (that is authoring tests, not running
  QA), backend/API testing, or full SEO or performance audits.
---

# Frontend QA

## The rule this exists to enforce

**A feature you have not clicked is not done.** The build passing, the diff
looking right, and the screenshot looking right are three things that are all
true of pages where the submit button throws on click. Every claim you make
about the page has to trace to something you observed in a browser.

## Two halves, both required

| | tool | catches |
|---|---|---|
| **Sweep** | `scripts/qa-run.mjs` | everything static and repeatable: console errors, failed requests, overflow, broken images, a11y basics, three widths |
| **Flows** | the Browser tools (`mcp__Claude_Browser__*`) | everything that needs a click: does submit submit, does the empty state appear, does the error path recover |

The sweep is cheap and total — run it first, always, and fix its errors before
touching anything else, because a page throwing on load will fail every flow for
reasons that have nothing to do with the flow.

## 1. Sweep

```bash
node scripts/qa-run.mjs http://localhost:3000
node scripts/qa-run.mjs ./dist --widths 390,768,1440 --out qa
```

Takes a URL, a directory, or an HTML file (local paths get served for you).
Exit 0 clean · 1 warnings · 2 errors. `--json` for machine output.

Findings identical at every width are printed once; the rest are grouped by the
width where they appear, so responsive breakage stands out from real breakage.
A screenshot per width lands in `--out`. **Read them** — the sweep cannot see
that the hero text is white on white.

`references/checks.md` lists every check, its threshold, and what it cannot see.

## 2. Flows

Derive the flows from what actually changed, not from a generic checklist. For a
diff, the flows are the paths through the code you touched. For a whole app, the
flows are what a user came to do.

For each flow, drive it in the browser and assert on **state, not vibes**:

```
navigate → read_page (get refs) → computer/form_input (act)
        → read_page again (did the DOM change as intended?)
        → read_console_messages (did acting throw?)
        → read_network_requests (did the request fire, with what status?)
```

`read_page` before and after is the assertion. "I clicked it and the screenshot
looks fine" is not — a click that silently no-ops looks identical.

Cover, per flow: **the happy path, the empty state, and one failure.** The
failure path is where front ends are actually broken — submit with a blank
required field, with a bad email, with the network refusing. Most bugs worth
finding live there. `references/flows.md` has the derivation method and the
patterns per flow type.

## 2b. The same page without a mouse

The sweep checks that a focused control *looks* focused. That is a different
question from whether you can get to it, and they are tested by different means:
`el.focus()` always works, pressing Tab does not.

```bash
node scripts/keyboard.mjs http://localhost:3000/checkout
```

It presses Tab from the top of the document and records where focus actually
lands, then compares that against everything on the page a mouse can operate —
including the things that are controls *only* if you have a mouse.

```
  Tab reaches 4 stop(s) before the order repeats.
  4 of 6 visible, enabled controls are on that path.

  clickable, but Tab never gets there:
    button#save          “Save for later” — tabindex="-1"
    div#pay.btn          “Pay now” — painted like a control, but is not one

  focus jumps back up the page 1 time(s) — the tab order does not follow the layout:
    Cancel (y 355)  ->  Terms and conditions (y 315)
```

That page's primary action cannot be reached without a mouse, and the sweep
reported nothing but a tap-target warning. **Start the inventory from what a
mouse can click, not from a focusable selector** — a `<div onclick>` matches no
focusable selector, so a check built on one can never see it. The first version
of this script called that page "4 of 4 controls reachable".

Exit 0 clean · 1 something clickable is off the Tab path.

## 3. Report

Lead with the verdict, then evidence, then everything you could not check.

```
Verified: 4 flows, 3 widths.  2 broken, 1 degraded.

BROKEN  Checkout submit does nothing when the promo field is empty
        POST /api/checkout never fires; console: TypeError: Cannot read
        properties of null (reading 'value') at checkout.js:88
        Repro: /cart → Checkout → leave promo blank → Place order
BROKEN  Product grid overflows at 390px (+120px) — .grid has min-width:510px
DEGRADED  Search returns results but the empty state is a blank panel
OK      login, signup, add-to-cart, nav at all three widths
NOT CHECKED  payment (needs a live Stripe key), email delivery
```

Rules for the report:

- Every BROKEN line carries a **reproduction** and the **evidence** (the console
  line, the status code, the measured overflow). No evidence, no finding.
- **NOT CHECKED is mandatory.** Anything gated behind credentials, payment, or a
  third-party service is a gap, and silently omitting it reads as a pass.
- Do not report style opinions as bugs. "The spacing feels tight" is feedback;
  "the button is 33×18 and unreachable on touch" is a finding.
- If you fixed something while testing, say so and re-run the sweep — a fix you
  have not re-verified is in exactly the state you started in.

## Boundaries

Do not, without the user asking in this session: submit a form that sends real
data, complete a purchase, accept terms or cookie banners on their behalf, or
enter credentials. Test against local, staging, or seeded accounts. On a live
site, restrict yourself to read-only navigation and say so in the report.

## Files

- `scripts/qa-run.mjs` — the sweep. Zero-dependency Node 22+, headless Chrome
- `scripts/keyboard.mjs` — the Tab walk: what a mouse can reach and Tab cannot
- `scripts/probes.js` — the in-page checks (edit here to add one)
- `scripts/lib.mjs` — static server, Chrome launcher, CDP client
- `references/checks.md` — every check, its threshold, its blind spots
- `references/flows.md` — deriving flows, driving them, asserting on them
