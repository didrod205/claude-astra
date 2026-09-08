// ROUNDS calls itself a routing puzzle: one gap joins the two corridors, and a
// step costs a turn. Several ways to route, over the same nights. If a policy
// that never crosses the gap does as well as one that plans, there is no puzzle.
import { serve, launchChrome, CDP, goto } from '../../../scripts/lib.mjs';
import { dirname, basename } from 'node:path';
const file = process.argv[2];
const server = await serve(dirname(file));
const chrome = await launchChrome();
const cdp = await CDP.page(chrome.port);
await goto(cdp, `http://127.0.0.1:${server.port}/${basename(file)}`);
await new Promise(r => setTimeout(r, 400));

const RUN = pick => `(() => {
  const g = window.__game;
  const pick = ${pick};
  const runs = [];
  for (let r = 0; r < 12; r++) {
    g.seed(2024 + r * 7919); g.reset(); g.start();
    const M = g.state().map, ROWS = M.length, COLS = M[0].length;
    const walk = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && M[y][x] === '.';
    // BFS from the player: distance to every walkable cell, and the first step
    const routes = (px, py) => {
      const dist = {}, first = {};
      const q = [[px, py]]; dist[px + ',' + py] = 0;
      for (let h = 0; h < q.length; h++) {
        const [x, y] = q[h], d = dist[x + ',' + y];
        for (const [dx, dy, a] of [[0,-1,'up'],[0,1,'down'],[-1,0,'left'],[1,0,'right']]) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (!walk(nx, ny) || k in dist) continue;
          dist[k] = d + 1; first[k] = d === 0 ? a : first[x + ',' + y];
          q.push([nx, ny]);
        }
      }
      return { dist, first };
    };
    let held = null, steps = 0, treats = 0, pace = false;
    const paceDir = st => (walk(st.px + 1, st.py) && !pace) ? 'right'
                        : walk(st.px - 1, st.py) ? 'left' : 'right';
    const hold = a => { if (held) g.input(held, false); held = a; if (a) g.input(a, true); };
    let guard = 0;
    for (let t = 0; t < 2400; t++) {
      const st = g.state();
      if (st.status !== 'playing') break;
      const live = st.beds.filter(b => b.need);
      // Holding nothing does not pass a turn, so an idle ward freezes the clock
      // and no need ever arrives again. Pace the corridor instead, the way a
      // nurse with nothing to do would — otherwise the instrument deadlocks and
      // reports a 34-turn shift as if the game had ended.
      if (!live.length) { hold(paceDir(st)); pace = !pace;
        const b0 = g.state().tick;
        for (let k = 0; k < 24 && g.state().tick === b0 && g.state().status === 'playing'; k++) g.step(1);
        continue; }
      const { dist, first } = routes(st.px, st.py);
      // a bed is reachable from any walkable cell orthogonally adjacent to it
      const reach = b => {
        let best = Infinity, step = null;
        for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const k = (b.x + dx) + ',' + (b.y + dy);
          if (k in dist && dist[k] < best) { best = dist[k]; step = first[k] || null; }
        }
        return { d: best, step };
      };
      const cand = live.map(b => ({ b, ...reach(b) })).filter(c => c.d < Infinity);
      if (!cand.length) { hold(null); g.step(1); continue; }
      const want = pick(cand, st);
      if (!want) { hold(paceDir(st)); pace = !pace;
        const b1 = g.state().tick;
        for (let k = 0; k < 24 && g.state().tick === b1 && g.state().status === 'playing'; k++) g.step(1);
        continue; }
      if (want.d === 0) { hold('treat'); treats++; } else { hold(want.step); steps++; }
      const before = g.state().tick;
      for (let k = 0; k < 24 && g.state().tick === before && g.state().status === 'playing'; k++) g.step(1);
      if (g.state().tick === before && ++guard > 40) break;
    }
    const f = g.state();
    runs.push([f.score, 4 - f.lives, f.tick, steps, treats, f.missed]);
  }
  return JSON.stringify(runs);
})()`;

const POLICIES = [
  ['nearest need',        `(c) => c.reduce((a, b) => b.d < a.d ? b : a)`],
  ['soonest to expire',   `(c) => c.reduce((a, b) => b.b.t < a.b.t ? b : a)`],
  ['top corridor only',   `(c) => { const q = c.filter(x => x.b.y <= 3);
                                    return q.length ? q.reduce((a, b) => b.d < a.d ? b : a) : null; }`],
  ['cheapest to finish',  `(c) => c.reduce((a, b) => (b.d + b.b.workLeft) < (a.d + a.b.workLeft) ? b : a)`],
  ['savable, then near',  `(c) => { const ok = c.filter(x => x.d + x.b.workLeft <= x.b.t);
                                    const q = ok.length ? ok : c;
                                    return q.reduce((a, b) => b.d < a.d ? b : a); }`],
  ['the ones you cannot leave', `(c) => { const ok = c.filter(x => x.d + x.b.workLeft <= x.b.t);
                                          const q = ok.length ? ok : c;
                                          const h = q.filter(x => x.b.hurts);
                                          const pick = h.length ? h : q;
                                          return pick.reduce((a, b) => b.d < a.d ? b : a); }`],
];
console.log('  policy                        settled    harmed  lapsed   steps   dawn');
for (const [label, pick] of POLICIES) {
  const runs = JSON.parse(await cdp.eval(RUN(pick), { awaitPromise: false }));
  const med = j => runs.map(r => r[j]).sort((a, b) => a - b)[runs.length >> 1];
  const lo = Math.min(...runs.map(r => r[0])), hi = Math.max(...runs.map(r => r[0]));
  console.log(`  ${label.padEnd(27)} ${String(med(0)).padStart(4)} (${String(lo).padStart(2)}–${hi}) ${String(med(1)).padStart(6)}  ${String(med(5)).padStart(6)}  ${String(med(3)).padStart(6)}   ${runs.filter(r => r[2] >= 200).length}/12`);
}
chrome.kill(); server.close(); process.exit(0);
