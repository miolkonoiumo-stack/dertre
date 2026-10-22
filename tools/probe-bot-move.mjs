import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { TICK_MS } from '../shared/constants.js';

const g = new Game({ seed: 1 });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
for (const p of g.players.values()) if (p.isBot) new BotBrain(p, 'intermediate', 31);
g.start(0);

let logged = 0;
for (let i = 0; i < 900; i++) {
  g.tick(TICK_MS);
  if (g.phase === PHASE.PLAY && logged < 8 && i % 15 === 0) {
    logged++;
    const bots = [...g.players.values()].filter((p) => p.isBot);
    const parts = bots.map((b) => {
      const t = b.bot && b.bot.target ? `${b.bot.target.x.toFixed(1)},${b.bot.target.z.toFixed(1)}` : 'null';
      return `${String(b.id).slice(4, 9)} (${b.x.toFixed(1)},${b.z.toFixed(1)}) tgt=${t} inp=${b.input.x},${b.input.z}`;
    });
    console.log(`t=${Math.round(g.now)} ${parts.join(' | ')}`);
  }
}
