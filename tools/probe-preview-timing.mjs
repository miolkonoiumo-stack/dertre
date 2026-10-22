// How long does the game actually expose `pending` during the warning window?
// Runs shared/game.js headless: no browser noise, exact timing.
import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { TICK_MS, WARNING_MS, ROUND_MS } from '../shared/constants.js';

const g = new Game({ seed: 42, difficulty: 'intermediate' });
g.addPlayer({ id: 'me', name: 'me', isBot: false });
spawnBots(g, 5, 'intermediate');
for (const p of g.players.values()) if (p.isBot) new BotBrain(p, 'intermediate', 7);
g.start();

let rounds = 0;
let pendingMs = 0;
let unknownMs = 0;
let lastWarnLogged = false;

for (let i = 0; i < 20000; i++) {
  g.tick(TICK_MS);
  if (g.phase === PHASE.PLAY) {
    if (g.pending) pendingMs += TICK_MS;
    else unknownMs += TICK_MS;

    // Log the first time a preview becomes available in each round.
    if (g.pending && !lastWarnLogged) {
      const left = g.roundEndsAt - g.now;
      console.log(
        `round ${g.round}: preview appears with ${left.toFixed(0)}ms left on the clock ` +
        `(warning window is ${WARNING_MS}ms)`,
      );
      lastWarnLogged = true;
    }
  } else if (g.phase !== PHASE.PLAY && lastWarnLogged) {
    rounds++;
    lastWarnLogged = false;
  }
  if (g.phase === PHASE.RESULT && g.winner) break;
  if (rounds >= 3) break;
}

console.log('---');
console.log('ticks with a preview available:', pendingMs, 'ms');
console.log('ticks without:', unknownMs, 'ms');
console.log('expected per round (WARNING_MS):', WARNING_MS, 'ms');
console.log('rounds observed:', rounds, '| round length:', ROUND_MS, 'ms');
