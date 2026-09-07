# Hitting the right thing

## The AX summary is the map

Every `app_screenshot` returns an image **and** a list of actionable
accessibility elements, each prefixed `[N]`. That N is what `app_click`,
`app_type`, and `app_batch` take as `element_index`, and it targets the
element's centre directly.

Use it whenever the element is listed. It survives scrolling, window resizing,
and re-layout; a coordinate captured before a re-render points at whatever moved
into that spot.

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

## What `app_click` will not do

Menu-presenting controls (pop-up menus, pull-down menus, toolbar gear menus) and
right-clicks are **refused**, because opening them would bring the app to the
front and break the background contract.

The answer is almost always `app_menu` — nearly every dropdown command also
exists in the menu bar. When it genuinely doesn't (a custom in-window picker),
that is one of the few legitimate reasons to escalate to display-scope tools.

## `unsupported(canvas)`

A coordinate click on a region the app draws itself — a KiCad board, a Photoshop
document, a Keynote slide — has nothing to hit-test against. Two fallbacks:

- `element_index` from the AX summary, if the app exposes anything there.
- `target: "focused"` dispatches to the app's own focused element. This is the
  one that works for Pages/Keynote/Numbers document bodies: click into the
  document once, then `type` with `target: "focused"`.

If neither works, the app is a true canvas and you need display-scope control.

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
- `disable_substitutions: true` stops smart quotes and dashes — essential for
  code, paths, and anything a parser will read.
- Multi-line text is much faster when `clipboardWrite` was granted at
  `request_access` time; ask for it up front if you know you'll paste.
- `app_key` takes a combo string (`"cmd+s"`, `"shift+tab"`, `"return"`). Prefer
  `app_menu` for anything that has a menu equivalent — it is explicit and cannot
  be swallowed by a focused field.

## Reading state without clicking

- `app_screenshot` + the AX summary tells you what is enabled, checked, selected.
- `app_menu({ list: "편집" })` reads the menu without opening anything — the
  fastest way to learn what a command is actually called and whether it is
  available.
- `read_clipboard` (granted separately) after a Copy is often the cleanest way to
  get a value out of an app that won't let you select text otherwise.
