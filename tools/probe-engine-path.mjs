import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { isOnPlate, isSafeAt } from '../shared/sim.js';
import { TICK_MS } from '../shared/constants.js';

// Reproduce the browser path EXACTLY: bots think AFTER tick(), same as
// local-session.advance(). Then report the state inside _beginSwap.
const g = new Game({ seed: 42 });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
const brains = new Map();
for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', 42));
g.start(0);

let snap = null;
const orig = g._beginSwap.bind(g);
g._beginSwap = function (now) {
  if (!snap) {
    snap = [...g.players.values()].filter((p) => p.alive).map((p) => ({
      id: String(p.id).slice(0, 6), isBot: p.isBot,
      onPlate: isOnPlate(p.x, p.z), safeAt: isSafeAt(g.safe, p.x, p.z), y: +p.y.toFixed(2),
    }));
  }
  return orig(now);
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
  // Hook events
  const evs = g.drainEvents ? g.drainEvents() : [];
  for (const e of evs) {
    if (e.t === 'eliminated') {
      console.log('ELIMINATED EVENT:', e.ids.map((i) => String(i).slice(0, 6)));
      if (snap) for (const s of snap) console.log(`  ${s.id} ${s.isBot ? 'BOT  ' : 'HUMAN'} onPlate=${s.onPlate} safeAt=${s.safeAt} y=${s.y}`);
      process.exit(0);
    }
  }
}
console.log('snap:', snap);
