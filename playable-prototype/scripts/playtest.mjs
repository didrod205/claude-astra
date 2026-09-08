#!/usr/bin/env node
// Prove a prototype is actually playable — headlessly, without waiting for real
// time, by driving the __game contract.
//
//   node scripts/playtest.mjs <file-or-dir> [more...] [--ticks 1800] [--seeds 5] [--out shots] [--json]
//
// A directory is scanned one level deep for .html files, so one call playtests
// every prototype in a batch.
//
// Exit 0 clean · 1 warnings · 2 a prototype is not playable.

import { writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, basename, join, extname } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['ticks', 'out', 'seeds']);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const positional = argv.filter((a, i) => {
  const prev = argv[i - 1];
  return !a.startsWith('--') && !(prev?.startsWith('--') && VALUED.has(prev.slice(2)));
});
const TICKS = +flag('ticks', 1800);
const SEEDS = Math.max(1, +flag('seeds', 5));
const OUT = flag('out', null);
const asJson = argv.includes('--json');

if (!positional.length) { console.error('usage: playtest.mjs <file-or-dir>... [--ticks N] [--out DIR]'); process.exit(64); }

// --- collect targets ---------------------------------------------------------
const targets = [];
for (const p of positional) {
  const abs = resolve(p);
  const st = await stat(abs).catch(() => null);
  if (!st) { console.error(`no such path: ${abs}`); process.exit(66); }
  if (st.isDirectory()) {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      if (e.isFile() && extname(e.name) === '.html') targets.push(join(abs, e.name));
      else if (e.isDirectory()) {
        const inner = await readdir(join(abs, e.name)).catch(() => []);
        for (const f of inner) if (extname(f) === '.html') targets.push(join(abs, e.name, f));
      }
    }
  } else targets.push(abs);
}
if (!targets.length) { console.error('no .html prototypes found'); process.exit(66); }

// --- the in-page harness -----------------------------------------------------
const HARNESS = `window.__pt = (o) => {
  const g = window.__game;
  g.seed(o.seed); g.reset(); g.start();
  let s = (o.seed ^ 0x9e3779b9) | 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const acts = (g.actions || []).filter(a => a !== 'start' && a !== 'reset');
  let held = null, best = 0, over = null;
  const hold = a => { if (held) g.input(held, false); held = a; if (a) g.input(a, true); };
  for (let t = 0; t < o.ticks; t++) {
    if (o.mode === 'bot' && t % 15 === 0 && acts.length) hold(acts[Math.floor(rnd() * acts.length)]);
    if (o.mode === 'hold' && t === 0) hold(o.action);
    if (o.mode === 'script' && o.script[t] !== undefined) hold(o.script[t]);
    g.step(1);
    const st = g.state() || {};
    if (typeof st.score === 'number' && st.score > best) best = st.score;
    if (st.status && st.status !== 'playing') { over = { tick: t, status: st.status }; if (o.stopOnEnd) break; }
  }
  hold(null);
  return JSON.stringify({ final: g.state(), best, over });
};`;

