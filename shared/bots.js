/**
 * Bot brains. They only see information a human player has:
 *   - the current safe layout (and, in later rounds, the previous one)
 *   - their own position and the positions of nearby players
 *   - the round clock
 * Higher difficulties get faster reactions and a look-ahead at the *rhythm*
 * of the game — never at the upcoming layout before the swap is announced.
 */

import { BOT_PROFILES, TILE, CAPACITY, FRICTION } from './constants.js';
import {
  makeRng, safeGroups, tileCenter, worldToTile, idx, spotInTile,
} from './sim.js';

export class BotBrain {
  constructor(player, profileName = 'intermediate', seed = 1) {
    this.p = player;
    this.profile = BOT_PROFILES[profileName] || BOT_PROFILES.intermediate;
    this.rng = makeRng(seed ^ (player.id.length * 2654435761));
    this.target = null;        // {x, z}
    this.nextThink = 0;
    this.jumpCooldown = 0;
    this.stuckTimer = 0;
    this.lastPos = { x: player.x, z: player.z };
    this.mistakeUntil = 0;
    this.preferredZone = -1;
    this.preferredRound = -1;   // round the preference was locked for
  }

  /** @param {object} view { now, phase, roundEndsAt, safe, players, autoMode } */
  think(view) {
    const p = this.p;
    if (!p.alive || (view.phase !== 'play' && view.phase !== 'swap')) {
      p.input = { x: 0, z: 0, jump: false, sprint: false, seq: p.input.seq + 1 };
      return;
    }
    if (view.now < this.nextThink) {
      this._drive(view);
      return;
    }
    const react = this.profile.reactionMs * (0.7 + this.rng() * 0.6);
    this.nextThink = view.now + react;

    // Occasional blunder: freeze briefly or pick a bad target (difficulty knob).
    // The old code rolled this on EVERY think, and its duration (0.7-1.6 s) is
    // most of a 5 s round, so bots spent the round wandering badly and eliminated
    // themselves. Keep blunders short and rare.
    if (this.rng() < this.profile.errChance * 0.35) {
      this.mistakeUntil = view.now + 250 + this.rng() * 350;
      this.target = { x: p.x + (this.rng() - 0.5) * 4, z: p.z + (this.rng() - 0.5) * 4 };
    } else if (view.now > this.mistakeUntil) {
      this.target = this._chooseTarget(view);
    }
    this._drive(view);
  }

