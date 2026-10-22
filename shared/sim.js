/**
 * Deterministic simulation core â€" shared by server (authority) and client (prediction).
 *
 * Pure functions + one stateful Sim class. No DOM, no three.js, no network.
 * Being deterministic (seeded PRNG, fixed-step physics) is what lets the client
 * predict with confidence while the server stays the single source of truth.
 */

import {
  GRID, TILE, ARENA_HALF, TILE_TOP, GAP, PLAYER_RADIUS, GRAVITY, MAX_FALL,
  WALK_SPEED, ACCEL, FRICTION, AIR_CONTROL, JUMP_SPEED, KILL_Y,
  CAPACITY, MAX_ZONE_TILES, MIN_ZONE_TILES, ROUND_MS,
} from './constants.js';

// â"€â"€ Seeded PRNG (mulberry32) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

// â"€â"€ Grid helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export const idx = (x, z) => z * GRID + x;
export const inBounds = (x, z) => x >= 0 && z >= 0 && x < GRID && z < GRID;

/** Center of tile (x,z) in world space. Tile (x,z) sits at grid origin top-left. */
export function tileCenter(x, z) {
  return {
    x: -ARENA_HALF + TILE / 2 + x * TILE,
    z: -ARENA_HALF + TILE / 2 + z * TILE,
  };
}

/** Which tile contains a world position, or null when outside the arena. */
export function worldToTile(wx, wz) {
  const x = Math.floor((wx + ARENA_HALF) / TILE);
  const z = Math.floor((wz + ARENA_HALF) / TILE);
  return inBounds(x, z) ? { x, z } : null;
}

/**
 * Solid ground test: is this world point on the *plate* of a tile?
 * Tiles are drawn with a gap between them, so the outer edge of each cell is
 * void. Physics and round resolution both use this, so what you see is what
 * kills you.
 */
export function isOnPlate(wx, wz) {
  const t = worldToTile(wx, wz);
  if (!t) return false;
  // Generous: the physics body has radius, so someone standing on the very edge
  // of a plate is still standing on it visually (and it feels fair).
  const lim = TILE / 2 + 0.01;
  const c = tileCenter(t.x, t.z);
  return Math.abs(wx - c.x) <= lim && Math.abs(wz - c.z) <= lim;
}

/** Is this world point over a safe tile? `safe` is a Uint8Array of GRID*GRID. */
export function isSafeAt(safe, wx, wz) {
  const t = worldToTile(wx, wz);
  return !!t && safe[idx(t.x, t.z)] === 1;
}