// A greedy player, built out of replays. The game is deterministic and seeded,
// so "what happens if I press left here?" is answerable exactly: re-run from the
// seed with the same prefix and a different next action. Comparing this against
// random play measures the thing a prototype exists to find out — whether the
// inputs carry a decision or the outcome is just the seed.
const GREEDY = `window.__ptGreedy = (o) => {
  const g = window.__game;
  const acts = (g.actions || []).filter(a => a !== 'start' && a !== 'reset');
  if (!acts.length) return JSON.stringify({ best: 0, unsupported: 'no actions' });
  // Past the decision point the rollout keeps PLAYING, pseudo-randomly, rather
  // than going silent — a turn-based game advances nothing without input, so a
  // silent tail scores zero for every candidate and the comparison is empty.
  // Every candidate shares the same tail, so they differ only by the decision.
  const play = (script, ticks, H, tailSeed) => {
    g.seed(o.seed); g.reset(); g.start();
    let held = null, best = 0, over = null, ts = tailSeed | 0;
    const rnd = () => { ts = (Math.imul(ts, 1664525) + 1013904223) | 0; return (ts >>> 0) / 4294967296; };
    const hold = a => { if (held) g.input(held, false); held = a; if (a) g.input(a, true); };
    for (let t = 0; t < ticks; t++) {
      if (script[t] !== undefined) hold(script[t]);
      else if (t % H === 0) hold(acts[Math.floor(rnd() * acts.length)]);
      g.step(1);
      const st = g.state() || {};
      if (typeof st.score === 'number' && st.score > best) best = st.score;
      if (st.status && st.status !== 'playing') { over = { tick: t, status: st.status }; break; }
    }
    hold(null);
    return { best, over };
  };
  const H = o.horizon || 15;   // same cadence as the random bot, so the two compare
  const script = {};
  for (let t = 0; t < o.ticks; t += H) {
    let pick = acts[0], bestVal = -Infinity;
    for (const a of acts) {
      script[t] = a;
      const r = play(script, o.ticks, H, o.seed ^ 0x5bf03635);   // common tail across candidates
      const val = r.best * 1000 + (r.over ? r.over.tick : o.ticks);
      if (val > bestVal) { bestVal = val; pick = a; }
    }
    script[t] = pick;
    if (play(script, t + H, H, o.seed ^ 0x5bf03635).over) break;
  }
  const f = play(script, o.ticks, H, o.seed ^ 0x5bf03635);
  return JSON.stringify({ best: f.best, over: f.over, decisions: Object.keys(script).length });
};`;

const CONTRACT = `(() => {
  const g = window.__game;
  if (!g) return JSON.stringify({ missing: '__game' });
  const need = ['state','start','reset','input','step','seed'];
  const missing = need.filter(k => typeof g[k] !== 'function');
  let st = null, err = null;
  try { st = g.state(); } catch (e) { err = String(e); }
  return JSON.stringify({
    missing: missing.length ? missing.join(', ') : null,
    stateError: err,
    actions: Array.isArray(g.actions) ? g.actions : null,
    stateKeys: st && typeof st === 'object' ? Object.keys(st) : null,
    status: st?.status ?? null,
  });
})()`;

// --- run ---------------------------------------------------------------------
const chrome = await launchChrome();
const results = [];
if (OUT) await mkdir(resolve(OUT), { recursive: true });

