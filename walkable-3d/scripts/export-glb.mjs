#!/usr/bin/env node
// Export the scene to a .glb with the manifest hierarchy and names intact,
// ready to open in Blender (File > Import > glTF 2.0) or Unreal (glTF importer).
//   node scripts/export-glb.mjs <sceneDir> [--out scene.glb]

import { rename, mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const dir = resolve(argv.find((a, i) => !a.startsWith('--') && i !== oi + 1) ?? '.');
const out = resolve(oi < 0 ? join(dir, 'scene.glb') : argv[oi + 1]);

const server = await serve(dir);
const chrome = await launchChrome();
const drop = await mkdtemp(join(tmpdir(), 'w3d-glb-'));
try {
  const cdp = await CDP.page(chrome.port);
  await instrument(cdp);
  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 300 });
  await cdp.eval('window.__ready');

  // Let the browser write the file itself. A whole scene is tens of megabytes
  // and moving it through Runtime.evaluate as base64 is pathologically slow —
  // a single 4 MB chunk took over two minutes to serialise.
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: drop, eventsEnabled: true,
  }).catch(() => cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: drop }));

  await cdp.eval(`window.__exportGLTF().then(buf => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    a.download = 'scene.glb';
    document.body.appendChild(a);
    a.click();
    return buf.byteLength;
  })`, { timeout: 300000 });

  // Wait for it to land and stop growing.
  let file = null, last = -1, stable = 0;
  for (let i = 0; i < 300; i++) {
    const names = (await readdir(drop)).filter(n => n.endsWith('.glb'));
    if (names.length) {
      file = join(drop, names[0]);
      const sz = (await stat(file)).size;
      if (sz > 0 && sz === last) { if (++stable >= 3) break; } else { stable = 0; last = sz; }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!file) throw new Error('the browser never produced a .glb');

  await rename(file, out).catch(async () => {
    const { copyFile } = await import('node:fs/promises');
    await copyFile(file, out);
  });
  const sz = (await stat(out)).size;
  console.log(`\n  ${out}  (${(sz / 1024 / 1024).toFixed(1)} MB)\n`);
} finally {
  chrome.kill();
  server.close();
  await rm(drop, { recursive: true, force: true }).catch(() => {});
}
