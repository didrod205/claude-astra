#!/usr/bin/env node
// Export the scene to a .glb with the manifest hierarchy and names intact,
// ready to open in Blender (File > Import > glTF 2.0) or Unreal (glTF importer).
//   node scripts/export-glb.mjs <sceneDir> [--out scene.glb]
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const oi = argv.indexOf('--out');
const dir = resolve(argv.find((a, i) => !a.startsWith('--') && i !== oi + 1) ?? '.');
const out = resolve(oi < 0 ? join(dir, 'scene.glb') : argv[oi + 1]);

const server = await serve(dir);
const chrome = await launchChrome();
try {
  const cdp = await CDP.page(chrome.port);
  await instrument(cdp);
  await goto(cdp, `http://127.0.0.1:${server.port}/index.html`, { settle: 300 });
  await cdp.eval('window.__ready');
  const b64 = await cdp.eval(`window.__exportGLTF().then(buf => {
    let s = '', bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  })`);
  const buf = Buffer.from(b64, 'base64');
  await writeFile(out, buf);
  console.log(`\n  ${out}  (${(buf.length / 1024).toFixed(0)} KB)\n`);
} finally { chrome.kill(); server.close(); }
