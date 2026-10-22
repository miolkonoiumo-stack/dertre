import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { safeGroups, tileCenter } from '../shared/sim.js';
import { TICK_MS, TILE, GRID } from '../shared/constants.js';

function nearestZoneDist(p, groups) {
  let best = Infinity;
  for (const gr of groups) {
    const c = gr[0];
    const cc = tileCenter(c % GRID, (c / GRID) | 0);
    best = Math.min(best, Math.hypot(cc.x - p.x, cc.z - p.z));
  }
  return best;
}

let totalDied = 0, totalRounds = 0;
for (let seed = 1; seed <= 4; seed++) {
  const g = new Game({ seed, difficulty: 'intermediate' });
  g.addPlayer({ id: 'me', name: 'me', isBot: false });
  spawnBots(g, 5, 'intermediate');
  for (const p of g.players.values()) if (p.isBot) new BotBrain(p, 'intermediate', seed * 31);
  g.start(0);

  let round = 0, best = new Map(), startDist = new Map();
  for (let i = 0; i < 60000; i++) {
    g.tick(TICK_MS);
    if (g.phase === PHASE.RESULT) break;
    if (g.phase !== PHASE.PLAY) continue;
    if (g.round !== round) {
      round = g.round;
      const groups = safeGroups(g.safe);
      best.clear(); startDist.clear();
      for (const [id, p] of g.players) {
        if (!p.alive) continue;
        const d = nearestZoneDist(p, groups) / TILE;
        startDist.set(id, d); best.set(id, d);
      }
    }
    const groups = safeGroups(g.safe);
    for (const [id, p] of g.players) {
      if (!p.alive || !best.has(id)) continue;
      best.set(id, Math.min(best.get(id), nearestZoneDist(p, groups) / TILE));
    }
    // Last tick of the round: report.
    if (g.roundEndsAt - g.now <= TICK_MS) {
      totalRounds++;
      const out = [];
      for (const [pid, d] of startDist) {
        const p = g.players.get(pid);
        out.push(`${String(pid).slice(0, 9)}:start=${d.toFixed(1)}t,best=${best.get(pid).toFixed(1)}t,${p.alive ? 'ALIVE' : 'DEAD'}`);
        if (!p.alive) totalDied++;
      }
      console.log(`seed ${seed} r${g.round} alive=${g.aliveCount()} | ${out.join('  ')}`);
    }
  }
}
console.log('---');
console.log(`rounds=${totalRounds} deaths=${totalDied}`);