/** Connected components of safe tiles (4-neighbourhood). Returns arrays of indices. */
export function safeGroups(safe) {
  const seen = new Uint8Array(GRID * GRID);
  const groups = [];
  for (let i = 0; i < GRID * GRID; i++) {
    if (!safe[i] || seen[i]) continue;
    const group = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      group.push(c);
      const cx = c % GRID, cz = (c / GRID) | 0;
      const nb = [];
      if (cx > 0) nb.push(c - 1);
      if (cx < GRID - 1) nb.push(c + 1);
      if (cz > 0) nb.push(c - GRID);
      if (cz < GRID - 1) nb.push(c + GRID);
      for (const n of nb) {
        if (safe[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Build the safe-tile mask for `alive` players.
 *
 * Rule: exactly (alive - 1) safe ZONES, minimum one. Each zone is a blob of
 * tiles (>= MIN, <= MAX). With 1 player left we still produce one zone (game is
 * already over at that point, but the visual stays coherent).
 *
 * Guarantees we enforce before returning a layout:
 *  - number of zones === required
 *  - zone tile count <= MAX_ZONE_TILES so a zone never becomes half the arena
 *  - the tiles of the biggest zone can hold everyone currently safe, so a
 *    contested round is winnable by out-running, not by math
 *  - layout differs from the previous one (no "nothing happened" rounds)
 */
export function generateLayout(aliveCount, rng, prevSafe = null, attempt = 0, anchors = null) {
  const required = Math.max(1, aliveCount - 1);
  const safe = new Uint8Array(GRID * GRID);

  // 1. Pick `required` seeds with farthest-point sampling so zones spread out.
  //    When we know where players are standing, the first seeds are drawn from
  //    around them: a zone nobody can reach in ROUND_MS just kills the room.
  const seeds = [];
  // Only require a real separation when zones are few; with many zones we need
  // all the room we can get.
  const minSep = required <= 2 ? 4 : required <= 4 ? 3 : 2;
  if (anchors && anchors.length) {
    // Zones must ROTATE. The old code seeded the first zones straight onto the
    // players' own tiles, so the floor barely moved between rounds (measured: a
    // 1.11 tile average shift) and an idle player won by standing still.
    // Now the seeds are drawn uniformly at random; the only thing we keep from
    // the anchors is a reachability filter: a zone nobody can cross to in one
    // round is just a room-wide execution.
    // Reachability budget, in tiles: how far a player can actually run during
    // one round. This used to be `MAX_ZONE_TILES * 2`, which after zones became
    // a single tile meant "within 2 tiles of a player" — every zone piled on top
    // of the spawn ring. Now it derives from real movement, but counting only the
    // time a player ACTUALLY has: a human needs ~1.2s to read the new layout and
    // react, and pathing is never a straight sprint. Using the full ROUND_MS at
    // full speed produced corner zones 12 tiles away that nobody reached (round 1
    // went 6 players -> 1).
    const usableMs = ROUND_MS - 1200;                       // minus reaction
    const reachTiles = Math.max(2, Math.floor((WALK_SPEED * (usableMs / 1000) * 0.55) / TILE));
    const reach = reachTiles;   // hard cap: the check below is the real gate
    const distTo = (c) => {
      let best = Infinity;
      for (const a of anchors) best = Math.min(best, Math.abs(a.x - c.x) + Math.abs(a.z - c.z));
      return best;
    };
    const candidates = [];
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const d = distTo({ x, z });
        if (d <= reach) candidates.push({ x, z, r: rng(), d });
      }
    }
    // Uniformly random order: no bias toward being near a player.
    candidates.sort((a, b) => a.r - b.r);
    for (const c of candidates) {
      if (seeds.length >= required) break;
      if (seeds.some((s) => Math.max(Math.abs(s.x - c.x), Math.abs(s.z - c.z)) < minSep)) continue;
      seeds.push({ x: c.x, z: c.z });
    }
    // Fallback: if the separation filter starved us, relax it and refill from the
    // same random pool before falling through to the pure-random filler below.
    if (seeds.length < required) {
      for (const c of candidates) {
        if (seeds.length >= required) break;
        if (seeds.some((s) => s.x === c.x && s.z === c.z)) continue;
        seeds.push({ x: c.x, z: c.z });
      }
    }
  }
  if (!seeds.length) {
    seeds.push({ x: Math.floor(rng() * GRID), z: Math.floor(rng() * GRID) });
  }

  let guard = 0;
  while (seeds.length < required && guard++ < 400) {
    // Candidate pool: 24 random cells, keep the one farthest from existing seeds.
    let best = null, bestD = -1;
    for (let k = 0; k < 24; k++) {
      const x = Math.floor(rng() * GRID);
      const z = Math.floor(rng() * GRID);
      let d = Infinity;
      for (const s of seeds) d = Math.min(d, Math.abs(s.x - x) + Math.abs(s.z - z));
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    // The zone count is a hard rule: (alive - 1) zones. Separation is only a
    // nicety, so relax it progressively instead of giving up short.
    const relax = guard > 200 ? 1 : minSep;
    if (bestD >= relax) { seeds.push(best); continue; }
    if (bestD >= 1) { seeds.push(best); continue; }
    seeds.push({ x: Math.floor(rng() * GRID), z: Math.floor(rng() * GRID) });
  }
  // Absolute guarantee, even if the random search failed: pad with cells that
  // are not already seeds, scanning the grid deterministically.
  if (seeds.length < required) {
    const taken = new Set(seeds.map((s) => s.z * GRID + s.x));
    for (let i = 0; i < GRID * GRID && seeds.length < required; i++) {
      if (taken.has(i)) continue;
      seeds.push({ x: i % GRID, z: (i / GRID) | 0 });
      taken.add(i);
    }
  }

  // 2. Grow each seed into a blob, growing the *smallest* zone each step so the
  //    sizes stay balanced and no two zones ever touch.
  const blobs = seeds.map((s) => [{ x: s.x, z: s.z }]);
  const owner = new Int16Array(GRID * GRID).fill(-1);
  blobs.forEach((cells, i) => { owner[idx(cells[0].x, cells[0].z)] = i; });

  const zoneTarget = (i) => {
    // Bigger budgets when few zones, small bites when many — but never more than
    // MAX_ZONE_TILES. With single-tile zones (MAX_ZONE_TILES = 1) this must be
    // exactly 1, otherwise the first zone always grew to 2 tiles and the player
    // saw "3 cuadros por jugador" instead of one tile per player.
    const base = required <= 2 ? 6 : required <= 4 ? 4 : 2;
    return Math.min(MAX_ZONE_TILES, base + (i % 2 === 0 ? 1 : 0));
  };

  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < blobs.length; i++) {
      const cells = blobs[i];
      if (cells.length >= zoneTarget(i) || cells.length >= MAX_ZONE_TILES) continue;
      // Collect the free 4-neighbours of every cell in this zone.
      const frontier = [];
      for (const c of cells) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.x + dx, nz = c.z + dz;
          if (!inBounds(nx, nz)) continue;
          const id = idx(nx, nz);
          if (owner[id] !== -1) continue;
          // Must not touch another zone diagonally (keeps groups disjoint).
          let touches = false;
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const tx = nx + ox, tz = nz + oz;
            if (inBounds(tx, tz) && owner[idx(tx, tz)] !== -1 && owner[idx(tx, tz)] !== i) { touches = true; break; }
          }
          if (touches) continue;
          frontier.push({ x: nx, z: nz });
        }
      }
      if (!frontier.length) continue;
      const pick = frontier[Math.floor(rng() * frontier.length)];
      owner[idx(pick.x, pick.z)] = i;
      cells.push(pick);
      grew = true;
    }
  }

  for (let i = 0; i < owner.length; i++) if (owner[i] !== -1) safe[i] = 1;

  // 3. Verify. If zones merged anyway (diagonal contact), rebuild the layout as
  //    single isolated tiles. A layout that is one zone short directly kills a
  //    player who had nowhere safe to stand, so this must be airtight: we keep
  //    the seeds where they are (they sit under players) and only nudge them by
  //    a neighbouring cell as a last resort.
  let groups = safeGroups(safe);
  // Rebuild only when the ZONE COUNT is wrong. The old check also forced a
  // rebuild whenever a player was not standing on (or next to) a zone - and
  // that rebuild was deterministic, anchored to the players' tiles. Result: the
  // floor reproduced the same few patches every round (measured 0.13 tile
  // average shift, with different seeds giving byte-identical layouts).
  // Reachability is already handled when the seeds are chosen, so we no longer
  // need to re-tie the floor to where people happen to be standing.
  if (groups.length !== required) {
    // Deterministic rebuild. Priority order matters more than aesthetics here:
    // every living player standing on the new layout beats pretty spacing.
    //   1. put a tile on each anchor (players keep their ground),
    //   2. then add isolated tiles until the zone count matches,
    //   3. finally grow blob-free single tiles only as needed.
    safe.fill(0);
    const chosen = [];
    const occupied = () => new Set(chosen.map((c) => c.z * GRID + c.x));
    const add = (x, z) => {
      x = Math.max(0, Math.min(GRID - 1, Math.round(x)));
      z = Math.max(0, Math.min(GRID - 1, Math.round(z)));
      const k = z * GRID + x;
      if (occupied().has(k)) return false;
      chosen.push({ x, z });
      return true;
    };
    const isolated = (x, z) => {
      for (const c of chosen) if (c.x === x && c.z === z) return false;
      // Adjacent to nothing: keeps the group count exact.
      for (const c of chosen) if (Math.abs(c.x - x) + Math.abs(c.z - z) < 2) return false;
      return true;
    };

    // 1. Seed completely at random, biased only toward REACHABLE cells. Do not
    //    place a tile under each anchor: that pinned the floor to the players
    //    and made every round look the same. A living player does not need safe
    //    ground under their feet at swap time - they need a zone they can cross
    //    to within the round.
    const reach = MAX_ZONE_TILES * 2;
    const reachable = (x, z) => {
      if (!anchors || !anchors.length) return true;
      return anchors.some((a) => Math.abs(a.x - x) + Math.abs(a.z - z) <= reach);
    };
    {
      // Uniform random pass over all in-arena tiles, then a reachable-only pass.
      const all = [];
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) all.push({ x, z, r: rng() });
      all.sort((a, b) => a.r - b.r);
      for (const c of all) {
        if (chosen.length >= required) break;
        if (!reachable(c.x, c.z)) continue;
        if (!isolated(c.x, c.z)) continue;
        add(c.x, c.z);
      }
      for (const c of all) {
        if (chosen.length >= required) break;
        if (!reachable(c.x, c.z)) continue;
        if (chosen.some((p) => p.x === c.x && p.z === c.z)) continue;
        add(c.x, c.z);
      }
    }

    // 2. Trim to the required count only if we somehow overshot.
    while (chosen.length > required) chosen.pop();

    // 3. Top up with isolated tiles picked as far from existing zones as we can.
    let guard = 0;
    while (chosen.length < required && guard++ < 600) {
      let best = null, bestD = -1;
      for (let k = 0; k < 40; k++) {
        const x = Math.floor(rng() * GRID), z = Math.floor(rng() * GRID);
        if (!isolated(x, z)) continue;
        let d = Infinity;
        for (const c of chosen) d = Math.min(d, Math.abs(c.x - x) + Math.abs(c.z - z));
        if (d > bestD) { bestD = d; best = { x, z }; }
      }
      if (best) { add(best.x, best.z); continue; }
      // No isolated cell left: allow adjacency (zones merge, but nobody dies).
      for (let i = 0; i < GRID * GRID; i++) {
        const x = i % GRID, z = (i / GRID) | 0;
        if (occupied().has(z * GRID + x)) continue;
        add(x, z);
        break;
      }
    }
    for (const c of chosen) safe[idx(c.x, c.z)] = 1;
    groups = safeGroups(safe);
  }

  // 4. Every survivor must have a real chance: at least one zone must be able
  //    to seat a fair share of the living players.
  if (groups.length) {
    const need = Math.min(aliveCount, Math.ceil(aliveCount / groups.length));
    let biggest = groups.reduce((a, b) => (a.length >= b.length ? a : b));
    let tries = 0;
    while (biggest.length * CAPACITY < need && tries++ < 40) {
      const frontier = [];
      for (const i of biggest) {
        const x = i % GRID, z = (i / GRID) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (inBounds(nx, nz) && !safe[idx(nx, nz)]) frontier.push(idx(nx, nz));
        }
      }
      if (!frontier.length) break;
      safe[frontier[Math.floor(rng() * frontier.length)]] = 1;
      const g2 = safeGroups(safe);
      if (g2.length !== groups.length) break;   // growing would merge zones
      groups = g2;
      biggest = groups.reduce((a, b) => (a.length >= b.length ? a : b));
    }
  }

  // 5. Never repeat the previous layout.
  //    The old bar was "6 differing tiles out of 144", which a layout could clear
  //    while leaving the zones essentially in place. Require that most of the
  //    previous floor changed, so the safe zones genuinely relocate.
  if (prevSafe && attempt < 8) {
    let diff = 0;
    for (let i = 0; i < safe.length; i++) if (safe[i] !== prevSafe[i]) diff++;
    const prevTiles = prevSafe.reduce((a, b) => a + b, 0);
    // Something close to a total repaint, not just "some tiles moved".
    const need = Math.max(GRID * 5, Math.ceil(prevTiles * 0.95));
    if (diff < need) return generateLayout(aliveCount, rng, prevSafe, attempt + 1, anchors);
  }

  // 6. Absolute fallback: never hand out an empty arena.
  if (safeGroups(safe).length === 0) {
    const c = (GRID - 1) / 2;
    safe[idx(Math.round(c), Math.round(c))] = 1;
  }

  // 4. (Count guarantee moved to the end of the function.)

  // 5. Fatten every zone so a real player has room to stand. Single-tile zones
  //    were the cause of "I was on green and it killed me": with CAPACITY = 1 a
  //    second body on that one tile is eliminated even though the floor under
  //    them is green. Grow each zone to at least MIN_ZONE_TILES connected tiles,
  //    adding only cells that touch the existing zone so the group count never
  //    changes.
  {
    const groups = safeGroups(safe);
    // Owner map: which zone index each safe cell belongs to (-1 = none).
    const owner = new Int16Array(GRID * GRID).fill(-1);
    groups.forEach((g, gi) => { for (const i of g) owner[i] = gi; });
    const touchesOther = (k, gi) => {
      const x = k % GRID, z = (k / GRID) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= GRID || nz < 0 || nz >= GRID) continue;
        const o = owner[idx(nx, nz)];
        if (o >= 0 && o !== gi) return true;   // would merge two zones
      }
      return false;
    };
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      if (g.length >= MIN_ZONE_TILES) continue;
      const cells = new Set(g);
      let guard = 0;
      while (cells.size < MIN_ZONE_TILES && guard++ < 60) {
        const cand = [];
        for (const i of cells) {
          const x = i % GRID, z = (i / GRID) | 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nx >= GRID || nz < 0 || nz >= GRID) continue;
            const k = idx(nx, nz);
            if (owner[k] >= 0) continue;      // already a zone cell
            if (cells.has(k)) continue;
            if (touchesOther(k, gi)) continue; // keep zones disjoint
            cand.push(k);
          }
        }
        if (!cand.length) {
          // Boxed in by other zones: this zone can never reach MIN_ZONE_TILES.
          // Move it to a free pocket elsewhere instead of leaving a 1-tile trap.
          // The pocket must have MIN_ZONE_TILES contiguous free cells that do not
          // touch any other zone, otherwise moving it merges two zones and the
          // "living - 1" count silently drops.
          const freeForBlob = (x, z) => {
            const cells2 = [];
            const tryAdd = (cx, cz) => {
              if (cx < 0 || cx >= GRID || cz < 0 || cz >= GRID) return false;
              if (safe[idx(cx, cz)]) return false;
              for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const tx = cx + ox, tz = cz + oz;
                if (tx < 0 || tx >= GRID || tz < 0 || tz >= GRID) continue;
                const o = owner[idx(tx, tz)];
                if (o >= 0 && o !== gi) return false;   // would fuse zones
              }
              cells2.push([cx, cz]);
              return true;
            };
            if (!tryAdd(x, z)) return null;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
              if (cells2.length >= MIN_ZONE_TILES) break;
              const nx = x + dx, nz = z + dz;
              if (cells2.some(([cx, cz]) => cx === nx && cz === nz)) continue;
              tryAdd(nx, nz);
            }
            return cells2.length >= MIN_ZONE_TILES ? cells2 : null;
          };
          const spots = [];
          for (let z = 0; z < GRID; z++) {
            for (let x = 0; x < GRID; x++) {
              const blob = freeForBlob(x, z);
              if (blob) spots.push({ blob, r: rng() });
            }
          }
          if (spots.length) {
            spots.sort((a, b) => a.r - b.r);
            for (const i of cells) { safe[i] = 0; owner[i] = -1; }
            cells.clear();
            for (const [cx, cz] of spots[0].blob) {
              const k = idx(cx, cz);
              cells.add(k); safe[k] = 1; owner[k] = gi;
            }
            continue;
          }
          break;
        }
        let best = cand[0], bestD = Infinity;
        for (const k of cand) {
          const x = k % GRID, z = (k / GRID) | 0;
          let d = Infinity;
          for (const a of anchors || []) d = Math.min(d, Math.abs(a.x - x) + Math.abs(a.z - z));
          if (!anchors || !anchors.length) d = 0;
          if (d < bestD) { bestD = d; best = k; }
        }
        cells.add(best);
        owner[best] = gi;
        safe[best] = 1;
      }
    }
  }

  // 6. Never hand back a layout that is basically the previous one. Zones must
  //    RELOCATE every round - otherwise standing still wins the match, which is
  //    the single most obvious way this game can feel broken. If the retries
  //    above could not produce a real repaint, fall through to the random lattice
  //    rebuild instead of returning a near-copy.
  if (prevSafe) {
    let diff = 0;
    for (let i = 0; i < safe.length; i++) if (safe[i] !== prevSafe[i]) diff++;
    if (diff < Math.max(GRID * 4, 24)) {
      // Place whole BLOBS on ground the previous round did not use, instead of
      // single cells. Single-cell placement produced one-tile zones after a
      // forced repaint, which is the "green floor killed me" trap.
      safe.fill(0);
      const want = Math.max(1, aliveCount - 1);
      const own = new Int16Array(GRID * GRID).fill(-1);
      const free = (x, z) => x >= 0 && x < GRID && z >= 0 && z < GRID && !prevSafe[idx(x, z)] && !safe[idx(x, z)];
      const seeds6 = [];
      const order = [];
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) order.push({ x, z, r: rng() });
      order.sort((a, b) => a.r - b.r);
      for (const c of order) {
        if (seeds6.length >= want) break;
        if (c.x < 1 || c.x >= GRID - 1 || c.z < 1 || c.z >= GRID - 1) continue;
        if (!free(c.x, c.z)) continue;
        // Need MIN_ZONE_TILES free neighbours that are also off the old floor.
        let room = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (free(c.x + dx, c.z + dz) && !prevSafe[idx(c.x + dx, c.z + dz)]) room++;
        }
        if (room < MIN_ZONE_TILES - 1) continue;
        if (seeds6.some((p) => Math.abs(p.x - c.x) + Math.abs(p.z - c.z) < 2)) continue;
        seeds6.push(c);
      }
      if (seeds6.length === want) {
        seeds6.forEach((s, gi) => { own[idx(s.x, s.z)] = gi; safe[idx(s.x, s.z)] = 1; });
        const blobs = seeds6.map((s) => [[s.x, s.z]]);
        for (let gi = 0; gi < blobs.length; gi++) {
          let g6 = 0;
          while (blobs[gi].length < MIN_ZONE_TILES && g6++ < 30) {
            const cand6 = [];
            for (const [cx, cz] of blobs[gi]) {
              for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, nz = cz + dz;
                if (!free(nx, nz)) continue;
                let touches = false;
                for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                  const tx = nx + ox, tz = nz + oz;
                  if (tx < 0 || tx >= GRID || tz < 0 || tz >= GRID) continue;
                  const o = own[idx(tx, tz)];
                  if (o >= 0 && o !== gi) { touches = true; break; }
                }
                if (!touches) cand6.push([nx, nz]);
              }
            }
            if (!cand6.length) break;
            const pick = cand6[Math.floor(rng() * cand6.length)];
            blobs[gi].push(pick);
            safe[idx(pick[0], pick[1])] = 1;
            own[idx(pick[0], pick[1])] = gi;
          }
        }
        const g6 = safeGroups(safe);
        // If the repaint could not stay clean, drop it and let step 7 repair:
        // a correct count with fat zones beats a pretty repaint.
        if (g6.length !== want || g6.some((g) => g.length < MIN_ZONE_TILES)) safe.fill(0);
      }
    }
  }

  // 7. FINAL HARD GUARANTEE - runs last so nothing above can undo it.
  //    The zone count is the core rule: N living players => exactly N-1 zones.
  //    Everything before this can drift (fattening merges neighbours, relocation
  //    lands next to another zone), so verify against the FINISHED layout and
  //    repair.
  {
    const want = Math.max(1, aliveCount - 1);
    const current = safeGroups(safe);
    const oversize = current.some((g) => g.length > MAX_ZONE_TILES);
    if (current.length !== want || oversize) {
      // Rebuild with exactly `want` SINGLE tiles, spread out and reachable.
      // With one tile per player there is no room for mistakes: an extra tile
      // merges two zones, and an unreachable tile is an unavoidable death.
      const order = [];
      for (let z = 0; z < GRID; z++) {
        for (let x = 0; x < GRID; x++) order.push({ x, z, r: rng() });
      }
      // Reachability is non-negotiable when zones are a single tile: a player
      // must be able to cross to it inside one round. Calibrated on the walk
      // speed actually available, with a real margin: the old 0.92 of MAX speed
      // assumed a perfect diagonal sprint and produced zones nobody could reach.
      const canCross = WALK_SPEED * ((ROUND_MS - 1200) / 1000) * 0.6;
      const near = anchors && anchors.length
        ? (c) => anchors.some((a) => Math.hypot(a.x - c.x, a.z - c.z) * TILE <= canCross)
        : () => true;
      order.sort((a, b) => (near(b) ? 1 : 0) - (near(a) ? 1 : 0) || a.r - b.r);

      const build = (minSep) => {
        const picked = [];
        for (const c of order) {
          if (picked.length >= want) break;
          if (!near(c)) continue;
          if (picked.some((p) => Math.abs(p.x - c.x) + Math.abs(p.z - c.z) < minSep)) continue;
          picked.push(c);
        }
        return picked.length === want ? picked : null;
      };
      let picked = build(2) || build(1);
      if (!picked) {
        // Last resort: spaced lattice, ignoring reachability to keep the count.
        picked = [];
        for (let z = 0; z < GRID && picked.length < want; z += 2) {
          for (let x = 0; x < GRID && picked.length < want; x += 2) picked.push({ x, z });
        }
      }
      safe.fill(0);
      for (const c of picked) safe[idx(c.x, c.z)] = 1;
    }
  }

  return safe;
}
/** Deterministic point inside a tile, nudged by a stable per-player hash. */
export function spotInTile(tile, salt) {
  const c = tileCenter(tile.x, tile.z);
  // Guard the salt: a NaN seed produced NaN coordinates, which froze bots and
  // shoved them off the arena. Always fall back to a valid deterministic seed.
  const s = Number.isFinite(salt) ? salt : 1;
  const r = makeRng((s * 2654435761) >>> 0);
  const lim = TILE * 0.24;
  return { x: c.x + (r() * 2 - 1) * lim, z: c.z + (r() * 2 - 1) * lim };
}

