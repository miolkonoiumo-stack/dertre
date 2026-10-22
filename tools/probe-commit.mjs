import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { isOnPlate, isSafeAt, safeGroups, worldToTile, idx } from '../shared/sim.js';
import { TICK_MS, CAPACITY } from '../shared/constants.js';

const g = new Game({ seed: 42 });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
const brains = new Map();
for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', 42));
g.start(0);

// Intercept the commit: report what resolveRound would see.
const origCommit = g._commitSwap.bind(g);
g._commitSwap = function (now) {
  const judged = g.safe;
  const players = [...g.players.values()].filter((p) => p.connected && p.alive);
  const groups = safeGroups(judged);
  console.log(`\n=== commitSwap round ${g.round} ===`);
  console.log(`zones(${groups.length}): ` + groups.map((gr) => `(${gr[0] % 12},${(gr[0] / 12) | 0})`).join(' '));
  for (const p of players) {
    const t = worldToTile(p.x, p.z);
    const groupOf = groups.findIndex((gr) => t && gr.includes(idx(t.x, t.z)));
    console.log(`  ${String(p.id).slice(0, 6).padEnd(7)} tile=(${t?.x},${t?.z}) safe=${isSafeAt(judged, p.x, p.z)} plate=${isOnPlate(p.x, p.z)} group=${groupOf}`);
  }
  return origCommit(now);
};

for (let i = 0; i < 5000; i++) {
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
  for (const e of g.drainEvents ? g.drainEvents() : []) {
    if (e.t === 'eliminated') {
      console.log('ELIM:', e.ids.map((i) => String(i).slice(0, 6)).join(','));
      process.exit(0);
    }
  }
}
