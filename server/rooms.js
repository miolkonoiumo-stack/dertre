/**
 * Room manager: rooms, codes, privacy, matchmaking.
 * Pure Node — no socket dependencies, so it is trivially testable.
 */

import { Game, PHASE } from '../shared/game.js';
import { randomSeed } from '../shared/sim.js';
import { MAX_PLAYERS, ROOM_CODE_LEN, COUNTDOWN_LOCK_MS } from '../shared/constants.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export function makeCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return s;
}

export class Room {
  constructor({ code, name = 'Arena', isPrivate = false, hostId = null }) {
    this.code = code;
    this.name = name.slice(0, 24);
    this.isPrivate = isPrivate;
    this.hostId = hostId;
    this.createdAt = Date.now();
    this.members = new Map();  // socketId -> { name, socketId, joinedAt }
    this.game = new Game({ seed: randomSeed(), roomCode: code });
    this.locked = false;
    this.lastActivity = Date.now();
  }

  addMember(socketId, name) {
    if (this.locked) return { ok: false, reason: 'locked' };
    if (this.members.size >= MAX_PLAYERS) return { ok: false, reason: 'room_full' };
    const display = String(name || 'Player').trim().slice(0, 14) || 'Player';
    this.members.set(socketId, { socketId, name: display, joinedAt: Date.now() });
    const res = this.game.addPlayer(socketId, { name: display, color: this.members.size - 1 });
    this.touch();
    return { ok: res.ok, reason: res.reason };
  }

  removeMember(socketId) {
    this.members.delete(socketId);
    this.game.removePlayer(socketId);
    if (this.hostId === socketId) {
      this.hostId = this.members.keys().next().value || null;
    }
    this.touch();
  }

  touch() { this.lastActivity = Date.now(); }

  isOpen() {
    return this.game.phase === PHASE.LOBBY && !this.locked;
  }

  publicInfo() {
    return {
      code: this.code,
      name: this.name,
      isPrivate: this.isPrivate,
      players: this.members.size,
      max: MAX_PLAYERS,
      phase: this.game.phase,
      hostId: this.hostId,
      locked: this.locked,
    };
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.sweepTimer = setInterval(() => this.sweep(), 30_000);
    this.sweepTimer.unref?.();
  }

  create({ name, isPrivate = false, hostId = null, template }) {
    let code;
    let guard = 0;
    do { code = template || makeCode(); guard++; }
    while (this.rooms.has(code) && guard < 200);
    const room = new Room({ code, name: name || `Arena ${code}`, isPrivate, hostId });
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase()) || null;
  }

  listPublic() {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate && r.phase !== 'result')
      .map((r) => r.publicInfo())
      .sort((a, b) => b.players - a.players);
  }

  findJoinable() {
    const open = [...this.rooms.values()]
      .filter((r) => !r.isPrivate && !r.locked && r.members.size < MAX_PLAYERS && r.isOpen())
      .sort((a, b) => b.members.size - a.members.size);
    return open[0] || null;
  }

  dispose(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.locked = true;
    this.rooms.delete(code);
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const empty = room.members.size === 0;
      const idle = now - room.lastActivity > 10 * 60_000;
      if ((empty && idle) || (empty && now - room.createdAt > 60_000)) {
        this.dispose(code);
      }
    }
  }

  stats() {
    return {
      rooms: this.rooms.size,
      publicRooms: [...this.rooms.values()].filter((r) => !r.isPrivate).length,
      players: [...this.rooms.values()].reduce((n, r) => n + r.members.size, 0),
    };
  }
}

export { COUNTDOWN_LOCK_MS };