  _chooseTarget(view) {
    const p = this.p;
    const groups = safeGroups(view.safe);
    if (!groups.length) {
      return { x: 0, z: 0 };
    }

    const timeLeft = view.roundEndsAt - view.now;
    const groupInfo = groups.map((g, gi) => {
      const cells = g.map((i) => ({ x: i % 12, z: (i / 12) | 0 }));
      const c = cells.reduce((acc, t) => {
        const w = tileCenter(t.x, t.z); acc.x += w.x; acc.z += w.z; return acc;
      }, { x: 0, z: 0 });
      c.x /= cells.length; c.z /= cells.length;
      const dist = Math.hypot(c.x - p.x, c.z - p.z);
      // Count rivals already committed to this zone
      const rivals = view.players.filter((q) =>
        q.id !== p.id && q.alive &&
        Math.hypot(q.x - c.x, q.z - c.z) < Math.hypot(p.x - c.x, p.z - c.z) + TILE * 0.5,
      ).length;
      // Bodies physically inside this zone right now. With CAPACITY = 1 a zone
      // holding a rival is CLOSED: going there kills you while standing on green.
      const occupants = view.players.filter((q) => {
        if (q.id === p.id || !q.alive) return false;
        const t = worldToTile(q.x, q.z);
        return t && g.includes(idx(t.x, t.z));
      }).length;
      // Rivals heading here. Counting only who is ALREADY inside was not enough:
      // two bots that started the round side by side picked the same zone, were
      // both still en route, saw it "empty", and arrived together to die to
      // capacity. Treat a rival closer to this zone than we are as a claim on it.
      const inbound = view.players.filter((q) => {
        if (q.id === p.id || !q.alive) return false;
        const dq = Math.hypot(q.x - c.x, q.z - c.z);
        return dq < dist - TILE * 0.4;
      }).length;
      return { gi, cells, c, dist, rivals, occupants, inbound, size: cells.length };
    });

    // Spread the bots across zones instead of sending them all to the closest
    // one. Previously every bot scored almost identically, so five bots piled
    // onto one tile (capacity 2) and three died to each other rather than to
    // the lava. Claim a zone by deterministic rank so the room divides evenly:
    // rank is the player's index among living players sorted by distance to the
    // zone they favour, which keeps the assignment stable and collision-free.
    const living = view.players.filter((q) => q.alive);
    const zoneOrder = groupInfo.map((g) => g.gi);
    // Spread the bots across zones instead of sending them all to the closest
    // one. Claiming by `claimIndex % nZones` was not enough: with fewer zones
    // than players the modulo wrapped two players onto the same tile, and when
    // `nZones` happened to divide two ids they collided on purpose. It also
    // depended on alphabetical id order, so the assignment was effectively
    // random. This is a real greedy matching instead: every living player, in a
    // deterministic order, takes the nearest zone still free.
    const nZones = Math.max(1, zoneOrder.length);
    // Lock the claim ONCE per round. Recomputing the greedy matching every tick
    // let two bots swap zones back and forth (each saw the other as the reason
    // to move), so they converged on the same tile and one died to capacity.
    // A per-round commitment makes them leave the start line already split.
    const claimRound = Number.isFinite(view.round) ? view.round : 0;
    if (this.preferredRound !== claimRound) {
      this.preferredRound = claimRound;
      this.preferredZone = -1;
    }
    bands: {
      if (this.preferredZone >= 0 && groupInfo.some((g) => g.gi === this.preferredZone)) break bands;
      // N players, N-1 zones: somebody is always left out. That is the rule, not
      // a bug — but the leftover must not collide onto another player's zone.
      // Order the draw so the LAST picker is the one farthest from every zone,
      // and give it a backup zone of its own only if one is still free.
      const byId = [...living].sort((a, b) => {
        const da = Math.min(...groupInfo.map((gr) => Math.hypot(gr.c.x - a.x, gr.c.z - a.z)));
        const db = Math.min(...groupInfo.map((gr) => Math.hypot(gr.c.x - b.x, gr.c.z - b.z)));
        return db - da || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
      const taken = new Set();
      for (const q of byId) {
        let bestGi = -1, bestD = Infinity;
        for (const gr of groupInfo) {
          if (taken.has(gr.gi)) continue;
          const d = Math.hypot(gr.c.x - q.x, gr.c.z - q.z);
          if (d < bestD) { bestD = d; bestGi = gr.gi; }
        }
        if (bestGi < 0) break;
        taken.add(bestGi);
        if (q.id === p.id) { this.preferredZone = bestGi; break; }
      }
    }
    // No zone left for us (the odd one out). Run to the NEAREST one, not to
    // `zoneOrder[0]`: defaulting to the first zone sent the leftover straight
    // onto a tile another bot had already claimed. The capacity pass still
    // decides, but a different tile is a real second chance.
    const hasClaim = this.preferredZone >= 0 && groupInfo.some((g) => g.gi === this.preferredZone);
    // No zone was left for us (N players, N-1 zones, so several can be spare).
    // Pick the nearest zone that still has room instead of the nearest zone
    // outright: the naive version sent a spare player onto a tile another bot had
    // already claimed and the capacity pass killed it on green while an empty
    // zone stood across the arena. "Room" must count players ARRIVING there, not
    // just bodies inside it: at decision time the rightful owner is usually still
    // two tiles away and the tile reads empty. A brain cannot see other brains, so
    // predict them from what a human could see too: position + velocity.
    const arrival = (g, q) => Math.hypot(g.c.x - q.x, g.c.z - q.z);
    const headingHere = (g) => view.players.filter((q) => {
      if (q.id === p.id || !q.alive) return false;
      const vx = q.vx || 0, vz = q.vz || 0;
      const sp = Math.hypot(vx, vz);
      if (sp < 0.3) return false;                    // standing still: not coming
      const toX = g.c.x - q.x, toZ = g.c.z - q.z;
      const toLen = Math.hypot(toX, toZ);
      if (toLen < 1e-6) return true;                 // already on it
      const cos = (vx * toX + vz * toZ) / (sp * toLen);
      // Moving towards this zone, and close enough to reach it before we could.
      return cos > 0.75 && toLen < Math.max(2 * TILE, sp * 1.6);
    }).length;
    const openZones = groupInfo.filter((g) => g.occupants + headingHere(g) < CAPACITY);
    const fallbackPool = openZones.length ? openZones : groupInfo;
    const myZone = hasClaim
      ? this.preferredZone
      : fallbackPool.reduce((best, g) =>
          arrival(g, p) < arrival(best, p) ? g : best,
          fallbackPool[0]).gi;

    // Already standing on the zone assigned to us? Then HOLD. Do not recompute, do
    // not "improve" anything for the rest of the round. Tracing showed bots that
    // were alone and safely on their tile (nearest rival 7 and 17 units away)
    // leaving it at full speed in the last 150 ms and burning: every re-think
    // nudged the target, the physics had no friction with an active input, and
    // they coasted off a 1-tile platform. Standing still is always the winning
    // move once you are home.
    {
      const hereT = worldToTile(p.x, p.z);
      const onMine = hereT && groupInfo[myZone]?.cells.some((c) => c.x === hereT.x && c.z === hereT.z);
      if (onMine) {
        this.target = { x: p.x, z: p.z };
        p.input = { x: 0, z: 0, jump: false, sprint: false, seq: p.input.seq + 1 };
        return this.target;
      }
    }

    // Mercy (tutorial / beginner only): if a zone would be taken and the human
    // is still far away, bots prefer another zone so the player is not boxed
    // out by pure reflex. This is how the low difficulties stay friendly.
    const mercy = this.profile.mercy || 0;
    const humanFar = mercy > 0
      ? living.find((q) => !q.isBot &&
          Math.min(...groupInfo.map((g) => Math.hypot(g.c.x - q.x, g.c.z - q.z))) > TILE * 3)
      : null;
    const humanZone = humanFar
      ? groupInfo.reduce((best, g) =>
          Math.hypot(g.c.x - humanFar.x, g.c.z - humanFar.z) <
          Math.hypot(best.c.x - humanFar.x, best.c.z - humanFar.z) ? g : best,
        groupInfo[0]).gi
      : -1;

    // Prefer: reachable in time, less contested, closer.
    const speed = 6.6 * (p.speedMul || 1);
    const scored = groupInfo.map((g) => {
      const travel = g.dist / speed;
      const canMake = travel * 1000 < timeLeft - 60;
      const capacityOk = g.size * CAPACITY > g.rivals;
      // Advanced bots weigh contention; beginners just go nearest.
      const contention = this.profile.lookahead >= 1 ? g.rivals * 2.2 : g.rivals * 0.6;
      let score = g.dist + contention * TILE;
      if (!canMake) score += 40;
      if (!capacityOk) score += this.profile.lookahead >= 1 ? 35 : 12;
      // Big incentive to take your own share of the available zones. This has to
      // outrank raw distance, otherwise two bots that start side by side both
      // prefer the same nearer zone and the greedy matching above is ignored.
      // 20 tiles of bias comfortably beats any in-arena distance (max ~15.6).
      // The odd player out has no claimed zone, so `hasClaim` is false and the
      // bonus must NOT apply — otherwise it re-locked onto a taken tile and the
      // capacity pass killed it next to a free zone.
      if (hasClaim && g.gi === myZone) score -= TILE * 20;
      // A zone somebody already stands in is a death trap, not a target.
      if (g.occupants >= CAPACITY) score += TILE * 12;
      // A zone a rival will reach before us is equally lost: arriving second
      // means dying to capacity while standing on green.
      if (this.profile.lookahead >= 1 && g.inbound >= CAPACITY) score += TILE * 9;
      // Step aside from the human's zone on easy modes.
      if (g.gi === humanZone && this.rng() < mercy) score += TILE * 4;
      score += (this.rng() - 0.5) * this.profile.jitter * 6;
      return { ...g, score };
    }).sort((a, b) => a.score - b.score);

    const choice = scored[0];
    // `view.round` is not always supplied; a missing round made this salt NaN,
    // which poisoned spotInTile and sent every bot to a NaN target (they froze
    // or drifted off the arena edge). Fall back to the round clock bucket.
    const roundKey = Number.isFinite(view.round) ? view.round : Math.floor((view.now || 0) / 1000);
    const salt = roundKey * 31 + choice.gi;
    // Pick a free cell inside the zone, avoiding one already crowded by rivals,
    // since a tile only seats CAPACITY players.
    const cellLoad = (cell) => {
      const w = tileCenter(cell.x, cell.z);
      return view.players.filter((q) =>
        q.id !== p.id && q.alive && Math.hypot(q.x - w.x, q.z - w.z) < TILE * 0.6,
      ).length;
    };
    const ordered = choice.cells
      .map((cell) => ({ cell, load: cellLoad(cell) }))
      .sort((a, b) => a.load - b.load);
    const cell = ordered[0].cell;
    const spot = spotInTile(cell, salt + String(p.id).length);
    // aim slightly inside the zone, not at the very edge
    const cx = choice.c.x, cz = choice.c.z;
    return { x: spot.x * 0.5 + cx * 0.5, z: spot.z * 0.5 + cz * 0.5 };
  }

  _drive(view) {
    const p = this.p;
    if (!p.alive || (view.phase !== 'play' && view.phase !== 'swap')) return;
    if (view.now < this.mistakeUntil) {
      // panic wiggle
      p.input = { x: Math.sin(view.now / 180) * 0.4, z: Math.cos(view.now / 210) * 0.4, jump: false, sprint: false, seq: p.input.seq + 1 };
      return;
    }
    if (!this.target) { this.target = { x: p.x, z: p.z }; }
    // A non-finite target used to send bots to (NaN, NaN): the direction became
    // NaN, movement stopped, and the soft-push shoved them off the arena edge.
    // Never let a bad target through — fall back to holding position.
    if (!Number.isFinite(this.target.x) || !Number.isFinite(this.target.z)) {
      this.target = { x: p.x, z: p.z };
    }

    let dx = this.target.x - p.x;
    let dz = this.target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < TILE * 0.22) { p.input = { x: 0, z: 0, jump: false, sprint: false, seq: p.input.seq + 1 }; return; }
    // Plan the stop like a real driver: with friction F the body coasts
    // d = v²/(2·k) after the stick is released. The bots accelerated all the way
    // in and arrived at 5.7 u/s with 0.8 tiles left, so they ploughed through
    // their own zone ((1,5) instead of the zone at (1,6)). Release the stick as
    // soon as the remaining distance is inside the braking distance, not 0.5
    // tiles from the centre.
    const speed = Math.hypot(p.vx || 0, p.vz || 0);
    const stopping = (speed * speed) / (2 * FRICTION * 4.5);
    if (d < Math.max(TILE * 0.3, stopping)) {
      p.input = { x: 0, z: 0, jump: false, sprint: false, seq: p.input.seq + 1 };
      return;
    }
    dx /= d; dz /= d;

    // Anti-stuck: if we barely moved while trying to move, hop.
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos = { x: p.x, z: p.z };
    if (moved < 0.02) this.stuckTimer += 16; else this.stuckTimer = 0;

    let jump = false;
    if (this.stuckTimer > 380 && this.jumpCooldown <= 0 && Math.abs(p.y) < 0.2) {
      jump = true; this.jumpCooldown = 500; this.stuckTimer = 0;
    }
    if (this.jumpCooldown > 0) this.jumpCooldown -= 16;

    const urgency = view.roundEndsAt ? (view.roundEndsAt - view.now) : 9999;
    const sprint = urgency < 1400 || d > TILE * 4;

    // Steering: aim to keep the current facing sane
    p.input = { x: dx, z: dz, jump, sprint, seq: p.input.seq + 1 };
  }
}

export function spawnBots(game, count, difficulty = 'intermediate', names = []) {
  const prefix = ['Lava', 'Ash', 'Ember', 'Magma', 'Cinder', 'Pyro', 'Blaze', 'Scorch'];
  const used = new Set([...game.players.values()].map((p) => p.name));
  let made = 0;
  for (let i = 0; i < count; i++) {
    let name = names[i];
    if (!name) {
      let attempt = 0;
      do {
        name = prefix[Math.floor(Math.random() * prefix.length)] + (10 + Math.floor(Math.random() * 89));
        attempt++;
      } while (used.has(name) && attempt < 20);
    }
    used.add(name);
    const id = 'bot-' + Math.random().toString(36).slice(2, 9);
    const res = game.addPlayer(id, {
      name, color: game.players.size, isBot: true, botProfile: difficulty,
      speedMul: BOT_PROFILES[difficulty]?.speed ?? 0.9,
    });
    if (res.ok) made++;
  }
  return made;
}
