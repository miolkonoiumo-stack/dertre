/**
 * Authoritative match state machine â€” the single implementation of the rules.
 *
 * Both the Node server (multiplayer) and the browser (solo/offline) import this.
 * The Game instance owns players, the round clock, layout transitions and the
 * elimination checks. Everything that can be decided is decided here, once.
 */

import {
  ROUND_MS, WARNING_MS, SWAP_MS, COUNTDOWN_MS, END_MS, TICK_MS,
  MAX_PLAYERS, CAPACITY, TILE_TOP, KILL_Y, GRID,
} from './constants.js';
import {
  makeRng, generateLayout, safeGroups, tileCenter, worldToTile, idx,
  resolveRound, stepPlayer, sanitizeInput, spotInTile, zoneOccupancy,
} from './sim.js';

export const PHASE = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAY: 'play',
  RESULT: 'result',
};

export class Game {
  constructor({ seed = 1, roomCode = 'LOCAL' } = {}) {
    this.roomCode = roomCode;
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.players = new Map();      // id -> player
    this.order = [];               // join order (stable ids)
    this.phase = PHASE.LOBBY;
    this.now = 0;                  // ms since match start (server clock)
    this.round = 0;
    this.phaseEndsAt = 0;
    this.roundEndsAt = 0;
    this.warningAt = 0;
    this.safe = new Uint8Array(144);
    this.prevSafe = null;
    this.pending = null;           // layout being swapped in
    this.neutralFloor = false;     // true while the deck is plain (pre-round)
    this.events = [];              // consumed by networking / local game loop
    this.winner = null;
    this.startedAt = 0;
    this.paused = false;
  }

