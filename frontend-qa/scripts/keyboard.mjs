#!/usr/bin/env node
// Can the page be used without a mouse? Press Tab and see where focus goes.
//
//   node scripts/keyboard.mjs <url-or-file> [--width 1280] [--max 120] [--json]
//
// The sweep checks that a focused control LOOKS focused. This checks something
// else: that you can get to it at all. An element can be focusable by script and
// unreachable by Tab, and the two are tested by different means — el.focus()
// always works, pressing Tab does not.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { serve, launchChrome, CDP, instrument, goto } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const asJson = argv.includes('--json');
const VALUED = new Set(['width', 'height', 'max']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && VALUED.has(argv[i - 1].slice(2))));
if (!positional.length) { console.error('usage: keyboard.mjs <url-or-file> [--width 1280] [--max 120]'); process.exit(64); }

const WIDTH = +flag('width', 1280), HEIGHT = +flag('height', 900), MAX = +flag('max', 120);

let target = positional[0], server = null;
if (!/^https?:/.test(target)) {
  const p = resolve(target);
  if (!existsSync(p)) { console.error(`no such file: ${p}`); process.exit(66); }
  const dir = p.replace(/\/[^/]*$/, '');
  server = await serve(dir);
  target = `http://127.0.0.1:${server.port}/${p.slice(dir.length + 1)}`;
}

const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
try {
  await instrument(cdp);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  // Without this the page is never "focused" and :focus never matches — the same
  // trap the sweep documents. A Tab walk on an unfocused page goes nowhere.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await goto(cdp, target, { settle: 600 });

  const INVENTORY = `(() => {
    const vis = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
    };
    const where = el => {
      const id = el.id ? '#' + el.id : '';
      const cls = (el.className && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      return el.tagName.toLowerCase() + id + cls;
    };
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [role="button"], [role="link"], [role="tab"], [contenteditable="true"]';
    const proper = [...document.querySelectorAll(sel)];
    const isProper = new Set(proper);
    // The thing that is a control only if you own a mouse. A <div onclick>
    // matches no focusable selector at all, so a check that starts from the
    // focusable selector can never report it — which is how the first version of
    // this script called a page with a div-button "4 of 4 controls reachable".
    const painted = [...document.querySelectorAll('*')].filter(el => {
      if (isProper.has(el) || !vis(el)) return false;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 40) return false;
      if (el.closest('a[href], button, label, [role="button"]')) return false;
      return el.hasAttribute('onclick') || getComputedStyle(el).cursor === 'pointer';
    });
    const all = [...proper, ...painted];
    return JSON.stringify(all.map((el, i) => {
      el.dataset.__kb = String(i);
      const r = el.getBoundingClientRect();
      return { i, el: where(el), visible: vis(el), painted: !isProper.has(el),
               disabled: !!el.disabled, tabindex: el.getAttribute('tabindex'),
               x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               text: (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 34) };
    }));
  })()`;
  const items = JSON.parse(await cdp.eval(INVENTORY, { awaitPromise: false }));

  // Start from the very top of the document, the way a keyboard user arrives.
  await cdp.eval(`document.body.setAttribute('tabindex','-1'); document.body.focus(); document.activeElement.blur && document.activeElement.blur();`, { awaitPromise: false });

  const ACTIVE = `(() => {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return JSON.stringify(null);
    const r = a.getBoundingClientRect(), s = getComputedStyle(a);
    return JSON.stringify({ idx: a.dataset && a.dataset.__kb != null ? +a.dataset.__kb : -1,
      tag: a.tagName.toLowerCase(),
      onscreen: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight,
      x: Math.round(r.x), y: Math.round(r.y),
      text: (a.textContent || a.value || a.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 34) });
  })()`;

  const order = [];
  const seen = new Set();
  let cycled = false;
  for (let i = 0; i < MAX; i++) {
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
        ...(type === 'char' ? { text: '\t' } : {}),
      }).catch(() => {});
    }
    const a = JSON.parse(await cdp.eval(ACTIVE, { awaitPromise: false }));
    if (!a) { if (order.length) { cycled = true; break; } continue; }
    const key = a.idx >= 0 ? 'i' + a.idx : a.tag + ':' + a.x + ',' + a.y;
    if (seen.has(key)) { cycled = true; break; }
    seen.add(key); order.push(a);
  }

  const reached = new Set(order.filter(o => o.idx >= 0).map(o => o.idx));
  // tabindex="-1" is not an exemption. A visible button carrying it is clickable
  // and untabbable, which is the defect, not a declaration that it is fine.
  const wanted = items.filter(it => it.visible && !it.disabled);
  const missed = wanted.filter(it => !reached.has(it.i));
  const offscreen = order.filter(o => !o.onscreen);

  // Reading order, roughly: rows top to bottom, then left to right within a row.
  const back = [];
  for (let i = 1; i < order.length; i++) {
    const p = order[i - 1], c = order[i];
    if (c.y < p.y - 24) back.push([p, c]);
  }

  if (asJson) {
    console.log(JSON.stringify({ order, missed, offscreen, back, cycled }, null, 2));
  } else {
    console.log(`\nkeyboard — ${target}\n`);
    console.log(`  Tab reaches ${order.length} stop(s)${cycled ? ' before the order repeats' : ` (stopped at --max ${MAX})`}.`);
    console.log(`  ${reached.size} of ${wanted.length} visible, enabled controls are on that path.`);

    if (missed.length) {
      console.log(`\n  clickable, but Tab never gets there:`);
      for (const m of missed.slice(0, 12)) {
        const why = m.tabindex != null ? ` — tabindex="${m.tabindex}"`
                  : m.painted ? ' — painted like a control, but is not one'
                  : ' — focusable, but Tab does not arrive';
        console.log(`    ${m.el.padEnd(20)} ${m.text ? '“' + m.text + '”' : ''}${why}`);
      }
      if (missed.length > 12) console.log(`    ... and ${missed.length - 12} more`);
      console.log(`\n  A <div onclick> is not a control. Give it a <button>, or a role and a tabindex.`);
    }
    if (offscreen.length) {
      console.log(`\n  Tab stops on something that is not on screen:`);
      for (const o of offscreen.slice(0, 6)) console.log(`    ${o.tag} at ${o.x},${o.y}   ${o.text ? '“' + o.text + '”' : ''}`);
    }
    if (back.length) {
      console.log(`\n  focus jumps back up the page ${back.length} time(s) — the tab order does not follow the layout:`);
      for (const [p, c] of back.slice(0, 5)) console.log(`    ${p.text || p.tag} (y ${p.y})  ->  ${c.text || c.tag} (y ${c.y})`);
    }
    if (!missed.length && !offscreen.length && !back.length)
      console.log(`\n  Every visible control is on the Tab path, in the order the page reads.`);
  }
  process.exit(missed.length || offscreen.length ? 1 : 0);
} finally {
  chrome.kill(); server?.close();
}
