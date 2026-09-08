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

// Bind on BOTH e.code and e.key. Synthetic events — browser automation, some
// IMEs — often arrive with no `code` at all, and a letter key comes through as
// e.key 'p', never 'KeyP'. A game that reads only e.code cannot be driven by them.
const bind = m => { const t = {}; for (const k in m) { t[k] = m[k];
  if (/^Key[A-Z]$/.test(k)) { t[k[3].toLowerCase()] = m[k]; t[k[3]] = m[k]; }
  if (k === 'Space') t[' '] = m[k]; } return t; };
const KEYS = bind({ ArrowLeft: 'left', ArrowRight: 'right', Space: 'start' });
addEventListener('keydown', e => { const a = KEYS[e.code] || KEYS[e.key]; if (a) { e.preventDefault(); api.input(a, true); } });
addEventListener('keyup',   e => { const a = KEYS[e.code] || KEYS[e.key]; if (a) api.input(a, false); });

let acc = 0, last = performance.now();
(function loop(now) {                    // the ONLY place real time appears
  acc += Math.min(now - last, 100); last = now;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  draw();
  requestAnimationFrame(loop);
})(last);
```

## `state()` — what to expose

**Everything the player can read off the screen**, as objects with their
coordinates. Positions, timers, what each thing is, how far through it you are.

This page used to say the opposite — *"not the full entity list; a count is
enough and keeps the diff fast"* — and that one sentence is the most common
fault in the prototypes built with this skill, three of four:

```js
state: () => ({ status, tick, score, lives, x, needs, worst })
//                                          ↑ a count, and the worst timer
```

The screen showed six doors, each with a countdown and a job in progress. The
state showed **how many** and **the worst one**. Every check in the harness
passes on that — contract, determinism, dead inputs, bot score, lookahead —
because all of them drive the game with a *random* player, and a random player
never needed to know which door.

But it means no other player can exist. You cannot write "go to the nearest
call", "go to the one about to expire", or "ignore the ones you cannot reach in
time" against a count. So the moment you want to know whether your game has a
decision in it — which is the moment this skill exists for — you cannot ask. Nor
can an agent play it as a player rather than look at a screenshot of it.

```js
rooms: G.rooms.map((r, i) => ({
  bay: i + 1, x: (i + 0.5) * RW, need: !!r.need,
  left: r.left, kind: KINDS[r.kind].name, toGo: KINDS[r.kind].work - r.work,
})),
```

Always: `status`, `tick`, `score`. Then lives, level, the player's position, and
the entities. The diff cost is not the problem it was made out to be — twenty
beds and three nurses are nothing beside a canvas redraw every tick.

Round floats: `+x.toFixed(2)`. Unrounded floats make two mathematically identical
runs compare unequal and the determinism check fail for the wrong reason. This
matters more once you expose entities, not less.

## Turn-based: an empty board must not stop the clock

If time advances only when the player acts, check what happens when there is
nothing to act on. New work arriving on a *turn* counter means a player who
clears the board freezes the game — no turns, so no arrivals, so no turns. One
prototype here stopped dead at turn 34 of 200, and being good at it was what
caused that. Either let time pass on an empty board, or make sure it cannot
empty.

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

**Watch the turn-per-tick ratio.** The harness holds one action for 15 ticks and
this pattern consumes `pending` once, so a bot's 1800 ticks buys **120 moves, not
1800** — a turn-based prototype gets a fifteenth of the play a real-time one
does, dies in the first quarter of its shift, and reads as shallow for no design
reason. Either give a held action auto-repeat:

```js
let pending = null, held = null, since = 0;
api.input = (a, down) => { if (down) { pending = a; held = a; } else if (held === a) held = null; };
function update() {
  if (G.status !== 'playing') return;
  if (!pending && held && ++since >= 8) pending = held;      // a turn every 8 ticks
  if (!pending) return;
  applyMove(pending); pending = null; since = 0; G.tick++;
}
```

…or size the game so a shift fits in the tick budget at one turn per 15.

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

One more, which the harness cannot catch because it drives `input()` directly:
**the HUD must not be the only place state is visible.** If your DOM counters are
written inside `draw()`, they freeze wherever the frame loop is paused — a
background tab, a hidden automation pane — and anyone testing the page through
the DOM sees stale values against working code. Keep `state()` authoritative.

| mistake | shows up as |
|---|---|
| `Math.random()` anywhere in `update()` | `determinism` |
| `Date.now()` / `performance.now()` in `update()` | `determinism` |
| unrounded floats in `state()` | `determinism`, confusingly |
| an action declared but never read in `update()` | `input` — dead action |
| `input()` writes a variable `update()` doesn't read | `input` — dead action |
| a state that reports counts instead of objects | nothing — and that is exactly the problem. See *`state()` — what to expose* |
| an action with nothing to act on in the first 2 seconds | `input` — dead action. The check holds each action for 120 ticks **from a fresh start**, so every declared action must have a valid target by then. A bell that first rings at tick 96, or a player who starts out of reach of anything, both read as a dead input |
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
