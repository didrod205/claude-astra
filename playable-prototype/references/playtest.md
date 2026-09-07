# Reading the playtest

```bash
node scripts/playtest.mjs prototypes/           # a whole directory
node scripts/playtest.mjs a.html b.html         # named files
node scripts/playtest.mjs prototypes/ --ticks 4000 --out shots --json
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
6. **Bot run** — `--ticks` (default 1800) of random play, changing action every
   15 ticks, recording the best score and how it ended.
7. **Speed** — 3000 ticks, reported as ms per 1000.
8. **Screenshots** at menu and after 240 ticks of play, if `--out` is given.

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
