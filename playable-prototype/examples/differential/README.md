# Differential — a prototype taken past its first clean run

`differential.html` is a finished version of one of four night-shift prototypes.
It passed the harness on its first build — clean, no warnings, and a lookahead
player scoring **10x** what a random one did. That number was worthless. The
dominant strategy at the time was to ignore every mechanic in the game and press
a treatment button until something worked.

This directory is here because that gap is the interesting part.

## What the harness could see, and what it could not

`playtest.mjs` answers *is this playable, is it deterministic, do the inputs do
anything, is there a decision here at all* — against a **random** player. Every
one of those came back clean while the game was broken, because they were all
true. What it cannot answer is the question you actually have once a prototype
runs: **is the thing I built the thing being played?**

Nothing generic can answer that. It needs instruments that know what your game
claims about itself. The three in `instruments/` are the ones this game needed;
yours will be different, and writing them takes about twenty minutes each.

## The instruments

All three drive the game through the public `__game` contract only — no hooks
into its internals, so they cannot flatter it.

**`calib.mjs` — is the number on screen true?**
This game shows a posterior over five diagnoses. Play many patients through
random work-ups, commit to whatever the panel leads with, and bucket the outcome
by the confidence claimed. An honest panel lands on the diagonal.

```
  panel says     n    if honest    actually settled
    50–59%    73      44%      █████████·············  42%
    70–79%    25      60%      █████████████·········  60%
    90–99%    68      76%      █████████████████·····  76%

  overall: the panel claimed 69% across 271 commitments.
  if it is honest that is 55% settling; 54% settled.
```

It found a real lie. A failed treatment updated the belief by ×0.3, but a wrong
treatment *never* worked, so the true likelihood was 0 and the panel read 55%
where the answer was 40%. The fix was to change the **game** rather than the
number: a correct treatment now works four times in five, which makes ×0.2 the
honest update and makes "no response" genuinely ambiguous. The curve above is
after that change.

**`evidence.mjs` — what does each purchase buy?**
Confidence and hit rate after each fixed work-up. This is where you see whether
your economy exists.

```
  nothing at all    59%     one test    77–85%     two tests    91%
```

The first build read `nothing at all → 78%, right 73%`. Every test, the scanner
and the entire clock were a rounding error on evidence the player got for free.
The fix was to stop the vitals resolving all five conditions and let them resolve
to a **pair** — cardiac and bleed share a shock picture, sepsis and metabolic a
febrile one — so a test exists to break a tie rather than to confirm what you
already knew.

**`policies.mjs` — do the decisions matter?**
Several plainly different ways to play, each one decision function, raced over
the same twelve nights.

```
  policy                                    got out clean   sent up  harmed  died   dawn
  always gamble                                17 ( 5–21)      21      19     9   6/12
  work up, then commit                         18 (13–23)      21      10     9   6/12
  order everything first                       20 (15–25)      22      10     8   10/12
  call the crashing, investigate the rest      21 (12–23)      22      10     7   8/12
```

This is the one that kept catching things, three times over:

1. **"Never test at all" won by a mile** — 37 a night against 30. A failed
   treatment also ruled its condition out, so guessing was a cheaper test than
   testing.
2. Fixed, and every policy scored *the same*. The run ended at four deaths
   whatever you did, so reckless play banked faster and died sooner and it came
   out level. Raising the limit only handed the win back to gambling.
3. Fixed by looking at what actually differed: gambling harmed 17 patients a
   night and working up harmed 5, and **the score was not looking at it**. The
   score became the people who got out without a treatment that did nothing.

Only after all three does the table above order the way the game claims to work.

## The arithmetic that decided the design

Worth stating on its own, because it is not obvious and it sank three builds:

> A test only saves you treatments — from about 1.8 guesses per discharge down to
> 1.3. So a test that costs more than **half a treatment** can never pay, no
> matter how good the information is.

While tests blocked the doctor for their full duration, no tuning could make them
worth ordering. The fix was structural, and it is what a real emergency
department does: **ordering** a test costs you a moment, the **result** takes
real time and arrives while you are elsewhere. That single change is what puts
the decision where the game wanted it — you can investigate the people who are
stable, and the ones who are crashing you have to call on the spot, because they
will not survive the wait.

## Running them

```bash
cd instruments
node calib.mjs     ../differential.html
node evidence.mjs  ../differential.html
node policies.mjs  ../differential.html
```

Each takes under a minute. `playtest.mjs ..` still runs on the game itself.
