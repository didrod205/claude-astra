# Night shift — three prototypes, and what a policy race found in each

These are the other three of the four prototypes a session with only this skill
produced from one line of brief. The fourth, developed the same way, is in
[`../differential`](../differential).

All three passed the harness cleanly. All three were broken, and in each case the
same instrument found it: **write several plainly different ways to play, race
them over the same seeds, and look at what separates them.**

```bash
cd instruments
node policies-a.mjs ../a-callbell.html      # pressure
node policies-b.mjs ../b-rounds.html        # routing
node policies-d.mjs ../d-charge.html        # indirect control
```

## Before any of them could run

Three of the four exposed a state like this:

```js
state: () => ({ status, tick, score, lives, x, needs, worst })
//                                          ↑ a count, and the worst timer
```

The screen showed six doors, each with a countdown and a job in progress. The
state showed **how many** and **the worst one**. You cannot answer "which door,
and is it worth crossing the corridor for" from that, so no policy could be
written at all — only a random bot, which is what the harness runs, which is why
the harness was happy.

*A machine API that carries less than the screen does is not a machine API for
that game.* All three needed their state opened up before any of the work below
was possible. That is now a rule in
[`references/contract.md`](../../references/contract.md).

---

## A — Call Bell · pressure

> *"Bells ring faster than you can walk."*

They did not. A nearest-door policy answered 15 of about 16 calls, reached dawn
on twelve nights out of twelve, lost one patient and spent **a seventh of the
shift standing still with nothing ringing**.

Raising the load fixed the idling, and then a second problem surfaced that no
amount of tuning would fix: four policies scored *identically*.

```
  nearest door             19      most burnt fuse       12
  finish what you began    19      cheapest job          19
                                   triage: drop the lost 19
```

**One server on a corridor makes distance the whole answer.** Nearest-first is
very close to optimal and every other rule collapses onto it — so the choice the
game is named after was not a choice. The fix is not a better rule, it is
*heterogeneous stakes*: the four kinds of call were four labels over identical
mechanics, and now they differ in what they cost you and in what it costs to miss
one. Someone on the floor is not a call bell nobody answered.

That still was not enough, and the reason is worth keeping:

```
  nearest door             19 answered · 3 falls        ← scored HIGHER
  falls first, then near   17 answered · 1 fall
```

Dropping patients scored better than catching them, because the score counted
calls and the falls were free. So the penalty is now paid in the currency the
game is actually played in: **a patient on the floor has to be picked up**, and it
takes longer than the call you saved by walking past. Final:

```
  policy                      answered   falls  gave up   walking  attending  idle   dawn
  nearest door                      16       4        1       56%        43%    1%   4/12
  soonest to go                     13       3        2       70%        29%    1%   8/12
  cheapest job                      20       3        1       60%        39%    1%   9/12
  triage: drop the lost             20       3        1       59%        40%    1%  10/12
  falls first, then near            18       1        3       63%        36%    1%  12/12
```

No policy dominates: twenty answered at three falls and ten dawns, or eighteen at
one fall and twelve. That is a decision.

---

## B — Rounds · routing

> *"A routing puzzle wearing scrubs. The gap is the only way between the two
> corridors."*

The clearest failure of the four. **Every policy scored exactly 38, lost nobody,
and reached dawn twelve times out of twelve** — including one written to refuse
to cross the gap at all. A fuse of 34–52 turns on a ward you can cross in eight
steps is not a constraint, and arrivals ran well under capacity.

The instrument found something else first, by deadlocking. In a turn-based game
**holding no action passes no time**, so an idle ward freezes the clock and no
need ever arrives again: a good player clears the board and the shift stops at
turn 34 of 200. Being good at it prevented you from finishing it. The instrument
now paces the corridor when there is nothing to do, the way a nurse would, and
the load was raised so it does not empty.

Fuses sized to the map, work costs per kind so standing at a bed is a
commitment, and the same heterogeneous-stakes fix as A — one kind of call you
cannot leave, one that gets worse if you do:

```
  policy                        settled    harmed  lapsed   steps   dawn
  nearest need                       35         1       2     113  12/12
  soonest to expire                  29         3       4     126   8/12
  top corridor only                  22         4       6      39   2/12
  savable, then near                 35         1       2     111  12/12
  the ones you cannot leave          33         0       5     113  12/12
```

`top corridor only` at 22 against 35 is the check that the map is now load-
bearing. It was the same 34 as everything else before.

---

## D — Charge Nurse · indirect control

> *"Every command is a bet placed a minute before it pays off. Nothing kills you
> — the shift just gets worse."*

Both halves were false, and the race said so in one table.

```
  never move anyone           107 seen · 180 diverted
  cover the biggest           116
  keep A&E covered            152      ← one order, at handover, then nothing
```

**A static assignment beat every policy that managed the floor.** Two reasons,
and they are both structural:

- The wards had **fixed arrival rates**, so there was nothing to bet on. A
  command is only a bet if the thing you are betting on can change. Each ward now
  has its own slow swell, out of phase with the others, and the board shows the
  rate, its direction and a trace — a bet you cannot read is a coin toss.
- The floor was **permanently saturated**: three nurses cleared 0.33 tasks a tick
  and four wards produced 0.32. In a saturated system reassignment is pure loss,
  because there is always work where you already stand. Demand now averages well
  under capacity and swings hard, so wards genuinely run dry and a nurse standing
  in a quiet one is the mistake the game is about.

And diverting ambulances — the stated failure mode — was not merely free but
*better* than free, since it capped the queue. A diverted ward now works at half
speed while it settles: the handover, the complaints, the bed moves.

```
  policy                      seen    diverted   orders  breaks   stamina at dawn
  never move anyone            75          90        0       0                40
  keep A&E covered             97          66        1       0                 6
  stop the diversions         105          54       26       0                 0
  cover the biggest           113          42       39       0                 0
  biggest, and rest them      115          42       40      20                35
  bet on the swell            117          42       29      18                40
```

Managing beats parking, anticipating beats reacting, resting nurses pays for
itself, and doing nothing is much worse than all of it.

---

## The three findings worth carrying to another game

1. **The state must carry what the screen does.** Otherwise the only player that
   can exist is a random one, and a random player cannot tell you whether your
   game is any good.
2. **One server plus travel makes distance the whole answer** — unless the calls
   differ in what they are worth. Found twice here, independently, in two games
   that look nothing alike.
3. **In a saturated system every reassignment is a loss.** If your game is about
   allocating attention, some of it has to be idle some of the time, or the
   allocation is not a decision.

And running underneath all three, the same thing the differential taught:
**a score that does not move with what separates your policies will read as
balanced, playable and deep, and still not be a game about the thing you meant.**
