// What does each purchase actually buy? Confidence in the leading diagnosis
// after exactly k tests, and whether the lead is the true condition.
import { serve, launchChrome, CDP, goto } from '../../../scripts/lib.mjs';
import { dirname, basename } from 'node:path';
const file = process.argv[2];
const server = await serve(dirname(file));
const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
await goto(cdp, `http://127.0.0.1:${server.port}/${basename(file)}`);
await new Promise(r => setTimeout(r, 400));

const SCRIPT = plan => `(() => {
  const g = window.__game, out = [];
  for (let run = 0; run < 60; run++) {
    g.seed(4000 + run * 977); g.reset(); g.start();
    for (const a of ${JSON.stringify(plan)}) {
      g.input(a, true);
      for (let t = 0; t < 80; t++) g.step(1);
    }
    const st = g.state();
    if (st.status !== 'playing' || !st.queue) continue;
    const before = st.score;
    g.input('tx_' + ['cardiac','sepsis','bleed','neuro','metabolic'][st.lead], true);
    for (let t = 0; t < 30; t++) g.step(1);
    out.push([st.conf, g.state().score > before ? 1 : 0]);
  }
  return JSON.stringify(out);
})()`;

const plans = [
  ['nothing at all', []],
  ['examine', ['examine']],
  ['ECG', ['ecg']],
  ['bloods', ['bloods']],
  ['CT', ['ct']],
  ['bloods + ECG', ['bloods', 'ecg']],
  ['bloods + ECG + CT', ['bloods', 'ecg', 'ct']],
];
console.log('  workup                n    median conf   right');
for (const [label, plan] of plans) {
  const rows = JSON.parse(await cdp.eval(SCRIPT(plan), { awaitPromise: false }));
  const cs = rows.map(r => r[0]).sort((a, b) => a - b);
  const med = cs[cs.length >> 1];
  const right = rows.reduce((s, r) => s + r[1], 0) / rows.length;
  const bar = '█'.repeat(Math.round(med / 100 * 20)).padEnd(20, '·');
  console.log(`  ${label.padEnd(20)} ${String(rows.length).padStart(3)}   ${bar} ${String(med).padStart(3)}%   ${(right * 100).toFixed(0)}%`);
}
chrome.kill(); server.close(); process.exit(0);
