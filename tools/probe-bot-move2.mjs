// Drive the bots exactly like local-session does, and watch whether they MOVE.
import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { TICK_MS } from '../shared/constants.js';

const g = new Game({ seed: 1 });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
const brains = new Map();
for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', 31));
g.start(0);

let logged = 0;
for (let i = 0; i < 900; i++) {
  g.tick(TICK_MS);
  if (g.phase === PHASE.PLAY || g.phase === 'swap') {
    const view = {
      now: g.now, phase: g.phase, roundEndsAt: g.roundEndsAt,
      safe: g.pending || g.safe, current: g.safe, pending: g.pending,
      changing: !!g.pending,
      players: [...g.players.values()].filter((p) => p.connected),
    };
    for (const [id, brain] of brains) { const p = g.players.get(id); if (p) brain.think(view); }
  }
  if (g.phase === PHASE.PLAY && logged < 8 && i % 15 === 0) {
    logged++;
    const parts = [...brains.entries()].map(([id, b]) => {
      const p = g.players.get(id);
      const t = b.target ? `${b.target.x.toFixed(1)},${b.target.z.toFixed(1)}` : 'null';
      return `${String(id).slice(4, 9)} (${p.x.toFixed(1)},${p.z.toFixed(1)}) tgt=${t}`;
    });
    console.log(`t=${Math.round(g.now)} ${parts.join(' | ')}`);
  }
}
