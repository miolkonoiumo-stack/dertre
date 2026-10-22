/**
 * HUD, menus, countdown, killfeed, results. Pure DOM — no rendering concerns.
 */

import { ROUND_MS, MAX_PLAYERS, PALETTE } from '@shared/constants.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

export class UI {
  constructor({ onAction } = {}) {
    this.onAction = onAction || (() => {});
    this.screens = ['loader', 'menu', 'rooms', 'lobby', 'settings', 'howto', 'results', 'pause'];
    this.current = null;
    this.selectedColor = Number(localStorage.getItem('tfil_color') || 0);
    this.msgTimer = null;
    this._bind();
    this._buildSwatches();
    // Sync with whatever screen the markup already has marked active. The
    // loader ships with class="active" in the HTML, so `current` must start as
    // 'loader' or any later `if (current === 'loader')` check silently fails.
    this.current = this.screens.find((s) => document.getElementById(s)?.classList.contains('active')) || null;
  }

  show(name) {
    for (const s of this.screens) {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('active', s === name);
    }
    this.current = name;
    const hud = $('#hud');
    if (hud) hud.hidden = !(name === 'game');
  }

  hudVisible(on) {
    const hud = $('#hud');
    if (hud) hud.hidden = !on;
  }

  _bind() {
    const act = (id, action) => {
      const el = document.getElementById(id);
      el?.addEventListener('click', () => this.onAction(action));
    };
    act('btn-campaign', 'solo');
    act('btn-quick', 'quick');
    act('btn-rooms', 'rooms');
    act('btn-settings', 'settings');
    act('btn-howto', 'howto');
    act('btn-create', 'create');
    act('btn-join', 'join');
    act('btn-refresh', 'refresh');
    act('btn-leave', 'leave');
    act('btn-ready', 'ready');
    act('btn-start', 'start');
    act('btn-pause', 'pause');
    act('btn-resume', 'resume');
    act('btn-quit', 'quit');
    act('btn-again', 'again');
    act('btn-menu', 'menu');
    act('btn-jump-touch', 'jump-touch');
    $$('[data-back]').forEach((b) => b.addEventListener('click', () => this.show('menu')));

    const botRange = $('#bot-count');
    botRange?.addEventListener('input', () => { $('#bot-count-out').textContent = botRange.value; });

    // settings live-binding
    const vol = (id, kind) => {
      const el = document.getElementById(id);
      el?.addEventListener('input', () => this.onAction('volume', { kind, value: el.value / 100 }));
    };
    vol('vol-master', 'master'); vol('vol-music', 'music'); vol('vol-sfx', 'sfx');
    $('#quality')?.addEventListener('change', (e) => this.onAction('quality', e.target.value));
    $('#opt-bloom')?.addEventListener('change', (e) => this.onAction('bloom', e.target.checked));
    $('#opt-shadows')?.addEventListener('change', (e) => this.onAction('shadows', e.target.checked));
    $('#opt-particles')?.addEventListener('change', (e) => this.onAction('particles', e.target.checked));
    $('#opt-invert')?.addEventListener('change', (e) => this.onAction('invertY', e.target.checked));
    $('#cam-sens')?.addEventListener('input', (e) => this.onAction('sensitivity', e.target.value / 100));

    $('#chat-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chat-input');
      const v = input.value.trim();
      if (v) { this.onAction('chat', v); input.value = ''; }
    });
  }

  _buildSwatches() {
    const wrap = $('#color-picker');
    if (!wrap) return;
    PALETTE.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === this.selectedColor ? ' sel' : '');
      b.style.background = c.body;
      b.style.color = c.body;
      b.dataset.i = i;
      b.addEventListener('click', () => {
        this.selectedColor = i;
        localStorage.setItem('tfil_color', String(i));
        $$('.swatch').forEach((s) => s.classList.toggle('sel', Number(s.dataset.i) === i));
        this.onAction('color', i);
      });
      wrap.appendChild(b);
    });
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────
  renderRooms(list, onPick) {
    const ul = $('#room-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="muted">No hay salas públicas. ¡Crea la primera!</li>';
      return;
    }
    for (const r of list) {
      const li = document.createElement('li');
      const full = r.players >= r.max;
      li.innerHTML = `<b>${escapeHtml(r.name)}</b><span class="meta">${r.code} · ${r.players}/${r.max} · ${r.phase === 'lobby' ? 'esperando' : 'en partida'}${full ? ' · LLENA' : ''}</span>`;
      li.addEventListener('click', () => onPick(r.code));
      ul.appendChild(li);
    }
  }

  renderLobby({ code, players, hostId, myId }) {
    $('#lobby-code').textContent = code || '-----';
    const ul = $('#lobby-players');
    if (!ul) return;
    ul.innerHTML = '';
    for (const p of players || []) {
      const li = document.createElement('li');
      li.innerHTML = `
        <i style="width:10px;height:10px;border-radius:50%;background:${PALETTE[p.color % PALETTE.length].body};box-shadow:0 0 8px ${PALETTE[p.color % PALETTE.length].body}"></i>
        <span>${escapeHtml(p.name)}${p.id === myId ? ' <b style="color:var(--accent)">(tú)</b>' : ''}</span>
        <span class="meta" style="margin-left:auto;color:var(--ink-dim);font-size:12px">${p.host ? '👑' : ''} ${p.ready ? '✓ listo' : '…'}</span>`;
      ul.appendChild(li);
    }
    const isHost = hostId === myId;
    $('#btn-start').hidden = !isHost;
    $('#lobby-hint').textContent = isHost
      ? 'Inicia cuando todos estén listos. Mínimo 1 jugador.'
      : 'Espera a que el anfitrión inicie la partida.';
  }

  addChat(name, text) {
    const log = $('#chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.innerHTML = `<b>${escapeHtml(name)}</b>: ${escapeHtml(text)}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  setTimer(remainingMs, totalMs = ROUND_MS) {
    const ring = $('#ring-fg');
    const num = $('#timer-num');
    if (!ring || !num) return;
    const frac = Math.max(0, Math.min(1, remainingMs / totalMs));
    ring.style.strokeDashoffset = String(327 * (1 - frac));
    ring.style.stroke = remainingMs < 1500 ? 'var(--danger)' : remainingMs < 3000 ? 'var(--lava-hot)' : 'var(--safe)';
    num.textContent = Math.max(0, Math.ceil(remainingMs / 1000));
    num.style.color = remainingMs < 1500 ? 'var(--danger)' : '#fff';
  }

  setAlive(n) { const el = $('#hud-alive'); if (el) el.textContent = n; }
  setRound(n) { const el = $('#hud-round'); if (el) el.textContent = n; }

  setPlayers(list, myId) {
    const wrap = $('#hud-players');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const p of list) {
      const d = document.createElement('div');
      d.className = 'pl' + (p.alive ? '' : ' dead');
      d.innerHTML = `<i style="background:${PALETTE[p.color % PALETTE.length].body}"></i>${escapeHtml(p.name)}${p.id === myId ? ' •' : ''}`;
      wrap.appendChild(d);
    }
  }

  message(text, color = '#fff', ms = 900) {
    const el = $('#center-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    el.style.textShadow = `0 0 30px ${color}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => el.classList.remove('show'), ms + 200);
  }

  kill(text) {
    const feed = $('#killfeed');
    if (!feed) return;
    const d = document.createElement('div');
    d.textContent = text;
    feed.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  countdown(n) {
    if (n <= 0) { $('#countdown').hidden = true; return; }
    const el = $('#countdown');
    el.hidden = false;
    const span = $('#countdown-num');
    span.textContent = n === 4 ? '¡CORRE!' : String(n);
    span.style.animation = 'none';
    void span.offsetWidth;
    span.style.animation = 'cdPulse 900ms ease';
  }

  spectator(on) { const el = $('#spectator-badge'); if (el) el.hidden = !on; }

  setTouch(on) { $('#touch-controls')?.classList.toggle('on', on); }

  // ── Results ───────────────────────────────────────────────────────────────
  showResults({ standings, winner, myId, isBot }) {
    this.show('results');
    const me = standings.find((s) => s.id === myId);
    const won = me && me.rank === 1;
    $('#results-title').textContent = won ? '¡VICTORIA!' : me ? `#${me.rank}` : 'FIN';
    $('#results-title').style.color = won ? 'var(--safe)' : 'var(--lava)';
    const w = standings.find((s) => s.id === winner);
    $('#results-sub').textContent = w ? `Ganador: ${w.name}` : 'Sin supervivientes';
    const ol = $('#results-list');
    ol.innerHTML = '';
    standings.forEach((s) => {
      const li = document.createElement('li');
      if (s.id === myId) li.classList.add('me');
      li.innerHTML = `<b style="width:22px;color:var(--ink-dim)">${s.rank}</b>
        <i style="width:9px;height:9px;border-radius:50%;background:${PALETTE[s.color % PALETTE.length].body}"></i>
        <span>${escapeHtml(s.name)}${s.isBot ? ' <small style="opacity:.5">IA</small>' : ''}</span>
        <span style="margin-left:auto;color:var(--ink-dim);font-size:12px">${s.roundsSurvived} rondas</span>`;
      ol.appendChild(li);
    });
    $('#btn-again').hidden = isBot === false;
  }

  setConn(on, text) {
    const dot = $('#conn-dot'), t = $('#conn-text');
    if (dot) dot.className = 'dot ' + (on ? 'on' : 'off');
    if (t && text) t.textContent = text;
  }

  toast(text, ms = 2600) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.hidden = true; }, ms);
  }

  loaderProgress(frac, text) {
    const fill = $('#loader-fill');
    if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
    if (text) $('#loader-text').textContent = text;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { MAX_PLAYERS };
