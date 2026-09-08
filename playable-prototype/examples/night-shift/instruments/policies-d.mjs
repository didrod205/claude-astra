// CHARGE NURSE says every command is a bet placed a minute before it pays off,
// and that nothing kills you — the shift just gets worse. Both claims are
// testable. If never moving anyone scores what chasing the queue does, the
// minute of travel is not a bet. If diverting ambulances costs nothing, the
// shift does not in fact get worse.
import { serve, launchChrome, CDP, goto } from '../../../scripts/lib.mjs';
import { dirname, basename } from 'node:path';
const file = process.argv[2];
const server = await serve(dirname(file));
const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
await goto(cdp, `http://127.0.0.1:${server.port}/${basename(file)}`);
await new Promise(r => setTimeout(r, 400));

const RUN = decide => `(() => {
  const g = window.__game;
  const decide = ${decide};
  const runs = [];
  for (let r = 0; r < 12; r++) {
    g.seed(2024 + r * 7919); g.reset(); g.start();
    let moves = 0, breaks = 0;
    for (let t = 0; t < 900; t++) {
      const st = g.state();
      if (st.status !== 'playing') break;
      if (t % 12 === 0) {                       // a charge nurse gives an order now and then
        const a = decide(st);
        if (a) { g.input(a, true); if (a === 'pool') breaks++; else moves++; }
      }
      g.step(1);
    }
    const f = g.state();
    runs.push([f.score, f.diverted, moves, breaks, Math.round(f.nurses.reduce((s, n) => s + n.stam, 0) / 3)]);
  }
  return JSON.stringify(runs);
})()`;

const POLICIES = [
  ['never move anyone',    `() => null`],
  ['cover the biggest',    `(st) => { const w = st.wards.reduce((a, b) => b.tasks > a.tasks ? b : a);
                                      const on = st.nurses.filter(n => n.ward === w.i).length;
                                      return on >= 2 ? null : 'w' + (w.i + 1); }`],
  ['keep A&E covered',     `(st) => { const on = st.nurses.filter(n => n.ward === 0).length;
                                      return on >= 2 ? null : 'w1'; }`],
  ['stop the diversions',  `(st) => { const w = st.wards.reduce((a, b) => (b.divertAt - b.tasks) < (a.divertAt - a.tasks) ? b : a);
                                      if (w.tasks < w.divertAt - 4) return null;
                                      const on = st.nurses.filter(n => n.ward === w.i).length;
                                      return on >= 2 ? null : 'w' + (w.i + 1); }`],
  ['bet on the swell',     `(st) => { const tired = st.nurses.find(n => n.ward >= 0 && n.stam < 30);
                                      if (tired) return 'pool';
                                      // where the work will be in a minute, not where it is
                                      const w = st.wards.reduce((a, b) =>
                                        (b.tasks + b.rate * (b.rising ? 2.5 : 0.6)) >
                                        (a.tasks + a.rate * (a.rising ? 2.5 : 0.6)) ? b : a);
                                      const on = st.nurses.filter(n => n.ward === w.i).length;
                                      return on >= 2 ? null : 'w' + (w.i + 1); }`],
  ['biggest, and rest them', `(st) => { const tired = st.nurses.find(n => n.ward >= 0 && n.stam < 30);
                                        if (tired) return 'pool';
                                        const w = st.wards.reduce((a, b) => b.tasks > a.tasks ? b : a);
                                        const on = st.nurses.filter(n => n.ward === w.i).length;
                                        return on >= 2 ? null : 'w' + (w.i + 1); }`],
];
console.log('  policy                      seen    diverted   orders  breaks   stamina at dawn');
for (const [label, decide] of POLICIES) {
  const runs = JSON.parse(await cdp.eval(RUN(decide), { awaitPromise: false }));
  const med = j => runs.map(r => r[j]).sort((a, b) => a - b)[runs.length >> 1];
  const lo = Math.min(...runs.map(r => r[0])), hi = Math.max(...runs.map(r => r[0]));
  console.log(`  ${label.padEnd(24)} ${String(med(0)).padStart(4)} (${String(lo).padStart(3)}–${hi})  ${String(med(1)).padStart(6)}   ${String(med(2)).padStart(6)}  ${String(med(3)).padStart(6)}   ${String(med(4)).padStart(9)}`);
}
chrome.kill(); server.close(); process.exit(0);
