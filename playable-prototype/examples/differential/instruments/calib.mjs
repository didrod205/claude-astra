// Is the number on the screen true? Play many patients through random workups,
// commit to whatever the panel leads with, and bucket the outcome by the
// confidence it claimed. Uses only the public __game contract.
//
// What is observable from outside is whether the patient SETTLED, and a correct
// treatment settles them 4 times in 5. So an honest panel claiming p should
// settle 0.8p of the time, and that — not p — is the line to compare against.
import { serve, launchChrome, CDP, goto } from '../../../scripts/lib.mjs';
import { dirname, basename } from 'node:path';
const file = process.argv[2];
const server = await serve(dirname(file));
const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
await goto(cdp, `http://127.0.0.1:${server.port}/${basename(file)}`);
await new Promise(r => setTimeout(r, 400));

const SCRIPT = `(() => {
  const g = window.__game;
  const TESTS = ['examine','ecg','bloods','ct'];
  const TX = ['tx_cardiac','tx_sepsis','tx_bleed','tx_neuro','tx_metabolic'];
  const buckets = {};                       // conf bucket -> [right, total]
  let rs = 12345;
  const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) | 0; return (rs >>> 0) / 4294967296; };
  for (let run = 0; run < 40; run++) {
    g.seed(9000 + run * 331); g.reset(); g.start();
    for (let round = 0; round < 26; round++) {
      const st0 = g.state();
      if (st0.status !== 'playing') break;
      const nTests = Math.floor(rnd() * 4);              // 0-3 tests, at random
      for (let k = 0; k < nTests; k++) {
        g.input(TESTS[Math.floor(rnd() * TESTS.length)], true);
        for (let t = 0; t < 70; t++) g.step(1);          // let it finish
      }
      const st = g.state();
      if (st.status !== 'playing' || st.lead < 0 || !st.queue) break;
      const conf = st.conf, before = st.score;
      g.input(TX[st.lead], true);
      for (let t = 0; t < 30; t++) g.step(1);
      const right = g.state().score > before;
      const b = Math.min(9, Math.floor(conf / 10));
      (buckets[b] = buckets[b] || [0, 0]);
      buckets[b][0] += right ? 1 : 0; buckets[b][1]++;
      g.input('next', true);
    }
  }
  return JSON.stringify(buckets);
})()`;
const out = JSON.parse(await cdp.eval(SCRIPT, { awaitPromise: false }));
const WORKS = 0.8;   // a correct treatment settles the patient this often
console.log('  panel says     n    if honest    actually settled');
let sn = 0, sr = 0, sc = 0;
for (const b of Object.keys(out).sort((a, z) => a - z)) {
  const [r, n] = out[b];
  const lo = b * 10, hi = +b * 10 + 9;
  sn += n; sr += r; sc += n * (lo + 5);
  const exp = (lo + 5) / 100 * WORKS;
  const bar = '█'.repeat(Math.round(r / n * 22)).padEnd(22, '·');
  console.log(`  ${String(lo).padStart(4)}–${hi}%  ${String(n).padStart(4)}     ${(exp * 100).toFixed(0).padStart(3)}%      ${bar} ${(r / n * 100).toFixed(0).padStart(3)}%`);
}
console.log(`\n  overall: the panel claimed ${(sc / sn).toFixed(0)}% across ${sn} commitments.`);
console.log(`  if it is honest that is ${(sc / sn * WORKS).toFixed(0)}% settling; ${(sr / sn * 100).toFixed(0)}% settled.`);
chrome.kill(); server.close(); process.exit(0);
