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

## Install

Copy a skill directory into `~/.claude/skills/`:

```bash
git clone https://github.com/didrod205/claude-astra.git
cp -r claude-astra/walkable-3d ~/.claude/skills/
```

Or point Claude Code at the checkout and invoke a skill by name.

## Try walkable-3d in one command

```bash
node walkable-3d/scripts/serve.mjs walkable-3d/assets/template --open
```

Click the page, then WASD. `G` exports a `.glb`.

```bash
node walkable-3d/scripts/audit.mjs walkable-3d/assets/template
node walkable-3d/scripts/shot.mjs  walkable-3d/assets/template --out shots
```

## Try playable-prototype in one command

```bash
node playable-prototype/scripts/playtest.mjs playable-prototype/assets/template/game.html --out shots
```

Or just open `playable-prototype/assets/template/game.html` and play it.

## Requirements

Node 22+ and a Chrome, Chromium, or Edge install. The scripts find the browser
themselves; set `CHROME_BIN` to override. `walkable-3d` renders through software
WebGL by default so it works headless anywhere — set `W3D_GL=angle` to use the
GPU. `house-style` is Python 3 standard library only, plus PyMuPDF if you want to
read PDF samples. `desktop-app-driver` is macOS-only and needs the computer-use
tools.
