# What the sweep checks

`qa-run.mjs` loads the page at each width, waits `--wait` ms (default 800) after
load, runs `probes.js` in the page, and screenshots. Errors mean broken;
warnings mean look.

## Errors

| check | threshold | what it means |
|---|---|---|
| `console` | any `console.error` or uncaught exception | the page is throwing. Fix before anything else — downstream flows fail for unrelated reasons |
| `network` | any failed request, or HTTP ≥ 400 | a missing asset or a broken endpoint. `favicon.ico` is filtered out |
| `overflow` | `documentElement.scrollWidth > clientWidth + 1` | the body scrolls sideways. The narrowest overflowing element is named — that's the culprit, not its stretched ancestors |
| `image` | `naturalWidth === 0` after load | broken `src`, wrong path, or a blocked host |
| `dom` | the same `id` twice | breaks `label[for]`, in-page anchors, and every `getElementById` after the first |
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

## What it cannot see

The sweep is a static snapshot of the loaded page. It does not know about:

- **Anything behind an interaction.** Menus, modals, tabs, accordions, and every
  route you have to click to reach are invisible to it. That is what the flow
  half is for.
- **Colour contrast, visual hierarchy, overlap, z-index.** Read the screenshots.
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
