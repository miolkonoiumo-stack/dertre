/**
 * Procedural WebAudio: no asset downloads, no autoplay violations.
 * Everything is synthesised (drone music, siren, countdown beeps, splashes,
 * elimination thumps) and starts only after the first user gesture.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.vol = { master: 0.8, music: 0.55, sfx: 0.85 };
    this.muted = false;
    this.musicNodes = [];
    this.musicOn = false;
    this.started = false;
  }

  /** Must be called from a user gesture handler. */
  unlock() {
    if (this.started) { this.ctx?.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol.master;
    this.master.connect(this.ctx.destination);

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    comp.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.vol.music * 0.35;
    this.musicGain.connect(comp);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.vol.sfx;
    this.sfxGain.connect(comp);

    this.started = true;
    this.startMusic();
  }

  setVolume(kind, v) {
    this.vol[kind] = v;
    if (!this.started) return;
    if (kind === 'master') this.master.gain.value = this.muted ? 0 : v;
    if (kind === 'music') this.musicGain.gain.value = v * 0.35;
    if (kind === 'sfx') this.sfxGain.gain.value = v;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.vol.master;
  }

  // ── Synth helpers ─────────────────────────────────────────────────────────
  _noiseBuffer(dur = 1) {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      }
      this._noise = buf;
    }
    return this._noise;
  }

  _env(node, t0, attack, decay, peak = 1) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /** Continuous lava rumble. Looped noise through a lowpass. */
  startMusic() {
    if (!this.started || this.musicOn) return;
    const c = this.ctx;
    this.musicOn = true;

    // Rumble bed
    const noise = c.createBufferSource();
    noise.buffer = this._noiseBuffer();
    noise.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.6;
    const ng = c.createGain(); ng.gain.value = 0.5;
    noise.connect(lp).connect(ng).connect(this.musicGain);
    noise.start();

    // Drone chord (A minor-ish, constantly detuning)
    const freqs = [55, 82.41, 110, 164.81];
    const oscs = freqs.map((f, i) => {
      const o = c.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0.055 / (i + 1);
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.017;
      const lg = c.createGain(); lg.gain.value = 1.2;
      lfo.connect(lg).connect(o.frequency);
      o.connect(g).connect(this.musicGain);
      o.start(); lfo.start();
      return { o, g, lfo };
    });
    this.musicNodes = [...oscs, { noise, ng, lp }];
  }

  duckMusic(on) {
    if (!this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(on ? this.vol.music * 0.12 : this.vol.music * 0.35, this.ctx.currentTime, 0.3);
  }

  // ── SFX ───────────────────────────────────────────────────────────────────
  _tone({ freq = 440, type = 'sine', dur = 0.2, gain = 0.3, slide = 0, delay = 0 }) {
    if (!this.started) return;
    const c = this.ctx;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    const g = c.createGain();
    this._env(g, t0, 0.008, dur, gain);
    o.connect(g).connect(this.sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  beep(n = 1) { this._tone({ freq: 620 + n * 80, type: 'square', dur: 0.16, gain: 0.18 }); }
  go() { this._tone({ freq: 880, type: 'sawtooth', dur: 0.35, gain: 0.28, slide: 300 }); this._tone({ freq: 220, type: 'sine', dur: 0.6, gain: 0.2 }); }
  jump() { this._tone({ freq: 300, type: 'triangle', dur: 0.14, gain: 0.12, slide: 260 }); }
  land() { this._tone({ freq: 120, type: 'sine', dur: 0.12, gain: 0.16, slide: -40 }); }

  siren() {
    if (!this.started) return;
    const c = this.ctx, t0 = c.currentTime;
    for (let i = 0; i < 3; i++) {
      this._tone({ freq: 400, type: 'square', dur: 0.28, gain: 0.14, slide: 500, delay: i * 0.34 });
    }
  }

  splash() {
    if (!this.started) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuffer();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const g = c.createGain();
    this._env(g, t0, 0.005, 0.5, 0.5);
    src.connect(bp).connect(g).connect(this.sfxGain);
    src.start(t0); src.stop(t0 + 0.6);
    this._tone({ freq: 160, type: 'sine', dur: 0.35, gain: 0.25, slide: -100 });
  }

  explode() {
    if (!this.started) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuffer();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(4000, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.7);
    const g = c.createGain();
    this._env(g, t0, 0.005, 0.85, 0.75);
    src.connect(lp).connect(g).connect(this.sfxGain);
    src.start(t0); src.stop(t0 + 0.9);
    this._tone({ freq: 90, type: 'sine', dur: 0.7, gain: 0.4, slide: -50 });
  }

  swap() {
    if (!this.started) return;
    const c = this.ctx, t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuffer();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300;
    const g = c.createGain();
    this._env(g, t0, 0.02, 0.6, 0.35);
    src.connect(hp).connect(g).connect(this.sfxGain);
    src.start(t0); src.stop(t0 + 0.7);
    this._tone({ freq: 440, type: 'triangle', dur: 0.5, gain: 0.16, slide: -220 });
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.22, delay: i * 0.12 }));
  }

  defeat() {
    [392, 329.63, 261.63, 196].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.45, gain: 0.14, delay: i * 0.14 }));
  }

  dispose() {
    try { this.ctx?.close(); } catch {}
    this.started = false;
  }
}
