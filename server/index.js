/**
 * Authoritative Node server.
 *
 * Responsibilities:
 *  - own every Game instance (rooms), run the fixed tick
 *  - broadcast snapshots; clients only render + predict
 *  - validate inputs (never trust positions, kills or winners from a browser)
 *  - handle create/join/leave/ready/start, reconnection and disconnects
 *  - serve the built client from /dist when present
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { PHASE } from '../shared/game.js';
import { MAX_PLAYERS, TICK_MS } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Optional lightweight stats endpoint
app.get('/healthz', (req, res) => res.json({ ok: true, ...manager.stats(), uptime: process.uptime() }));

const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { maxAge: '1h', index: 'index.html' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || req.path === '/healthz') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res.type('text/plain').send('THE FLOOR IS LAVA server is running. Build the client with `npm run build` to serve the game here.'));
}

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] },
  pingInterval: 8000,
  pingTimeout: 12000,
  maxHttpBufferSize: 1e5,
});

const manager = new RoomManager();

// ── Tiny per-socket rate limiter (input flooding / spam protection) ──────────
function limiter(perSecond) {
  let tokens = perSecond;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(perSecond, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const sessions = new Map(); // token -> { roomCode, name, socketId? }

io.on('connection', (socket) => {
  let room = null;
  let token = socket.handshake.auth?.token || null;
  const canInput = limiter(90);

  const sendError = (code, message) => socket.emit('error:game', { code, message });

  const broadcastLobby = (r) => {
    io.to(r.code).emit('room:update', {
      ...r.publicInfo(),
      players: r.game.fullState().players,
    });
  };

  // ── Create room ───────────────────────────────────────────────────────────
  socket.on('room:create', ({ name, roomName, isPrivate } = {}, ack) => {
    if (room) return ack?.({ ok: false, reason: 'already_in_room' });
    const created = manager.create({
      name: roomName || (isPrivate ? 'Private Arena' : 'Public Arena'),
      isPrivate: !!isPrivate,
      hostId: socket.id,
    });
    const joined = created.addMember(socket.id, name);
    if (!joined.ok) { manager.dispose(created.code); return ack?.({ ok: false, reason: joined.reason }); }
    room = created;
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.set(token, { roomCode: room.code, name: joined.name ?? name });
    socket.join(room.code);
    ack?.({ ok: true, code: room.code, token, state: room.game.fullState() });
    broadcastLobby(room);
    io.emit('rooms:list', manager.listPublic());
  });

  // ── Join room (by code) ───────────────────────────────────────────────────
  socket.on('room:join', ({ code, name, token: resume } = {}, ack) => {
    if (room) return ack?.({ ok: false, reason: 'already_in_room' });
    const target = manager.get(code);
    if (!target) return ack?.({ ok: false, reason: 'not_found' });
    const res = target.addMember(socket.id, name);
    if (!res.ok) return ack?.({ ok: false, reason: res.reason });
    room = target;
    token = resume || Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.set(token, { roomCode: room.code, name });
    socket.join(room.code);
    ack?.({ ok: true, code: room.code, token, state: room.game.fullState() });
    broadcastLobby(room);
    io.emit('rooms:list', manager.listPublic());
  });

  // ── Quick play: public room with a free seat ──────────────────────────────
  socket.on('room:quick', ({ name } = {}, ack) => {
    if (room) return ack?.({ ok: false, reason: 'already_in_room' });
    let target = manager.findJoinable();
    if (!target) {
      target = manager.create({ name: 'Public Arena', hostId: socket.id });
    }
    const res = target.addMember(socket.id, name);
    if (!res.ok) return ack?.({ ok: false, reason: res.reason });
    room = target;
    token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessions.set(token, { roomCode: room.code, name });
    socket.join(room.code);
    ack?.({ ok: true, code: room.code, token, state: room.game.fullState() });
    broadcastLobby(room);
    io.emit('rooms:list', manager.listPublic());
  });

  // Request/response room listing. Must NOT reuse the "rooms:list" push name:
  // the server broadcasts that event, and a socket that emits it would receive
  // its own pushes back as a bogus request payload.
  // Clients call this with (payload, ack) so the ack is the SECOND argument.
  const replyRooms = (payloadOrAck, maybeAck) => {
    const cb = typeof payloadOrAck === 'function' ? payloadOrAck : maybeAck;
    if (typeof cb === 'function') cb({ rooms: manager.listPublic() });
  };
  socket.on('rooms:request', replyRooms);
  socket.on('rooms:list', replyRooms);

  // ── Ready / start / leave ─────────────────────────────────────────────────
  socket.on('player:ready', ({ ready } = {}) => {
    if (!room) return;
    const p = room.game.players.get(socket.id);
    if (p) p.ready = !!ready;
    broadcastLobby(room);
  });

  socket.on('match:start', (ack) => {
    if (!room) return ack?.({ ok: false, reason: 'no_room' });
    if (room.hostId !== socket.id) return ack?.({ ok: false, reason: 'not_host' });
    if (room.game.phase !== PHASE.LOBBY) return ack?.({ ok: false, reason: 'busy' });
    if (room.members.size < 1) return ack?.({ ok: false, reason: 'empty' });
    // everyone present must be ready (host counts as ready)
    const notReady = [...room.game.players.values()].filter((p) => p.connected && !p.ready && p.id !== room.hostId);
    if (notReady.length && !room.autoStart) {
      return ack?.({ ok: false, reason: 'not_ready', who: notReady.map((p) => p.name) });
    }
    room.locked = true;
    room.game.start(Date.now());
    ack?.({ ok: true });
    io.to(room.code).emit('match:started', { seed: room.game.seed });
    broadcastLobby(room);
  });

  socket.on('match:rematch', (ack) => {
    if (!room) return ack?.({ ok: false });
    if (room.game.phase !== PHASE.RESULT && room.game.phase !== PHASE.LOBBY) return ack?.({ ok: false, reason: 'busy' });
    room.locked = true;
    room.game.seed = (Math.random() * 0xffffffff) >>> 0;
    room.game.phase = PHASE.LOBBY;
    room.game.start(Date.now());
    ack?.({ ok: true });
    io.to(room.code).emit('match:started', { seed: room.game.seed });
  });

  socket.on('room:leave', (ack) => {
    if (!room) return ack?.({ ok: true });
    const code = room.code;
    socket.leave(code);
    room.removeMember(socket.id);
    io.to(code).emit('room:update', { ...room.publicInfo(), players: room.game.fullState().players });
    io.emit('rooms:list', manager.listPublic());
    if (room.members.size === 0) manager.dispose(code);
    room = null;
    ack?.({ ok: true });
  });

  // ── Input (the only thing a client is allowed to say about itself) ────────
  socket.on('input', (frame) => {
    if (!room || !room.game) return;
    if (!canInput()) return;                     // silently drop floods
    const p = room.game.players.get(socket.id);
    if (!p) return;
    // Sanitising happens inside Game.setInput; positions are never accepted.
    room.game.setInput(socket.id, frame);
  });

  // ── Chat in lobby ─────────────────────────────────────────────────────────
  socket.on('chat', ({ text } = {}) => {
    if (!room) return;
    const clean = String(text || '').slice(0, 160).replace(/[<>&]/g, '');
    if (!clean.trim()) return;
    io.to(room.code).emit('chat', { id: socket.id, name: room.members.get(socket.id)?.name || '?', text: clean });
  });

  // ── Resume after a reload/drop ────────────────────────────────────────────
  socket.on('session:resume', ({ token: t } = {}, ack) => {
    const s = sessions.get(t);
    if (!s) return ack?.({ ok: false, reason: 'unknown_session' });
    const r = manager.get(s.roomCode);
    if (!r) return ack?.({ ok: false, reason: 'room_gone' });
    if (r.game.players.has(socket.id)) return ack?.({ ok: false, reason: 'duplicate' });
    const res = r.addMember(socket.id, s.name);
    if (!res.ok) return ack?.({ ok: false, reason: res.reason });
    room = r; token = t;
    sessions.set(t, { roomCode: r.code, name: s.name });
    socket.join(r.code);
    ack?.({ ok: true, code: r.code, state: r.game.fullState() });
    broadcastLobby(r);
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const code = room.code;
    room.removeMember(socket.id);
    io.to(code).emit('room:update', { ...room.publicInfo(), players: room.game.fullState().players });
    io.emit('rooms:list', manager.listPublic());
    if (room.members.size === 0) manager.dispose(code);
    room = null;
  });
});

// ── Authoritative tick loop (one interval for every room) ────────────────────
setInterval(() => {
  for (const room of manager.rooms.values()) {
    const g = room.game;
    if (g.phase === PHASE.LOBBY && room.members.size === 0) continue;
    g.tick(TICK_MS);
    const events = g.drainEvents();
    // Broadcast the delta every tick; layout changes carry their own payload.
    io.to(room.code).emit('tick', { s: g.tickState(), e: events.length ? events : undefined });
    for (const e of events) {
      if (e.t === 'end') io.to(room.code).emit('match:end', { winner: e.winner, standings: e.standings, round: e.round });
      if (e.t === 'lobby') {
        room.locked = false;
        for (const p of g.players.values()) p.ready = !p.isBot || p.isBot;
      }
    }
  }
}, TICK_MS).unref?.();

server.listen(PORT, () => {
  console.log(`[floor-is-lava] authoritative server on :${PORT}  (dist: ${fs.existsSync(distDir) ? 'served' : 'not built'})`);
});

export { app, server, io, manager };
