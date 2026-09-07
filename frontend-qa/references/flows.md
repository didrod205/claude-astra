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
