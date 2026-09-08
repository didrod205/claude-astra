# Driving the flows

The sweep proves the page loads. Flows prove it works. This half runs on the
Browser tools (`mcp__Claude_Browser__*`).

## Deriving the flows

Do not run a generic checklist. Derive from what is in front of you:

| you have | the flows are |
|---|---|
| a diff | every path through the code you touched, plus whatever calls it |
| a feature request | the thing the user asked for, done end to end, the way a user would |
| a whole app, cold | what the app is *for* — the two or three journeys everything else exists to support |
| a bug report | the exact repro first, then the two neighbouring paths |

Three to six flows is usually right. Twelve shallow ones find less than four
deep ones.

## The loop, per flow

```
navigate                  → the entry point
read_page                 → refs + the "before" state
computer / form_input     → act, one step at a time
read_page                 → the "after" state. THIS IS THE ASSERTION
read_console_messages     → did acting throw?
read_network_requests     → did the request fire, with what status and body?
```

`browser_batch` collapses this into one round trip when you can predict the next
few steps — navigate, click field, type, press Return, screenshot. Use it once
you know the page; use single calls while you are still learning it.

**Prefer `read_page` refs over pixel coordinates.** `ref_12` survives a re-render
and a layout shift; `(412, 380)` does not. Fall back to coordinates only for
canvas and custom-drawn widgets.

**On a canvas app there are no refs at all.** `read_page` returns the DOM around
the canvas and nothing of the application; the game or editor is not in the
accessibility tree. Two mechanics of coordinate clicking that are easy to lose
half an hour to:

- `left_click` by coordinate **refuses to run without a prior
  `computer{action:"screenshot"}`** — "no screenshot dimensions cached".
- The screenshot's coordinate frame is **not the CSS viewport**: 800×500 for a
  1440×900 viewport, 750×1624 for 375×812. Every coordinate off
  `getBoundingClientRect` needs rescaling.

**`left_click` can stop working after `resize_window`.** A click that worked at
the desktop viewport timed out after 30 s with "the Browser pane is currently
hidden" once the same page was reloaded at `preset: "mobile"`. Dispatching a
`PointerEvent` from JS still works, but it is a weaker assertion — say so in the
report rather than pretending you clicked.

## Two things that will make your report wrong

Both were found by actually driving a page, and neither is visible from the docs.

### The pane is hidden, so `requestAnimationFrame` never fires

`document.visibilityState` is `"hidden"` while the Browser pane is not displayed
— and fronting the tab does not change it, because it is the *pane*, not the tab,
that is hidden. Nothing driven by a frame loop advances: a canvas game, an
animated chart, a counter updated inside `draw()`, a progress bar. Waiting does
not help; a page frozen this way looks exactly like a page that is broken.

```js
document.visibilityState   // "hidden" → rAF is paused. Read this BEFORE
                           //            concluding an animated UI is stale.
```

Driving a real 1.5 seconds against such a page left `tick` at 0 and the HUD
reading its initial value while the internal state had already changed — a
tester reading only the DOM would have filed "the counter never updates" against
working code.

What to do:

- **Assert on state that changes synchronously with the event**, not on whatever
  the render loop paints. A well-built page updates its model on the click; only
  the painting waits for the frame.
- **Drive the loop yourself** when the app exposes a way. This is not a
  workaround — for a canvas app it is the primary way to test, and you should
  look for it *first*: `window.__game` (anything from `playable-prototype` has
  it), a tick or update function, a store you can step. `__game.step(300)` made
  a frozen page's DOM read `landed 1` correctly, and made a 20 000-tick soak
  possible in seconds.
- **Say so in the report.** "Not checked: anything that only updates on a frame
  loop" is an honest line; a false bug is not.

### Click the page once before you test any keyboard input

**Before a real click lands in the page, `computer{action:"key"}` events do not
reach it at all.** The tool reports `pressed space x1`; a capture-phase listener
on `window` records nothing, with `document.hasFocus()` true and `activeElement`
on `BODY`. One real `left_click` on the page and the identical calls start
arriving.

This manufactures false bugs. Press Space, observe nothing, file "Space doesn't
start the game" — against working code. Click first, every time.

Once events do land, they are still lossy: they arrive **without `e.code`**.
`ArrowRight` comes through on `e.key` alone, and **`space` arrives with `key`
and `code` both empty, so it cannot be sent through this tool at all.** Any
handler written as `KEYS[e.code]` — the common form — silently never fires.

So: prefer pointer interaction or the app's own API for anything load-bearing.
If a key genuinely does nothing, check whether the handler reads `e.code`, and
whether you have clicked the page, before filing it as a bug.

## What "assert" means here

| bad | good |
|---|---|
| "clicked submit, looks fine" | "after submit, `read_page` shows the confirmation heading and the form is gone" |
| "the form works" | "POST /api/signup → 201; the row appears in the list" |
| "no errors" | "`read_console_messages` returned 0 entries after the click" |
| "responsive is ok" | "at 390px the nav collapses to the menu button and the grid is one column" |

A click that silently no-ops produces an identical screenshot to a click that
worked. Only the DOM, the console, and the network tell them apart.

## Cover three states per flow

**Happy path** — the intended journey, completed.

**Empty / initial state** — no results, no items, first visit. Frequently
shipped as a blank white panel because nobody looked at it.

**Failure** — the highest-yield of the three:

- required field left blank; whitespace-only input
- an invalid value (a malformed email, a negative quantity, a past date)
- an over-long string in a field with no `maxlength`
- submitting twice fast (double-submit guard?)
- the back button after a submit
- a request that fails — block it, or point the app at a bad endpoint

Check that failure is *handled*, not just that it fails: an inline message the
user can act on, focus moved to the problem, and the entered data still there.
Silent failure and a wall of stack trace are both findings.

## Responsive

Use `resize_window` with `preset: "mobile" | "tablet" | "desktop"`, and reload
after switching — load-time device gates will not re-run otherwise. Reset with
`preset: "desktop"` when you are finished; the emulated size sticks to the tab.

Check per width: nothing overflows sideways, the nav is reachable, text is
readable without zoom, tap targets are ≥ 44px, no content is clipped or hidden
behind a fixed bar.

## Common front-end failures worth probing

- a button that is an `<a href="#">` — works with a mouse, not with the keyboard
- state that survives a reload when it should not, or does not when it should
- a modal that traps scroll, or one you cannot close with Escape
- a list that renders before the data and flashes empty
- a form that clears itself on a validation error
- an infinite spinner where the request already 500'd
- anything that only works the *first* time

## Safety while testing

Never, unless the user asked for it in this session: send a real message, place
an order, accept terms or a cookie banner, or type credentials. Prefer local or
staging. On production, stay read-only and say so in the report.
