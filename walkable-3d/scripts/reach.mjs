#!/usr/bin/env node
// Where can a person actually GET to? Flood-fill the scene from spawn, walking
// every edge with the real controller.
//
//   node scripts/reach.mjs <scene-dir-or-json> [--cell 0.7] [--from x,y,z] [--json]
//
// The audit proves the spawn point is not inside a wall. It says nothing about
// whether the building has a way in, whether a room is sealed behind a doorway
// too narrow to use, or whether half of what you modelled is somewhere nobody
// can stand. A scene can audit clean, photograph well, and still be a diorama.

import { resolve, dirname, basename } from 'node:path';
import { stat } from 'node:fs/promises';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const asJson = argv.includes('--json');
const VALUED = new Set(['cell', 'from', 'sec', 'radius', 'budget']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && VALUED.has(argv[i - 1].slice(2))));
if (!pos.length) { console.error('usage: reach.mjs <scene-dir-or-json> [--cell 0.7] [--from x,y,z]'); process.exit(64); }

const target = resolve(pos[0]);
const st = await stat(target).catch(() => null);
if (!st) { console.error(`no such path: ${target}`); process.exit(66); }
const dir = st.isDirectory() ? target : dirname(target);

const server = await serve(dir);
const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
try {
  await instrument(cdp);
  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 700 });
  await cdp.eval('window.__ready', { awaitPromise: true });
  await cdp.eval('window.__thaw && window.__thaw()', { awaitPromise: false });

  const opts = { cell: +flag('cell', 1.0), sec: +flag('sec', 0.42),
                 radius: +flag('radius', 45), budget: +flag('budget', 9000) };
  const from = flag('from', null);
  if (from) opts.from = from.split(',').map(Number);
  const r = JSON.parse(await cdp.eval(`JSON.stringify(window.__reach(${JSON.stringify(opts)}))`,
                                      { awaitPromise: false, timeout: 300000 }));

  if (asJson) { console.log(JSON.stringify(r, null, 2)); }
  else {
    const name = basename(dir);
    console.log(`\nreach — ${name}\n`);
    console.log(`  ${r.cells} standing places · ${r.area} m² · ${r.extent[0]} x ${r.extent[1]} m of ground`);
    if (!r.exhausted) console.log(`  (stopped at the edge budget — the space is larger than this)`);

    // Not "how much of the building's bounding box did the fill land in": that
    // number moved 322 -> 293 when the cabin was sealed shut, because the box
    // includes the decking outside. What actually changed was that every stick
    // of furniture became unreachable, so that is the headline.
    //
    // Anything at floor level a person cannot get near is either scenery or a
    // mistake, and the scene cannot tell you which. You can. Anything above head
    // height is a roof, a ceiling or a light, and belongs out of the reckoning.
    const ground = r.objects.filter(o => o.y <= 2.0);
    const far = ground.filter(o => o.near > 2.0);
    console.log(`\n  ${ground.length - far.length} of ${ground.length} named objects at floor level are within 2 m of somewhere you can stand`);
    console.log(`  (${r.objects.length - ground.length} more sit above head height — roofs, ceilings, lights).`);
    if (far.length) {
      console.log(`\n  at floor level and out of reach:`);
      for (const o of far.slice(0, 14)) console.log(`    ${String(o.near).padStart(6)} m away   ${o.id}`);
      if (far.length > 14) console.log(`    ... and ${far.length - 14} more`);
      console.log(`\n  Scenery across a ravine belongs on that list. Furniture does not —`);
      console.log(`  a room you cannot walk into audits clean and photographs well.`);
    } else {
      console.log(`\n  Nothing modelled at floor level is somewhere a person cannot get to.`);
    }
  }
  process.exit(r.cells <= 1 ? 2 : (r.objects.filter(o => o.y <= 2.0 && o.near > 2.0).length ? 1 : 0));
} finally {
  chrome.kill(); server.close();
}
