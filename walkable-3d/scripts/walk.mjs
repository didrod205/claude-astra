#!/usr/bin/env node
// Walk the scene. The audit proves the player can STAND; this proves they can
// move — that the ground carries them uphill and down, that they do not drop
// through it, and that they are not fenced in where they should not be.
//
//   node scripts/walk.mjs <sceneDir> [--seconds 8] [--dirs 8] [--from x,y,z] [--json]
//
// Exit 0 clean · 1 warnings · 2 the scene is not walkable.

import { resolve, basename } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['seconds', 'dirs', 'from']);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const dir = resolve(argv.find((a, i) => {
  const p = argv[i - 1];
  return !a.startsWith('--') && !(p?.startsWith('--') && VALUED.has(p.slice(2)));
}) ?? '.');
const SEC = +flag('seconds', 8);
const DIRS = Math.max(1, +flag('dirs', 8));
const asJson = argv.includes('--json');
// Walk from somewhere other than the spawn — an interior needs testing from
// inside it, and the spawn is usually at the front door or on the path.
const FROM = flag('from', null);
const from = FROM ? FROM.split(',').map(Number) : null;

const server = await serve(dir);
const chrome = await launchChrome();
const problems = [];
const add = (level, check, msg) => problems.push({ level, check, msg });
let runs = [];

try {
  const cdp = await CDP.page(chrome.port);
  const log = await instrument(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 500, deviceScaleFactor: 1, mobile: false });
  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 250 });

  const built = await cdp.eval(`window.__ready.then(()=>true).catch(()=>false)`).catch(() => false);
  if (!built) {
    const err = await cdp.eval(`window.__bootError ?? 'scene never finished building'`).catch(() => 'unknown');
    add('error', 'boot', err);
  } else if (!(await cdp.eval('typeof window.__walk === "function"'))) {
    add('error', 'hooks', 'this scene ships an older runtime.js without __walk — copy the current one from assets/template');
  } else {
    for (let i = 0; i < DIRS; i++) {
      const yaw = (i / DIRS) * Math.PI * 2;
      const r = JSON.parse(await cdp.eval(
        `JSON.stringify(window.__walk(${yaw}, ${SEC}, 1/60, ${from ? JSON.stringify(from) : 'null'}))`,
        { timeout: 180000 }));
      runs.push({ heading: Math.round((yaw * 180) / Math.PI), ...r });
    }
    for (const e of log.errors) add('error', 'console', String(e.text).slice(0, 200));

    const moved = runs.filter(r => r.distance > 1.0);
    const fell = runs.filter(r => r.underGround);
    const dropped = runs.filter(r => r.worstDrop > 1.5);
    const floaty = runs.filter(r => r.airborneFraction > 0.5);

    if (!moved.length)
      add('error', 'walk', `the player could not move more than 1 m in any of ${DIRS} directions — fenced in at the spawn`);
    else if (moved.length < DIRS / 3)
      add('warn', 'walk', `only ${moved.length} of ${DIRS} directions are walkable — is the spawn boxed in?`);

    if (fell.length)
      add('error', 'walk', `the player ended up BELOW the ground walking ${fell.map(r => r.heading + '°').join(', ')} — they fall through`);
    if (dropped.length)
      add('error', 'walk', `a single frame dropped more than 1.5 m walking ${dropped.map(r => r.heading + '°').join(', ')} — a hole or a cliff edge with nothing under it`);
    if (floaty.length)
      add('warn', 'walk', `airborne more than half the time walking ${floaty.map(r => r.heading + '°').join(', ')} — the ground is not carrying the player`);

    const climbed = runs.filter(r => r.climb > 0.3);
    if (climbed.length) {
      const best = climbed.sort((a, b) => b.climb - a.climb)[0];
      add('info', 'terrain', `the ground has relief: ${best.climb} m of climb walking ${best.heading}°`);
    }
  }
} finally {
  chrome.kill();
  server.close();
}

const errs = problems.filter(p => p.level === 'error');
const warns = problems.filter(p => p.level === 'warn');
if (asJson) console.log(JSON.stringify({ ok: !errs.length, problems, runs }, null, 2));
else {
  console.log(`\nwalk — ${basename(dir)} · ${DIRS} directions · ${SEC}s each` +
              `${from ? ` · from ${from.join(', ')}` : ''}\n`);
  for (const r of runs) {
    console.log(`  ${String(r.heading).padStart(3)}°  ${String(r.distance).padStart(6)} m   ` +
      `climb ${String(r.climb).padStart(5)} m   end y ${String(r.endY).padStart(6)}   ` +
      `${r.onGround ? 'on ground' : 'AIRBORNE '}${r.underGround ? '  UNDER GROUND' : ''}`);
  }
  console.log('');
  for (const p of problems) console.log(`  ${p.level === 'error' ? 'x' : p.level === 'warn' ? '!' : '·'} [${p.check}] ${p.msg}`);
  if (!problems.length) console.log('  ok - walkable in every direction tried');
  console.log('');
}
process.exit(errs.length ? 2 : warns.length ? 1 : 0);
