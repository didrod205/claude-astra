#!/usr/bin/env node
// Deterministic QA sweep of a page at three widths.
//
//   node scripts/qa-run.mjs <url-or-directory> [--out qa] [--widths 390,768,1440]
//                           [--wait 800] [--json]
//
// Reports: console errors, page exceptions, failed/4xx-5xx requests, horizontal
// overflow, broken images, missing alt, unnamed controls, unlabelled fields,
// heading order, duplicate ids, dead links, small tap targets (mobile only).
// Writes a screenshot per width.
//
// This is the sweep. It does NOT click anything — driving the actual flows is
// the interactive half of the job (see SKILL.md).

import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const VALUED = new Set(['out', 'widths', 'wait']);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const target = argv.find((a, i) => {
  const prev = argv[i - 1];
  return !a.startsWith('--') && !(prev?.startsWith('--') && VALUED.has(prev.slice(2)));
});

if (!target) { console.error('usage: qa-run.mjs <url-or-directory> [--out qa] [--widths 390,768,1440]'); process.exit(64); }

const out = resolve(flag('out', 'qa'));
const widths = flag('widths', '390,768,1440').split(',').map(Number);
const wait = +flag('wait', 800);
const asJson = argv.includes('--json');
const probes = await readFile(join(HERE, 'probes.js'), 'utf8');

// A directory or a local file gets served; anything else is treated as a URL.
let url = target, server = null;
if (!/^https?:\/\//.test(target)) {
  const p = resolve(target);
  const st = await stat(p).catch(() => null);
  if (!st) { console.error(`no such path: ${p}`); process.exit(66); }
  const root = st.isDirectory() ? p : dirname(p);
  if (st.isDirectory() && !(await stat(join(p, 'index.html')).catch(() => null))) {
    console.error(`${p} has no index.html — pass the .html file you want swept, or a URL.`);
    process.exit(66);
  }
  server = await serve(root);
  url = `http://127.0.0.1:${server.port}/${st.isDirectory() ? '' : p.slice(root.length + 1)}`;
}

const chrome = await launchChrome();
const runs = [];

try {
  await mkdir(out, { recursive: true });
  for (const w of widths) {
    const h = w < 500 ? 844 : 900;
    const cdp = await CDP.page(chrome.port);
    const log = await instrument(cdp);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 2, mobile: w < 500,
      ...(w < 500 ? { screenWidth: w, screenHeight: h } : {}),
    });
    if (w < 500) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // Without this a headless page is never window-focused, so `:focus` never
    // matches and every focus style silently reads as absent.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

    await goto(cdp, url, { settle: wait });

    let probe = null, probeError = null;
    try { probe = JSON.parse(await cdp.eval(probes, { awaitPromise: false })); }
    catch (e) { probeError = String(e.message ?? e); }

    const shot = join(out, `${w}.png`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(shot, Buffer.from(data, 'base64'));

    runs.push({ width: w, shot, probe, probeError, log });
    cdp.close();
  }
} finally {
  chrome.kill();
  server?.close();
}

/* ------------------------------------------------------------------ report */

const findings = [];
const add = (level, width, check, msg) => findings.push({ level, width, check, msg });
const cap = (arr, n, fmt) => arr.slice(0, n).map(fmt).join('; ') + (arr.length > n ? ` (+${arr.length - n} more)` : '');

