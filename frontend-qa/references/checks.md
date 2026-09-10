# What the sweep checks

`qa-run.mjs` loads the page at each width, waits `--wait` ms (default 800) after
load, runs `probes.js` in the page, and screenshots. Errors mean broken;
warnings mean look.

## Errors

| check | threshold | what it means |
|---|---|---|
| `viewport` | mobile widths only: no `<meta name="viewport">`, or one without `width=device-width` | **fix this before reading anything else about mobile.** A phone lays such a page out at ~980px and scales it down: the site is unreadable, and every width-based check below was measured in a 980px viewport that does not exist on screen. A 460px element in a "390px" run reports no overflow, because the run was really 980px wide |
| `console` | any `console.error` or uncaught exception | the page is throwing. Fix before anything else — downstream flows fail for unrelated reasons |
| `clipped` | content wider than the viewport that produces no scrollbar | centred overflow (`place-content:center`, `margin:auto`) is cut off on both sides rather than scrollable, so `scrollWidth` never grows and the `overflow` check cannot see it |
| `network` | any failed request, or HTTP ≥ 400 | a missing asset or a broken endpoint. `favicon.ico` is filtered out |
| `overflow` | `documentElement.scrollWidth > clientWidth + 1` | the body scrolls sideways. The narrowest overflowing element is named — that's the culprit, not its stretched ancestors |
| `image` | `naturalWidth === 0` after load | broken `src`, wrong path, or a blocked host |
| `dom` | the same `id` twice | breaks `label[for]`, in-page anchors, and every `getElementById` after the first |
| `contrast` | text below WCAG AA — 4.5:1, or 3:1 for large text (≥24px, or ≥18.66px bold) | computed from the text colour and the first opaque background above it. Text sitting on an image or gradient is counted as **unverifiable** and reported separately, never guessed at |
| `probe` | probes threw | usually a CSP blocking evaluation, or the page navigated mid-run |

## Warnings

| check | threshold | note |
|---|---|---|
| `a11y` image alt | visible `<img>` with no `alt` attribute | `alt=""` is correct for decorative images and is not flagged |
| `a11y` control name | visible button/link/`role=button` with no text, `aria-label`, `title`, or labelled child | icon-only buttons are the usual hit |
| `a11y` field label | visible input/select/textarea with no `<label for>`, wrapping label, or aria label | a `placeholder` is not a label |
| `a11y` heading order | a jump of more than one level, or ≠ 1 visible `<h1>` | |
| `link` | `href` missing, empty, or `#` | either a real dead link or a button wearing an anchor |
| `touch` | tap target under 44×44 CSS px | **mobile widths only** (< 500px) |
| `meta` | no `<title>` | |
| `canvas` | a `<canvas>` that is the largest thing on the page and has no accessible name, role or `tabindex` | the application is invisible to assistive technology and to the keyboard — **and every other check on this page is close to meaningless**, because they are shaped around DOM widgets. A canvas game with no DOM controls also produces zero `link` and zero `touch` findings, which reads as "nothing wrong" and means "there is nothing to press" |
| `a11y` focus | a control whose computed style does not change when focused | `outline: none` with nothing put back. Needs `Emulation.setFocusEmulationEnabled`, which the runner turns on — without it a headless page is never window-focused, `:focus` never matches, and every focus style silently reads as absent |

## Read the findings in this order

Two of these checks invalidate the others when they fire, so the report is not a
flat list:

1. **`viewport`** — until the page declares `width=device-width`, no mobile
   measurement in the report means what it says.
2. **`console`** — a page throwing on load fails flows for reasons unrelated to
   the flow.

Everything else can be read in any order.

## What it cannot see

The sweep is a static snapshot of the loaded page. It does not know about:

- **Anything behind an interaction.** Menus, modals, tabs, accordions, and every
  route you have to click to reach are invisible to it. That is what the flow
  half is for.
- **A canvas application, almost entirely.** A sweep of a canvas game came back
  with one error and one warning for a page that is unplayable on the width it
  had just measured. The `canvas` finding exists to say so out loud: **a clean
  sweep on a canvas app means almost nothing.** Drive it.
- **Visual hierarchy, overlap, z-index.** Read the screenshots.
- **Contrast over an image or a gradient.** Reported as a count of unverifiable
  elements. Judge those by eye — the tool declines rather than guessing.
- **Whether the content is correct.** A page can be flawless and show the wrong
  price.
- **Slow or late failures.** Raise `--wait` for a heavy SPA; a request that
  fails at 3s is missed at the default 800ms.
- **Client-side routing.** Each width loads the entry URL only. Sweep other
  routes by passing their URLs.
- **Real device behaviour.** Mobile width emulates touch and a small viewport,
  not iOS Safari's quirks.

## Tuning

```bash
--widths 390,768,1440   # default. 390 = iPhone, 768 = tablet, 1440 = laptop
--wait 2500             # SPA that fetches after paint
--out qa                # screenshot directory
--json                  # full findings + shot paths, for further processing
```

Add a check by editing `probes.js` — it returns one JSON object, and `qa-run.mjs`
turns fields into findings. Keep probes to DOM facts; leave judgement to the
report.


## Keyboard reachability — `keyboard.mjs`

Separate from the sweep, and separate from the `focus` check inside it. The
sweep's `focus` check asks whether a focused control looks focused; this asks
whether Tab can get to it at all. They fail independently: a `<div onclick>`
styled as a button has no focus style to check and never receives focus, so the
sweep has nothing to say about it.

```bash
node scripts/keyboard.mjs <url> [--width 1280] [--max 120]
```

**Where the inventory starts is the whole design.** Enumerate focusable elements
and Tab-walk them and every page passes, because the elements that are missing
from the Tab path are by definition the ones that selector does not match. So the
inventory starts from **what a mouse can operate**: focusable elements, plus
anything visible with an `onclick` or `cursor: pointer` and a short label that is
not already inside a control. Everything in that set is expected on the Tab path.

| reported | usual cause |
|---|---|
| *painted like a control, but is not one* | `<div onclick>` / `<span class="btn">`. Use a `<button>`, or `role="button"` **and** `tabindex="0"` **and** an Enter/Space handler |
| *tabindex="-1"* | deliberately removed from the tab order and never put back. Legitimate for a control you focus programmatically (a dialog), a defect for anything a user is meant to press |
| *focusable, but Tab does not arrive* | a focus trap, an `inert` ancestor, or a listener calling `preventDefault()` on Tab |
| *focus jumps back up the page* | positive `tabindex` values. They jump ahead of everything with `tabindex="0"`, so the order stops matching the layout |

The page must be focus-emulated (`Emulation.setFocusEmulationEnabled`) or Tab
goes nowhere at all, the same trap the sweep documents for `:focus`.

**Blind spots.** It does not press Enter or Space, so a `role="button"` with a
tabindex and no key handler passes — it is on the Tab path and does nothing.
It does not test arrow-key navigation inside composite widgets (menus, grids,
tab lists), where the correct pattern is one tab stop and arrows within. And a
`cursor: pointer` on a decorative card is a false positive; read the list.
