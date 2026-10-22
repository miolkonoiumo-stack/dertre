import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, PHASE } from '../shared/game.js';
import {
  generateLayout, safeGroups, resolveRound, makeRng, worldToTile, idx,
  stepPlayer, sanitizeInput, tileCenter, isSafeAt, zoneOccupancy,
} from '../shared/sim.js';
import {
  GRID, ROUND_MS, SWAP_MS, COUNTDOWN_MS, CAPACITY, MAX_PLAYERS, TICK_MS, WALK_SPEED, TILE,
} from '../shared/constants.js';
import { spawnBots, BotBrain } from '../shared/bots.js';

const count = (mask) => mask.reduce((a, b) => a + b, 0);

function makeGame(n, seed = 7) {
  const g = new Game({ seed });
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, { name: 'P' + i, color: i });
  return g;
}

/** Advance a game by ms in real ticks. */
function advance(g, ms) {
  const steps = Math.round(ms / TICK_MS);
  for (let i = 0; i < steps; i++) g.tick(TICK_MS);
  return g;
}

// ── Zone generation ──────────────────────────────────────────────────────────
test('layout has exactly (alive - 1) safe zones while more than one player lives', () => {
  for (let alive = 2; alive <= MAX_PLAYERS; alive++) {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = makeRng(seed * 7919);
      const safe = generateLayout(alive, rng);
      const groups = safeGroups(safe);
      assert.equal(
        groups.length, alive - 1,
        `alive=${alive} seed=${seed} -> ${groups.length} zones`,
      );
    }
  }
});

test('layout never returns an empty arena', () => {
  for (let alive = 2; alive <= MAX_PLAYERS; alive++) {
    for (let seed = 1; seed <= 25; seed++) {
      const safe = generateLayout(alive, makeRng(seed));
      assert.ok(count(safe) >= alive - 1, `alive=${alive} seed=${seed} has ${count(safe)} safe tiles`);
    }
  }
});

test('layouts change between rounds', () => {
  const rng = makeRng(424242);
  let prev = generateLayout(6, rng);
  let carried = 0;      // safe tiles reused from the previous round
  let rounds = 0;
  for (let i = 0; i < 60; i++) {
    const next = generateLayout(6, rng, prev);
    // What matters is whether the SAFE GROUND relocates, not how many bytes of
    // the mask flipped. Comparing raw masks counted lava->safe flips as change
    // and let a layout that kept its zones in place pass.
    let shared = 0;
    for (let j = 0; j < next.length; j++) if (next[j] && prev[j]) shared++;
    carried += shared;
    rounds++;
    assert.equal(safeGroups(next).length, 5, 'zones must stay at alive-1');
    prev = next;
  }
  // Standing still is only a winning strategy if the floor stays under you.
  assert.ok(carried / rounds < 1.5, `safe ground must relocate, avg reused tiles was ${(carried / rounds).toFixed(2)}`);
});

test('single living player still gets exactly one zone', () => {
  const safe = generateLayout(1, makeRng(99));
  assert.equal(safeGroups(safe).length, 1);
});

// ── Occupancy resolution ────────────────────────────────────────────────────
test('players standing on lava are eliminated at resolution', () => {
  // Round 1 is fully safe, so build the lava case directly: one safe tile,
  // everybody else parked on a lava tile.
  const safe = new Uint8Array(GRID * GRID);
  safe[idx(0, 0)] = 1;
  const lava = tileCenter(6, 6);
  const players = [
    { id: 'a', alive: true, x: lava.x, z: lava.z, y: 0 },
    { id: 'b', alive: true, x: lava.x + 0.2, z: lava.z, y: 0 },
  ];
  const { survivors, eliminated } = resolveRound(players, safe);
  assert.equal(survivors.length, 0, 'nobody on lava survives');
  assert.equal(eliminated.length, players.length);
});