for (const r of runs) {
  const w = r.width;
  if (r.probeError) { add('error', w, 'probe', r.probeError); continue; }
  const p = r.probe;

  for (const e of r.log.errors) add('error', w, 'console', String(e.text).replace(/\s+/g, ' ').slice(0, 220));
  for (const f of r.log.failed.filter(f => !/favicon\.ico/.test(f.url ?? '')).slice(0, 10))
    add('error', w, 'network', `${f.text} ${f.url ?? ''}`.trim().slice(0, 200));

  // Report this first: without it the page is unreadable on a phone, and every
  // other width-based finding below was measured in a viewport that isn't real.
  if (w < 500 && p.viewport) {
    if (!p.viewport.present)
      add('error', w, 'viewport', `no <meta name="viewport"> — the phone lays this out at ${p.viewport.layoutWidth}px and scales it down`);
    else if (!p.viewport.deviceWidth)
      add('error', w, 'viewport', `viewport meta has no width=device-width (content="${p.viewport.content}") — laid out at ${p.viewport.layoutWidth}px`);
  }

  if (p.overflow.length) add('error', w, 'overflow', `page scrolls sideways: ${cap(p.overflow, 4, o => `${o.el} +${o.over}px`)}`);
  if (p.clipped.length && !p.overflow.length)
    add('error', w, 'clipped', `wider than the viewport with no way to scroll to it: ${cap(p.clipped, 4, c => `${c.el} ${c.w}px in ${p.stats.viewport}px`)}`);
  for (const i of p.images.filter(i => i.issue === 'broken')) add('error', w, 'image', `broken: ${i.el} ${i.src}`);
  for (const d of p.dupIds) add('error', w, 'dom', `duplicate id "${d.id}" x${d.count}`);

  if (p.contrast?.length) {
    const worst = [...p.contrast].sort((a, b) => a.ratio - b.ratio);
    add('error', w, 'contrast', `${p.contrast.length} text element(s) below WCAG AA: ` +
      cap(worst, 3, c => `${c.el} ${c.ratio}:1 (needs ${c.need}) "${c.text}"`));
  }
  if (p.contrastSkipped) add('warn', w, 'contrast', `${p.contrastSkipped} element(s) sit on an image or gradient — contrast not verifiable, check by eye`);
  if (p.focus?.length) add('warn', w, 'a11y', `${p.focus.length} control(s) show no visible change when focused: ${cap(p.focus, 4, f => f.el)}`);

  const noAlt = p.images.filter(i => i.issue === 'no alt');
  if (noAlt.length) add('warn', w, 'a11y', `${noAlt.length} image(s) without alt: ${cap(noAlt, 4, i => i.el)}`);
  if (p.controls.length) add('warn', w, 'a11y', `${p.controls.length} control(s) with no accessible name: ${cap(p.controls, 4, c => c.el)}`);
  if (p.labels.length) add('warn', w, 'a11y', `${p.labels.length} field(s) with no label: ${cap(p.labels, 4, l => `${l.el}[${l.type}]`)}`);
  for (const h of p.headings) {
    if (h.h1count != null) add('warn', w, 'a11y', `${h.h1count} visible <h1> on the page`);
    else add('warn', w, 'a11y', `heading jumps h${h.from} -> h${h.to}: "${h.text}"`);
  }
  if (p.deadLinks.length) add('warn', w, 'link', `${p.deadLinks.length} link(s) with no destination: ${cap(p.deadLinks, 4, l => `"${l.text}"`)}`);
  if (w < 500 && p.targets.length) add('warn', w, 'touch', `${p.targets.length} tap target(s) under 44px: ${cap(p.targets, 4, t => `${t.el} ${t.w}x${t.h}`)}`);
  if (!p.stats.title) add('warn', w, 'meta', 'page has no <title>');
}

const errs = findings.filter(f => f.level === 'error');
const warns = findings.filter(f => f.level === 'warn');

if (asJson) {
  console.log(JSON.stringify({ url, ok: !errs.length, findings, shots: runs.map(r => ({ width: r.width, shot: r.shot })) }, null, 2));
} else {
  console.log(`\nqa sweep - ${url}`);
  console.log(`  ${runs.map(r => `${r.width}px`).join(' / ')} - ${errs.length} error(s), ${warns.length} warning(s)\n`);
  const groups = new Map();
  for (const f of findings) {
    const k = `${f.level}\u0000${f.check}\u0000${f.msg}`;
    if (!groups.has(k)) groups.set(k, { ...f, widths: [] });
    groups.get(k).widths.push(f.width);
  }
  const all = [...groups.values()];
  const everywhere = all.filter(g => g.widths.length === widths.length);
  const specific = all.filter(g => g.widths.length !== widths.length);
  const line = f => `    ${f.level === 'error' ? 'x' : '!'} [${f.check}] ${f.msg}`;
  const rank = (a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1);

  if (everywhere.length) {
    console.log('  every width');
    for (const f of everywhere.sort(rank)) console.log(line(f));
  }
  for (const w of widths) {
    const here = specific.filter(f => f.widths.includes(w)).sort(rank);
    if (!here.length) continue;
    console.log(`  ${w}px only`);
    for (const f of here) console.log(line(f));
  }
  if (!findings.length) console.log('  ok - nothing flagged by the static sweep');
  console.log('');
  for (const r of runs) console.log(`  ${r.shot}`);
  console.log('');
}
process.exit(errs.length ? 2 : warns.length ? 1 : 0);
