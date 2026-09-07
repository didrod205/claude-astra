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

---

## 계산기 (Calculator) · com.apple.calculator · macOS 26 · menus in Korean

Driven end to end in the background; every line here was observed, not assumed.

**Access:** `request_access({ apps: ["com.apple.calculator"] })` → tier `full`.
The display name `"계산기"` does **not** resolve — use the bundle id.

**Windows:** one, `window_id` from `open_application`'s reply. Launching in the
background does not front it.

**Menu bar (verified):** `Apple, 계산기, 편집, 보기, 윈도우, 도움말`
| command | path |
|---|---|
| basic mode | `["보기", "기본"]` |
| scientific mode | `["보기", "공학용"]` |
| programmer mode | `["보기", "프로그래머"]` |
| show history | `["보기", "기록 보기"]` |

**AX coverage:** excellent — every key is an `AXButton` with a Korean title
(`"등호"`, `"곱하기"`, `"모두 지우기"`, `"부호 변경"`). Basic mode has 27 elements,
25 actionable; the inline summary shows only the first 15, so `app_ax_find` with
`role: "AXButton"` is the way to see the rest. Scientific mode reaches 56 and the
**walk truncates** — coordinates are the documented fallback there.

**Traps:**
- The toolbar `"모드"` button is an `AXButton`, so it is not refused, but pressing
  it does nothing in the background. Use `["보기", …]` instead.
- Indices shift whenever the display gains the expression line, and are entirely
  renumbered when the mode changes (the window also goes 230 → 674 px wide).

**Undo path:** none — it is a calculator. `"모두 지우기"` resets.

**A verified sequence** (12 × 7 = 84, ending in the mandatory screenshot):

```
app_batch com.apple.calculator [
  {click element_index: 모두 지우기}, {click: 1}, {click: 2},
  {click: 곱하기}, {click: 7}, {click: 등호}, {screenshot scale: 0.5} ]
→ All 7 actions ok; display reads 84
```

## 텍스트 편집기 (TextEdit) · com.apple.TextEdit · macOS 26 · menus in Korean

**Access:** bundle id, tier `full`. `"텍스트 편집기"` does not resolve.

**Windows:** launching gives **no window** — `app_list_windows` returns `[]`.
Create one with `["파일", "신규"]` (not "새로운 항목").

**Menu bar (verified):** `파일` holds `신규 · 열기… · 닫기 · 저장 · 별도 저장… ·
복제 · PDF로 내보내기…`; `편집` holds `실행 취소 · 모두 선택 · 대체 · 맞춤법 및 문법`.

**AX coverage:** the document body is `[0] AXTextArea` — fully writable with
`app_type({ element_index: 0 })`, no canvas fallback needed. The format bar is
`AXCheckBox/AXSegment` for bold/italic and `AXPopUpButton` for 글자체 / 스타일 /
줄 간격, plus `AXMenuButton` for 목록 스타일.

**Traps:**
- `AXPopUpButton '글자체'` is refused — correctly, with guidance.
- **`편집 > 실행 취소` is disabled immediately after a background `app_type`.** The
  write goes through `AXSelectedText` and never enters TextEdit's undo stack. Do
  not plan on undoing a background edit.
- `파일 > 닫기` is disabled while the app is not frontmost, so you cannot tidy up
  the window you created from the background.
- `app_key delete` on a non-empty text area is refused; emptying a field means
  `app_type` with `mode: "replace"` and `overwrite_existing: true`.
- Autosave gives an untitled document a `.rtf` name in the title bar without
  writing a file to disk.

**Undo path:** the `overwrite_existing: true` result, which returns the previous
content verbatim for you to write back. Nothing else.
