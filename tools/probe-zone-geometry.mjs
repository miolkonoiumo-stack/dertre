import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { safeGroups, tileCenter, worldToTile } from '../shared/sim.js';
import { TICK_MS, TILE, GRID } from '../shared/constants.js';

const g = new Game({ seed: 5 });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
const brains = new Map();
for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', 55));
g.start(0);

let round = 0;
for (let i = 0; i < 4000; i++) {
  g.tick(TICK_MS);
  if (g.phase === PHASE.PLAY || g.phase === 'swap') {
    const view = {
      now: g.now, phase: g.phase, round: g.round, roundEndsAt: g.roundEndsAt,
      safe: g.pending || g.safe, current: g.safe, pending: g.pending,
      changing: !!g.pending,
      players: [...g.players.values()].filter((p) => p.connected),
    };
    for (const [id, brain] of brains) { const p = g.players.get(id); if (p) brain.think(view); }
  }
  if (g.phase !== PHASE.PLAY) continue;
  if (g.round !== round) {
    round = g.round;
    const groups = safeGroups(g.safe).map((gr) => {
      const c = gr[0];
      return { x: c % GRID, z: (c / GRID) | 0, w: tileCenter(c % GRID, (c / GRID) | 0) };
    });
    console.log(`\n--- round ${round}: alive=${g.aliveCount()} zones=${groups.length} ---`);
    console.log('zones: ' + groups.map((z) => `(${z.x},${z.z})`).join(' '));
    for (const p of g.players.values()) {
      if (!p.alive) continue;
      const t = worldToTile(p.x, p.z);
      let bestD = Infinity, bz = null;
      for (const z of groups) {
        const d = Math.hypot(z.w.x - p.x, z.w.z - p.z);
        if (d < bestD) { bestD = d; bz = z; }
      }
      console.log(`  ${String(p.id).slice(0, 8).padEnd(9)} tile=(${t?.x},${t?.z}) nearestZone=(${bz.x},${bz.z}) dist=${(bestD / TILE).toFixed(1)}t`);
    }
  }
  if (round >= 1 && g.roundEndsAt - g.now < TICK_MS * 2) {
    const alive = [...g.players.values()].filter((p) => p.alive);
    console.log(`  END round ${round}: alive=${alive.length} dead=${6 - alive.length}`);
    for (const p of g.players.values()) {
      const t = worldToTile(p.x, p.z);
      console.log(`    ${String(p.id).slice(0, 8).padEnd(9)} end tile=(${t?.x},${t?.z}) ${p.alive ? 'ALIVE' : 'DEAD'}`);
    }
    break;
  }
}
