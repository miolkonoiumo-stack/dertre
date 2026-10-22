import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { safeGroups, worldToTile } from '../shared/sim.js';
import { TICK_MS } from '../shared/constants.js';

for (let seed = 1; seed <= 6; seed++) {
  const g = new Game({ seed, difficulty: 'intermediate' });
  g.addPlayer({ id: 'me', name: 'me', isBot: false });
  spawnBots(g, 5, 'intermediate');
  for (const p of g.players.values()) if (p.isBot) new BotBrain(p, 'intermediate', seed * 31);
  g.start(0);

  let prevAlive = g.aliveCount();
  let lastRound = 0;
  for (let i = 0; i < 60000; i++) {
    const before = [...g.players.values()].map((p) => ({ id: p.id, alive: p.alive, x: p.x, z: p.z }));
    g.tick(TICK_MS);
    if (g.phase === PHASE.PLAY && g.round !== lastRound) {
      lastRound = g.round;
      const alive = g.aliveCount();
      if (prevAlive - alive > 1) {
        console.log(`seed ${seed} round ${g.round}: ${prevAlive} -> ${alive}`);
        const dead = before.filter((b) => !g.players.get(b.id).alive);
        for (const d of dead) {
          const t = worldToTile(d.x, d.z);
          const onSafe = t ? g.safe[t.z * 12 + t.x] === 1 : false;
          console.log(`   ${d.id} at tile (${t?.x},${t?.z}) onSafe=${onSafe} fellOff=${g.players.get(d.id).fellOff}`);
        }
      }
      prevAlive = alive;
    }
    if (g.phase === PHASE.RESULT) break;
  }
}
