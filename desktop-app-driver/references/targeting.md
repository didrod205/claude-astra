# Hitting the right thing

## The AX summary is the map

Every `app_screenshot` returns an image **and** a list of actionable
accessibility elements, each prefixed `[N]`. That N is what `app_click`,
`app_type`, and `app_batch` take as `element_index`, and it targets the
element's centre directly.

Use it whenever the element is listed — it targets the element's own centre
rather than hit-testing a point, so it works where a coordinate lands on an
overlay or a container.

**But the numbering is rebuilt on every screenshot.** It is an index into that
one summary, not an identity. A single Calculator batch shifted every index by
one because the expression line appeared; switching the window to scientific mode
renumbered all 56 elements and changed the window's width from 230 to 674. Both
`element_index` and `coordinate` are anchored to the last screenshot. Re-read
after anything that changes the window.

The inline summary is short — only the first few actionable elements. When what
you need isn't there:

```
app_ax_find({ app, role: "AXButton", title_contains: "저장" })
```

It searches the elements captured by the **last `app_screenshot` of that
window**, so screenshot first. Both filters are optional; omit `role` to search
by title alone.

### Roles worth knowing

| role | is |
|---|---|
| `AXButton` | button |
| `AXTextField` / `AXTextArea` | single-line / multi-line input |
| `AXCheckBox` / `AXRadioButton` | toggles |
| `AXPopUpButton` | a dropdown — **`app_click` refuses it**, see below |
| `AXComboBox` | editable dropdown |
| `AXMenuButton` | a toolbar button that opens a menu — also refused |
| `AXRow` / `AXCell` | table contents |
| `AXTabGroup` | tab bar |
| `AXStaticText` | a label; useful for reading state, not for clicking |
| `AXGroup` / `AXSplitGroup` | containers; search inside them |

## What `app_click` will not do — and what it will do badly

An `AXPopUpButton`, an `AXMenuButton`, or a right-click is **refused outright**,
because opening the menu would front the app. The error is good: it names
`app_menu` and `app_release` as the ways forward. TextEdit's font picker
(`AXPopUpButton '글자체'`) behaves exactly this way.

**A plain `AXButton` that opens a menu is not refused.** Calculator's toolbar
"모드" button returned `ok (AXPress on AXButton '모드' via AXWindow>AXToolbar)`
and the window was untouched — no menu, no mode change, no error. The guard keys
off the accessibility role, not off what the control actually does, so a
success result here means "the press was dispatched", not "the thing happened".

The answer to both is almost always `app_menu` — nearly every dropdown command
also exists in the menu bar, and `보기 > 공학용` switched the mode instantly after
the button press had silently failed. When there genuinely is no menu equivalent
(a custom in-window picker), that is one of the few legitimate reasons to
escalate to display-scope tools.

## `unsupported(canvas)`

A coordinate click on a region the app draws itself — a KiCad board, a Photoshop
document, a Keynote slide — has nothing to hit-test against. Two fallbacks:

- `element_index` from the AX summary, if the app exposes anything there.
- `target: "focused"` dispatches to the app's own focused element. This is the
  one that works for Pages/Keynote/Numbers document bodies: click into the
  document once, then `type` with `target: "focused"`.

If neither works, the app is a true canvas and you need display-scope control.

## When the AX walk truncates

A large window can exceed the accessibility walk, and the summary says so:

```
…(the accessibility walk was truncated — parts of this window's UI are NOT
listed here or in app_ax_find; use coordinates from the screenshot for
anything you can see but can't find by index)
```

That is the one case where **coordinates outrank `element_index`**, and
`app_ax_find` will not rescue you — it searches the same truncated capture.
Calculator in scientific mode hits this at 56 elements.

## Coordinates, when you must

- They are **window-local**, in the full-resolution frame of the most recent
  `app_screenshot` of that window. A scaled screenshot reports that frame back —
  never measure off the scaled image's own pixels.
- (0,0) is the window's top-left, not the screen's.
- A screenshot inside `app_batch` re-anchors every coordinate and index after it.
- Re-screenshot after anything that could move the layout: a resize, a scroll, a
  panel opening, a document loading.

## Windows

`app_list_windows` gives ids. Targeting is per-call: pass `window_id` to act on a
different one — there is no "switch window" tool. Omitting it uses the window you
most recently screenshotted for that app.

`app_bring_to_current_space` is for a window on another Space or minimised.

## Typing

- `app_type` with `mode: "replace"` overwrites the field; `"insert"` adds at the
  cursor. Replace is usually what you want for a field you are setting.
- Replacing a **non-empty** field is refused unless you pass
  `overwrite_existing: true`, and that flag makes the call return the previous
  content so you can restore it. Since a background write often does not reach
  the app's undo stack, that returned value **is** your undo — keep it.
- `disable_substitutions: true` stops smart quotes and dashes — essential for
  code, paths, and anything a parser will read.
- Multi-line text is much faster when `clipboardWrite` was granted at
  `request_access` time; ask for it up front if you know you'll paste.
- `app_key` in the background accepts only `return`, `escape`, `backspace`,
  `delete`, and `cmd+a`. Everything else needs the menu bar, which you should
  prefer anyway — `app_menu` is explicit and cannot be swallowed by a focused
  field. Even the allowed keys can refuse: `delete` on a non-empty text area was
  blocked because the only background fallback would have replaced the whole
  field.

## Reading state without clicking

- `app_screenshot` + the AX summary tells you what is enabled, checked, selected.
- `app_menu({ list: "편집" })` reads the menu without opening anything — the
  fastest way to learn what a command is actually called and whether it is
  available.
- `read_clipboard` (granted separately) after a Copy is often the cleanest way to
  get a value out of an app that won't let you select text otherwise.
