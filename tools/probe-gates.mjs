import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { isOnPlate, isSafeAt, worldToTile, idx } from '../shared/sim.js';
import { TICK_MS, TILE_TOP, GRID } from '../shared/constants.js';

const g = new Game({ seed: 11 });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
const brains = new Map();
for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', 111));
g.start(0);

let round = 0, reported = false;
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
  if (g.round !== round) { round = g.round; reported = false; }
  // One tick before resolution: check every gate that resolveRound uses.
  if (!reported && g.roundEndsAt - g.now <= TICK_MS + 1) {
    reported = true;
    console.log(`\nround ${round} just before resolution (left=${Math.round(g.roundEndsAt - g.now)}ms):`);
    for (const p of g.players.values()) {
      if (!p.alive) continue;
      const t = worldToTile(p.x, p.z);
      const grounded = p.y <= TILE_TOP + 0.9;
      const plate = isOnPlate(p.x, p.z);
      const safeHere = isSafeAt(g.safe, p.x, p.z);
      const tileIdx = t ? g.safe[idx(t.x, t.z)] === 1 : false;
      console.log(`  ${String(p.id).slice(0, 6).padEnd(7)} y=${p.y.toFixed(2)} grounded=${grounded} onPlate=${plate} safeAt=${safeHere} tile=( ${t?.x},${t?.z}) tileSafe=${tileIdx} | pos=(${p.x.toFixed(2)},${p.z.toFixed(2)})`);
    }
    break;
  }
}
