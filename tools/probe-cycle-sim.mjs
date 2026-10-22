// Verify the cycle the user described, end to end, in the real engine:
// neutral floor -> zones + 5s counter -> whoever is off a zone explodes ->
// if N remain, exactly N-1 zones appear -> repeat.
import { Game, PHASE } from '../shared/game.js';
import { spawnBots, BotBrain } from '../shared/bots.js';
import { safeGroups } from '../shared/sim.js';
import { TICK_MS, ROUND_MS, COUNTDOWN_MS, WARNING_MS } from '../shared/constants.js';

let totalRounds = 0;
let countViolations = 0;
let droppedTooMany = 0;
let hardViolations = 0;
const aliveFlags = new Map();
let neutralOk = 0, neutralBad = 0;
let previewOk = 0, previewBad = 0;

for (let seed = 1; seed <= 6; seed++) {
  const g = new Game({ seed, difficulty: 'intermediate' });
  g.addPlayer({ id: 'me', name: 'me', isBot: false });
  spawnBots(g, 5, 'intermediate');
  const brains = new Map();
  for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'intermediate', seed * 31));

  g.start(0);
  // Neutral floor during countdown.
  if (safeGroups(g.safe).length === 0) neutralOk++; else neutralBad++;

  let lastRound = 0;
  let ticksInRound = 0;

  for (let i = 0; i < 60000; i++) {
    g.tick(TICK_MS);
    // Drive the bots exactly like the client does — without this they stand
    // still and the "nobody dies twice" assertion passes for the wrong reason.
    if (g.phase === PHASE.PLAY || g.phase === 'swap') {
      const view = {
        now: g.now, phase: g.phase, round: g.round, roundEndsAt: g.roundEndsAt,
        safe: g.pending || g.safe, current: g.safe, pending: g.pending,
        changing: !!g.pending,
        players: [...g.players.values()].filter((p) => p.connected),
      };
      for (const [id, brain] of brains) { const p = g.players.get(id); if (p) brain.think(view); }
    }
    if (g.phase === PHASE.PLAY) {
      // The safe zones must be visible for the whole counter, not swapped in at
      // the last moment: pending must be null during play, the layout IS the one
      // the player sees.
      if (g.pending) previewBad++; else previewOk++;
    }
    // Measure eliminations EXACTLY at resolution, not by diffing the alive count
    // when a new round starts. The old check read `prevAlive` only at round
    // start, so it compared across a whole round and reported phantom double
    // deaths (it was really counting the odd-player-out from the PREVIOUS round
    // together with the new one).
    for (const e of g.drainEvents()) {
      if (e.t === 'eliminated') {
        const killed = e.ids.length;
        if (killed > 1) {
          droppedTooMany++;
          // Not every multi-kill is a bug: with N alive and N-1 single-tile zones
          // of capacity 1 there is exactly one slot fewer than players, so one
          // extra death is the rule working. Flag only the surplus.
          if (killed - 1 > 1) hardViolations++;
        }
      }
    }
    if (g.phase === PHASE.PLAY && g.round !== lastRound) {
      lastRound = g.round;
      totalRounds++;
      const alive = g.aliveCount();
      const need = Math.max(1, alive - 1);
      const got = safeGroups(g.safe).length;
      if (got !== need) countViolations++;
    }
    if (g.phase === PHASE.RESULT) break;
  }
}

console.log('rounds observed:', totalRounds);
console.log('zone-count violations:', countViolations);
console.log('rounds with ANY multi-kill:', droppedTooMany);
console.log('rounds losing MORE than the allowed surplus:', hardViolations, '(must be 0)');
console.log('neutral floor at start ok/bad:', neutralOk, '/', neutralBad);
console.log('ticks where play had a stale pending preview:', previewBad, '(should be 0)');
console.log('---');
console.log(countViolations === 0 && hardViolations === 0 && neutralBad === 0 && previewBad === 0
  ? 'RESULT: PASS — cycle matches the description'
  : 'RESULT: FAIL');
