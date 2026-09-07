# Reading the playtest

```bash
node scripts/playtest.mjs prototypes/           # a whole directory
node scripts/playtest.mjs a.html b.html         # named files
node scripts/playtest.mjs prototypes/ --ticks 4000 --seeds 9 --out shots --json
```

A directory is scanned one level deep, so both `prototypes/*.html` and
`prototypes/*/index.html` are found. Exit 0 clean · 1 warnings · 2 not playable.

## What each run does

For every prototype, in this order:

1. **Load** in headless Chrome, collect console errors.
2. **Contract** — `__game` present, all six methods, `state()` returns an object
   with `status`.
3. **Idle run** — 600 ticks with no input. Proves `tick` advances, and finds out
   whether the game can end on its own.
4. **Determinism** — the same 400-tick scripted session twice, compared exactly.
5. **Dead inputs** — for each action, 120 ticks holding it vs 120 ticks idle from
   the same seed. Identical end state means the action does nothing.
6. **Bot run, across seeds** — `--seeds` (default 5) runs of `--ticks` (default
   1800) random play, changing action every 15 ticks. Reports the median score
   and the range.
7. **Depth** — how much better a *shallow lookahead player* does than the random
   one on the same seed. See below; this is the interesting number.
8. **Speed** — 3000 ticks, reported as ms per 1000.
9. **Screenshots** at menu and after 240 ticks of play, if `--out` is given.

## The depth number

```
ok  a-beam   random 12 (7–13 over 5 seeds) · same seed: random 7 vs lookahead 11 (1.6x)
```

Because a prototype is deterministic and seeded, *"what if I had pressed left
instead"* has an exact answer: replay from the seed with the same prefix and a
different next action. The harness does that at every decision point, keeps the
best action, and plays the rest of the run pseudo-randomly — with the **same
random tail for every candidate**, so two candidates differ only by the decision
being weighed.

Comparing that player against the random one measures the question a prototyping
pass exists to answer: **is there a decision here, or is the outcome just the
seed?**

| reading | means |
|---|---|
| **1.5x and up** | inputs carry real decisions. Worth developing |
| **1.2–1.5x** | thin but present |
| **≤ 1.0x** | flagged. A shallow lookahead did not beat random |

The last one has two causes and the harness cannot tell them apart, so the
warning names both: either the inputs genuinely carry no decision, or **the
payoff is slower than a 15-tick lookahead can see** — true of placement and
build-then-watch games, where the decisions are front-loaded and need several
moves of planning. Read it as a prompt to think, not a verdict.

The lookahead is a floor, not an optimal player. A game can have depth it does
not find. It cannot have less depth than it finds.

## The seed range

```
random 14 (12–14 over 5 seeds)      ← tight: the player is what varies
random 5  (2–9 over 5 seeds)        ← wide: the seed is doing a lot of the work
```

A spread wider than about 5x the median is flagged: the run is being decided by
what the RNG hands you rather than by how you play. That is a balance problem,
and it is invisible from one playthrough.

## Acting on each result

**`contract: window.__game is not defined`** — nothing else ran. The script threw
before assigning it (check the `console` lines), or you assigned inside a module
scope where it isn't on `window`.

**`determinism: same seed + same inputs gave different results`** — fix this
first, it invalidates everything after it. In order of likelihood: `Math.random()`
in the update path; `Date.now()` or `performance.now()` in the update path;
unrounded floats in `state()`; iteration over an object whose key order varies;
`start()` reseeding from the clock.

**`input: these actions change nothing`** — either the action is aspirational and
should come out of `actions`, or `input()` sets something `update()` never reads.
Grep the action name; it should appear in both.

**`input: dead-input check skipped`** — a consequence of the determinism failure,
not a separate problem. It comes back once the run is reproducible.

**`balance: scores across seeds range ... — the seed decides more than the player
does`** — one run told you nothing. Look at what varies between seeds: a spawn
that is sometimes impossible, a first wave that is sometimes free.

**`depth: a shallow lookahead player did not beat random`** — see above.

**`playable: a random bot scored 0`** — the important one. Work through:
- Does `state().score` actually update, or is the score only in a DOM element?
- Can score increase without a precise sequence a random bot won't find? A
  prototype only a good player can score in is not yet a prototype.
- Does `input()` reach the simulation at all? Check the dead-input line.
- Is the game over before scoring is possible? Look at the `botEnd` figure.

**`run: tick never advanced`** — `step()` isn't calling `update()`, or `start()`
didn't set `status` to `'playing'` and `update()` returns immediately.

**`design: doing nothing never ends the game`** (warning) — sometimes correct, for
a sandbox or a timer-based toy. For anything with a fail state it means the fail
state is unreachable, which the bot-score check often confirms.

**`perf: N ms per 1000 ticks`** (warning) — over 400 ms means under 60 fps for a
human. Usually an allocation per entity per tick, or an O(n²) collision pass.

## What it does not check

- **Fun.** Not measurable here. Play it yourself, hand it to the user.
- **Whether it looks right.** The screenshots are for your eyes; the harness
  cannot see a sprite drawn behind the background or text off the canvas.
- **Difficulty balance.** The bot score is a floor, not a curve. To measure a
  curve, run several seeds and compare — `--json` gives you the numbers.
- **Mobile and touch.** Add pointer handlers that call the same `input()`, then
  check them by hand.
- **Audio.** Headless Chrome is muted.

## Using the contract yourself

Anything that can evaluate JS in the page can play these prototypes. Via the
browser tools:

```js
__game.seed(7); __game.reset(); __game.start();
__game.input('right', true); __game.step(60); __game.input('right', false);
__game.state()      // → { status:'playing', tick:60, score:2, ... }
```

That is the same surface the bot uses, and the same one an agent playing the game
as a player would use. It is also the fastest way to reproduce a bug a human
reported: seed, script, step, inspect.
