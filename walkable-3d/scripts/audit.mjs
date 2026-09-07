#!/usr/bin/env node
// Structural audit of a walkable scene. Catches the failures a screenshot hides.
//
//   node scripts/audit.mjs <sceneDir> [--json]
//
// Exit 0 = clean, 1 = warnings only, 2 = errors (scene is broken).

import { resolve, basename } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const dir = resolve(argv.find(a => !a.startsWith('--')) ?? '.');
const asJson = argv.includes('--json');

const server = await serve(dir);
const chrome = await launchChrome();
const problems = [];
const add = (level, check, msg) => problems.push({ level, check, msg });

try {
  const cdp = await CDP.page(chrome.port);
  const log = await instrument(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 250 });

  const built = await cdp.eval(`window.__ready.then(()=>true).catch(()=>false)`).catch(() => false);
  if (!built) {
    const err = await cdp.eval(`window.__bootError ?? 'scene never finished building'`).catch(() => 'unknown');
    add('error', 'boot', err);
    report(); process.exit(2);
  }

  // Run the walk simulation deterministically — not on wall-clock, which a
  // headless page throttles — and check the player is still where they were
  // put. A scene can be structurally perfect and still not hold anyone up.
  const stand = await cdp.eval(`(() => {
    const sp = window.__three.manifest.spawn;
    if (!window.__simulate || !sp) return null;
    const r = window.__simulate(1.0);
    return JSON.stringify({ ...r, spawnY: sp.position[1] });
  })()`).then(v => (v ? JSON.parse(v) : null));

  const d = await cdp.eval(`JSON.stringify(window.__auditData())`).then(JSON.parse);
  const meshes = d.objects.filter(o => o.type !== 'group' && o.type !== 'light');

  for (const e of log.errors) add('error', 'console', String(e.text).slice(0, 200));

  // 1. Is there a scene at all?
  // Zero, not "fewer than two": a scene that is one terrain, or one imported
  // building, is unusual but not broken. The fault this catches is objects
  // never being parsed at all.
  if (!meshes.length) add('error', 'empty', 'no meshes in the scene — nothing was built');
  const diag = Math.hypot(...d.bounds.size);
  if (diag < 0.5) add('error', 'empty', `scene bounding box is ${diag.toFixed(2)} m across — nothing was placed`);

  // 2. Degenerate and absurd geometry.
  for (const o of meshes) {
    if (o.empty || o.size.every(v => v === 0)) add('error', 'degenerate', `${o.id} has zero size`);
    else if (Math.max(...o.size) > 500 && o.type !== 'terrain') add('warn', 'scale', `${o.id} is ${Math.max(...o.size).toFixed(0)} m across`);
    else if (Math.max(...o.size) < 0.002) add('warn', 'scale', `${o.id} is under 2 mm — invisible at human scale`);
  }

  // 3. Naming and hierarchy — this is what makes the export editable.
  const seen = new Map();
  for (const o of d.objects) {
    if (o.id === '(unnamed)') add('warn', 'naming', 'an object has no id');
    else seen.set(o.id, (seen.get(o.id) ?? 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) add('warn', 'naming', `id "${id}" used ${n}x`);

  // 4. Everything piled at the origin = the manifest was written without layout.
  const atOrigin = meshes.filter(o => o.min.every((v, i) => Math.abs((v + o.max[i]) / 2) < 0.01));
  if (meshes.length > 4 && atOrigin.length / meshes.length > 0.4) {
    add('error', 'layout', `${atOrigin.length}/${meshes.length} meshes are centred on the origin - they are stacked inside each other`);
  }

  // 5. Floating / sunken objects.
  const below = meshes.filter(o => o.max[1] < -0.05 && o.id !== 'ground');
  if (below.length) add('warn', 'layout', `${below.length} object(s) sit entirely below y=0: ${below.slice(0, 5).map(o => o.id).join(', ')}`);

  // 6. Solid objects intersecting each other.
  const solids = meshes.filter(o => o.solid);
  const vol = o => Math.max(o.size[0], 1e-6) * Math.max(o.size[1], 1e-6) * Math.max(o.size[2], 1e-6);
  let clashes = 0;
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      if (a.parent === b.id || b.parent === a.id) continue;
      const ov = [0, 1, 2].map(k => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
      if (ov.some(v => v <= 0)) continue;
      const share = (ov[0] * ov[1] * ov[2]) / Math.min(vol(a), vol(b));
      if (share > 0.25) {
        clashes++;
        if (clashes <= 6) add('warn', 'clash', `${a.id} / ${b.id} overlap by ${(share * 100).toFixed(0)}%`);
      }
    }
  }
  if (clashes > 6) add('warn', 'clash', `...and ${clashes - 6} more solid/solid overlaps`);

  // 7. The spawn point - the difference between "a walkable scene" and "a scene".
  if (!d.spawn) add('warn', 'spawn', 'no spawn defined; the player starts at a guess');
  else {
    const [sx, sy, sz] = d.spawn.position;
    const inside = solids.find(o =>
      sx > o.min[0] - 0.35 && sx < o.max[0] + 0.35 &&
      sz > o.min[2] - 0.35 && sz < o.max[2] + 0.35 &&
      sy - 1.7 < o.max[1] - 0.05 && sy > o.min[1]);
    if (inside) add('error', 'spawn', `spawn is inside solid "${inside.id}" - the player starts trapped`);

    // Ask the walk controller where the ground is, rather than guessing from
    // bounding boxes - a heightfield's box reaches far above the player.
    const ground = await cdp.eval(`window.__groundAt ? window.__groundAt(${sx}, ${sz}, ${sy + 2}) : null`);
    if (ground == null) add('error', 'spawn', 'no surface under the spawn point - the player falls out of the world');
    else {
      const drop = sy - ground;
      if (drop > 2.2) add('warn', 'spawn', `spawn floats ${drop.toFixed(1)} m above the ground`);
      else if (drop < 1.4) add('warn', 'spawn', `spawn eye height is ${drop.toFixed(2)} m - a standing adult is 1.7 m`);
    }
  }

  // 7b. Is the player still standing where they were put, half a second in?
  if (stand) {
    const drift = stand.y - stand.spawnY;
    if (!isFinite(stand.y) || Math.abs(drift) > 1.0)
      add('error', 'spawn', `after 1 s of walking the player is at y=${stand.y.toFixed(2)}, ` +
        `${Math.abs(drift).toFixed(1)} m from the spawn height — they are falling or being launched, not standing`);
    else if (!stand.onGround)
      add('warn', 'spawn', 'the player is still airborne after a second');
  }

  // 7c. The mistakes a first draft makes. Each of these cost an iteration to
  //     find by hand; none of them is visible in a screenshot.
  const lights = d.objects.filter(o => o.type === 'light');
  const enclosing = solids.filter(o => o.size[1] >= 1.8 && Math.max(o.size[0], o.size[2]) >= 2);
  if (!lights.length && enclosing.length >= 3)
    add('warn', 'light', 'no light objects, but the scene has walls — an emissive material glows without ' +
      'emitting, so any interior will render as a black box. Add a { kind: "light" }');

  // Only near the floor: a solid sill at waist height is furniture you bump into,
  // which is fine. A solid 26 cm course at ankle height is a fence.
  const floorY = Math.min(...meshes.map(o => o.min[1]));
  const lowSolids = solids.filter(o => o.size[1] > 0.02 && o.size[1] < 0.35 &&
                                       Math.max(o.size[0], o.size[2]) > 1.0 &&
                                       o.min[1] < floorY + 0.6);
  if (lowSolids.length)
    add('warn', 'solid', `${lowSolids.length} low solid slab(s) — ${lowSolids.slice(0, 4).map(o => o.id).join(', ')}. ` +
      'Under 35 cm is trim you step onto; solid, it is a wall you cannot step over');

  // Gaps a person cannot fit through, between things tall and wide enough to be
  // walls or doors. 0.7 m is the width of the player capsule.
  const walls = solids.filter(o => o.size[1] >= 1.5 && Math.max(o.size[0], o.size[2]) >= 0.8);
  const tight = [];
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a2 = walls[i], b2 = walls[j];
      const yOver = Math.min(a2.max[1], b2.max[1]) - Math.max(a2.min[1], b2.min[1]);
      if (yOver < 1.0) continue;
      for (const [ax, other] of [[0, 2], [2, 0]]) {
        const shared = Math.min(a2.max[other], b2.max[other]) - Math.max(a2.min[other], b2.min[other]);
        if (shared < 0.1) continue;
        // Both have to be slabs facing the same way, or this fires on every
        // bookcase standing 15 cm off a wall — which is a slot, not a doorway.
        if (a2.size[other] > 0.5 || b2.size[other] > 0.5) continue;
        const gap = Math.max(a2.min[ax], b2.min[ax]) - Math.min(a2.max[ax], b2.max[ax]);
        if (gap > 0.05 && gap < 0.75) tight.push({ a: a2.id, b: b2.id, gap: gap.toFixed(2) });
      }
    }
  }
  if (tight.length)
    add('warn', 'passage', `${tight.length} gap(s) too narrow to walk through: ` +
      tight.slice(0, 4).map(t => `${t.a}/${t.b} ${t.gap} m`).join(', ') +
      ' — a person needs 0.7 m. Run walk.mjs to see whether it matters');

  const mats = new Set();
  for (const o of d.objects) if (o.material) mats.add(o.material);
  if (d.materialCount > 26)
    add('warn', 'palette', `${d.materialCount} materials — a coherent scene is usually under 20. ` +
      'Two neutrals, one or two woods, one cool, one accent');

  // 8. Budget.
  if (d.render.calls > 900) add('warn', 'perf', `${d.render.calls} draw calls - merge or instance repeated props`);
  if (d.render.triangles > 3000000) add('warn', 'perf', `${(d.render.triangles / 1e6).toFixed(1)}M triangles`);

  report(d);
} finally {
  chrome.kill();
  server.close();
}

function report(d) {
  const errs = problems.filter(p => p.level === 'error');
  const warns = problems.filter(p => p.level === 'warn');
  if (asJson) { console.log(JSON.stringify({ ok: !errs.length, problems, data: d }, null, 2)); }
  else {
    console.log(`\naudit - ${basename(dir)}`);
    if (d) console.log(`  ${d.objects.length} objects (${d.objects.filter(o => o.solid).length} solid) - ` +
      `${d.bounds.size.map(v => v.toFixed(1)).join(' x ')} m - ` +
      `${d.render.calls} draw calls - ${(d.render.triangles / 1000).toFixed(0)}k tris`);
    console.log('');
    for (const p of [...errs, ...warns]) console.log(`  ${p.level === 'error' ? 'x' : '!'} [${p.check}] ${p.msg}`);
    console.log(problems.length ? '' : '  ok - no structural problems\n');
  }
  process.exitCode = errs.length ? 2 : warns.length ? 1 : 0;
}
