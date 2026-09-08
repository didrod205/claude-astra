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
   one, across three seeds. See below; this is the interesting number.
8. **Speed** — the median of three 2000-tick runs after a warmup. A single
   bracket around one run swung 160–404 ms on unchanged files and flipped the
   warning on and off at random.
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

It decides on the **same 15-tick cadence as the random bot**, so the two differ
only in how they choose, and it is run on three seeds — on one seed the ratio
swung 4x on ordinary tuning changes, which is noise, not signal.

**The warning is not a threshold on the ratio.** One greedy choice per 15 ticks
against a random tail is a weak player: a ratio near 1.0 is normal for a game
with real decisions in it, and warning on that flagged three of four perfectly
good prototypes. What is diagnostic is **never winning on any seed** —

```
! [depth] a shallow lookahead player never beat random on any of 3 seeds
          (20/20/20 vs 20/20/20)
```

— which is exactly what a game whose inputs do not affect the outcome looks
like. Two causes, and the harness cannot tell them apart: either the inputs
carry no decision, or the payoff is slower than a 15-tick lookahead can see,
which is what a placement or build-then-watch game looks like. Read it as a
prompt to think, not a verdict.

The ratio itself is still worth reading. Above about 1.5x there is clearly
something to get good at; near 1.0 with the lookahead winning on *some* seed
means there is a decision the shallow player only sometimes finds.

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

**`perf: N ms per step+draw`** (warning) — note what this measures: the documented
`step()` renders, so it is the cost of a whole frame, not of the update. The
60 fps budget is 16.7 ms, and the warning fires at 4 ms — a quarter of it, before
the browser does anything else. Usual causes: an `innerHTML` write per frame, an
allocation per entity per tick, an O(n²) collision pass.

## Past the first clean run

Everything above measures a prototype against a **random** player. That is the
right question for *is this playable* and the wrong one for *is the thing I built
the thing being played* — and a clean run says nothing about the second.

A worked case is in `examples/differential/`. It passed on its first build, no
warnings, lookahead scoring **10x** random. The dominant strategy at the time was
to ignore every mechanic in the game and press a treatment button until something
worked. The harness was not wrong; it was answering its own question.

Nothing generic can answer the other one — it needs instruments that know what
your game claims about itself. Three kinds are worth writing, and each takes
about twenty minutes:

| instrument | the question | what it caught in that game |
|---|---|---|
| **calibration** | is a number the game shows the player *true*? | the posterior read 55% where the answer was 40% |
| **economy** | what does each purchase actually buy? | free evidence already gave 78% — every test, the scanner and the clock were a rounding error |
| **policy race** | do the decisions matter? | "never order anything" beat working patients up, 37 a night to 30 |

The policy race is the one to write first if you write only one. Several plainly
different ways to play, each a single decision function, over the same seeds:

```
  policy                        score
  always gamble                    17
  work up, then commit             18
  order everything first           20
  call the crashing, test the rest 21
```

Three separate failures showed up in that one table, and the third is the one to
watch for, because it is invisible from every other angle: after two rounds of
fixes **every policy scored the same**. What differed was harm — 19 a night
against 10 — and the score was not looking at it. A prototype whose score does
not move with the thing the game is about will read as balanced, deterministic,
playable and deep, and still not be a game about that thing.

Drive these through the public `__game` contract only, never the internals, or
they will flatter what you built.

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