try {
  for (const file of targets) {
    const name = basename(file, '.html');
    const server = await serve(dirname(file));
    const problems = [];
    const add = (level, check, msg) => problems.push({ level, check, msg });
    const stats = {};

    try {
      const cdp = await CDP.page(chrome.port);
      const log = await instrument(cdp);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 760, deviceScaleFactor: 2, mobile: false });
      await goto(cdp, `http://127.0.0.1:${server.port}/${basename(file)}`, { settle: 350 });

      for (const e of log.errors) add('error', 'console', String(e.text).replace(/\s+/g, ' ').slice(0, 200));

      // 1. contract
      const c = JSON.parse(await cdp.eval(CONTRACT, { awaitPromise: false }));
      if (c.missing === '__game') {
        add('error', 'contract', 'window.__game is not defined — nothing can play this');
        results.push({ name, file, problems, stats }); server.close(); continue;
      }
      if (c.missing) add('error', 'contract', `__game is missing: ${c.missing}`);
      if (c.stateError) add('error', 'contract', `state() threw: ${c.stateError}`);
      if (!c.actions?.length) add('error', 'contract', '__game.actions is empty — no way to know what inputs exist');
      if (!c.stateKeys?.includes('status')) add('error', 'contract', 'state() has no "status"');
      if (!c.stateKeys?.includes('tick')) add('warn', 'contract', 'state() has no "tick" — progress is unmeasurable');
      if (!c.stateKeys?.includes('score')) add('warn', 'contract', 'state() has no "score" — success is unmeasurable');
      stats.actions = c.actions ?? [];
      if (problems.some(p => p.level === 'error' && p.check === 'contract')) {
        results.push({ name, file, problems, stats }); server.close(); continue;
      }

      await cdp.eval(HARNESS, { awaitPromise: false });
      const run = async o => JSON.parse(await cdp.eval(`window.__pt(${JSON.stringify(o)})`, { awaitPromise: false }));

      // 2. it starts and time moves. A turn-based game legitimately advances
      //    nothing while no move is pending, so the verdict waits for the bot run.
      const idleTicks = Math.min(TICKS, 1200);
      const idle = await run({ seed: 12345, ticks: idleTicks, mode: 'idle', stopOnEnd: false });
      if (!idle.final) add('error', 'run', 'state() returned nothing after a run');
      stats.idleTick = idle.final?.tick ?? 0;
      stats.idleEnd = idle.over ? `${idle.over.status} @ tick ${idle.over.tick}` : 'never ended';

      // 3. deterministic — checked first, because every later comparison
      //    depends on two identical runs being identical.
      const script = {}; let s = 99;
      const playable = stats.actions.filter(a => a !== 'start' && a !== 'reset');
      stats.playableActions = playable.length;
      for (let t = 0; t < 400; t += 10) {
        s = (Math.imul(s, 1664525) + 1013904223) | 0;
        script[t] = playable.length ? playable[Math.abs(s) % playable.length] : null;
      }
      const [d1, d2] = [await run({ seed: 4242, ticks: 400, mode: 'script', script }),
                        await run({ seed: 4242, ticks: 400, mode: 'script', script })];
      const deterministic = JSON.stringify(d1.final) === JSON.stringify(d2.final);
      if (!deterministic)
        add('error', 'determinism', 'same seed + same inputs gave different results — likely Math.random() or wall-clock in the update loop');

      // 4. every declared action does something. Only meaningful when two runs
      //    of the same script agree, so it is skipped (not faked) otherwise.
      if (!deterministic) {
        add('warn', 'input', 'dead-input check skipped — cannot tell an input apart from the noise until the run is deterministic');
        stats.liveActions = null;
      } else {
        const dead = [];
        const baseline = await run({ seed: 777, ticks: 120, mode: 'idle', stopOnEnd: false });
        for (const a of playable) {
          const withA = await run({ seed: 777, ticks: 120, mode: 'hold', action: a, stopOnEnd: false });
          if (JSON.stringify(withA.final) === JSON.stringify(baseline.final)) dead.push(a);
        }
        if (dead.length) add('error', 'input', `these actions change nothing: ${dead.join(', ')}`);
        stats.liveActions = playable.length - dead.length;
      }

      // 5. a random bot can make progress — sampled across seeds, because one
      //    seed tells you about one run and nothing about the game.
      const bot = await run({ seed: 2024, ticks: TICKS, mode: 'bot', stopOnEnd: true });
      const seeds = [{ score: bot.best, end: bot.over ? bot.over.tick : TICKS }];
      for (let i = 1; i < SEEDS; i++) {
        const r = await run({ seed: 2024 + i * 7919, ticks: TICKS, mode: 'bot', stopOnEnd: true });
        seeds.push({ score: r.best, end: r.over ? r.over.tick : TICKS });
      }
      const scores = seeds.map(s => s.score).sort((a, b) => a - b);
      const med = scores[scores.length >> 1];
      stats.botScore = med;
      stats.botRange = [scores[0], scores[scores.length - 1]];
      stats.botEnd = `median end @ ${seeds.map(s => s.end).sort((a, b) => a - b)[seeds.length >> 1]}`;
      if (scores[scores.length - 1] === 0)
        add('error', 'playable', `a random bot scored 0 on all ${SEEDS} seeds in ${TICKS} ticks — unwinnable, or scoring is broken`);
      else if (med === 0)
        add('warn', 'playable', `a random bot scored 0 on most seeds (range ${scores[0]}–${scores[scores.length - 1]}) — the floor may be too high`);
      if (med > 0 && scores[scores.length - 1] > med * 5)
        add('warn', 'balance', `scores across seeds range ${scores[0]}–${scores[scores.length - 1]} around a median of ${med} — the seed decides more than the player does`);

      // 6. does playing WELL beat playing at random? This is the prototype question.
      if (deterministic && playable.length) {
        await cdp.eval(GREEDY, { awaitPromise: false });
        // The search costs (ticks/H) x actions x ticks simulated steps, because a
        // replay has no snapshot to resume from and starts at zero every time. At
        // 11 actions and 900 ticks that is 600k steps of a game that renders on
        // every one, which overran the 120 s evaluate timeout — and a timeout in
        // here used to mark the whole prototype unplayable, when in fact every
        // other check had passed. So: fit the search to a step budget by
        // shortening the game it is measured over, and say so when that happens.
        // Both players get the same gTicks, so the comparison stays honest.
        const BUDGET = 5e5;
        const cost = t => (t / 15) * playable.length * t * 1.15;
        let gTicks = Math.min(TICKS, 900);
        while (gTicks > 150 && cost(gTicks) > BUDGET) gTicks = Math.round(gTicks * 0.8);
        // Same cadence as the random bot — 15, as the comment in __ptGreedy and
        // the docs both say. Passing 30 here locked the lookahead into
        // commitments twice as long as the player it is compared against, so a
        // game whose natural action is shorter than 30 ticks read as having no
        // depth. The measuring instrument was dictating the design.
        //
        // And across seeds, like the bot score beside it: on one seed the ratio
        // swung 4x on ordinary tuning changes.
        const dSeeds = [2024, 2024 + 7919, 2024 + 15838];
        const ratios = [], greedies = [], randoms = [];
        let depthFailed = null;
        for (const sd of dSeeds) {
          try {
            const g2 = JSON.parse(await cdp.eval(
              `window.__ptGreedy(${JSON.stringify({ seed: sd, ticks: gTicks, horizon: 15 })})`,
              { awaitPromise: false }));
            const r2 = await run({ seed: sd, ticks: gTicks, mode: 'bot', stopOnEnd: true });
            greedies.push(g2.best); randoms.push(r2.best);
            ratios.push(r2.best > 0 ? g2.best / r2.best : (g2.best > 0 ? Infinity : 1));
          } catch (e) { depthFailed = String(e.message || e); break; }
        }
        if (depthFailed) {
          // Not a verdict on the game. Say which check did not run, and why.
          add('warn', 'depth', `depth not measured — the lookahead search did not finish (${depthFailed}). ` +
            `${playable.length} actions over ${gTicks} ticks is past what a replay search can do in the time; ` +
            'the other checks above still hold');
        }
        const mid = a2 => [...a2].sort((x, y) => x - y)[a2.length >> 1];
        if (greedies.length) {
          stats.greedy = mid(greedies); stats.randomAt = mid(randoms);
          stats.gradientTicks = gTicks; stats.gradientSeeds = greedies.length;
          const grad = mid(ratios.map(v => (v === Infinity ? 1e9 : v)));
          stats.gradient = grad >= 1e9 ? Infinity : grad;
        }
        // The signal is whether the lookahead EVER beats random, not by how much.
        // One greedy choice per 15 ticks against a random tail is a weak player:
        // ratios near 1.0 are normal for a game with real decisions in it, and
        // warning on them flagged three of four prototypes that were fine. What
        // is diagnostic is never winning on any seed — that is what a game whose
        // inputs do not affect the outcome looks like, exactly.
        const neverBetter = greedies.length && greedies.every((g3, i) => g3 <= randoms[i]);
        if (neverBetter)
          add('warn', 'depth', `a shallow lookahead player never beat random on any of ${dSeeds.length} seeds ` +
            `(${greedies.join('/')} vs ${randoms.join('/')}) — either the inputs carry no decision, ` +
            'or the payoff is slower than a 15-tick lookahead can see');
      }

      // Now the idle run can be judged. Idle advancing nothing while the bot run
      // does is the signature of a turn-based game — the documented pattern, not
      // a fault. Only when neither advances is the simulation actually dead.
      const botTick = bot.final?.tick ?? 0;
      stats.turnBased = stats.idleTick === 0 && botTick > 0;
      if (stats.idleTick === 0 && botTick === 0)
        add('error', 'run', 'tick never advanced in either run — step() does not drive the simulation');
      else if (!stats.turnBased && !idle.over)
        add('warn', 'design', `doing nothing for ${idleTicks} ticks never ends the game — is there a lose condition?`);

      // 6. speed. Median of three after a warmup: a single bracket around one
      //    run swung 160-404 ms on unchanged files, which flipped the warning on
      //    and off at random. And step() renders, so this is the cost of a whole
      //    frame, not of the update — 16.7 ms is the 60 fps budget.
      await run({ seed: 1, ticks: 600, mode: 'idle', stopOnEnd: false });   // warm up
      const samples = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        await run({ seed: 1 + i, ticks: 2000, mode: 'idle', stopOnEnd: false });
        samples.push((Date.now() - t0) / 2);
      }
      stats.msPer1000Ticks = Math.round(samples.sort((x, y) => x - y)[1]);
      const msPerFrame = stats.msPer1000Ticks / 1000;
      if (msPerFrame > 4)
        add('warn', 'perf', `${msPerFrame.toFixed(1)} ms per step+draw — ${(msPerFrame / 16.7 * 100).toFixed(0)}% ` +
          'of a 60 fps frame budget, before the browser does anything else');

      // 7. shots
      if (OUT) {
        stats.shots = [];
        for (const [label, prep] of [
          ['menu', `window.__game.reset()`],
          ['playing', `window.__game.seed(2024); window.__game.reset(); window.__game.start(); window.__game.step(240)`],
        ]) {
          await cdp.eval(prep, { awaitPromise: false });
          await new Promise(r => setTimeout(r, 120));
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
          const f = resolve(OUT, `${name}-${label}.png`);
          await writeFile(f, Buffer.from(data, 'base64'));
          stats.shots.push(f);
        }
      }

      for (const e of log.errors.slice(problems.filter(p => p.check === 'console').length))
        add('error', 'console', String(e.text).slice(0, 200));
      cdp.close();
    } catch (e) {
      add('error', 'harness', String(e.message ?? e).slice(0, 300));
    } finally { server.close(); }

    results.push({ name, file, problems, stats });
  }
} finally { chrome.kill(); }