/**
 * Resolve which players survive a round.
 *
 * Every player is tested against their REAL position at the end of the swap.
 * On a contested zone (more bodies than capacity allows) we break ties with a
 * deterministic key so all clients and the server agree:
 *   1. players fully inside the zone tile set
 *   2. then by distance to the zone centroid (closer wins)
 *   3. then by id (stable)
 */
export function resolveRound(players, safe) {
  const groups = safeGroups(safe);
  const alive = players.filter((p) => p.alive);
  const survivors = [];
  const eliminated = [];

  for (const p of alive) {
    // Must be over a safe tile *plate* (not the gap) and not mid-jump.
    const grounded = p.y <= TILE_TOP + 0.9;
    if (!grounded || !isOnPlate(p.x, p.z) || !isSafeAt(safe, p.x, p.z)) {
      eliminated.push(p.id);
      continue;
    }
    survivors.push(p);
  }

  // Capacity pass: per zone, count the survivors standing on it and keep at most
  // CAPACITY. This used to build a `byIndex` Map keyed by tile, which SILENTLY
  // DROPPED a player whenever two of them shared a tile: the map kept the last
  // writer only, so a second player on the same green tile fell through to the
  // "must be eliminated" sweep at the bottom and died while standing on safety.
  // Occupancy is now resolved per zone with an explicit contender list.
  const keep = new Set();
  const losers = [];
  for (const group of groups) {
    const cellSet = new Set(group);
    const contenders = survivors.filter((s) => {
      const t = worldToTile(s.x, s.z);
      return t && cellSet.has(idx(t.x, t.z));
    });
    if (!contenders.length) continue;
    if (contenders.length <= CAPACITY) {
      for (const c of contenders) keep.add(c.id);
      continue;
    }
    // Contested zone: keep the CAPACITY players closest to its centre, with a
    // deterministic tiebreak so every client and the server agree.
    let cxs = 0, czs = 0;
    for (const i of group) { const c = tileCenter(i % GRID, (i / GRID) | 0); cxs += c.x; czs += c.z; }
    cxs /= group.length; czs /= group.length;
    const ranked = contenders
      .map((p) => ({ p, d: Math.hypot(p.x - cxs, p.z - czs) + Math.hypot(p.z, p.x) * 1e-9 }))
      .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
    for (const r of ranked.slice(0, CAPACITY)) keep.add(r.p.id);
    for (const r of ranked.slice(CAPACITY)) losers.push(r.p);
  }

  // A player who lost a contested tile is NOT burned automatically: with N alive
  // and N-1 zones somebody is always the odd one out, but if a perfectly good
  // zone is standing empty, killing them next to it is what produced "two deaths
  // in one round". Hand the extra players to the free zones first; only the ones
  // still unplaced are eliminated. This keeps the rule honest (exactly one death
  // while the counts allow it) without letting a bot's mistake execute a second
  // player who actually made it to safety.
  for (const p of losers) {
    let bestGi = null, bestD = Infinity;
    for (const group of groups) {
      const cellSet = new Set(group);
      const here = survivors.filter((s) => {
        const t = worldToTile(s.x, s.z);
        return t && cellSet.has(idx(t.x, t.z));
      });
      const filled = here.length - here.filter((s) => s.id === p.id).length;
      if (filled >= CAPACITY) continue;
      let cxs = 0, czs = 0;
      for (const i of group) { const c = tileCenter(i % GRID, (i / GRID) | 0); cxs += c.x; czs += c.z; }
      cxs /= group.length; czs /= group.length;
      const d = Math.hypot(p.x - cxs, p.z - czs);
      if (d < bestD) { bestD = d; bestGi = group; }
    }
    if (bestGi && bestD < TILE * 1.6) {
      // Close enough to count as standing on it: the tile is empty and they are
      // on its edge, so the round saves them instead of burning them.
      keep.add(p.id);
    } else {
      eliminated.push(p.id);
    }
  }

  // Anyone who was over a safe plate but lost their zone to capacity is already
  // in `eliminated`. Everybody else survived — do NOT sweep them out.
  return { survivors: survivors.filter((s) => keep.has(s.id)).map((p) => p.id), eliminated };
}

