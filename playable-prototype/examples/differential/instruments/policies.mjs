// Is there headroom above the obvious policy? Each policy sees every waiting
// patient and returns which one to work and what to do — or nothing, and waits
// for a result to come back. If they all score the same, the decisions on
// screen are decoration.
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
  const TX = ['tx_cardiac','tx_sepsis','tx_bleed','tx_neuro','tx_metabolic'];
  const decide = ${decide};
  const runs = [];
  for (let r = 0; r < 12; r++) {
    g.seed(2024 + r * 7919); g.reset(); g.start();
    for (let t = 0; t < 1800; t++) {
      const st = g.state();
      if (st.status !== 'playing') break;
      if (st.busy === 0 && st.queue) {
        const seen = [];
        for (let k = 0; k < st.queue; k++) { seen.push(g.state()); g.input('next', true); }
        const c = decide(seen.filter(x => !x.inCT));
        if (c) {
          while (g.state().focus !== c.p.focus) g.input('next', true);
          const now = g.state();
          g.input(c.a === 'treat' ? TX[now.lead] : c.a, true);
        }
      }
      g.step(1);
    }
    const f = g.state();
    runs.push([f.score, f.out, f.harm, f.deaths, f.tick]);
  }
  return JSON.stringify(runs);
})()`;

const sickest = `l => l.length ? l.reduce((a, b) => b.curSev > a.curSev ? b : a) : null`;
const POLICIES = [
  ['always gamble',
   `l => { const p = (${sickest})(l); return p && { p, a: 'treat' }; }`],

  ['work up, then commit',
   `l => { const ready = l.filter(x => x.awaiting === 0);
           const p = (${sickest})(ready);
           if (!p) return null;                       // everyone is waiting on a result
           if (p.ordered >= 2 || p.conf >= 78) return { p, a: 'treat' };
           return { p, a: p.ordered === 0 ? 'bloods' : 'ecg' }; }`],

  ['order everything first',
   `l => { const un = l.filter(x => x.ordered < 2);
           if (un.length) { const p = (${sickest})(un);
                            return { p, a: p.ordered === 0 ? 'bloods' : 'ecg' }; }
           const ready = l.filter(x => x.awaiting === 0);
           const p = (${sickest})(ready);
           return p && { p, a: 'treat' }; }`],

  ['call the crashing, investigate the rest',
   `l => { const crash = l.filter(x => x.curSev > 78);
           if (crash.length) return { p: (${sickest})(crash), a: 'treat' };
           const un = l.filter(x => x.ordered < 2);
           if (un.length) { const p = (${sickest})(un);
                            return { p, a: p.ordered === 0 ? 'bloods' : 'ecg' }; }
           const ready = l.filter(x => x.awaiting === 0 && x.conf >= 70);
           const p = (${sickest})(ready);
           return p && { p, a: 'treat' }; }`],

  ['same, but scan when the ward is quiet',
   `l => { const crash = l.filter(x => x.curSev > 78);
           if (crash.length) return { p: (${sickest})(crash), a: 'treat' };
           const un = l.filter(x => x.ordered < 2);
           if (un.length) { const p = (${sickest})(un);
                            return { p, a: p.ordered === 0 ? 'bloods' : 'ecg' }; }
           if (l.length <= 3) { const amb = l.filter(x => x.conf < 70 && x.awaiting === 0);
                                if (amb.length) return { p: (${sickest})(amb), a: 'ct' }; }
           const ready = l.filter(x => x.awaiting === 0 && x.conf >= 70);
           const p = (${sickest})(ready);
           return p && { p, a: 'treat' }; }`],
];
console.log('  policy                                    got out clean   sent up  harmed  died   dawn');
for (const [label, decide] of POLICIES) {
  const runs = JSON.parse(await cdp.eval(RUN(decide), { awaitPromise: false }));
  const med = j => runs.map(r => r[j]).sort((a, b) => a - b)[runs.length >> 1];
  const lo = Math.min(...runs.map(r => r[0])), hi = Math.max(...runs.map(r => r[0]));
  console.log(`  ${label.padEnd(40)} ${String(med(0)).padStart(6)} (${String(lo).padStart(2)}–${hi}) ${String(med(1)).padStart(7)} ${String(med(2)).padStart(7)} ${String(med(3)).padStart(5)}   ${runs.filter(r => r[4] >= 1800).length}/12`);
}
chrome.kill(); server.close(); process.exit(0);
