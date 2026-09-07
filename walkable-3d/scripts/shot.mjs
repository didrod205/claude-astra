#!/usr/bin/env node
// Screenshot a walkable scene from several angles at once.
//
//   node scripts/shot.mjs <sceneDir> [--out shots] [--w 1280] [--h 800]
//                         [--pose x,y,z@lx,ly,lz]...   (repeatable; overrides auto poses)
//                         [--only spawn|orbit|top]
//
// Default poses = spawn + 4 orbit corners + 1 top-down. One angle is never enough:
// the classic generated-3D failure is a facade that looks right from the front and
// is hollow, floating, or missing from every other side.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const many = n => argv.reduce((a, v, i) => (v === `--${n}` ? [...a, argv[i + 1]] : a), []);

const FLAGS_WITH_VALUE = new Set(['out', 'w', 'h', 'pose', 'only']);
const positional = argv.filter((a, i) => {
  const prev = argv[i - 1];
  return !a.startsWith('--') && !(prev?.startsWith('--') && FLAGS_WITH_VALUE.has(prev.slice(2)));
});
const dir = resolve(positional[0] ?? '.');
const out = resolve(flag('out', 'shots'));
const W = +flag('w', 1280), H = +flag('h', 800);
const only = flag('only', null);

const parsePose = s => {
  const [p, l] = s.split('@');
  return { position: p.split(',').map(Number), lookAt: (l ?? '0,0,0').split(',').map(Number) };
};

const server = await serve(dir);
const chrome = await launchChrome();
let failed = false;

try {
  const cdp = await CDP.page(chrome.port);
  const log = await instrument(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });

  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 250 });

  const built = await cdp.eval(`window.__ready.then(()=>true).catch(()=>false)`).catch(() => false);
  if (!built) {
    const err = await cdp.eval(`window.__bootError ?? 'scene never finished building'`).catch(() => 'unknown');
    console.error(`\n✗ scene failed to build:\n${err}\n`);
    for (const e of log.errors.slice(0, 8)) console.error(`  [${e.source}] ${e.text?.slice(0, 300)}`);
    process.exit(2);
  }

  const b = await cdp.eval(`JSON.stringify(window.__bounds({ subject: true }))`).then(JSON.parse);
  const spawn = await cdp.eval(`JSON.stringify(window.__three.manifest.spawn ?? null)`).then(JSON.parse);

  const [cx, cy, cz] = b.center;
  const span = Math.max(b.size[0], b.size[2], 1);
  const r = span * 1.15 + 4, eye = cy + b.size[1] * 0.7;

  const custom = many('pose').map(parsePose);
  let poses = custom.length ? custom.map((p, i) => ({ name: `pose-${i + 1}`, ...p })) : [
    ...(spawn ? [{ name: 'spawn', position: spawn.position, lookAt: spawn.lookAt ?? b.center }] : []),
    ...[0, 90, 180, 270].map(deg => ({
      name: `orbit-${deg}`,
      position: [cx + r * Math.cos(deg * Math.PI / 180), eye, cz + r * Math.sin(deg * Math.PI / 180)],
      lookAt: b.center,
    })),
    { name: 'top', position: [cx, cy + Math.max(b.size[1] * 2.4, span * 1.1), cz + 0.01], lookAt: b.center },
  ];
  if (only) poses = poses.filter(p => p.name.startsWith(only));

  await mkdir(out, { recursive: true });
  const written = [];
  for (const p of poses) {
    await cdp.eval(`window.__setCamera(${JSON.stringify({ position: p.position, lookAt: p.lookAt })})`);
    await new Promise(r => setTimeout(r, 120));
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = resolve(out, `${p.name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));
    written.push(file);
  }

  console.log(`\nscene ${basename(dir)} — bounds ${b.size.map(v => v.toFixed(1)).join(' × ')} m\n`);
  for (const f of written) console.log(`  ${f}`);
  if (log.errors.length) {
    failed = true;
    console.log(`\n⚠ ${log.errors.length} console error(s):`);
    for (const e of log.errors.slice(0, 8)) console.log(`  [${e.source}] ${String(e.text).slice(0, 240)}`);
  }
  console.log('');
} finally {
  chrome.kill();
  server.close();
}
process.exit(failed ? 1 : 0);
