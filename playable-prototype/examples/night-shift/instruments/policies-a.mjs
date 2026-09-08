// CALL BELL claims bells ring faster than you can walk, so which one you
// abandon matters. Several plainly different ways to choose, over the same
// nights. If they all score alike, the corridor is decoration.
import { serve, launchChrome, CDP, goto } from '../../../scripts/lib.mjs';
import { dirname, basename } from 'node:path';
const file = process.argv[2];
const server = await serve(dirname(file));
const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
await goto(cdp, `http://127.0.0.1:${server.port}/${basename(file)}`);
await new Promise(r => setTimeout(r, 400));

const RUN = choose => `(() => {
  const g = window.__game;
  const choose = ${choose};
  const runs = [];
  for (let r = 0; r < 12; r++) {
    g.seed(2024 + r * 7919); g.reset(); g.start();
    let held = null, walking = 0, attending = 0, idle = 0;
    const hold = a => { if (held) g.input(held, false); held = a; if (a) g.input(a, true); };
    for (let t = 0; t < 1000; t++) {
      const st = g.state();
      if (st.status !== 'playing') break;
      const live = st.rooms.filter(x => x.need);
      if (!live.length) { hold(null); idle++; }
      else {
        const want = choose(live, st);
        if (want.inReach) { hold('attend'); attending++; }
        else { hold(want.x > st.x ? 'right' : 'left'); walking++; }
      }
      g.step(1);
    }
    const f = g.state();
    runs.push([f.score, 4 - f.lives, f.tick, walking, attending, idle, f.unanswered]);
  }
  return JSON.stringify(runs);
})()`;

// travel and work, both in ticks: the nurse walks 4 a tick and works 4 a tick
const cost = `((x, st) => Math.abs(x.x - st.x) / 4 + x.toGo / 4)`;
const POLICIES = [
  ['nearest door',          `(l, st) => l.reduce((a, b) => Math.abs(b.x - st.x) < Math.abs(a.x - st.x) ? b : a)`],
  ['soonest to go',         `(l) => l.reduce((a, b) => b.left < a.left ? b : a)`],
  ['finish what you began', `(l, st) => { const started = l.filter(x => x.work > 0);
                                          const q = started.length ? started : l;
                                          return q.reduce((a, b) => Math.abs(b.x - st.x) < Math.abs(a.x - st.x) ? b : a); }`],
  ['cheapest job',          `(l, st) => l.reduce((a, b) => ${cost}(b, st) < ${cost}(a, st) ? b : a)`],
  ['triage: drop the lost', `(l, st) => { const savable = l.filter(x => ${cost}(x, st) <= x.left);
                                          const q = savable.length ? savable : l;
                                          return q.reduce((a, b) => ${cost}(b, st) < ${cost}(a, st) ? b : a); }`],
  ['falls first, then near', `(l, st) => { const savable = l.filter(x => ${cost}(x, st) <= x.left);
                                          const q = savable.length ? savable : l;
                                          const h = q.filter(x => x.hurts);
                                          const pick = h.length ? h : q;
                                          return pick.reduce((a, b) => ${cost}(b, st) < ${cost}(a, st) ? b : a); }`],
];
console.log('  policy                      answered   falls  gave up   walking  attending  idle   dawn');
for (const [label, choose] of POLICIES) {
  const runs = JSON.parse(await cdp.eval(RUN(choose), { awaitPromise: false }));
  const med = j => runs.map(r => r[j]).sort((a, b) => a - b)[runs.length >> 1];
  const lo = Math.min(...runs.map(r => r[0])), hi = Math.max(...runs.map(r => r[0]));
  const tot = med(3) + med(4) + med(5);
  const pc = j => `${(med(j) / tot * 100).toFixed(0)}%`;
  console.log(`  ${label.padEnd(25)} ${String(med(0)).padStart(4)} (${String(lo).padStart(2)}–${hi}) ${String(med(1)).padStart(5)} ${String(med(6)).padStart(7)}   ${pc(3).padStart(7)} ${pc(4).padStart(9)} ${pc(5).padStart(6)}   ${runs.filter(r => r[2] >= 1000).length}/12`);
}
chrome.kill(); server.close(); process.exit(0);
