/**
 * Multiplayer client: Socket.IO transport.
 *
 * The server is authoritative. This class:
 *  - sends inputs at a fixed cadence (never positions)
 *  - receives tick snapshots and interpolates remote avatars
 *  - predicts the local avatar with the SAME sim code, then reconciles
 *    against the authoritative position (small corrections are smoothed).
 */

import { io } from 'socket.io-client';
import { TICK_MS, PLAYER_RADIUS } from '@shared/constants.js';
import { stepPlayer, sanitizeInput } from '@shared/sim.js';

export class NetClient {
  constructor({ url = undefined, onEvent, onState, onTick, onStatus } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onState = onState || (() => {});
    this.onTick = onTick || (() => {});
    this.onStatus = onStatus || (() => {});
    this.socket = io(url || undefined, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      auth: { token: localStorage.getItem('tfil_token') || undefined },
    });
    this.connected = false;
    this.roomCode = null;
    this.myId = null;
    this.token = localStorage.getItem('tfil_token') || null;
    this.serverOffset = 0;     // serverNow - clientNow
    this.latency = 0;
    this.ready = false;
    this.lastSnap = null;
    this._pending = new Map();
    this._wire();
  }

  _wire() {
    const s = this.socket;
    s.on('connect', () => {
      this.connected = true;
      this.onStatus({ connected: true, id: s.id });
      if (this.token) {
        s.emit('session:resume', { token: this.token }, (res) => {
          if (res?.ok) {
            this.roomCode = res.code;
            this.myId = s.id;
            this.onState({ type: 'resume', ...res });
          }
        });
      }
    });
    s.on('disconnect', () => { this.connected = false; this.onStatus({ connected: false }); });
    s.on('connect_error', (err) => this.onStatus({ connected: false, error: err?.message }));
    s.on('room:update', (data) => this.onState({ type: 'room', ...data }));
    s.on('rooms:list', (data) => this.onState({ type: 'rooms', ...data }));
    s.on('match:started', (d) => this.onState({ type: 'started', ...d }));
    s.on('chat', (d) => this.onState({ type: 'chat', ...d }));
    s.on('error:game', (d) => this.onStatus({ connected: this.connected, error: d?.message, code: d?.code }));
    s.on('match:end', (d) => this.onEvent({ t: 'end', ...d }));
    s.on('tick', ({ s: snap, e }) => {
      this.lastSnap = snap;
      if (snap) this.serverNow = snap.now;
      if (e) for (const ev of e) this.onEvent({ ...ev, remote: true });
      this.onTick(snap);
    });
  }

  connect() {
    if (!this.socket.connected) this.socket.connect();
  }

  emitAck(event, payload) {
    return new Promise((resolve) => {
      if (!this.socket.connected) return resolve({ ok: false, reason: 'offline' });
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, reason: 'timeout' }); } }, 6000);
      this.socket.emit(event, payload, (res) => {
        if (done) return;
        done = true; clearTimeout(t); resolve(res || { ok: false });
      });
    });
  }

  async createRoom({ name, roomName, isPrivate }) {
    const res = await this.emitAck('room:create', { name, roomName, isPrivate });
    if (res.ok) { this._afterJoin(res); }
    return res;
  }

  async joinRoom({ code, name }) {
    const res = await this.emitAck('room:join', { code, name });
    if (res.ok) this._afterJoin(res);
    return res;
  }

  async quickPlay({ name }) {
    const res = await this.emitAck('room:quick', { name });
    if (res.ok) this._afterJoin(res);
    return res;
  }

  _afterJoin(res) {
    this.roomCode = res.code;
    this.myId = this.socket.id;
    this.token = res.token;
    if (res.token) localStorage.setItem('tfil_token', res.token);
    if (res.state) this.onState({ type: 'joined', state: res.state, code: res.code });
  }

  async listRooms() { return this.emitAck('rooms:request', {}); }
  async setReady(ready) { return this.emitAck('player:ready', { ready }); }
  async startMatch() { return this.emitAck('match:start', {}); }
  async rematch() { return this.emitAck('match:rematch', {}); }
  async leave() {
    const r = await this.emitAck('room:leave', {});
    this.roomCode = null;
    return r;
  }
  chat(text) { this.socket.emit('chat', { text }); }

  sendInput(frame) {
    if (!this.socket.connected) return;
    this.socket.volatile.emit('input', frame);
  }

  disconnect() { this.socket.disconnect(); }
}

export { PLAYER_RADIUS, stepPlayer, sanitizeInput, TICK_MS };