  // â”€â”€ Players â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  addPlayer(id, { name, color = 0, isBot = false, botProfile = null, speedMul = 1 } = {}) {
    if (this.players.size >= MAX_PLAYERS) return { ok: false, reason: 'room_full' };
    if (this.players.has(id)) return { ok: false, reason: 'duplicate' };
    const spawn = this._spawnSpot();
    const p = {
      id, name: String(name || 'Player').slice(0, 14), color: color % 16,
      isBot, botProfile, speedMul, alive: true, ready: !isBot,
      x: spawn.x, y: TILE_TOP, z: spawn.z, vx: 0, vy: 0, vz: 0, rot: 0,
      input: { x: 0, z: 0, jump: false, sprint: false, seq: 0 },
      deathAt: 0, diedRound: 0, roundsSurvived: 0, fellOff: false,
      joinedAt: this.now, lastSeen: this.now, connected: true,
      host: false, skin: { body: color, accent: color },
    };
    this.players.set(id, p);
    this.order.push(id);
    if (this.order.length === 1) p.host = true;
    this.events.push({ t: 'join', id, name: p.name });
    return { ok: true, player: p };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    this.events.push({ t: 'leave', id, name: p.name, wasAlive: p.alive });
    // In an active match the body stays as lava-food; otherwise drop it entirely.
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULT) {
      this.players.delete(id);
      this.order = this.order.filter((x) => x !== id);
      if (p.host) {
        const next = this.order.map((i) => this.players.get(i)).find((q) => q && q.connected);
        if (next) next.host = true;
      }
    } else {
      p.alive = false;
    }
  }

  _spawnSpot(index = this.players.size, safe = null) {
    // Spread spawns evenly on a ring so nobody starts stacked on one tile.
    const n = Math.max(1, this.players.size);
    const ang = (index / n) * Math.PI * 2 - Math.PI / 2;
    const r = n <= 2 ? 3.6 : 4.8;
    const jitter = (this.rng() - 0.5) * 0.8;
    const x = Math.cos(ang) * (r + jitter);
    const z = Math.sin(ang) * (r + jitter);
    // Snap the spawn onto the centre of a solid plate: never spawn over a gap
    // or outside the arena (otherwise the player falls before the round starts).
    const t = worldToTile(x, z);
    if (!t) return { x: 0, z: 0 };
    const c = tileCenter(t.x, t.z);
    return { x: c.x, z: c.z };
  }

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive && p.connected) n++;
    return n;
  }

  // â”€â”€ Match lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  start(now = this.now) {
    if (this.phase !== PHASE.LOBBY) return false;
    this.now = now;
    this.startedAt = now;
    this.round = 0;
    this.winner = null;
    this.phase = PHASE.COUNTDOWN;
    this.phaseEndsAt = now + COUNTDOWN_MS;
    // Reset players and place them on the spawn ring BEFORE building the floor:
    // the layout is anchored to player tiles, so it must see final positions.
    for (const p of this.players.values()) {
      p.alive = true; p.fellOff = false; p.deathAt = 0; p.diedRound = 0;
      p.roundsSurvived = 0; p.y = TILE_TOP; p.vy = 0; p.vx = 0; p.vz = 0;
      const s = this._spawnSpot(this.order.indexOf(p.id));
      p.x = s.x; p.z = s.z;
    }
    // The floor starts NEUTRAL: no green zones, no lava. The user described the
    // cycle as "el piso es de color neutro al iniciar, salen las zonas seguras y
    // el contador de 5 segundos empieza a descontar". So during the countdown the
    // arena shows a plain deck; the first layout is built when the round starts.
    this.safe = new Uint8Array(GRID * GRID);
    this.neutralFloor = true;
    this.round1AllSafe = false;
    this.prevSafe = null;
    this.events.push({ t: 'start', seed: this.seed });
    return true;
  }

  /** Begin the first play round after the countdown. */
  _beginRound(now) {
    this.round++;
    this.phase = PHASE.PLAY;
    this.roundEndsAt = now + ROUND_MS;
    this.warningAt = this.roundEndsAt - WARNING_MS;
    this._warned = false;
    this.round1AllSafe = false;

    // Build the round layout against the count actually playing. On round 1 the
    // floor is still neutral (empty mask), so it must be generated here; later
    // rounds reuse the layout committed by the swap unless the living count
    // changed in between, in which case it is re-cut.
    if (this.aliveCount() >= 1) {
      const need = Math.max(1, this.aliveCount() - 1);
      const empty = this.safe.every((v) => v === 0);
      if (this.neutralFloor || empty || safeGroups(this.safe).length !== need) {
        const anchors = [...this.players.values()]
          .filter((p) => p.alive && p.connected)
          .map((p) => worldToTile(p.x, p.z) || { x: GRID / 2, z: GRID / 2 });
        this.safe = generateLayout(this.aliveCount(), this.rng, this.prevSafe, 0, anchors);
        this.neutralFloor = false;
      }
    }

    // There is no "upcoming" layout once the round is running: the safe zones on
    // screen ARE the ones that will kill you at 0. Leaving a stale `pending` here
    // made the arena paint a second, different floor during play — the "el piso
    // cambia" the user kept reporting.
    this.pending = null;
    this._warned = true;   // no warning phase: the zones are visible all round

    this.events.push({ t: 'round', round: this.round, endsAt: this.roundEndsAt });
  }
  /** Clock hit `roundEndsAt`: judge against the floor on screen, then go on. */
  _beginSwap(now) {
    // Finish only when one player is left. A solo run keeps going (endless
    // practice) until the player dies.
    if (this.players.size > 1 && this.aliveCount() <= 1) return this._finishMatch(now);

    // A player who fell off during the round is already out.
    const fell = [...this.players.values()].filter((p) => !p.alive && p.fellOff && !p.diedRound);
    for (const p of fell) { p.diedRound = this.round; p.deathAt = now; }

    // THE FLOOR ON SCREEN IS THE ONE THAT JUDGES. There is no "next" layout to
    // resolve against: players spent the whole round running to these zones, so
    // these are the zones that save them. The next layout is built afterwards,
    // when the following round starts.
    const judgedFloor = this.safe;
    const players = [...this.players.values()].filter((p) => p.connected);
    const { eliminated } = resolveRound(players, judgedFloor);
    const applyAct = now + SWAP_MS;
    for (const id of eliminated) {
      const p = this.players.get(id);
      if (!p || !p.alive) continue;
      p.alive = false;
      p.deathAt = applyAct;
      p.diedRound = this.round;
      p.vx = 0; p.vy = Math.min(0, p.vy); p.vz = 0;
    }
    if (eliminated.length) {
      this.events.push({ t: 'eliminated', ids: eliminated, round: this.round, at: applyAct });
    }

    if (this.aliveCount() <= 0) return this._finishMatch(now);
    if (this.aliveCount() <= 1 && this.players.size > 1) return this._finishMatch(now);

    // Short beat so the player sees who exploded before the next floor appears.
    this.phase = 'swap';
    this._swapEndsAt = now + SWAP_MS;
    this.events.push({ t: 'swap', round: this.round + 1, startsAt: now, endsAt: this._swapEndsAt, prev: Array.from(judgedFloor), next: null });
  }

  _commitSwap(now) {
    // The floor is NOT replaced here. The swap beat only exists to show the
    // explosions; the next round builds its own layout in _beginRound.
    this._beginRound(now);
  }

  _finishMatch(now) {
    if (this.phase === PHASE.RESULT) return;
    this.phase = PHASE.RESULT;
    this.phaseEndsAt = now + END_MS;
    const alive = [...this.players.values()].filter((p) => p.alive && p.connected);
    if (alive.length === 1) {
      this.winner = alive[0].id;
      alive[0].roundsSurvived = this.round;
    } else {
      // No survivors left (everyone burned): winner is whoever lasted longest.
      const best = [...this.players.values()].filter((p) => p.connected)
        .sort((a, b) => (b.roundsSurvived - a.roundsSurvived) || (b.deathAt - a.deathAt))[0];
      this.winner = best ? best.id : null;
    }
    this.events.push({
      t: 'end',
      winner: this.winner,
      round: this.round,
      standings: this.standings(),
    });
  }

  standings() {
    return [...this.players.values()]
      .sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return (b.roundsSurvived - a.roundsSurvived) || (a.joinedAt - b.joinedAt);
      })
      .map((p, i) => ({
        rank: i + 1, id: p.id, name: p.name, color: p.color,
        alive: p.alive, roundsSurvived: p.roundsSurvived,
        isBot: !!p.isBot, connected: p.connected,
      }));
  }

  // â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setInput(id, raw) {
    const p = this.players.get(id);
    if (!p) return;
    const input = sanitizeInput(raw);
    if (input.seq >= p.input.seq) p.input = input;
    p.lastSeen = this.now;
  }

  // â”€â”€ Main tick â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /** Advance the world by `dt` ms (normally TICK_MS). Uses fixed substeps. */
  tick(dt = TICK_MS) {
    if (this.paused) return;
    const steps = Math.max(1, Math.round(dt / (TICK_MS / 2)));
    const sub = dt / steps / 1000;

    for (let s = 0; s < steps; s++) {
      this.now += (sub * 1000);
      this._physics(sub);
      this._clock();
    }
  }

  _physics(dt) {
    const list = [...this.players.values()].filter((p) => p.connected || p.alive);
    for (const p of list) {
      // Players cannot move during countdown/result, but spectators keep falling.
      const frozen = (this.phase === PHASE.COUNTDOWN || this.phase === PHASE.RESULT) && p.alive;
      const input = frozen ? { x: 0, z: 0, jump: false, sprint: false } : p.input;
      stepPlayer(p, input, dt, this.safe, list);
      if (!p.alive && !p.fellOff && this.phase === PHASE.PLAY) {
        // died in the arena (lava), mark the round
        p.diedRound = Math.max(p.diedRound, this.round);
      }
      p.input.jump = false; // one-shot
    }
    if (this.phase === PHASE.PLAY) {
      const hasOpponent = this.aliveCount() > 1;
      // During a round, lava only kills by *falling* (below the arena). Standing
      // on a lava tile is not fatal until the swap â€” otherwise every player who
      // starts the round on a tile that is about to vanish dies instantly.
      for (const p of this.players.values()) {
        if (!p.alive || !p.connected) continue;
        if (p.y < KILL_Y) {
          p.alive = false; p.deathAt = this.now; p.diedRound = this.round;
          this.events.push({ t: 'eliminated', ids: [p.id], round: this.round, at: this.now, lava: true });
        }
      }
      if (hasOpponent && this.aliveCount() <= 1) this._finishMatch(this.now);
    }
  }

  _clock() {
    const now = this.now;
    if (this.phase === PHASE.COUNTDOWN && now >= this.phaseEndsAt) {
      this._beginRound(now);
    } else if (this.phase === PHASE.PLAY) {
      // No warning sub-phase: the zones are visible for the whole round, and the
      // mask that judges the round is exactly the one on screen. Generating a
      // second "next" layout here is what repainted the floor mid-round.
      if (now >= this.roundEndsAt) this._beginSwap(now);
    } else if (this.phase === 'swap') {
      if (now >= this._swapEndsAt) this._commitSwap(now);
    } else if (this.phase === PHASE.RESULT && now >= this.phaseEndsAt) {
      this.events.push({ t: 'lobby' });
      this.phase = PHASE.LOBBY;
      this.round = 0;
      this.safe = new Uint8Array(144);
      for (const p of this.players.values()) {
        p.alive = true; p.fellOff = false; p.deathAt = 0; p.roundsSurvived = 0;
        const s = this._spawnSpot(this.order.indexOf(p.id));
        p.x = s.x; p.z = s.z; p.y = TILE_TOP; p.vx = p.vy = p.vz = 0;
      }
    }
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // â”€â”€ Snapshots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fullState() {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      round: this.round,
      now: this.now,
      phaseEndsAt: this.phase === 'swap' ? this._swapEndsAt : this.phaseEndsAt,
      roundEndsAt: this.roundEndsAt,
      warningAt: this.warningAt,
      safe: Array.from(this.safe),
      round1AllSafe: !!this.round1AllSafe,
      occupancy: zoneOccupancy([...this.players.values()], this.safe),
      prevSafe: this.prevSafe ? Array.from(this.prevSafe) : null,
      alive: this.aliveCount(),
      winner: this.winner,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, color: p.color, alive: p.alive, isBot: p.isBot,
        host: p.host, connected: p.connected, ready: p.ready,
        roundsSurvived: p.roundsSurvived, fellOff: p.fellOff,
        x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
        rot: +p.rot.toFixed(3), speedMul: p.speedMul,
      })),
    };
  }

  /** Small per-tick update: positions + clock. Layout only when it changes. */
  tickState() {
    return {
      now: this.now,
      phase: this.phase,
      round: this.round,
      alive: this.aliveCount(),
      phaseEndsAt: this.phase === 'swap' ? this._swapEndsAt : this.phaseEndsAt,
      players: [...this.players.values()].map((p) => [
        p.id, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), p.alive ? 1 : 0,
        +p.rot.toFixed(2), p.connected ? 1 : 0,
      ]),
    };
  }
}




