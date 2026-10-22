import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { safeGroups, isSafeAt, worldToTile } from '../shared/sim.js';
import { TICK_MS } from '../shared/constants.js';

// Which rounds kill >1 player, and what was the state?
for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
  const g = new Game({ seed });
  g.addPlayer({ id: 'me', name: 'me', isBot: false });
  spawnBots(g, 5, 'intermediate');
  const brains = new Map();
  for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', seed));
  g.start(0);

  const origSwap = g._beginSwap.bind(g);
  let preState = null;
  g._beginSwap = function (now) {
    preState = [...g.players.values()].filter((p) => p.alive).map((p) => ({
      id: String(p.id).slice(0, 5), safe: isSafeAt(g.safe, p.x, p.z),
      tile: (() => { const t = worldToTile(p.x, p.z); return t ? `(${t.x},${t.z})` : '?'; })(),
    }));
    preState.zones = safeGroups(g.safe).map((gr) => `(${gr[0] % 12},${(gr[0] / 12) | 0})`);
    return origSwap(now);
  };

  let prevAlive = null;
  for (let i = 0; i < 20000; i++) {
    g.tick(TICK_MS);
    if (g.phase === PHASE.PLAY || g.phase === 'swap') {
      const view = {
        now: g.now, phase: g.phase, round: g.round, roundEndsAt: g.roundEndsAt,
        safe: g.safe, current: g.safe, pending: null, changing: false,
        players: [...g.players.values()].filter((p) => p.connected),
      };
      for (const [id, brain] of brains) { const p = g.players.get(id); if (p) brain.think(view); }
    }
    for (const e of g.drainEvents()) {
      if (e.t === 'eliminated') {
        if (e.ids.length > 1 && preState) {
          console.log(`seed ${seed} round ${e.round}: ${e.ids.length} killed`);
          console.log('  zones: ' + preState.zones.join(' '));
          for (const p of preState) console.log(`    ${p.id} tile=${p.tile} safe=${p.safe}`);
        }
      }
      if (e.t === 'end') { i = 999999; }
    }
    if (g.phase === PHASE.RESULT) break;
  }
}
