# claude-astra

Five Claude skills for work that happens outside a text editor: building 3D
scenes you can walk, prototyping playable games, driving native desktop apps,
matching a house document style, and verifying a front end by actually clicking
it.

Each is a self-contained directory — a `SKILL.md` with the method, `references/`
for the detail, and `scripts/` where the work is deterministic enough to
automate. Those scripts are dependency-free — Node driving headless Chrome over
the DevTools protocol, or Python standard library. Nothing to install.

| skill | does |
|---|---|
| [`walkable-3d`](walkable-3d) | prompt / photo / sketch → a walkable Three.js scene, structurally audited, exported to `.glb` with every object still named and separable for Blender or Unreal |
| [`desktop-app-driver`](desktop-app-driver) | operate native Mac apps through the accessibility tree — in the background, while the user keeps working |
| [`playable-prototype`](playable-prototype) | one brief → several genuinely different browser game prototypes, each proven playable by a bot that presses the buttons |
| [`frontend-qa`](frontend-qa) | verify a page at three widths and drive its real flows, then report what's broken with evidence |
| [`house-style`](house-style) | pull the house style out of the user's own documents, then check new ones actually match it |

## The thing they have in common

Each one is built around a verification loop, because in all five domains the
work *looks* finished long before it *is* finished.

A generated 3D scene renders something, and that something is usually floating,
hollow, or wrong-scaled in ways one screenshot hides — so `walkable-3d` ships an
audit that fails the build when the player would spawn inside a wall, and a
screenshot tool that takes six angles because five of them are the ones you
didn't think to check.

A click that silently no-ops produces the same screenshot as one that worked — so
`frontend-qa` asserts on the DOM, the console, and the network, never on vibes.

A desktop action can report success and do nothing — so `desktop-app-driver`
ends every batch with a screenshot and treats `ineffective` as unproven.

A game that renders is not a game that plays — one of the four buttons does
nothing, or the score can never go up, and no screenshot shows it. So every
prototype `playable-prototype` produces exposes a small machine API, and a bot
plays it: holds each input and checks the world responded, runs the same seed
twice and checks it agrees, plays at random and checks it can score.

And "make it match our template" is guessing until you read the template — so
`house-style` unzips it, takes the theme fonts, the palette, the size ladder and
the layout names, and diffs the finished file back against them.

## Verified

`./verify.sh` reproduces every claim below. 17 checks, no arguments, no setup —
it builds its own fixtures in a temp directory and cleans up after itself.

```
walkable-3d
  ok    audit passes on the bundled scene
  ok    audit fails a scene with the player trapped in geometry
  ok    shot.mjs renders a frame headlessly
  ok    --plan cuts through the roof for an interior view
  ok    glTF export keeps object names and parenting
playable-prototype
  ok    the bundled game passes the playtest
  ok    playtest rejects a prototype with no API and one that is non-deterministic
  ok    playtest accepts a turn-based prototype that idles without advancing
frontend-qa
  ok    sweep passes a clean page
  ok    sweep catches console errors, overflow, broken images and duplicate ids
  ok    sweep flags a page with no viewport meta
house-style
  ok    pdf: the reference matches its own spec
  ok    pdf: a drifted file is caught on face, colour and size
  ok    docx: a real Word file matches its own spec
  ok    pptx: a real PowerPoint file matches its own spec
  ok    docx: off-house face and off-ladder size are caught
  ok    pptx: off-house face, 16:9 geometry and off-ladder size are caught
```

Every check is run **both ways** — a good input must pass and a deliberately
broken one must fail. A checker that only ever sees valid input is not a checker.

The `house-style` Office fixtures are the Word and PowerPoint templates bundled
with `python-docx` and `python-pptx`, which are genuine Microsoft Office output
(`Application=Microsoft Macintosh Word 14.0000`), plus generated decks and
documents carrying charts, tables, notes and page breaks. `style.py` itself is
run by the system `python3` on the standard library alone, so the no-dependency
claim is checked at the same time. Those two libraries are only needed to *build*
the fixtures; without them the four Office checks are skipped with a note, never
silently passed. Same for PyMuPDF and the two PDF checks.

### What this does not cover

No skill's *judgement* is tested here, only its tooling. `verify.sh` proves the
audit catches a trapped spawn — not that a scene looks good; proves the sweep
catches an overflow — not that a page is usable; proves the playtest catches a
dead input — not that a game is fun.

`desktop-app-driver` is absent from `verify.sh` and always will be: it drives the
user's own machine through a permission dialog, so there is nothing to automate.
It was instead **driven by hand** against Calculator and TextEdit — computing
12 × 7, switching modes through the menu bar, typing into a document, and
deliberately provoking the failure paths. That session corrected six things in
the skill, three of them claims that were simply wrong:

- `element_index` was described as surviving re-layout. It does not — the
  numbering is rebuilt on every screenshot, and one batch shifted every index.
- Menu-presenting controls were described as refused. An `AXPopUpButton` is; a
  plain `AXButton` that opens a menu returns `ok` and silently does nothing.
- "Know the undo path first" was described as reading the Edit menu. Undo was
  *listed and disabled* right after a background write, because the write never
  reached the app's undo stack.

The two apps are now written up as verified profiles in
[`references/app-profiles.md`](desktop-app-driver/references/app-profiles.md).

Dogfooding the three generation loops — authoring a two-storey townhouse from a
brief, spinning three lighthouse prototypes out of one idea, and sweeping them —
found four more defects, each now pinned by a check above:

- The six default 3D shots **cannot see inside a roofed building**, and the docs
  called the top-down "the highest-value image" while it showed a roof. `--plan`
  cuts through at a given height; one cut revealed the stairs, the stairwell
  opening and the furniture that four brick elevations had hidden.
- The playtest failed a **turn-based** prototype for "tick never advanced" —
  contradicting the turn-based pattern its own reference documents. Determinism
  and the bot run now decide that verdict, not the idle run.
- A page with **no `<meta name="viewport">`** was swept clean at 390px. A phone
  lays such a page out at ~980px and scales it down, so nothing overflowed —
  the missing tag was masking every responsive finding. Adding the check turned
  one silent pass into a correct "overflows by 35px".
- Passing a directory with no `index.html` produced a confusing 404 report
  instead of saying so.

Driving the flows half against a live prototype — the click-through session the
sweep cannot do — found two more, both of the kind that make a QA report *wrong*
rather than incomplete:

- **`requestAnimationFrame` never fires while the browser pane is hidden**, and
  fronting the tab does not help because it is the pane that is hidden. Driving a
  real 1.5 seconds left the game's `tick` at 0 and its DOM counters at their
  initial values while the internal state had already changed. A tester reading
  only the DOM would have filed "the counter never updates" against working code.
- **Synthetic key events arrive without `e.code`** — `ArrowRight` came through on
  `e.key` alone, and `space` with both fields empty — so any handler written as
  `KEYS[e.code]`, the common form, silently never fires while the tool still
  reports the key as pressed.

Both are now in `frontend-qa/references/flows.md`, with what to assert instead.
The second was also a real portability bug in this repo's own game template,
which read `e.code` only; it now binds on both.

The one bug the suite was originally written after finding: the size-ladder check silently
skipped `.docx` and `.pptx`, because those formats declare point sizes per run
rather than in a styles part, so a 19pt heading in a 12pt house passed clean.
Real-file testing found it; the last two lines above are what now catches it.

## Install

Copy a skill directory into `~/.claude/skills/`:

```bash
git clone https://github.com/didrod205/claude-astra.git
cp -r claude-astra/walkable-3d ~/.claude/skills/
```

Or point Claude Code at the checkout and invoke a skill by name.

## Using them

These are skills, not CLIs — you ask Claude in plain language and it runs the
loop. The commands under each are what it actually executes, and every output
block below is real, copied from the session that built and dogfooded these.

### walkable-3d

> *"Make me a two-storey townhouse I can walk into and go up the stairs."*
> *"이 사진으로 걸어다닐 수 있는 3D 씬 만들어줘"*

It lays the scene out on a metre grid first, writes `scene.json`, then audits and
photographs it until both are clean — the manifest is the deliverable, so
iterating means editing numbers, not rewriting code.

```bash
node walkable-3d/scripts/audit.mjs      scene/
node walkable-3d/scripts/shot.mjs       scene/ --out shots --plan 2.6 --plan 5.4
node walkable-3d/scripts/serve.mjs      scene/ --open        # walk it yourself
node walkable-3d/scripts/export-glb.mjs scene/ --out house.glb
```

```
audit - townhouse
  67 objects (25 solid) - 60.0 x 7.8 x 60.0 m - 57 draw calls - 2k tris

  ok - no structural problems
```

You get `scene/` (three files), six angles plus a cutaway plan per storey in
`shots/`, and a `.glb` whose objects keep the names you gave them — `w_g_s_l`,
`step_07`, `balc_rail_n` — so a person can open it in Blender and move the bed.

**Add `--plan` for anything with an interior.** A roofed building is opaque from
all six default angles.

### playable-prototype

> *"Prototype a game about a lighthouse keeper — a few different directions."*
> *"이 아이디어로 프로토타입 3개 뽑아줘"*

It picks directions that differ on an axis that changes how the thing *plays* —
reflex vs. deliberation, direct vs. indirect control — builds each as one
self-contained HTML file, then has a bot play all of them.

```bash
node playable-prototype/scripts/playtest.mjs prototypes/ --out shots --ticks 2400
```