test('over-capacity zone keeps exactly CAPACITY players deterministically', () => {
  const safe = new Uint8Array(GRID * GRID);
  safe[idx(5, 5)] = 1;             // a single safe tile -> CAPACITY seats
  const c = tileCenter(5, 5);
  const mk = (id, dx) => ({ id, alive: true, x: c.x + dx, z: c.z, y: 0 });
  const players = [mk('a', -0.5), mk('b', -0.1), mk('c', 0.1), mk('d', 0.5)];

  const r1 = resolveRound(players, safe);
  const r2 = resolveRound(players, safe);
  assert.equal(r1.survivors.length, CAPACITY, 'exactly CAPACITY players fit on one safe zone');
  assert.deepEqual(r1.survivors, r2.survivors, 'resolution must be deterministic');
  // closest to centroid wins
  assert.ok(r1.survivors.includes('b') || r1.survivors.includes('c'));
});

test('simultaneous arrivals are resolved without duplicates or losses', () => {
  const safe = new Uint8Array(GRID * GRID);
  // two zones: 1 tile each -> CAPACITY seats per zone, 5 contestants
  safe[idx(2, 2)] = 1;
  safe[idx(9, 9)] = 1;
  const c1 = tileCenter(2, 2), c2 = tileCenter(9, 9);
  const players = [
    { id: 'p1', alive: true, x: c1.x, z: c1.z, y: 0 },
    { id: 'p2', alive: true, x: c1.x + 0.2, z: c1.z, y: 0 },
    { id: 'p3', alive: true, x: c1.x - 0.2, z: c1.z, y: 0 },
    { id: 'p4', alive: true, x: c2.x, z: c2.z, y: 0 },
    { id: 'p5', alive: true, x: 0, z: 0, y: 0 },  // on lava
  ];
  const { survivors, eliminated } = resolveRound(players, safe);
  const seats = CAPACITY * 2;
  assert.equal(survivors.length, seats, 'every zone fills its CAPACITY seats');
  assert.equal(eliminated.length, players.length - seats, 'the rest are eliminated');
  assert.equal(new Set(survivors).size, survivors.length, 'no duplicates');
  assert.ok(!survivors.includes('p5'), 'a player on lava never survives');
  const all = new Set([...survivors, ...eliminated]);
  assert.equal(all.size, players.length, 'every player is accounted for exactly once');
});

test('a player in mid-air above lava is eliminated, above safe tile survives', () => {
  const safe = new Uint8Array(GRID * GRID);
  safe[idx(1, 1)] = 1;
  const s = tileCenter(1, 1);
  const onSafeHigh = tileCenter(7, 7);
  const players = [
    { id: 'air-safe', alive: true, x: s.x, z: s.z, y: 0 },        // grounded on safe
    { id: 'air-over-lava', alive: true, x: onSafeHigh.x, z: onSafeHigh.z, y: 6 },
  ];
  const { survivors, eliminated } = resolveRound(players, safe);
  assert.deepEqual(survivors, ['air-safe']);
  assert.deepEqual(eliminated, ['air-over-lava']);
});

// ── Round flow ──────────────────────────────────────────────────────────────
test('round 1 already obeys living-1 zones (no free all-safe opening)', () => {
  const g = makeGame(5);
  g.start(0);
  assert.equal(g.phase, PHASE.COUNTDOWN);
  // During the countdown the deck is NEUTRAL: no safe zones, no lava. The user
  // described it as "el piso es de color neutro al iniciar".
  assert.equal(safeGroups(g.safe).length, 0, 'neutral floor before the round starts');
  assert.equal(g.neutralFloor, true);
  assert.equal(g.round1AllSafe, false);
  advance(g, COUNTDOWN_MS + 20);
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.round, 1);
  assert.equal(g.aliveCount(), 5);
  // Once the round starts: exactly alive-1 zones, never a green carpet.
  assert.equal(safeGroups(g.safe).length, 4, 'round 1 must obey alive-1');
  assert.equal(g.neutralFloor, false);
});