// --- report ------------------------------------------------------------------
const broken = results.filter(r => r.problems.some(p => p.level === 'error'));
const warned = results.filter(r => !r.problems.some(p => p.level === 'error') && r.problems.length);

if (asJson) console.log(JSON.stringify({ ok: !broken.length, results }, null, 2));
else {
  console.log(`\nplaytest — ${results.length} prototype(s), ${TICKS} ticks, ${SEEDS} seeds\n`);
  for (const r of results) {
    const errs = r.problems.filter(p => p.level === 'error');
    const mark = errs.length ? 'x' : r.problems.length ? '!' : 'ok';
    const s = r.stats;
    const line = s.botScore !== undefined
      ? `random ${s.botScore} (${s.botRange?.join('–') ?? '?'} over ${SEEDS} seeds)` +
        (s.greedy != null ? ` · random ${s.randomAt} vs lookahead ${s.greedy} over ${s.gradientSeeds} seeds` +
          `${s.gradientTicks < Math.min(TICKS, 900) ? ` in ${s.gradientTicks}t` : ''} (${s.gradient === Infinity ? '∞' : s.gradient.toFixed(1)}x)` : '') +
        ` · ${s.liveActions === null ? '?' : s.liveActions ?? 0}/${s.playableActions ?? 0} actions live · ${s.msPer1000Ticks ?? '?'} ms/1000t${s.turnBased ? ' · turn-based' : ''}`
      : 'did not reach the play checks';
    console.log(`  ${mark.padEnd(3)} ${r.name.padEnd(22)} ${line}`);
    for (const p of r.problems) console.log(`        ${p.level === 'error' ? 'x' : '!'} [${p.check}] ${p.msg}`);
    for (const f of r.stats.shots ?? []) console.log(`        ${f}`);
  }
  console.log(`\n  ${results.length - broken.length - warned.length} clean · ${warned.length} with warnings · ${broken.length} not playable\n`);
}
process.exit(broken.length ? 2 : warned.length ? 1 : 0);