```
playtest — 3 prototype(s), 2400 ticks each

  ok  a-beam    bot scored 8,  over @ tick 1032 · 2/2 actions live · 5 ms/1000t
  ok  b-watch   bot scored 9,  over @ tick 510  · 3/3 actions live · 6 ms/1000t · turn-based
  ok  c-buoys   bot scored 27, survived 2400    · 5/5 actions live · 9 ms/1000t

  3 clean · 0 with warnings · 0 not playable
```

The bot holds every declared input and fails the ones that change nothing, runs
the same seed twice and fails a disagreement, and plays at random to check the
game can be scored in at all. You can drive any prototype the same way:

```js
__game.seed(7); __game.reset(); __game.start();
__game.input('right', true); __game.step(60); __game.state()
```

### frontend-qa

> *"QA this before I ship it."* · *"이거 왜 안 눌려?"* · *"테스트해줘"*

Two halves. The sweep is one command; the flows are a browser session where each
action is followed by re-reading the DOM, the console, and the network.

```bash
node frontend-qa/scripts/qa-run.mjs http://localhost:3000 --out qa
node frontend-qa/scripts/qa-run.mjs ./dist --widths 390,768,1440 --json
```

```
qa sweep - http://127.0.0.1:56392/
  390px - 1 error(s), 1 warning(s)

  every width
    x [viewport] no <meta name="viewport"> — the phone lays this out at 980px and scales it down
    ! [a11y] 0 visible <h1> on the page
```

Findings identical at every width print once, so responsive breakage stands out
from real breakage. Read `viewport` and `console` first — until those are clean,
nothing else in the report means what it says.

### house-style

> *"Write the Q3 deck in the same style as these three."*
> *"우리 템플릿 유지해서 보고서 하나 써줘"*

Give it two or three of your own files. It reads the theme rather than guessing
at it, and checks the finished file back against what it read.

```bash
python3 house-style/scripts/style.py extract deck.pptx report.docx -o style.json
python3 house-style/scripts/style.py check  draft.pptx --spec style.json
```

```
house style from 1 sample(s): real.pptx

  fonts     Arial, Calibri
  palette   #000000 #FFFFFF #1F497D #EEECE1 #4F81BD #C0504D #9BBB59 #8064A2
  sizes     9.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 24.0, 28.0, 32.0, 40.0, 44.0 pt
  slide_in  [10.0, 7.5]
  layouts   Title Slide, Section Header, Two Content, Comparison, Title Only …

style check — 1 file(s) against pptx-style.json

  x drift.pptx  [font] typefaces not in the house set: Impact
  x drift.pptx  [geometry] slide_in is [13.33, 7.5] but the house style is [10.0, 7.5]
  ! drift.pptx  [color] colours outside the palette: #D91C21
  ! drift.pptx  [size] point sizes not in the house ladder: [54.0]
```

The `docx` / `pptx` / `xlsx` skills write the file; this one decides what goes in
it and proves it matches. The layout names are worth more than any colour value —
building slides from the deck's own layouts is what makes it look native.

### desktop-app-driver

> *"Lay this schematic out in KiCad."* · *"이 앱에서 직접 해줘"* · *"설치하고 테스트해줘"*

No scripts — it is method plus per-app knowledge, driving the computer-use tools
in the **background**, so the target window never comes to the front and you keep
working. Grant by bundle id, target by accessibility index, prefer the menu bar,
and screenshot after every step.

```
request_access({ apps: ["com.apple.calculator"] })        → tier full
app_screenshot                                            → image + [N] AX summary
app_ax_find({ role: "AXButton" })                         → 25 buttons, Korean titles
app_batch([ click 모두 지우기, 1, 2, 곱하기, 7, 등호, screenshot ])
   → All 7 actions ok; display reads 84
app_menu({ path: ["보기", "공학용"] })                     → switched mode
```

Two things it will not let you skip: a plain `ok` means the action was
*dispatched*, not that it worked — so every batch ends in a screenshot — and a
background write often never reaches the app's undo stack, so `overwrite_existing`
returning the old value is your only undo. Both are written up, with the
Calculator and TextEdit sessions, in
[`references/app-profiles.md`](desktop-app-driver/references/app-profiles.md).

## Try it without asking Claude

```bash
./verify.sh                                                   # all 17 checks, ~3 min
node walkable-3d/scripts/serve.mjs walkable-3d/assets/template --open
open playable-prototype/assets/template/game.html
```

## Requirements

Node 22+ and a Chrome, Chromium, or Edge install. The scripts find the browser
themselves; set `CHROME_BIN` to override. `walkable-3d` renders through software
WebGL by default so it works headless anywhere — set `W3D_GL=angle` to use the
GPU. `house-style` is Python 3 standard library only, plus PyMuPDF if you want to
read PDF samples. `desktop-app-driver` is macOS-only and needs the computer-use
tools.
