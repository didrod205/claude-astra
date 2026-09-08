#!/usr/bin/env node
// What height is the ground at (x, z)? Terrain is generated from seeded noise
// inside the page, so this is the only honest way to seat a prop on it without
// reimplementing that noise in whatever you author the manifest with.
//
//   node scripts/ground.mjs <sceneDir> 12,-4 0,0 -8,15
//   node scripts/ground.mjs <sceneDir> --grid -20,-20,20,20,5     # x0,z0,x1,z1,step
//
// Prints one "x z y" line per point; y is blank where there is no ground.

import { resolve, basename } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const gi = argv.indexOf('--grid');
const dir = resolve(argv.find((a, i) => !a.startsWith('--') && i !== gi + 1 && a.includes('/')) ?? argv[0] ?? '.');

let pts = [];
if (gi >= 0) {
  const [x0, z0, x1, z1, step] = argv[gi + 1].split(',').map(Number);
  for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) pts.push([x, z]);
} else {
  pts = argv.filter(a => !a.startsWith('--') && /^-?[\d.]+,-?[\d.]+$/.test(a)).map(a => a.split(',').map(Number));
}
if (!pts.length) { console.error('usage: ground.mjs <sceneDir> x,z [x,z...]  |  --grid x0,z0,x1,z1,step'); process.exit(64); }

const server = await serve(dir);
const chrome = await launchChrome();
try {
  const cdp = await CDP.page(chrome.port);
  await instrument(cdp);
  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 300 });
  await cdp.eval('window.__ready');
  const ys = JSON.parse(await cdp.eval(`JSON.stringify(window.__groundAtMany(${JSON.stringify(pts)}))`));
  console.log(`# ground heights — ${basename(dir)}`);
  pts.forEach(([x, z], i) => console.log(`${x}\t${z}\t${ys[i] ?? ''}`));
} finally { chrome.kill(); server.close(); }
