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

## Try it

```bash
./verify.sh          # all 17 checks, ~3 minutes
```

Walk the bundled 3D scene — click the page, then WASD; `G` exports a `.glb`:

```bash
node walkable-3d/scripts/serve.mjs walkable-3d/assets/template --open
```

Audit it and photograph it from six angles:

```bash
node walkable-3d/scripts/audit.mjs walkable-3d/assets/template
node walkable-3d/scripts/shot.mjs  walkable-3d/assets/template --out shots
```

Play the reference game prototype, or let a bot play it for you:

```bash
open playable-prototype/assets/template/game.html
node playable-prototype/scripts/playtest.mjs playable-prototype/assets/template/game.html --out shots
```

Read a house style out of a document and check another against it:

```bash
python3 house-style/scripts/style.py extract their-deck.pptx -o style.json
python3 house-style/scripts/style.py check  your-draft.pptx --spec style.json
```

Sweep a page at three widths:

```bash
node frontend-qa/scripts/qa-run.mjs http://localhost:3000 --out qa
```

## Requirements

Node 22+ and a Chrome, Chromium, or Edge install. The scripts find the browser
themselves; set `CHROME_BIN` to override. `walkable-3d` renders through software
WebGL by default so it works headless anywhere — set `W3D_GL=angle` to use the
GPU. `house-style` is Python 3 standard library only, plus PyMuPDF if you want to
read PDF samples. `desktop-app-driver` is macOS-only and needs the computer-use
tools.
