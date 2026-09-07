# App profiles

A profile is what you learned about one app's UI, written down so the next
session doesn't re-derive it. The layout discovery is the expensive part of any
desktop session; the actions are cheap.

**Profiles must come from a real session.** Do not write one from memory of what
an app's menus probably look like — menu titles differ by version and by system
language, and a confidently wrong profile is worse than no profile, because the
next run will trust it. Fill one in *after* you have driven the app, from what
`app_menu({ list: null })` and the AX summaries actually returned.

Append profiles to this file.

## Template

````markdown
## <App name>  ·  <bundle id>  ·  v<version>  ·  menus in <language>

**Access:** `request_access({ apps: ["<name>"], clipboardWrite: <t/f>, systemKeyCombos: <t/f> })`

**Windows:** what `app_list_windows` returns — main window, palettes, inspectors,
which id is the one you actually act on.

**Menu bar (verified):**
| command | path |
|---|---|
| Save | `["<file menu>", "<save item>"]` |
| Undo | `["<edit menu>", "<undo item>"]` |
| … | |

**AX coverage:** which panels expose real elements and which are canvas.
Name the roles that show up for the controls you needed.

**Canvas regions:** where coordinate clicks return `unsupported`, and what works
instead (`element_index` / `target: "focused"` / display-scope).

**Traps:** modals that appear unprompted, autosave prompts, "reload from disk"
sheets, actions that look applied but need an explicit commit, anything with no
undo.

**Undo path:** what Undo actually reverts here, and what it does not.

**A verified sequence:** a batch that is known to work, with the screenshot
points marked.
````

## Patterns by app family

Not a substitute for a profile — a starting hypothesis for what to check first.

**Spreadsheets (Numbers, Excel).** Cells are usually addressable through AX rows
and cells, but the grid may behave as a canvas. Fastest reliable path is often to
click one cell, then drive with `app_key` (`tab`, `return`, arrows) and `app_type`
with `target: "focused"`. Turn `disable_substitutions` on — autocorrect mangles
formulas. Formulas commit on Return, not on typing; screenshot after committing,
not after typing. Prefer producing the file with the spreadsheet tooling
available to you and only using the GUI for what needs the app itself.

**CAD / EDA (KiCad, and its relatives).** Almost entirely canvas. The menu bar
and the dialogs are AX-visible; the board and schematic are not. Expect to drive
via menus and dialogs, and to escalate for actual canvas manipulation. These apps
lean on modal dialogs with many fields — an `app_batch` per dialog, ending in a
screenshot, is the efficient unit. Check whether the operation you want has a
scripting or CLI equivalent before clicking anything; many do, and it will be
faster and repeatable.

**Creative tools (Photoshop, Figma desktop, video editors).** Panels are AX-rich,
the document is canvas. Tool selection is usually a single key. Layers and
properties are readable through `app_ax_find`. Figma has a first-party MCP —
use it instead of clicking.

**Document apps (Pages, Keynote, TextEdit, Notes).** `target: "focused"` is the
key: click into the body once, then type against the focused element. Formatting
lives in the menu bar and the inspector, both AX-visible.

**BI and dashboard tools.** Heavy on drag-and-drop, which the background path
cannot do — expect to escalate. Check first whether the data can be shaped
outside the app and imported; dragging fields into a canvas is the slowest
possible way to build a report.

**Installers and updaters.** Mostly plain AXButtons — background clicking works
well. Read every dialog before pressing anything: bundled extras, licence
agreements, and destination pickers all live in "Next". Never accept a licence
or change a destination the user didn't ask for.
