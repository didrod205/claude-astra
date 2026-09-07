#!/usr/bin/env node
// Prove a prototype is actually playable — headlessly, without waiting for real
// time, by driving the __game contract.
//
//   node scripts/playtest.mjs <file-or-dir> [more...] [--ticks 1800] [--out shots] [--json]
//
// A directory is scanned one level deep for .html files, so one call playtests
// every prototype in a batch.
//
// Exit 0 clean · 1 warnings · 2 a prototype is not playable.

import { writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, basename, join, extname } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['ticks', 'out']);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const positional = argv.filter((a, i) => {
  const prev = argv[i - 1];
  return !a.startsWith('--') && !(prev?.startsWith('--') && VALUED.has(prev.slice(2)));
});
const TICKS = +flag('ticks', 1800);
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

      // 2. it starts and time moves
      const idle = await run({ seed: 12345, ticks: Math.min(TICKS, 600), mode: 'idle', stopOnEnd: false });
      if (!idle.final) add('error', 'run', 'state() returned nothing after a run');
      else {
        if ((idle.final.tick ?? 0) === 0) add('error', 'run', 'tick never advanced — step() does not drive the simulation');
        stats.idleEnd = idle.over ? `${idle.over.status} @ tick ${idle.over.tick}` : 'never ended';
        if (!idle.over) add('warn', 'design', 'doing nothing for 600 ticks never ends the game — is there a lose condition?');
      }

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

      // 5. a random bot can make progress
      const bot = await run({ seed: 2024, ticks: TICKS, mode: 'bot', stopOnEnd: true });
      stats.botScore = bot.best;
      stats.botEnd = bot.over ? `${bot.over.status} @ tick ${bot.over.tick}` : `survived ${TICKS}`;
      if (bot.best === 0) add('error', 'playable', `a random bot scored 0 in ${TICKS} ticks — unwinnable, or scoring is broken`);

      // 6. speed
      const t0 = Date.now();
      await run({ seed: 1, ticks: 3000, mode: 'idle', stopOnEnd: false });
      stats.msPer1000Ticks = Math.round((Date.now() - t0) / 3);
      if (stats.msPer1000Ticks > 400) add('warn', 'perf', `${stats.msPer1000Ticks} ms per 1000 ticks — will not hold 60 fps`);

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
  console.log(`\nplaytest — ${results.length} prototype(s), ${TICKS} ticks each\n`);
  for (const r of results) {
    const errs = r.problems.filter(p => p.level === 'error');
    const mark = errs.length ? 'x' : r.problems.length ? '!' : 'ok';
    const s = r.stats;
    const line = s.botScore !== undefined
      ? `bot scored ${s.botScore}, ${s.botEnd} · ${s.liveActions === null ? '?' : s.liveActions ?? 0}/${s.playableActions ?? 0} actions live · ${s.msPer1000Ticks ?? '?'} ms/1000t`
      : 'did not reach the play checks';
    console.log(`  ${mark.padEnd(3)} ${r.name.padEnd(22)} ${line}`);
    for (const p of r.problems) console.log(`        ${p.level === 'error' ? 'x' : '!'} [${p.check}] ${p.msg}`);
    for (const f of r.stats.shots ?? []) console.log(`        ${f}`);
  }
  console.log(`\n  ${results.length - broken.length - warned.length} clean · ${warned.length} with warnings · ${broken.length} not playable\n`);
}
process.exit(broken.length ? 2 : warned.length ? 1 : 0);
