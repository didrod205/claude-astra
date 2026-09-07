---
name: playable-prototype
description: >-
  Turn a game idea into several genuinely different, genuinely playable browser
  prototypes in one pass, each self-contained and each provably working —
  headlessly playtested by a bot that presses the buttons and checks the game
  responds. Use when asked to prototype, mock up, or spike a game or an
  interactive toy; to explore a mechanic in a few directions before committing;
  to build a small browser game, jam entry, or playable demo; or when the ask is
  "게임 만들어줘", "프로토타입 몇 개 뽑아줘", "이 아이디어 플레이 가능하게",
  "여러 버전으로 만들어봐". Every prototype exposes a machine API, so an agent can
  play it as a player, not just look at a screenshot. NOT for full game
  production, engine work, 3D walkable environments (use walkable-3d), or
  non-interactive animations.
---

# Playable prototypes

## What "playable" has to mean

A prototype that renders is not a prototype that plays. The failure mode is
specific and extremely common: the game draws, the menu appears, the screenshot
looks like a game — and one of the four buttons does nothing, or the score can
never increase, or it is impossible to lose, or the whole thing is different
every run so nothing about it can be reasoned about.

None of that is visible in a screenshot. All of it is visible to a bot that
presses the buttons. So every prototype implements one small contract, and
`playtest.mjs` plays it.

## The contract

```js
window.__game = {
  actions: ['left', 'right', 'fire', 'start'],   // semantic, never key codes
  state()          → { status, tick, score, ... } // status: menu | playing | over
  start()  reset() → void
  input(action, down) → void
  step(n)          → void   // advance n FIXED ticks. No real time involved
  seed(n)          → void   // reseed the RNG. Same seed + same inputs = same run
};
```

Six functions. They cost about twenty lines and they buy: headless playtesting at
thousands of ticks per second, reproducible bug reports, an agent that can play
the game, and a difficulty curve you can measure instead of guess.

Three rules that make the rest work:

1. **Fixed timestep.** `update()` advances one tick. The rAF loop calls it;
   `step(n)` calls it n times. Nothing in `update()` reads `performance.now()` or
   `Date.now()`, and nothing scales by a frame delta.
2. **Seeded RNG only.** One `Math.random()` in the update loop and the
   determinism check fails — correctly, because the prototype is then
   unreproducible.
3. **Semantic input.** `input('jump')`, never `keydown: 'Space'`. Keyboard
   handlers are a thin layer that call `input()`; the bot calls the same thing.

`references/contract.md` has implementations for the common genres.

## The loop

```
1. Read the brief. Pick N genuinely different directions — see below.
2. Build each as ONE self-contained .html file in a shared directory.
3. node scripts/playtest.mjs <dir> --out shots
4. Fix what it reports. Repeat until every prototype is clean.
5. Hand over the directory + the shots + a one-line pitch per prototype.
```

Build all N before playtesting any: the harness runs a whole directory in one
pass, and problems repeat across prototypes so you fix them in a batch.

## N different, not N reskinned

Asked for "a few prototypes", the lazy output is one game in three colour
schemes. Vary an axis that changes how it *plays*:

| axis | ends of it |
|---|---|
| pressure | reflex / turn-based deliberation |
| goal | survive as long as possible / reach a target / maximise a score |
| failure | one hit and out / attrition / no failure, only a clock |
| control | continuous movement / discrete grid steps / indirect (place, don't steer) |
| information | everything visible / fog / delayed feedback |
| scope | one screen / scrolling / discrete levels |

Two prototypes that differ on one of those rows teach the user something. Two
that differ on palette teach nothing. State the axis in the pitch: *"A is a
reflex dodger, B is the same fiction as a turn-based puzzle — is the appeal the
timing or the planning?"*

Three to five is the useful range.

## Playtest

```bash
node scripts/playtest.mjs prototypes/ --out shots
node scripts/playtest.mjs one.html --ticks 4000 --json
```

Exit 0 clean · 1 warnings · 2 something is not playable. What it checks:

| check | fails when |
|---|---|
| `contract` | `__game` missing, or missing a method, or `state()` has no `status` |
| `determinism` | two identical runs diverge. **Checked first** — every later check needs it |
| `input` | an action in `actions` changes nothing. Skipped, and said to be skipped, if the run isn't deterministic |
| `playable` | a random bot scores 0 over the whole run |
| `run` | `tick` never advances |
| `design` (warn) | doing nothing forever never ends the game |
| `perf` (warn) | over 400 ms per 1000 ticks — won't hold 60 fps |
| `console` | any page error |

**The random-bot score is the load-bearing check.** A bot pressing buttons at
random should score *something* in a prototype humans can learn. Zero means the
scoring is broken, or the game is unwinnable, or the input never reaches the
simulation. Read `references/playtest.md` for how to act on each result.

The `--out` screenshots are for you to look at, not proof of anything. The
harness cannot see that the player sprite is behind the background.

## What still needs a human

The playtest proves the prototype *functions*. It cannot tell you it is fun,
that the difficulty ramp feels right, or that the controls feel good. Say that
plainly when handing over, give the user the one-line pitch per prototype and the
axis you varied, and ask which direction to develop — that question is the actual
deliverable of a prototyping pass.

## Files

- `assets/template/game.html` — a small complete game implementing the contract.
  Read it before writing your first prototype; copy the contract block from it
- `scripts/playtest.mjs` — the harness
- `scripts/lib.mjs` — static server, Chrome launcher, CDP client
- `references/contract.md` — implementing the contract per genre
- `references/playtest.md` — every check, and what to do about it