/**
 * Which zone (group index) each living player is inside, and how many are on
 * each zone. Used by the client to paint a zone red when it is already taken,
 * so "two people in one green zone" is visible instead of a surprise death.
 * @returns {{ byPlayer: Record<string, number>, counts: number[] }}
 */
export function zoneOccupancy(players, safe) {
  const groups = safeGroups(safe);
  const cellToGroup = new Map();
  groups.forEach((g, gi) => { for (const i of g) cellToGroup.set(i, gi); });
  const byPlayer = {};
  const counts = new Array(groups.length).fill(0);
  for (const p of players) {
    if (!p.alive || !p.connected) continue;
    const t = worldToTile(p.x, p.z);
    const gi = t ? cellToGroup.get(idx(t.x, t.z)) : undefined;
    if (gi === undefined) { byPlayer[p.id] = -1; continue; }
    byPlayer[p.id] = gi;
    counts[gi]++;
  }
  return { byPlayer, counts };
}

/** Replace players with dead ones removed from the moving set (spectators). */
export function applyEliminations(state, ids) {
  for (const id of ids) {
    const p = state.players[id];
    if (!p || !p.alive) continue;
    p.alive = false;
    p.vx = 0; p.vz = 0; p.vy = Math.min(p.vy, 0);
    p.deathAt = state.now;
  }
}