test('a full round transitions play -> swap -> play with a correct zone count', () => {
  const g = makeGame(5);
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  assert.equal(g.phase, PHASE.PLAY);
  for (const p of g.players.values()) g.setInput(p.id, { x: 0, z: 0, jump: false });

  // Nobody moves, so everybody burns: the round is judged against the floor they
  // were standing on and the match ends straight away. The swap beat only exists
  // when at least two players survive, so accept either outcome here.
  advance(g, ROUND_MS + 20);
  assert.ok([
    'swap', PHASE.PLAY, PHASE.RESULT,
  ].includes(g.phase), `round clock must advance the match (got ${g.phase})`);

  if (g.phase === 'swap') {
    // No mid-round floor swap any more: the next layout is built by the round
    // that follows, so the swap beat must NOT publish a different mask.
    assert.equal(g.pending, null, 'swap must not publish a second floor');
    assert.equal(safeGroups(g.safe).length, 4, '5 alive -> 4 zones on the judged floor');
  }

  advance(g, SWAP_MS + 40);
  assert.ok([PHASE.PLAY, PHASE.RESULT].includes(g.phase));
  if (g.phase === PHASE.PLAY) {
    assert.equal(g.round, 2, 'round counter advanced');
    const zones = safeGroups(g.safe).length;
    assert.ok(zones >= 1, `at least one zone (got ${zones})`);
    assert.ok(zones <= 4, `never more zones than the previous floor planned (got ${zones})`);
  } else {
    assert.equal(g.aliveCount(), 0, 'nobody moved, so nobody survived');
  }
});

test('players left on lava after a swap are eliminated', () => {
  const g = makeGame(4);
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  // Freeze all inputs so nobody moves.
  for (const p of g.players.values()) g.setInput(p.id, { x: 0, z: 0, jump: false });
  advance(g, ROUND_MS + 20);
  const prevSafe = g.safe.slice();
  advance(g, SWAP_MS + 40);
  const alive = [...g.players.values()].filter((p) => p.alive);
  for (const p of alive) {
    const t = worldToTile(p.x, p.z);
    assert.ok(t, 'survivor must be inside the arena');
    assert.equal(g.safe[idx(t.x, t.z)], 1, `survivor ${p.id} must stand on a safe tile`);
  }
});

test('match finishes with exactly one winner and never loses players', () => {
  const g = makeGame(4);
  g.start(0);
  let guard = 0;
  while (g.phase !== PHASE.RESULT && guard++ < 400) {
    advance(g, ROUND_MS + SWAP_MS + 100);
    if (g.phase === PHASE.RESULT) break;
    advance(g, 100);
  }
  assert.equal(g.phase, PHASE.RESULT, 'match should end');
  // zero survivors is legal (everyone burned) � a winner is still awarded
  const alive = [...g.players.values()].filter((p) => p.alive);
  assert.ok(alive.length <= 1, 'at most one survivor');
  if (alive.length === 1) assert.equal(g.winner, alive[0].id);
  assert.ok(g.winner, 'a winner is always declared');
  const standings = g.standings();
  assert.equal(standings.length, 4);
  assert.equal(standings[0].id, g.winner);
  assert.deepEqual(standings.map((s) => s.rank), [1, 2, 3, 4]);
});

test('solo game (1 player) still produces a valid, winnable state', () => {
  const g = makeGame(1);
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  assert.equal(g.phase, PHASE.PLAY);
  advance(g, ROUND_MS + SWAP_MS + 50);
  // With one player the match ends (no opponents) or stays playable.
  assert.ok([PHASE.RESULT, PHASE.PLAY].includes(g.phase));
  assert.equal(safeGroups(g.safe).length >= 1, true);
});

