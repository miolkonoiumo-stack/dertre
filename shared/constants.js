/**
 * Shared simulation constants.
 * Used verbatim by the authoritative server AND the three.js client,
 * so physics stays identical on both sides (client = prediction, server = truth).
 */

// ── Arena grid ────────────────────────────────────────────────────────────────
export const GRID = 12;                 // 12 x 12 tiles
export const TILE = 2.4;                // tile edge (world units)
export const GAP = 0.12;                // visual gap between tiles
export const ARENA_HALF = (GRID * TILE) / 2;
export const TILE_TOP = 0;              // walking surface height

// Safe-zone rules: a tile can hold at most this many survivors.
// One player per safe group. The rule "safe zones = living players - 1" only
// removes somebody each round if a zone can hold a single player: with capacity
// 2 and 5 zones, six players all fit and the match never ends.
export const CAPACITY = 1;
// A safe zone is a group of connected safe tiles. Max group size (tiles).
export const MAX_ZONE_TILES = 1;       // one SINGLE tile per safe zone; no blobs
export const MIN_ZONE_TILES = 1;       // N living players => exactly N-1 single tiles

// ── Round timing (ms) ─────────────────────────────────────────────────────────
export const ROUND_MS = 5000;           // 5s, exactly as the user described the cycle
                                        // ("el contador de 5 segundos empieza a descontar")
export const WARNING_MS = 5000;         // The safe zones are visible for the WHOLE round:
                                        // they appear, the 5s counter runs, and whoever is
                                        // not on one explodes. No hidden swap, no guess.
export const SWAP_MS = 650;             // lava crossing animation window
export const COUNTDOWN_MS = 3200;       // 3-2-1-GO
export const END_MS = 9000;             // results screen duration

// ── Player physics (units = meters, seconds) ──────────────────────────────────
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.7;
export const WALK_SPEED = 6.6;
export const AIR_CONTROL = 0.55;
export const ACCEL = 62;                // ground acceleration
export const FRICTION = 12;             // ground damping
export const GRAVITY = 26;
export const JUMP_SPEED = 9.2;
export const MAX_FALL = 45;
export const KILL_Y = -9;               // fell off the arena

// Server tick
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

// ── Rooms ─────────────────────────────────────────────────────────────────────
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS_START = 1;     // solo start allowed (practice)
export const ROOM_CODE_LEN = 5;
export const COUNTDOWN_LOCK_MS = 2500;

// ── Colors (kept in sync with client materials) ───────────────────────────────
export const PALETTE = [
  { name: 'Neon Lime',   body: '#8bff3d', accent: '#1f7a00' },
  { name: 'Plasma Cyan', body: '#3df0ff', accent: '#00556b' },
  { name: 'Magma Pink',  body: '#ff3d8b', accent: '#6b003a' },
  { name: 'Solar Gold',  body: '#ffcc3d', accent: '#6b4e00' },
  { name: 'Violet Pulse',body: '#b45cff', accent: '#3b006b' },
  { name: 'Ice White',   body: '#e8f3ff', accent: '#4a6280' },
  { name: 'Rust Orange', body: '#ff7a29', accent: '#6b2a00' },
  { name: 'Deep Teal',   body: '#29ffc7', accent: '#006b52' },
];

export const BOT_PROFILES = {
  // Five difficulty modes. `errChance` is the per-decision blunder chance,
  // `lookahead` lets bots reason about contested zones, `speed` scales movement.
  tutorial:    { reactionMs: 1100, jitter: 0.75, lookahead: 0,   speed: 0.62, errChance: 0.55, mercy: 0.35 },
  beginner:    { reactionMs: 900,  jitter: 0.55, lookahead: 0,   speed: 0.74, errChance: 0.35, mercy: 0.15 },
  intermediate:{ reactionMs: 520,  jitter: 0.30, lookahead: 0,   speed: 0.86, errChance: 0.14, mercy: 0.04 },
  advanced:    { reactionMs: 300,  jitter: 0.14, lookahead: 1,   speed: 0.95, errChance: 0.05, mercy: 0 },
  expert:      { reactionMs: 170,  jitter: 0.06, lookahead: 2,   speed: 1.0,  errChance: 0.01, mercy: 0 },
};