// â"€â"€ Player physics step (identical on client and server) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function stepPlayer(p, input, dt, safe, allPlayers) {
  if (!p.alive) {
    // Spectator: keep falling but ignore input.
    input = { x: 0, z: 0, jump: false };
  }

  // Ground probe: are we standing on a tile (safe or not does not affect physics)
  const onGround = p.y <= TILE_TOP + 0.001 && p.vy <= 0.001;
  const inArenaTile = !!worldToTile(p.x, p.z);

  const speedMul = input.sprint ? 1.18 : 1.0;
  const maxSpeed = WALK_SPEED * (p.speedMul || 1) * speedMul;
  const accel = onGround ? ACCEL : ACCEL * AIR_CONTROL;
  const friction = onGround ? FRICTION : 0.4;

  let ax = (input.x || 0), az = (input.z || 0);
  const len = Math.hypot(ax, az);
  if (len > 1) { ax /= len; az /= len; }

  p.vx += ax * accel * dt;
  p.vz += az * accel * dt;

  if (len < 0.01) {
    const damp = Math.exp(-friction * dt);
    p.vx *= damp; p.vz *= damp;
  } else {
    // clamp to max speed
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > maxSpeed) { const k = maxSpeed / sp; p.vx *= k; p.vz *= k; }
  }

  if (input.jump && onGround && p.alive) {
    p.vy = JUMP_SPEED;
    p.y += 0.001;
  }
  p.vy -= GRAVITY * dt;
  if (p.vy < -MAX_FALL) p.vy = -MAX_FALL;

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.y += p.vy * dt;

  // Land on the arena slab if over a tile plate
  if (p.y <= TILE_TOP && isOnPlate(p.x, p.z)) {
    p.y = TILE_TOP;
    if (p.vy < 0) p.vy = 0;
  }

  // Arena edge: falling off is allowed (that is how people die), no invisible walls.
  if (p.y < KILL_Y && p.alive) {
    p.alive = false;
    p.fellOff = true;
  }

  // Player-vs-player separation (soft push, prevents overlap stacking)
  if (allPlayers) {
    for (const q of allPlayers) {
      if (q === p) continue;
      const dx = p.x - q.x, dz = p.z - q.z;
      const d2 = dx * dx + dz * dz;
      const min = PLAYER_RADIUS * 2;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
  }

  // Face travel direction
  if (p.vx * p.vx + p.vz * p.vz > 0.25) {
    p.rot = Math.atan2(p.vx, p.vz);
  }
  return p;
}

/**
 * Validate a client input frame. Anything malformed is neutralised rather than
 * trusted â€" this is the clientâ†'server boundary.
 */
export function sanitizeInput(input) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  return {
    x: num(input?.x),
    z: num(input?.z),
    jump: !!input?.jump,
    sprint: !!input?.sprint,
    seq: Number.isFinite(input?.seq) ? input.seq : 0,
  };
}