// ── Player limits ───────────────────────────────────────────────────────────
test('room enforces MAX_PLAYERS', () => {
  const g = makeGame(MAX_PLAYERS);
  const res = g.addPlayer('extra', { name: 'Extra' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'room_full');
  assert.equal(g.players.size, MAX_PLAYERS);
});

test('duplicate ids are rejected', () => {
  const g = makeGame(2);
  assert.equal(g.addPlayer('p0', { name: 'Dup' }).reason, 'duplicate');
});

test('players always spawn inside the arena', () => {
  const g = makeGame(MAX_PLAYERS);
  for (const p of g.players.values()) {
    const t = worldToTile(p.x, p.z);
    assert.ok(t, `${p.id} spawned outside the arena at ${p.x},${p.z}`);
    assert.ok(Math.abs(p.x) <= GRID * 1.2 + 1);
  }
});

// ── Physics ─────────────────────────────────────────────────────────────────
test('player accelerates to max speed', () => {
  const p = {
    id: 'x', alive: true, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, speedMul: 1,
  };
  const input = { x: 1, z: 0, jump: false, sprint: false };
  for (let i = 0; i < 30; i++) stepPlayer(p, input, 1 / 30, null, null);
  const speed = Math.hypot(p.vx, p.vz);
  assert.ok(speed > 0.1 * WALK_SPEED, `player should move (speed ${speed})`);
  assert.ok(speed <= WALK_SPEED + 0.001, `speed ${speed} exceeded ${WALK_SPEED}`);
});

test('player falls off the arena and is marked dead', () => {
  const p = { id: 'x', alive: true, x: 999, y: 0, z: 999, vx: 0, vy: 0, vz: 0, rot: 0 };
  for (let i = 0; i < 300; i++) stepPlayer(p, { x: 0, z: 0, jump: false }, 1 / 60, null, null);
  assert.equal(p.alive, false);
  assert.equal(p.fellOff, true);
});

test('jump only works from the ground', () => {
  const p = { id: 'x', alive: true, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rot: 0 };
  stepPlayer(p, { x: 0, z: 0, jump: true }, 1 / 60, null, null);
  assert.ok(p.vy > 5, 'jump should give upward velocity');
  const vyAfter = p.vy;
  p.y = 5;                       // now airborne
  stepPlayer(p, { x: 0, z: 0, jump: true }, 1 / 60, null, null);
  assert.ok(p.vy < vyAfter, 'no double jump');
});

test('inputs are sanitised at the boundary', () => {
  assert.deepEqual(sanitizeInput({ x: 99, z: -99, jump: 1, sprint: 'yes' }),
    { x: 1, z: -1, jump: true, sprint: true, seq: 0 });
  assert.deepEqual(sanitizeInput(null), { x: 0, z: 0, jump: false, sprint: false, seq: 0 });
  assert.deepEqual(sanitizeInput({ x: NaN, z: Infinity }), { x: 0, z: 0, jump: false, sprint: false, seq: 0 });
});

test('client cannot set its own position (only inputs are accepted)', () => {
  const g = makeGame(2);
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  const p = g.players.get('p0');
  const before = { x: p.x, z: p.z };
  g.setInput('p0', { x: 0, z: 0, jump: false, x_pos: 999, z_pos: 999, teleport: true });
  assert.equal(p.x, before.x);
  assert.equal(p.z, before.z);
});

// ── Disconnections ──────────────────────────────────────────────────────────
test('a disconnected player in the lobby is removed and host migrates', () => {
  const g = makeGame(3);
  assert.equal(g.players.get('p0').host, true);
  g.removePlayer('p0');
  assert.equal(g.players.has('p0'), false);
  assert.equal(g.players.get('p1').host, true, 'host should migrate');
});

test('a disconnected mid-match player is eliminated but other players continue', () => {
  const g = makeGame(3);
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  g.removePlayer('p1');
  assert.equal(g.aliveCount(), 2);
  advance(g, 100);
  assert.ok([PHASE.PLAY, 'swap'].includes(g.phase));
  const p1 = g.players.get('p1');
  assert.equal(p1.alive, false);
  assert.equal(p1.connected, false);
});

test('disconnecting the last opponent ends the match with a winner', () => {
  const g = makeGame(2);
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  g.removePlayer('p1');
  advance(g, 200);
  assert.ok([PHASE.RESULT, PHASE.PLAY, 'swap'].includes(g.phase));
  // The match must resolve on the next round boundary at the latest.
  advance(g, ROUND_MS + SWAP_MS + 200);
  assert.equal(g.phase, PHASE.RESULT);
  assert.equal(g.winner, 'p0');
  assert.equal(g.aliveCount(), 1);
});

// ── Bots ────────────────────────────────────────────────────────────────────
test('bots are added within the player limit', () => {
  const g = new Game({ seed: 1 });
  g.addPlayer('me', { name: 'Me' });
  const made = spawnBots(g, 30, 'expert');
  assert.equal(made, MAX_PLAYERS - 1);
  assert.equal(g.players.size, MAX_PLAYERS);
});

test('bots survive at least one round on intermediate difficulty', () => {
  const g = new Game({ seed: 2024 });
  g.addPlayer('me', { name: 'Me' });
  spawnBots(g, 5, 'expert');
  g.start(0);
  advance(g, COUNTDOWN_MS + 20);
  const brains = new Map();
  for (const p of g.players.values()) if (p.isBot) brains.set(p.id, new BotBrain(p, 'expert', g.seed));
  // me stands still on the safest tile we can find
  let guard = 0;
  while (g.phase === PHASE.PLAY && guard++ < 400) {
    for (const [id, b] of brains) {
      b.think({ now: g.now, phase: g.phase, roundEndsAt: g.roundEndsAt, safe: g.safe, players: [...g.players.values()] });
    }
    g.tick(TICK_MS);
  }
  const botsAlive = [...g.players.values()].filter((p) => p.isBot && p.alive).length;
  assert.ok(botsAlive >= 1, 'at least one bot should survive the first round');
});







// -- Regressions for the "stale layout" family of bugs -----------------------
test('every play tick has exactly alive-1 zones, even after a death', () => {
  // The pending layout used to be generated at warning time with the OLD living
  // count and applied unchanged, so after a death the floor kept one zone too
  // many: everyone fits, nobody dies, and extra green patches appear.
  for (let seed = 1; seed <= 6; seed++) {
    const g = new Game({ seed: seed * 977 });
    for (let i = 0; i < 6; i++) g.addPlayer('p' + i, { name: 'P' + i });
    g.start(0);
    let lastAlive = g.aliveCount();
    for (let i = 0; i < 20 * 90; i++) {
      for (const p of g.players.values()) g.setInput(p.id, { x: 0, z: 0, jump: false });
      g.tick(TICK_MS);
      if (g.phase !== PHASE.PLAY) continue;
      if (g.aliveCount() <= 1) break;
      assert.equal(
        safeGroups(g.safe).length,
        g.aliveCount() - 1,
        `seed ${seed}: ${g.aliveCount()} alive but ${safeGroups(g.safe).length} zones`,
      );
      lastAlive = g.aliveCount();
    }
  }
});

test('every zone is exactly ONE tile (N players => N-1 single tiles)', () => {
  // The rule the user actually wants: one square per player, minus one. Not
  // blobs. Blobs read as "3 cuadros por jugador" and hide where to run.
  for (let n = 2; n <= 8; n++) {
    for (let seed = 1; seed <= 40; seed++) {
      const anchors = [];
      for (let i = 0; i < n; i++) anchors.push({ x: 2 + ((i * 2) % 9), z: 2 + ((i * 3) % 9) });
      const layout = generateLayout(n, makeRng(seed * 37 + n), null, 0, anchors);
      const groups = safeGroups(layout);
      assert.equal(groups.length, Math.max(1, n - 1), `alive ${n} seed ${seed}`);
      for (const g of groups) {
        assert.equal(g.length, 1, `alive ${n} seed ${seed}: zone with ${g.length} tiles`);
      }
    }
  }
});

test('every zone can be reached before the swap', () => {
  // Single-tile zones leave no room for error: a tile on the far side of the
  // arena that cannot be crossed in one round is an unavoidable death.
  const canCross = WALK_SPEED * (ROUND_MS / 1000) * 0.92;
  for (let n = 2; n <= 8; n++) {
    for (let seed = 1; seed <= 40; seed++) {
      const anchors = [];
      for (let i = 0; i < n; i++) anchors.push({ x: 2 + ((i * 2) % 9), z: 2 + ((i * 3) % 9) });
      const layout = generateLayout(n, makeRng(seed * 37 + n), null, 0, anchors);
      for (const g of safeGroups(layout)) {
        const tx = g[0] % GRID;
        const tz = (g[0] / GRID) | 0;
        const reachable = anchors.some((a) => Math.hypot(a.x - tx, a.z - tz) * TILE <= canCross);
        assert.ok(reachable, `alive ${n} seed ${seed}: zone at (${tx},${tz}) is out of reach`);
      }
    }
  }
});

test('zoneOccupancy reports which zone each living player stands in', () => {
  const layout = generateLayout(4, makeRng(7), null, 0, null);
  const groups = safeGroups(layout);
  const cell = groups[0][0];
  const center = tileCenter(cell % GRID, (cell / GRID) | 0);
  const players = [
    { id: 'a', alive: true, connected: true, x: center.x, z: center.z },
    { id: 'b', alive: false, connected: true, x: center.x, z: center.z },
  ];
  const occ = zoneOccupancy(players, layout);
  assert.equal(occ.byPlayer.a, 0);
  assert.equal(occ.counts[0], 1);
  assert.equal(occ.byPlayer.b, undefined, 'dead players are not counted');
});