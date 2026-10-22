import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { safeGroups, worldToTile, tileCenter } from '../shared/sim.js';
import { TICK_MS, TILE } from '../shared/constants.js';

for (let seed = 1; seed <= 4; seed++) {
  const g = new Game({ seed, difficulty: 'intermediate' });
  g.addPlayer({ id: 'me', name: 'me', isBot: false });
  spawnBots(g, 5, 'intermediate');
  for (const p of g.players.values()) if (p.isBot) new BotBrain(p, 'intermediate', seed * 31);
  g.start(0);

  let lastRound = 0;
  const track = new Map();
  for (let i = 0; i < 60000; i++) {
    g.tick(TICK_MS);
    if (g.phase !== PHASE.PLAY) { if (g.phase === PHASE.RESULT) break; continue; }
    if (g.round !== lastRound) {
      lastRound = g.round;
      track.clear();
      const groups = safeGroups(g.safe);
      console.log(`\nseed ${seed} round ${g.round}: alive=${g.aliveCount()} zones=${groups.length}`);
      for (const [id, p] of g.players) {
        if (!p.alive) continue;
        const t = worldToTile(p.x, p.z);
        // distance from this player to its nearest zone tile
        const centers = groups.map((gr) => gr[0]);
        let best = Infinity;
        for (const c of centers) {
          const cc = tileCenter(c % 12, (c / 12) | 0);
          best = Math.min(best, Math.hypot(cc.x - p.x, cc.z - p.z));
        }
        track.set(id, { start: best, best });
      }
    }
    for (const [id, p] of g.players) {
      const tr = track.get(id);
      if (!tr || !p.alive) continue;
      const groups = safeGroups(g.safe);
      let d = Infinity;
      for (const gr of groups) {
        const cc = tileCenter(gr[0] % 12, (gr[0] / 12) | 0);
        d = Math.min(d, Math.hypot(cc.x - p.x, cc.z - p.z));
      }
      tr.best = Math.min(tr.best, d);
    }
    if (g.round === lastRound && g.roundEndsAt - g.now < 50) {
      for (const [id, tr] of track) {
        const p = g.players.get(id);
        const st = (tr.best / TILE).toFixed(1);
        console.log(`   ${id.padEnd(12)} startDist=${(tr.start / TILE).toFixed(1)}t best=${st}t ${p.alive ? 'SURVIVED' : 'died'}`);
      }
    }
  }
}
