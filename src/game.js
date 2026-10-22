/**
 * Client game shell: owns the three.js world, avatars, session (local or
 * remote) and the HUD. One instance for the whole app lifetime.
 */

import * as THREE from 'three';
import { World, CameraRig } from './scene/world.js';
import { Arena } from './scene/arena.js';
import { Avatar } from './entities/avatar.js';
import { Effects } from './effects/effects.js';
import { Input } from './input/input.js';
import { UI } from './ui/ui.js';
import { AudioEngine } from './audio/audio.js';
import { LocalSession } from './net/local-session.js';
import { NetClient } from './net/client.js';
import {
  GRID, TILE, ROUND_MS, WARNING_MS, TILE_TOP, PALETTE, ARENA_HALF, CAPACITY,
} from '@shared/constants.js';
import { PHASE } from '@shared/game.js';
import { tileCenter, safeGroups, worldToTile, idx } from '@shared/sim.js';

const SETTINGS_KEY = 'tfil_settings';

export class GameApp {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = this._loadSettings();
    this.mode = null;            // 'solo' | 'online'
    this.session = null;
    this.net = null;
    this.avatars = new Map();
    this.safe = new Uint8Array(GRID * GRID);
    this.prevSafe = new Uint8Array(GRID * GRID);
    this.remoteSnapshot = null;
    this.flash = 0;
    this.lastRound = 0;
    this.myAlive = true;
    this.spectating = false;
    this.eliminated = new Set();
    this.running = false;
    this.lastT = 0;
    this.countdownShown = null;
    this.matchOver = false;
    this._raf = null;
    this._onlineEnds = 0;
    this._awaitingRematch = false;
  }

  // â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async boot() {
    const ui = (this.ui = new UI({ onAction: (a, v) => this.onAction(a, v) }));
    const audio = (this.audio = new AudioEngine());
    audio.setVolume('master', this.settings.master);
    audio.setVolume('music', this.settings.music);
    audio.setVolume('sfx', this.settings.sfx);

    ui.loaderProgress(0.12, 'Creando motor 3Dâ€¦');
    const world = (this.world = new World(this.canvas, {
      quality: this.settings.quality,
      bloom: this.settings.bloom,
      shadows: this.settings.shadows,
    }));
    const rig = (this.rig = new CameraRig(world.camera, {
      sensitivity: this.settings.sensitivity,
      invertY: this.settings.invertY,
    }));

    ui.loaderProgress(0.38, 'Construyendo arenaâ€¦');
    const arena = (this.arena = new Arena(world.scene, { quality: this.settings.quality }));
    arena.setSafe(this.safe);

    ui.loaderProgress(0.62, 'PartÃ­culas y efectosâ€¦');
    const fx = (this.fx = new Effects(world.scene, { particles: this.settings.particles }));
    fx.shakeFn = (a) => rig.kick(a);

    const input = (this.input = new Input());
    input.bindTouch({
      joy: document.getElementById('joy'),
      knob: document.getElementById('joy-knob'),
      jumpBtn: document.getElementById('btn-jump-touch'),
      lookZone: document.getElementById('cam-zone'),
    });
    this.canvas.addEventListener('click', () => {
      if (this.running && this.mode && !this.input.isTouch) input.requestPointerLock(this.canvas);
    });

    this._applySettingsToUI();
    this._drawSkinPreview();

    ui.loaderProgress(0.84, 'Conectando servidorâ€¦');
    this.net = new NetClient({
      onEvent: (e) => this.onNetEvent(e),
      onState: (s) => this.onNetState(s),
      onTick: (s) => this.onNetTick(s),
      onStatus: (s) => this.onNetStatus(s),
    });
    this.net.connect();

    this.lastT = performance.now();
    this.running = true;
    this._raf = requestAnimationFrame((t) => this._frame(t));

    ui.loaderProgress(1, 'Listo');
    // Unconditional: by this point boot has fully succeeded, so showing the menu
    // is always correct. Never gate this on `ui.current`, which used to be null
    // and left players stuck on the loading screen forever.
    setTimeout(() => ui.show('menu'), 320);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._pauseIfPlaying();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode && this.ui.current === 'game') this.onAction('pause');
    });
    window.addEventListener('resize', () => this._drawSkinPreview());
  }

  // â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _loadSettings() {
    const def = {
      master: 0.8, music: 0.55, sfx: 0.85, quality: 'high',
      bloom: true, shadows: true, particles: true, invertY: false, sensitivity: 0.9,
    };
    try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return def; }
  }

  _saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); }

  _applySettingsToUI() {
    const s = this.settings;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
    set('vol-master', s.master * 100); set('vol-music', s.music * 100); set('vol-sfx', s.sfx * 100);
    set('quality', s.quality); chk('opt-bloom', s.bloom); chk('opt-shadows', s.shadows);
    chk('opt-particles', s.particles); chk('opt-invert', s.invertY); set('cam-sens', s.sensitivity * 100);
    const nameEl = document.getElementById('player-name');
    if (nameEl) nameEl.value = localStorage.getItem('tfil_name') || '';
    const diff = document.getElementById('difficulty');
    if (diff) diff.value = localStorage.getItem('tfil_diff') || 'intermediate';
    this._bindDifficultyPicker();
    const bots = document.getElementById('bot-count');
    if (bots) {
      bots.value = localStorage.getItem('tfil_bots') || '5';
      const out = document.getElementById('bot-count-out');
      if (out) out.textContent = bots.value;
    }
    this.ui.setTouch(this.input?.isTouch);
  }

  /** 2D portrait of the selected color so the menu has a character preview. */
  _drawSkinPreview() {
    const c = document.getElementById('skin-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const col = PALETTE[this.ui.selectedColor % PALETTE.length];
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h * 0.72, 10, w / 2, h * 0.72, w * 0.5);
    g.addColorStop(0, 'rgba(255,74,31,0.30)');
    g.addColorStop(1, 'rgba(255,74,31,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const cx = w / 2, base = h * 0.82, s = w / 220;
    const dark = col.accent;
    ctx.save();
    ctx.shadowColor = col.body; ctx.shadowBlur = 24;
    // legs
    ctx.fillStyle = dark;
    ctx.fillRect(cx - 26 * s, base - 66 * s, 18 * s, 62 * s);
    ctx.fillRect(cx + 8 * s, base - 66 * s, 18 * s, 62 * s);
    // torso
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.roundRect(cx - 34 * s, base - 140 * s, 68 * s, 84 * s, 22 * s);
    ctx.fill();
    // arms
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.roundRect(cx - 52 * s, base - 134 * s, 16 * s, 66 * s, 8 * s);
    ctx.roundRect(cx + 36 * s, base - 134 * s, 16 * s, 66 * s, 8 * s);
    ctx.fill();
    // head
    ctx.beginPath(); ctx.arc(cx, base - 166 * s, 27 * s, 0, Math.PI * 2); ctx.fill();
    // visor
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.roundRect(cx - 20 * s, base - 172 * s, 40 * s, 10 * s, 5 * s); ctx.fill();
    ctx.restore();
  }

  get playerName() {
    const v = (document.getElementById('player-name')?.value || '').trim();
    return (v || 'PILOT').slice(0, 14);
  }

  get difficulty() { return document.getElementById('difficulty')?.value || 'intermediate'; }

  /**
   * Wires the five visible difficulty buttons to the hidden <select> the rest of
   * the code reads. Keeps one source of truth while giving the menu a control
   * that is actually obvious to click.
   */
  _bindDifficultyPicker() {
    const picker = document.getElementById('difficulty-picker');
    const select = document.getElementById('difficulty');
    if (!picker || !select) return;
    const opts = [...picker.querySelectorAll('.diff-opt')];
    const sync = () => {
      for (const b of opts) {
        const on = b.dataset.diff === select.value;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    };
    for (const b of opts) {
      b.addEventListener('click', () => {
        select.value = b.dataset.diff;
        localStorage.setItem('tfil_diff', select.value);
        sync();
        this.audio?.ui?.();
      });
    }
    sync();
  }
  get botCount() { return Number(document.getElementById('bot-count')?.value || 5); }

  _captureProfile() {
    localStorage.setItem('tfil_name', this.playerName);
    localStorage.setItem('tfil_diff', this.difficulty);
    localStorage.setItem('tfil_bots', String(this.botCount));
  }

  // â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  onAction(action, value) {
    switch (action) {
      case 'solo': return this.startSolo();
      case 'quick': return this.startQuick();
      case 'rooms': this.ui.show('rooms'); return this.refreshRooms();
      case 'settings': this.ui.show('settings'); return;
      case 'howto': this.ui.show('howto'); return;
      case 'refresh': return this.refreshRooms();
      case 'create': return this.createRoom();
      case 'join': return this.joinRoom();
      case 'leave': return this.leaveRoom();
      case 'ready': return this.toggleReady();
      case 'start': return this.startOnlineMatch();
      case 'pause': return this._pauseIfPlaying();
      case 'resume': return this.resume();
      case 'quit': return this.quitMatch();
      case 'again': return this.playAgain();
      case 'menu': return this.toMenu();
      case 'chat': return this.net?.chat(String(value || ''));
      case 'color': this._drawSkinPreview(); return;
      case 'volume':
        this.audio.setVolume(value.kind, value.value);
        this.settings[value.kind] = value.value; this._saveSettings(); return;
      case 'quality':
        this.settings.quality = value; this.world.setQuality(value); this._saveSettings(); return;
      case 'bloom':
        this.settings.bloom = value; this.world.setBloom(value); this._saveSettings(); return;
      case 'shadows':
        this.settings.shadows = value; this.world.setQuality(this.settings.quality); this._saveSettings(); return;
      case 'particles':
        this.settings.particles = value; this.fx.enabled = value; this._saveSettings(); return;
      case 'invertY':
        this.settings.invertY = value; this.rig.invertY = value; this._saveSettings(); return;
      case 'sensitivity':
        this.settings.sensitivity = value; this.rig.sensitivity = value; this._saveSettings(); return;
      default: return;
    }
  }

  // â”€â”€ Solo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  startSolo() {
    this.audio.unlock();
    this._captureProfile();
    this._teardownSession();
    this.mode = 'solo';
    this.eliminated.clear();
    this.matchOver = false;
    this.myAlive = true;
    this.spectating = false;
    this.countdownShown = null;
    this.input.enabled = true;

    const session = (this.session = new LocalSession({
      name: this.playerName,
      color: this.ui.selectedColor,
      bots: this.botCount,
      difficulty: this.difficulty,
      onEvent: (e) => this.onNetEvent(e),
    }));
    this.ui.show('game');
    this.ui.hudVisible(true);
    this.ui.setTouch(this.input.isTouch);
    this.ui.spectator(false);
    this._syncPlayers(session.state);
    this.lastRound = 0;
    session.start();
    if (!this.input.isTouch) setTimeout(() => this.input.requestPointerLock(this.canvas), 320);
  }

  playAgain() {
    if (this.mode === 'solo') {
      this.session.restart({ bots: this.botCount, difficulty: this.difficulty });
      this.eliminated.clear();
      this.matchOver = false;
      this.myAlive = true;
      this.spectating = false;
      this.countdownShown = null;
      this.lastRound = 0;
      this.input.enabled = true;
      this.ui.show('game');
      this.ui.hudVisible(true);
      this.ui.spectator(false);
      this._syncPlayers(this.session.state);
      if (!this.input.isTouch) setTimeout(() => this.input.requestPointerLock(this.canvas), 200);
    } else if (this.mode === 'online') {
      this.net.rematch();
      this.ui.show('lobby');
    }
  }

  // â”€â”€ Online â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async startQuick() {
    this.audio.unlock();
    this._captureProfile();
    if (!this.net.connected) {
      this.ui.toast('Servidor no disponible. Usa JUGAR (IA) mientras tanto.');
      return;
    }
    this.ui.toast('Buscando salaâ€¦', 1200);
    const res = await this.net.quickPlay({ name: this.playerName });
    if (!res.ok) return this.ui.toast('No se pudo entrar: ' + this._reason(res.reason));
    this.mode = 'online';
    this.eliminated.clear(); this.matchOver = false; this.myAlive = true; this.spectating = false;
    this._enterLobby(res.state, res.code);
  }

  async createRoom() {
    this.audio.unlock();
    this._captureProfile();
    if (!this.net.connected) return this.ui.toast('Servidor no disponible.');
    const roomName = (document.getElementById('room-name')?.value || '').trim();
    const isPrivate = !!document.getElementById('room-private')?.checked;
    const res = await this.net.createRoom({ name: this.playerName, roomName, isPrivate });
    if (!res.ok) return this.ui.toast('No se pudo crear: ' + this._reason(res.reason));
    this.mode = 'online';
    this._enterLobby(res.state, res.code);
  }

  async joinRoom() {
    this.audio.unlock();
    this._captureProfile();
    const code = (document.getElementById('join-code')?.value || '').trim().toUpperCase();
    if (code.length !== 5) return this.ui.toast('El cÃ³digo tiene 5 caracteres.');
    if (!this.net.connected) return this.ui.toast('Servidor no disponible.');
    const res = await this.net.joinRoom({ code, name: this.playerName });
    if (!res.ok) return this.ui.toast(this._reason(res.reason));
    this.mode = 'online';
    this.eliminated.clear(); this.matchOver = false; this.myAlive = true; this.spectating = false;
    this._enterLobby(res.state, res.code);
  }

  _reason(r) {
    return ({
      not_found: 'Esa sala no existe.',
      room_full: 'La sala estÃ¡ llena.',
      locked: 'La partida ya empezÃ³.',
      already_in_room: 'Ya estÃ¡s en una sala.',
      offline: 'Sin conexiÃ³n al servidor.',
      timeout: 'El servidor no responde.',
      not_ready: 'Faltan jugadores listos.',
      not_host: 'Solo el anfitriÃ³n puede iniciar.',
      busy: 'La partida ya estÃ¡ en curso.',
    })[r] || ('Error: ' + (r || 'desconocido'));
  }

  async refreshRooms() {
    if (!this.net.connected) {
      this.ui.renderRooms([], () => {});
      return;
    }
    const res = await this.net.listRooms();
    this.ui.renderRooms(res.rooms || [], (code) => {
      const el = document.getElementById('join-code');
      if (el) el.value = code;
      this.onAction('join');
    });
  }

  _enterLobby(state, code) {
    this.remoteSnapshot = state;
    this.ui.show('lobby');
    this._renderLobby(state, code);
    const el = document.getElementById('join-code');
    if (el) el.value = '';
  }

  _renderLobby(state, code) {
    if (!state) return;
    const myId = this.net?.socket?.id;
    const players = state.players || [];
    this.ui.renderLobby({
      code: code || state.roomCode || this.net?.roomCode,
      players: players.map((p) => ({
        id: p.id, name: p.name, color: p.color ?? 0, ready: p.ready, host: p.host,
      })),
      hostId: players.find((p) => p.host)?.id,
      myId,
    });
  }

  async toggleReady() {
    const myId = this.net?.socket?.id;
    const me = this.remoteSnapshot?.players?.find((p) => p.id === myId);
    await this.net.setReady(!me?.ready);
  }

  async startOnlineMatch() {
    const res = await this.net.startMatch();
    if (!res.ok) this.ui.toast(this._reason(res.reason));
  }

  async leaveRoom() {
    await this.net?.leave();
    this.remoteSnapshot = null;
    this._clearAvatars();
    this.mode = null;
    this.ui.show('menu');
  }

  // â”€â”€ Net callbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  onNetStatus(s) {
    this.ui.setConn(!!s.connected,
      s.connected ? 'Servidor: en lÃ­nea' : 'Servidor: sin conexiÃ³n Â· modo local disponible');
    if (!s.connected && this.mode === 'online' && !this.matchOver) {
      this.ui.toast('ConexiÃ³n perdida â€” reconectandoâ€¦');
    }
  }

  onNetState(s) {
    if (s.type === 'rooms') {
      this.ui.renderRooms(s.rooms || [], (code) => {
        const el = document.getElementById('join-code');
        if (el) el.value = code;
        this.onAction('join');
      });
      return;
    }
    if (s.type === 'joined' || s.type === 'resume') {
      const state = s.state;
      if (state) {
        this.remoteSnapshot = state;
        this._renderLobby(state, s.code);
        if (state.phase !== PHASE.LOBBY) {
          this.mode = 'online';
          this.ui.show('game');
          this.ui.hudVisible(true);
        }
      }
      return;
    }
    if (s.type === 'room') {
      const state = s.state || s;
      if (state?.players) {
        this.remoteSnapshot = state;
        if (this.ui.current === 'lobby' || this.mode === 'online') this._renderLobby(state);
      }
      return;
    }
    if (s.type === 'started') {
      this.mode = 'online';
      this.matchOver = false;
      this.eliminated.clear();
      this.myAlive = true;
      this.spectating = false;
      this.countdownShown = null;
      this.input.enabled = true;
      this.ui.show('game');
      this.ui.hudVisible(true);
      this.ui.spectator(false);
      if (!this.input.isTouch) setTimeout(() => this.input.requestPointerLock(this.canvas), 320);
      return;
    }
    if (s.type === 'chat') this.ui.addChat(s.name || '?', s.text || '');
  }

  onNetTick(snap) {
    if (!snap || this.mode !== 'online') return;
    this.remoteSnapshot = snap;
    this._applyRemote(snap);
    if (snap.phase !== PHASE.LOBBY && this.ui.current !== 'game' && !this.matchOver) {
      this.ui.show('game');
      this.ui.hudVisible(true);
    }
  }

  onNetEvent(e) {
    switch (e.t) {
      case 'start':
        this.ui.message('Â¡SOBREVIVE!', '#6dff3d', 800);
        break;
      case 'round':
        if (e.round !== this.lastRound) { this.lastRound = e.round; this.ui.setRound(e.round); }
        break;
      case 'warning':
        this.audio.siren();
        this.ui.message('Â¡EL SUELO VA A CAMBIAR!', '#ffb000', 1100);
        break;
      case 'swap': {
        this.prevSafe.set(e.prev);
        this.safe.set(e.next);
        this.arena.setSafe(e.next);
        this.audio.swap();
        this.flash = 1;
        const tiles = [];
        for (let i = 0; i < e.next.length; i++) {
          if (e.next[i]) tiles.push(tileCenter(i % GRID, (i / GRID) | 0));
        }
        this.fx.swapBurst(tiles);
        break;
      }
      case 'eliminated':
        for (const id of e.ids || []) this._eliminate(id, e.lava);
        break;
      case 'end':
        this._onMatchEnd(e);
        break;
      default: break;
    }
  }

  // â”€â”€ Eliminations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _eliminate(id, byLava) {
    if (this.eliminated.has(id)) return;
    this.eliminated.add(id);
    const av = this.avatars.get(id);
    const name = this._playerName(id);
    if (av) {
      const p = av.root.position;
      this.fx.death(p.x, p.y, p.z, PALETTE[(av.colorIndex ?? 0) % PALETTE.length].body);
      if (byLava) this.fx.splash(p.x, p.z);
      av.setEliminated();
    }
    this.audio.explode();
    this.ui.kill(`${name} se quemÃ³`);
    if (id === this._myId()) {
      this.myAlive = false;
      this.spectating = true;
      this.ui.message('ELIMINADO', '#ff3550', 1400);
      this.ui.spectator(true);
      this.audio.defeat();
      this.input.exitPointerLock();
    }
  }

  _playerName(id) {
    if (this.mode === 'solo' && this.session) {
      return this.session.game.players.get(id)?.name || 'Jugador';
    }
    const rows = this.remoteSnapshot?.players || [];
    const found = rows.find((r) => (Array.isArray(r) ? r[0] : r.id) === id);
    if (!found) {
      const lobby = this.remoteSnapshot?.players || [];
      return (typeof found === 'object' && found?.name) || lobby.find?.((p) => p?.id === id)?.name || 'Jugador';
    }
    return found.name || found[1] || 'Jugador';
  }

  _myId() {
    return this.mode === 'solo' ? this.session?.id : this.net?.socket?.id;
  }

  _onMatchEnd(e) {
    const myId = this._myId();
    const standings = (e.standings && e.standings.length)
      ? e.standings
      : (this.session?.game.standings() || []);
    const winner = e.winner ?? null;
    this.matchOver = true;
    this.ui.hudVisible(false);
    this.ui.spectator(false);
    this.ui.showResults({ standings, winner, myId, isBot: this.mode === 'solo' });
    if (winner === myId) { this.audio.victory(); this.ui.message('Â¡GANASTE!', '#6dff3d', 1800); }
    else this.audio.defeat();
    this.input.exitPointerLock();
  }

  // â”€â”€ Snapshots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _applyRemote(snap) {
    if (snap.safe) {
      this.safe.set(snap.safe);
      this.arena.setSafe(snap.safe);
    }
    this.ui.setAlive(snap.alive ?? 0);
    this.ui.setRound(snap.round ?? 0);
    const rows = snap.players || [];
    const meta = new Map(rows.map((r) => [r[0], r]));
    this.ui.setPlayers(rows.map((r) => ({
      id: r[0], name: this._playerName(r[0]), color: this._colorOf(r[0]), alive: !!r[4],
    })), this.net?.socket?.id);
    this._reconcileAvatars(rows);
  }

  _colorOf(id) {
    const p = this.remoteSnapshot?.players?.find?.((q) => q?.id === id);
    return p?.color ?? 0;
  }

  _syncPlayers(state) {
    if (!state?.players) return;
    for (const p of state.players) this._ensureAvatar(p.id, p.name, p.color);
  }

  _ensureAvatar(id, name, color) {
    let av = this.avatars.get(id);
    if (av) return av;
    av = new Avatar(color ?? 0);
    av.colorIndex = color ?? 0;
    av.setName(name || '');
    const pos = this._spawnFor(id);
    av.root.position.set(pos.x, TILE_TOP, pos.z);
    this.world.scene.add(av.root);
    this.avatars.set(id, av);
    return av;
  }

  _spawnFor(id) {
    if (this.mode === 'solo' && this.session) {
      const p = this.session.game.players.get(id);
      return { x: p?.x ?? 0, z: p?.z ?? 0 };
    }
    const row = (this.remoteSnapshot?.players || []).find((r) => r[0] === id);
    return { x: row?.[1] ?? 0, z: row?.[3] ?? 0 };
  }

  _reconcileAvatars(rows) {
    const seen = new Set();
    const myId = this.net?.socket?.id;
    for (const [id, x, y, z, alive, rot] of rows) {
      seen.add(id);
      const av = this._ensureAvatar(id, this._playerName(id), this._colorOf(id));
      const k = id === myId ? 0.6 : 0.3;
      av.root.position.x += (x - av.root.position.x) * k;
      av.root.position.y += (y - av.root.position.y) * k;
      av.root.position.z += (z - av.root.position.z) * k;
      if (rot != null) {
        const cur = av.root.rotation.y;
        let diff = rot - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        av.root.rotation.y = cur + diff * 0.35;
      }
      if (!alive && !this.eliminated.has(id)) this._eliminate(id, false);
      av.root.visible = !!alive;
    }
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) { this.world.scene.remove(av.root); this.avatars.delete(id); }
    }
  }

  _clearAvatars() {
    for (const av of this.avatars.values()) this.world.scene.remove(av.root);
    this.avatars.clear();
  }

  // â”€â”€ Frame loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _frame(t) {
    this._raf = requestAnimationFrame((tt) => this._frame(tt));
    // `dt` drives physics smoothing; the authoritative clock advances by the
    // real elapsed time below so a slow frame never turns into lost game time.
    const rawDt = (t - this.lastT) / 1000;
    const dt = Math.min(0.05, rawDt || 0.016);
    this.lastT = t;

    const look = this.input.takeLook();
    if (look.dx || look.dy) this.rig.addLook(look.dx, look.dy);

    const inGame = this.mode && this.ui.current === 'game';
    if (inGame && !this.matchOver) {
      const frame = this.input.frame();
      // `frame()` is in CAMERA space (W = "away from the camera"). The sim moves
      // players in WORLD space. The camera sits at +(sin yaw, cos yaw) relative
      // to the player, so "forward" is -(sin yaw, cos yaw). Getting this wrong
      // makes the avatar ignore the keys and drift sideways.
      // Camera is at player + (sin yaw, cos yaw)*dist, so it sits BEHIND the
      // player looking forward along -(sin yaw, cos yaw).
      //
      // Input convention (src/input/input.js): W gives z = -1, D gives x = +1.
      // So "forward" is -z and "right" is +x in camera space:
      //   forward = (-sin yaw, -cos yaw)
      //   right   = ( cos yaw, -sin yaw)
      // world = right * x  +  forward * (-z)
      // Getting the sign of z wrong here is exactly what made W run backwards.
      const yaw = this.rig?.yaw ?? 0;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const fx = -sn, fz = -cs;      // forward
      const rx = cs, rz = -sn;       // right
      const ix = frame.x, iz = -frame.z;  // iz = +1 when pushing forward
      frame.x = rx * ix + fx * iz;
      frame.z = rz * ix + fz * iz;
      if (this.mode === 'solo' && this.session) {
        this.session.setInput(frame);
        // Feed the REAL elapsed time (not the clamped render dt) so the match
        // clock keeps up with wall time even when the frame rate drops.
        this.session.advance(Math.min(rawDt * 1000, 250) || 16);
        if (this.session.game.phase === PHASE.PLAY && !this.matchOver) {
          this.input.enabled = true;
        }
      } else if (this.mode === 'online') {
        frame.seq = (frame.seq || 0) + 1;
        this.net.sendInput(frame);
      }
    }

    if (this.mode === 'solo' && this.session) this._applyLocal(this.session.state, dt);
    else if (this.mode === 'online') this._applyOnlineClock();

    // Camera
    const me = this.avatars.get(this._myId());
    const nowSec = performance.now() / 1000;
    if (me && this.myAlive && !this.spectating) {
      this.rig.mode = 'follow';
      this.rig.dist = this.input.isTouch ? 13 : 11;
      this.rig.follow(me.root.position, dt);
    } else if (this.mode && this.spectating) {
      this.rig.spectator(new THREE.Vector3(0, 0, 0), dt);
    } else {
      // menu idle orbit
      this.rig.mode = 'spectator';
      this.rig.target.set(0, 1.4, 0);
      this.rig.yaw += dt * 0.08;
      this.rig.pitch = 0.62;
      this.rig.dist = 30;
    }
    this.rig.update(dt);

    // Visuals
    const warning = this._warningFactor();
    // Feed the upcoming layout to the arena during the warning window so the
    // player can see where to run. The sim already publishes `pending` at swap
    // time; the warning phase is the countdown to that swap.
    const sess = this.session;
    const g2 = this.mode === 'solo' ? sess?.game : null;
    const pending = g2?.pending ?? null;
    // The preview must be READABLE for the whole warning window. Ramping it in
    // (strength = warning * 1.6) meant the first ~40% of the window was drawn at
    // near-zero strength, so the player had ~1s of usable signal out of 2.4s.
    this.arena.setPending(pending, pending ? 1 : 0);

    // Tell the arena which upcoming zones are already full, so they are painted
    // as taken. Without this, two players run into the same green zone and one
    // of them dies while standing on safe-looking floor.
    if (pending) {
      const groups = safeGroups(pending);
      const counts = new Array(groups.length).fill(0);
      const living = [...g2.players.values()].filter((p) => p.alive && p.connected);
      for (const p of living) {
        const t = worldToTile(p.x, p.z);
        if (!t) continue;
        const k = idx(t.x, t.z);
        const gi = groups.findIndex((gr) => gr.includes(k));
        if (gi >= 0) counts[gi]++;
      }
      const taken = [];
      counts.forEach((c, gi) => { if (c >= CAPACITY) taken.push(gi); });
      // Never grey out every zone: if everyone is packed, show the emptiest as
      // free so the player always has somewhere to aim for.
      if (taken.length >= groups.length && groups.length) taken.pop();
      this.arena.setTakenZones(taken);
    } else {
      this.arena.setTakenZones(null);
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);
    const flashFx = this.fx.update(dt);
    this.arena.update(nowSec, warning, Math.max(this.flash, flashFx));
    if (this.world.bloomPass) {
      // Lower base bloom: the old 0.85 + flash*0.5 blew out the tiles and hid the
      // safe/lava distinction exactly when it mattered most (round swap).
      this.world.bloomPass.strength = 0.42 + warning * 0.18 + this.flash * 0.2;
    }
    for (const [, av] of this.avatars) av.animate(dt, this._avatarMotion(av));

    this._updateCountdown();
    this.world.render(nowSec);
  }

  _avatarMotion(av) {
    if (this.mode === 'solo' && this.session) {
      const p = this.session.game.players.get(this._idOfAvatar(av));
      if (p) return { vx: p.vx, vy: p.vy, vz: p.vz, onGround: p.y <= TILE_TOP + 0.06, alive: p.alive };
    }
    return { vx: av._vx || 0, vy: av._vy || 0, vz: av._vz || 0, onGround: true, alive: av.root.visible };
  }

  _idOfAvatar(av) {
    for (const [id, a] of this.avatars) if (a === av) return id;
    return null;
  }

  _now() {
    if (this.mode === 'solo' && this.session) return this.session.game.now;
    return this.remoteSnapshot?.now ?? 0;
  }

  _applyLocal(state, dt) {
    if (!state) return;
    this.safe.set(state.safe);
    this.arena.setSafe(state.safe);
    // A neutral deck at the start (and on every fresh round) is drawn as plain
    // steel, not as "every tile is lava": the user described the floor as
    // neutral before the safe zones appear.
    this.arena.setAllSafe(!!state.round1AllSafe || !!state.neutralFloor);
    this.ui.setAlive(state.alive);
    this.ui.setRound(state.round);
    if (state.phase === PHASE.PLAY) this.ui.setTimer(Math.max(0, state.roundEndsAt - state.now));
    else if (state.phase === PHASE.COUNTDOWN) this.ui.setTimer(ROUND_MS);
    else this.ui.setTimer(0);

    const myId = this.session.id;
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      const av = this._ensureAvatar(p.id, p.name, p.color);
      // Smooth toward the authoritative position instead of snapping to it.
      // The sim runs at 20 Hz while we render at 60+, so hard assignment made
      // every avatar visibly stutter even at full frame rate.
      const isMe = p.id === myId;
      // Player-owned avatars follow the sim tightly so input feels direct; other
      // players are smoothed slightly harder.
      const follow = isMe ? 0.65 : 0.45;
      const t = 1 - Math.pow(1 - follow, Math.min(6, Math.max(1, dt * 60)));
      let nx = av.root.position.x + (p.x - av.root.position.x) * t;
      let ny = av.root.position.y + (p.y - av.root.position.y) * t;
      let nz = av.root.position.z + (p.z - av.root.position.z) * t;
      // Never teleport on a long frame: cap the correction so a 1 s hitch eases
      // in rather than snapping the avatar across the arena.
      const MAX_STEP = isMe ? 1.2 : 1.6;
      const dx = nx - av.root.position.x;
      const dy2 = ny - av.root.position.y;
      const dz = nz - av.root.position.z;
      const d = Math.hypot(dx, dy2, dz);
      if (d > MAX_STEP) {
        const s = MAX_STEP / d;
        nx = av.root.position.x + dx * s;
        ny = av.root.position.y + dy2 * s;
        nz = av.root.position.z + dz * s;
      }
      av.root.position.set(nx, ny, nz);
      av.root.rotation.y = p.rot;
      av.root.visible = p.alive;

      // Derive animation speed from the commanded velocity, not from position
      // deltas (which are noisy at 20 Hz and produced jittery walk cycles).
      av._vx = p.vx ?? 0;
      av._vy = p.vy ?? 0;
      av._vz = p.vz ?? 0;

      if (!p.alive && !this.eliminated.has(p.id)) {
        this.eliminated.add(p.id);
        this.fx.death(p.x, p.y, p.z, PALETTE[p.color % PALETTE.length].body);
        if (p.fellOff) this.fx.splash(p.x, p.z);
        this.audio.explode();
        this.ui.kill(p.fellOff ? `${p.name} cayÃ³ a la lava` : `${p.name} se quemÃ³`);
        if (p.id === myId) {
          this.myAlive = false; this.spectating = true;
          this.ui.message('ELIMINADO', '#ff3550', 1400);
          this.ui.spectator(true);
          this.audio.defeat();
          this.input.exitPointerLock();
        }
      }
    }
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) { this.world.scene.remove(av.root); this.avatars.delete(id); }
    }
    this.ui.setPlayers(state.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, alive: p.alive,
    })), myId);
  }

  _applyOnlineClock() {
    const snap = this.remoteSnapshot;
    if (!snap) return;
    if (snap.phase === PHASE.PLAY) {
      this._onlineEnds = performance.now() + Math.max(0, (snap.phaseEndsAt || snap.now) - snap.now);
    }
    if (this._onlineEnds && snap.phase === PHASE.PLAY) {
      this.ui.setTimer(Math.max(0, this._onlineEnds - performance.now()));
    }
  }


  _warningFactor() {
    if (this.mode === 'solo' && this.session) {
      const g = this.session.game;
      if (g.phase !== PHASE.PLAY) return 0;
      const left = g.roundEndsAt - g.now;
      return left > WARNING_MS ? 0 : Math.max(0, 1 - left / WARNING_MS);
    }
    const snap = this.remoteSnapshot;
    if (!snap || snap.phase !== PHASE.PLAY) return 0;
    const left = (snap.phaseEndsAt || 0) - snap.now;
    return left > WARNING_MS ? 0 : Math.max(0, 1 - left / WARNING_MS);
  }

  _updateCountdown() {
    let phase = null, endsAt = 0, now = 0, liveRound = 0;
    if (this.mode === 'solo' && this.session) {
      phase = this.session.game.phase;
      endsAt = this.session.game.phaseEndsAt;
      now = this.session.game.now;
      liveRound = this.session.game.round;
    } else if (this.remoteSnapshot) {
      phase = this.remoteSnapshot.phase;
      endsAt = this.remoteSnapshot.phaseEndsAt;
      now = this.remoteSnapshot.now;
      liveRound = this.remoteSnapshot.round || 0;
    }
    const el = document.getElementById('countdown');
    if (!el) return;

    if (phase === PHASE.COUNTDOWN) {
      const left = Math.max(0, endsAt - now);
      const n = Math.ceil(left / 1000);
      if (this.countdownShown !== n) {
        this.countdownShown = n;
        this.audio.beep(4 - n);
        el.hidden = false;
        const span = el.querySelector('span');
        if (span) {
          span.textContent = n > 0 ? String(n) : '¡YA!';
          span.style.animation = 'none';
          void span.offsetWidth;
          span.style.animation = 'cdPulse 900ms ease';
        }
      }
      return;
    }

    if (phase === PHASE.PLAY && this.countdownShown !== 'go') {
      this.countdownShown = 'go';
      this.audio.go();
      // "¡CORRE!" belongs to the start of the MATCH, not to every 5s round. It
      // used to fire each round and, because the overlay's `hidden` was being
      // overridden by CSS, it parked itself over the arena for the whole game.
      const firstRound = liveRound <= 1;
      if (firstRound) {
        el.hidden = false;
        const span = el.querySelector('span');
        if (span) span.textContent = '¡CORRE!';
        clearTimeout(this._correTimer);
        this._correTimer = setTimeout(() => { el.hidden = true; }, 750);
        this.ui.message('¡CORRE!', '#6dff3d', 700);
      }
      return;
    }

    if (phase !== PHASE.COUNTDOWN && phase !== PHASE.PLAY) {
      el.hidden = true;
      this.countdownShown = null;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  _pauseIfPlaying() {
    if (this.mode && !this.matchOver && this.ui.current === 'game') {
      this.input.exitPointerLock();
      this.ui.show('pause');
    }
  }

  resume() {
    this.ui.show('game');
    this.ui.hudVisible(true);
    if (!this.input.isTouch) this.input.requestPointerLock(this.canvas);
  }

  quitMatch() {
    if (this.mode === 'online') this.net?.leave();
    this._teardownSession();
    this.mode = null;
    this.matchOver = false;
    this.spectating = false;
    this.countdownShown = null;
    this.eliminated.clear();
    this._clearAvatars();
    this.ui.hudVisible(false);
    this.ui.spectator(false);
    this.input.enabled = true;
    this.ui.show('menu');
  }

  toMenu() {
    this.quitMatch();
    this.audio.duckMusic(false);
  }

  _teardownSession() {
    if (this.session) { this.session.dispose?.(); this.session = null; }
    this._clearAvatars();
    this.eliminated.clear();
    this.safe.fill(0);
    this.prevSafe.fill(0);
    this.arena?.setSafe(this.safe);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._teardownSession();
    this.input?.dispose();
    this.net?.disconnect();
    this.fx?.dispose();
    this.arena?.dispose();
    this.world?.dispose();
    this.audio?.dispose();
  }
}
