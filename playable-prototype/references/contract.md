# Implementing the contract

Copy the shape from `assets/template/game.html`. It is about twenty lines; the
rest of this file is how it lands in different genres.

## The skeleton

```js
let G;                                   // ALL mutable state in one object
const fresh = () => ({ status: 'menu', tick: 0, score: 0, /* ... */ });
G = fresh();

let rngState = 1;
const rnd = () => {                      // mulberry32 — seedable, fast, fine
  rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const held = {};                         // input state, read by update()

function update() {                      // ONE tick. No time, no randomness
  if (G.status !== 'playing') return;    // except through rnd()
  G.tick++;
  /* ... */
}

function draw() { /* reads G, writes pixels, mutates nothing */ }

const api = {
  actions: ['left', 'right', 'start'],
  state: () => ({ status: G.status, tick: G.tick, score: G.score, /* ... */ }),
  input(a, down = true) {
    if (a === 'start' && down && G.status !== 'playing') api.start();
    else held[a] = down;
  },
  start() { const seed = rngState; G = fresh(); rngState = seed; G.status = 'playing'; },
  reset() { G = fresh(); for (const k in held) held[k] = false; },
  seed(n) { rngState = n | 0; },
  step(n = 1) { for (let i = 0; i < n; i++) update(); draw(); },
};
window.__game = api;

const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', Space: 'start' };
addEventListener('keydown', e => { const a = KEYS[e.code]; if (a) { e.preventDefault(); api.input(a, true); } });
addEventListener('keyup',   e => { const a = KEYS[e.code]; if (a) api.input(a, false); });

let acc = 0, last = performance.now();
(function loop(now) {                    // the ONLY place real time appears
  acc += Math.min(now - last, 100); last = now;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  draw();
  requestAnimationFrame(loop);
})(last);
```

## `state()` — what to expose

Enough that a bot can tell whether it is doing well, and small enough to compare
cheaply (the harness diffs the whole object).

Always: `status`, `tick`, `score`. Then the handful of numbers that describe the
situation — the player's position, lives, the count of live entities, the current
level. **Not** the full entity list; a count is enough and keeps the diff fast.

Round floats: `+x.toFixed(2)`. Unrounded floats make two mathematically identical
runs compare unequal and the determinism check fail for the wrong reason.

## By genre

**Real-time action (dodger, shooter, runner).** The skeleton as written. `held`
is read every tick; movement is per-tick, never per-millisecond.

**Turn-based (puzzle, roguelike, board).** `update()` resolves one turn, and only
when a move is pending:

```js
let pending = null;
api.input = (a, down) => { if (down) pending = a; };
function update() {
  if (G.status !== 'playing' || !pending) return;
  applyMove(pending); pending = null; G.tick++;
}
```

`step(n)` then advances at most n turns, which is exactly what you want — a
bot's 1800 ticks becomes 1800 attempted moves.

**Physics.** Fixed timestep is already the correct way to do physics; you get
determinism for free. Never scale a velocity by a frame delta.

**Point-and-click / cursor games.** Declare positional actions and pass a payload:
`actions: ['click']`, `input('click', true, { x, y })`. The bot will call
`input('click', true)` with no payload — handle that by clicking a sensible
default (the centre, or a random valid target via `rnd()`) so the action still
registers as live.

**Text / choice games.** `actions: ['choice1', 'choice2', 'choice3']`, `status`
moves to `over` at an ending, `score` counts endings reached or objectives met.
Works fine; the bot walks the graph.

**Multiplayer / two players.** Prefix the actions: `p1_left`, `p2_left`. Give the
second player a scripted or trivial AI so single-player playtesting still
exercises the loop.

## Mistakes the harness will catch, so save yourself the round trip

| mistake | shows up as |
|---|---|
| `Math.random()` anywhere in `update()` | `determinism` |
| `Date.now()` / `performance.now()` in `update()` | `determinism` |
| unrounded floats in `state()` | `determinism`, confusingly |
| an action declared but never read in `update()` | `input` — dead action |
| `input()` writes a variable `update()` doesn't read | `input` — dead action |
| scoring only on a condition a bot can't reach | `playable` — bot scored 0 |
| `start()` doesn't set `status` to `'playing'` | `run` — tick never advanced |
| `step()` calls `requestAnimationFrame` instead of `update()` | `run` — tick never advanced |
| game state living in closures instead of `G` | `reset()` doesn't reset, runs bleed together |

## Self-contained means self-contained

One `.html` file per prototype: markup, CSS, and script inline. No build, no
imports, no assets — draw with canvas 2D, CSS, or inline SVG. It has to open from
`file://` by double-click and run.

If a prototype genuinely needs a library, load it from `cdnjs.cloudflare.com` or
`cdn.jsdelivr.net/npm/` with a pinned exact version, and check the playtest still
passes — a CDN failure at load time will show up as a `console` error.
