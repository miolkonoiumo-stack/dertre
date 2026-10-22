/**
 * Local session: runs the same authoritative Game module in the browser.
 * Used for solo-vs-bots and as an offline fallback when no server is reachable.
 * It is NOT a fake multiplayer: there is no remote player pretending to be online.
 */

import { Game, PHASE } from '@shared/game.js';
import { BotBrain, spawnBots } from '@shared/bots.js';
import { TICK_MS, MAX_PLAYERS } from '@shared/constants.js';
import { randomSeed } from '@shared/sim.js';

export class LocalSession {
  constructor({ name = 'You', color = 0, bots = 5, difficulty = 'intermediate', onEvent } = {}) {
    this.game = new Game({ seed: randomSeed(), roomCode: 'LOCAL' });
    this.id = 'me';
    this.name = name;
    this.onEvent = onEvent || (() => {});
    this.brains = new Map();
    this.handlers = [];

    this.game.addPlayer(this.id, { name, color });
    spawnBots(this.game, Math.min(bots, MAX_PLAYERS - 1), difficulty);
    for (const p of this.game.players.values()) {
      if (p.isBot) {
        this.brains.set(p.id, new BotBrain(p, difficulty, this.game.seed));
      }
    }
    // Ensure at least 2 players so the round rule is meaningful
    if (this.game.players.size < 2) {
      spawnBots(this.game, 1, difficulty);
      for (const p of this.game.players.values()) {
        if (p.isBot && !this.brains.has(p.id)) this.brains.set(p.id, new BotBrain(p, difficulty, this.game.seed));
      }
    }
  }

  get phase() { return this.game.phase; }

  start() {
    this.game.start(0);
    this._flush();
  }

  setInput(frame) {
    this.game.setInput(this.id, frame);
  }

  /** Advance by real elapsed time (accumulator keeps physics deterministic). */
  advance(elapsedMs) {
    if (this.game.phase === PHASE.LOBBY) return;
    // Clamp the *input* (protects against a 10-second tab-switch dump) but never
    // silently discard backlog: we drain up to `maxSteps` ticks per call and
    // keep the remainder in the accumulator for the next frame. Dropping time
    // made the game run in slow motion on low-FPS machines.
    this._acc = (this._acc || 0) + Math.min(elapsedMs, 250);
    const maxSteps = 24;
    let steps = 0;
    while (this._acc >= TICK_MS && steps < maxSteps) {
      this._acc -= TICK_MS;
      steps++;
      this.game.tick(TICK_MS);
      this._bots();
      this._flush();
    }
    // Extreme backlog (long freeze): drop it rather than fast-forwarding the
    // match through a hundred invisible ticks.
    if (this._acc > 2000) this._acc = 2000;
  }

  _bots() {
    const g = this.game;
    if (g.phase !== PHASE.PLAY && g.phase !== 'swap') return;
    // Bots must reason about the floor the round will END on, not the one it is
    // on right now. Passing only `safe` meant they never reacted to the warning
    // and simply stood on tiles that were about to become lava.
    const upcoming = g.pending || g.safe;
    const view = {
      now: g.now,
      phase: g.phase,
      round: g.round,
      roundEndsAt: g.roundEndsAt,
      safe: upcoming,
      current: g.safe,
      pending: g.pending,
      changing: !!g.pending,
      players: [...g.players.values()].filter((p) => p.connected),
    };
    for (const [id, brain] of this.brains) {
      const p = g.players.get(id);
      if (!p) continue;
      brain.think(view);
    }
  }

  _flush() {
    for (const e of this.game.drainEvents()) this.onEvent(e);
  }

  get state() { return this.game.fullState(); }
  get me() { return this.game.players.get(this.id); }

  restart({ bots, difficulty } = {}) {
    this.game = new Game({ seed: randomSeed(), roomCode: 'LOCAL' });
    this.brains.clear();
    this.game.addPlayer(this.id, { name: this.name, color: this.color ?? 0 });
    const count = Math.min(Math.max(bots ?? 5, 1), MAX_PLAYERS - 1);
    spawnBots(this.game, count, difficulty || 'intermediate');
    for (const p of this.game.players.values()) {
      if (p.isBot) this.brains.set(p.id, new BotBrain(p, difficulty || 'intermediate', this.game.seed));
    }
    this.start();
  }

  dispose() { this.handlers.forEach((h) => h()); this.handlers = []; }
}
