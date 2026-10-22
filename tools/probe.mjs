/**
 * Quick balance probe: how many players survive each round with idle players?
 * Used while tuning layout generation. Run: node tools/probe.mjs
 */
import { generateLayout, makeRng, safeGroups, resolveRound } from '../shared/sim.js';
import { GRID, CAPACITY } from '../shared/constants.js';

function sim(seed, alive0, rounds = 8) {
  const rng = makeRng(seed);
  let prev = null;
  const out = [];
  let alive = alive0;
  // round 1: whole arena safe
  out.push({ round: 1, alive });
  for (let r = 2; r <= rounds && alive > 1; r++) {
    const safe = generateLayout(alive, rng, prev);
    prev = safe;
    const zones = safeGroups(safe);
    const capacity = zones.length * CAPACITY;
    // worst case: everyone spreads evenly / everyone piles into the biggest zone
    const biggest = Math.max(...zones.map((z) => z.length));
    const bestCase = Math.min(alive, capacity);
    const guaranteed = Math.min(alive, biggest * CAPACITY);
    alive = Math.max(1, Math.min(alive, capacity));
    out.push({ round: r, alive, zones: zones.length, capacity, guaranteed, tiles: safe.reduce((a, b) => a + b, 0) });
  }
  return out;
}

let totals = [];
for (let seed = 1; seed <= 30; seed++) {
  const trace = sim(seed * 977, 8, 10);
  const last = trace[trace.length - 1];
  totals.push(trace.length);
  if (seed <= 5) console.log(`seed ${seed * 977}:`, trace.map((t) => `${t.round}:${t.alive}${t.zones ? '/' + t.zones + 'z' : ''}`).join(' '));
}
console.log('avg rounds to finish 8 players:', (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1));

// distribution of zone sizes with 7 players (6 zones)
const hist = {};
for (let seed = 1; seed <= 200; seed++) {
  const safe = generateLayout(7, makeRng(seed));
  const g = safeGroups(safe);
  const key = g.map((z) => z.length).sort((a, b) => b - a).join(',');
  hist[key] = (hist[key] || 0) + 1;
}
console.log('zone size combos (7 players):', Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8));
