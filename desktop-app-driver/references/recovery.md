# When it doesn't land

Work down this list. Do not repeat the same call hoping for a different result —
after two identical failures the cause is structural.

## 1. Read what came back

| result | means | do |
|---|---|---|
| `ineffective` | the write was accepted, the app hasn't visibly responded | screenshot. It may have worked. If not, the target was wrong |
| plain `ok` | the action was **dispatched**, not that it worked | still screenshot. `ok (AXPress on AXButton '모드')` came back from a press that changed nothing at all |
| `disabled` on a menu item | the item exists but is greyed out — usually the app is not frontmost or has no key window | fix the precondition; do not retry |
| `unsupported(canvas)` | nothing hit-testable at that coordinate | retry with `element_index`, then `target: "focused"` |
| refused (menu control) | you clicked a dropdown / gear / right-click | use `app_menu` |
| a tier error | the app is granted read-only or click-only | browsers → browser tools; terminals and IDEs → Bash |
| not granted | app missing from the session grant | `request_access` again with it added |

## 2. Screenshot and look

Nine times in ten the screenshot answers it immediately:

- **A modal or sheet is open.** A save dialog, an alert, an autosave prompt, a
  "document was changed by another application" sheet. It swallowed your click.
  Deal with the dialog first; read its buttons from the AX summary rather than
  assuming which is default.
- **The layout moved.** A panel opened, the window resized, content scrolled.
  Your coordinate is stale. Re-screenshot and re-target.
- **The control is disabled.** Nothing is selected, the document is read-only, a
  prerequisite step didn't happen. Fix the precondition.
- **Focus is elsewhere.** Typing went into another field. Click the field first,
  verify the caret in the screenshot, then type.
- **Wrong window.** Same app, second document. Check `window_id` against
  `app_list_windows`.
- **Nothing changed at all.** The app is busy or beachballing. Wait and
  re-screenshot once before concluding anything.

## 3. Change approach, not force

- Coordinate failing → `element_index`.
- `element_index` failing → `app_ax_find` for the real element.
- Both failing → `app_menu` for the command instead of the button.
- No menu equivalent → escalate to display-scope, telling the user why.

## 4. Batches

`app_batch` stops on the first error, but **not** on `ineffective` — and a
silently-no-op press reports plain `ok`, which is not an error either. So a batch
can report "All 7 actions ok" while one step did nothing and the rest acted on
the wrong state. Two habits fix this:

- End every batch with `{"action":"screenshot"}`.
- Keep destructive actions out of long batches. Run them as single calls with a
  screenshot either side.

When a batch fails partway, do not re-run it whole — the earlier actions already
applied and re-applying them may double the effect. The result tells you where:
a refused `delete` reported `Batch stopped at actions[2] (key). Completed 2 of 4;
1 not run.` Screenshot, confirm that reading, resume from there.

## 5. Off-Space and locked screens

An `is_off_space: true` window returns an **empty accessibility walk** — no
indices, and coordinate clicks refused as unverifiable. `app_bring_to_current_space`
is the documented fix, and it fails in two ways worth recognising:

- *"the user's current Space is a full-screen app"* — a window cannot be moved
  into a full-screen Space. Ask the user to leave full screen.
- It reports *"already on the current Space"* while clicks still refuse with
  *"this window is on another Space"*. The tools disagree because a **locked
  screen looks exactly like an off-Space window** from the background. Nothing
  will work until the screen is unlocked; stop and say so.

## 6. When you are properly stuck

Stop and tell the user, with:

- what you were trying to do, in their terms
- what you observed (the screenshot, the exact result string)
- what you already tried
- what you think is in the way, and the one thing you'd need from them

A precise stop after four attempts is worth more than twenty attempts and a
guess. If you changed anything before getting stuck, say exactly what — leaving a
document half-edited without saying so is the worst outcome of a failed session.
