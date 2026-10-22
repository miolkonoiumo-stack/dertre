/**
 * The arena: 12x12 instanced tiles over a lava basin, industrial frame,
 * volumetric-ish backdrop (volcanic ridges, distant towers, ember sky).
 *
 * Tiles are a single InstancedMesh (144 instances) whose colors are updated in
 * place — no per-frame allocations, no object churn.
 */

import * as THREE from 'three';
import {
  GRID, TILE, GAP, TILE_TOP, PALETTE,
} from '@shared/constants.js';
import { tileCenter, makeRng, safeGroups } from '@shared/sim.js';

const SAFE_COLOR = new THREE.Color('#4dff2e');
const SAFE_DEEP = new THREE.Color('#1d7a12');
const LAVA_COLOR = new THREE.Color('#2a0703');
const LAVA_HOT = new THREE.Color('#ff5a1f');
const WARN_COLOR = new THREE.Color('#ffb020');   // "you are about to burn"
const PREVIEW_COLOR = new THREE.Color('#37e6ff'); // "run here"
const PREVIEW_DEEP = new THREE.Color('#0a4a5c');
const DECK_COLOR = new THREE.Color('#6d7a8c');    // opening-round safe deck
const DECK_DEEP = new THREE.Color('#31394a');
const TAKEN_COLOR = new THREE.Color('#ff3b6b');  // zone already occupied: do not run here
const TAKEN_DEEP = new THREE.Color('#5c0a1c');

export class Arena {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'arena';
    scene.add(this.group);

    this.tileColors = new Float32Array(GRID * GRID * 3);
    this.tilePulse = new Float32Array(GRID * GRID);
    this.safeMask = new Uint8Array(GRID * GRID);

    this._buildTiles();
    this._buildBasin();
    this._buildFrame();
    this._buildBackdrop();
    this._buildGuides();
  }

  // ── Tiles ─────────────────────────────────────────────────────────────────
  _buildTiles() {
    const geo = new THREE.BoxGeometry(TILE - GAP, 0.38, TILE - GAP);
    geo.translate(0, TILE_TOP - 0.19, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.55, metalness: 0.12,
      vertexColors: false,
    });
    this.tileMat = mat;
    const inst = new THREE.InstancedMesh(geo, mat, GRID * GRID);
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    inst.castShadow = this.quality !== 'low';
    inst.receiveShadow = true;

    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        const i = z * GRID + x;
        const c = tileCenter(x, z);
        m.makeTranslation(c.x, 0, c.z);
        inst.setMatrixAt(i, m);
        color.copy(LAVA_COLOR);
        inst.setColorAt(i, color);
        color.toArray(this.tileColors, i * 3);
      }
    }
    inst.instanceColor.needsUpdate = true;
    this.tiles = inst;
    this.group.add(inst);

    // Subtle grid lines on the top surface for readability
    const grid = new THREE.GridHelper(GRID * TILE, GRID, 0x000000, 0x000000);
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    grid.position.y = TILE_TOP + 0.005;
    this.group.add(grid);

    // Glowing trim around the whole arena
    const trimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID * TILE + 0.3, 0.42, GRID * TILE + 0.3));
    const trim = new THREE.LineSegments(trimGeo, new THREE.LineBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.75 }));
    trim.position.y = TILE_TOP - 0.19;
    this.group.add(trim);
    this.trim = trim;
  }

  // ── Lava basin under the tiles ────────────────────────────────────────────
  _buildBasin() {
    const size = GRID * TILE + 14;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHot: { value: new THREE.Color('#ff4a10') },
        uCool: { value: new THREE.Color('#3a0300') },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv; varying float vH;
        void main() {
          vUv = uv;
          vec3 p = position;
          float h = sin(p.x * 0.42 + uTime * 0.9) * 0.34
                  + sin(p.z * 0.57 - uTime * 0.7) * 0.28
                  + sin((p.x + p.z) * 0.9 + uTime * 1.7) * 0.13;
          p.y += h;
          vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uHot; uniform vec3 uCool; uniform float uFlash;
        varying vec2 vUv; varying float vH;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        void main() {
          vec2 uv = vUv * 9.0;
          float n = noise(uv + vec2(uTime * 0.18, uTime * 0.11));
          float n2 = noise(uv * 2.3 - vec2(uTime * 0.27, uTime * 0.2));
          float veins = smoothstep(0.55, 0.95, n * 0.6 + n2 * 0.55);
          float crest = smoothstep(-0.1, 0.6, vH);
          vec3 col = mix(uCool, uHot, veins * 0.85 + crest * 0.35);
          col += uHot * uFlash * 0.55;
          float glow = 0.55 + 0.45 * sin(uTime * 1.6 + n * 12.0);
          col *= 0.8 + 0.35 * glow;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const plane = new THREE.Mesh(geo, mat);
    plane.position.y = TILE_TOP - 2.6;
    plane.receiveShadow = false;
    this.basin = plane;
    this.basinMat = mat;
    this.group.add(plane);

    // Secondary mirrored surface for depth
    const under = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.85, 48),
      new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.22 }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = TILE_TOP - 6.2;
    this.group.add(under);
  }

  // ── Industrial frame around the arena ─────────────────────────────────────
  _buildFrame() {
    const half = GRID * TILE / 2 + 1.4;
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.42, metalness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f3a, emissive: 0xff5a1f, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.7,
    });

    const beam = new THREE.BoxGeometry(half * 2 + 2, 0.55, 0.55);
    for (const z of [-half, half]) {
      const b = new THREE.Mesh(beam, beamMat);
      b.position.set(0, 0.1, z); b.castShadow = true; b.receiveShadow = true;
      this.group.add(b);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.06, 0.06), accentMat);
      strip.position.set(0, 0.34, z + 0.3);
      this.group.add(strip);
    }
    const side = new THREE.BoxGeometry(0.55, 0.55, half * 2 + 2);
    for (const x of [-half, half]) {
      const b = new THREE.Mesh(side, beamMat);
      b.position.set(x, 0.1, 0); b.castShadow = true;
      this.group.add(b);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, half * 2), accentMat);
      strip.position.set(x - 0.3, 0.34, 0);
      this.group.add(strip);
    }

    // Support pylons down to the lava
    const pylonGeo = new THREE.CylinderGeometry(0.22, 0.32, 9, 8);
    for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
      const p = new THREE.Mesh(pylonGeo, beamMat);
      p.position.set(x, -4.4, z);
      p.castShadow = true;
      this.group.add(p);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 8), accentMat);
      cap.position.set(x, 0.42, z);
      this.group.add(cap);
    }
    this.accentMat = accentMat;
  }

  // ── Backdrop: volcanic ridges + distant towers ────────────────────────────
  _buildBackdrop() {
    const rng = makeRng(1337);
    const backdrop = new THREE.Group();
    backdrop.name = 'backdrop';

    // Ridges in a ring
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x120a0c, roughness: 0.95, metalness: 0.05 });
    const ridgeGlow = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.5 });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
      const r = 46 + rng() * 26;
      const h = 12 + rng() * 26;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(8 + rng() * 9, h, 5 + ((rng() * 3) | 0)), ridgeMat);
      cone.position.set(Math.cos(a) * r, h / 2 - 12, Math.sin(a) * r);
      cone.rotation.y = rng() * Math.PI;
      backdrop.add(cone);
      if (rng() < 0.4) {
        const glow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.2, 6), ridgeGlow);
        glow.position.set(cone.position.x, cone.position.y + h / 2 + 0.4, cone.position.z);
        backdrop.add(glow);
      }
    }

    // Distant industrial towers
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x0e1016, roughness: 0.6, metalness: 0.6, emissive: 0x1b0600, emissiveIntensity: 0.6 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = 34 + rng() * 22;
      const h = 8 + rng() * 22;
      const w = 1.4 + rng() * 2.6;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), towerMat);
      tower.position.set(Math.cos(a) * r, h / 2 - 14, Math.sin(a) * r);
      backdrop.add(tower);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), lightMat);
      lamp.position.copy(tower.position).add(new THREE.Vector3(0, h / 2 + 0.2, 0));
      backdrop.add(lamp);
    }

    // Ember sky dome
    const skyGeo = new THREE.SphereGeometry(160, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color('#05030a') }, uBot: { value: new THREE.Color('#3a0d05') } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP;
        void main(){
          float h = normalize(vP).y * 0.5 + 0.5;
          vec3 c = mix(uBot, uTop, smoothstep(0.35, 0.85, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    backdrop.add(new THREE.Mesh(skyGeo, skyMat));

    this.scene.add(backdrop);
    this.backdrop = backdrop;
  }

  // ── Faint floating guide rings under the arena ───────────────────────────
  _buildGuides() {
    const geo = new THREE.TorusGeometry(GRID * TILE * 0.78, 0.035, 6, 96);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.35 });
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(geo, mat);
      t.rotation.x = Math.PI / 2;
      t.position.y = -3.5 - i * 1.6;
      t.scale.setScalar(1 + i * 0.06);
      this.group.add(t);
    }
  }

  // ── Runtime ───────────────────────────────────────────────────────────────
  /** Set the safe mask (Uint8Array 144). Triggers color transition. */
  setSafe(safe) {
    this.safeMask.set(safe);
  }
  /**
   * Round 1 makes the whole floor safe so nobody dies for free. Rendering that
   * as 144 identical green tiles looks like a bug, so we use a dim "safe deck"
   * look instead and let the lava show at the arena edges as a visual cue.
   */
  setAllSafe(on) {
    this.allSafe = !!on;
  }

  /**
   * Show the UPCOMING safe layout during the warning phase, so players can run
   * to safety before the floor changes. Without this preview the mechanic is
   * pure guesswork and only bots (which read the layout directly) can win.
   * @param {Uint8Array|null} pending
   * @param {number} strength 0..1 fade-in
   */
  setPending(pending, strength = 0) {
    this.pendingMask = pending;
    this.pendingStrength = strength;
    // Group index of each pending safe tile, so a whole zone can be recoloured
    // when it is already taken. Recomputed only when the mask object changes.
    if (pending !== this._pendingForGroups) {
      this._pendingForGroups = pending;
      const gid = new Int16Array(GRID * GRID).fill(-1);
      if (pending) {
        const groups = safeGroups(pending);
        groups.forEach((g, gi) => { for (const i of g) gid[i] = gi; });
      }
      this.pendingGroupOf = gid;
    }
  }

  /**
   * Mark which upcoming-zone indexes are already taken by somebody.
   * A green zone you can see is "taken" must look taken, otherwise the player
   * runs into a full zone and dies while standing on green floor.
   * @param {number[]|null} taken zone indexes at capacity
   */
  setTakenZones(taken) {
    this.takenZones = taken ? new Set(taken) : null;
  }

  /**
   * Per-frame visual update.
   * @param {number} t seconds
   * @param {number} pulse 0..1 warning intensity (blinking before a swap)
   * @param {number} flash 0..1 swap flash
   */
  update(t, pulse = 0, flash = 0) {
    const col = new THREE.Color();
    const blink = 0.5 + 0.5 * Math.sin(t * 14);
    const pend = this.pendingMask;
    const ps = this.pendingStrength || 0;
    for (let i = 0; i < this.safeMask.length; i++) {
      const s = this.safeMask[i];
      // Neutral deck: EVERY tile is plain steel. Used before the safe zones
      // appear, so the floor never opens as a wall of lava.
      if (this.allSafe) {
        const steel = 0.55 + 0.12 * Math.sin(t * 1.1 + i * 0.5);
        col.copy(DECK_DEEP).lerp(DECK_COLOR, steel);
        col.r = Math.min(1, col.r);
        col.g = Math.min(1, col.g);
        col.b = Math.min(1, col.b);
        this.tiles.setColorAt(i, col);
        continue;
      }
      if (s) {
        // Safe tiles must read as UNMISTAKABLY safe at all times, not only
        // during the warning blink. Previously the blend was gated on `pulse`,
        // which is 0 for most of the round, so safe tiles looked like dim lava.
        const k = 0.82 + pulse * 0.18 * blink;
        col.copy(SAFE_DEEP).lerp(SAFE_COLOR, k);
        col.multiplyScalar(1 + flash * 0.15);
        // Tiles that will stop being safe flash an urgent amber warning. Tuned
        // to read as a clear "this is leaving" without competing with the cyan
        // destination markers, which are the information players act on.
        if (pend && ps > 0 && !pend[i]) {
          col.copy(WARN_COLOR).lerp(LAVA_HOT, 0.30 + 0.20 * blink);
          col.multiplyScalar(1 + ps * 0.08);
        }
      } else {
        // Lava stays clearly red-hot so it never reads as "just dark floor".
        const wob = 0.42 + 0.1 * Math.sin(t * 2.2 + i * 0.7);
        col.copy(LAVA_COLOR).lerp(LAVA_HOT, Math.min(0.92, wob + flash * 0.2));
        // Tiles that are ABOUT to become safe glow cyan: this is the runway.
        // The destination must be STEADY, not a blink: players have ~2s to read
        // the whole arena and sprint, and a flickering marker reads as noise.
        if (pend && ps > 0 && pend[i]) {
          const pulseIn = 0.86 + 0.14 * Math.sin(t * 5);   // gentle breathing only
          col.copy(PREVIEW_DEEP).lerp(PREVIEW_COLOR, pulseIn);
          col.multiplyScalar(1 + ps * 0.35);
          // A zone that is already full turns magenta-red: do not run there.
          if (this.takenZones && this.takenZones.has(this.pendingGroupOf?.[i])) {
            col.copy(TAKEN_DEEP).lerp(TAKEN_COLOR, 0.75 + 0.25 * blink);
          }
        }
      }
      // Instance colours are multiplied by the material colour; anything above
      // 1.0 used to blow out to pure white and hide the tile pattern entirely.
      col.r = Math.min(1, col.r);
      col.g = Math.min(1, col.g);
      col.b = Math.min(1, col.b);
      this.tiles.setColorAt(i, col);
    }
    this.tiles.instanceColor.needsUpdate = true;

    this.basinMat.uniforms.uTime.value = t;
    this.basinMat.uniforms.uFlash.value = flash;
    this.trim.material.opacity = 0.55 + 0.3 * Math.sin(t * 3) + flash * 0.25;
    this.accentMat.emissiveIntensity = 0.45 + 0.3 * blink * pulse + flash * 0.4;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    this.scene.remove(this.group);
    if (this.backdrop) {
      this.backdrop.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
      });
      this.scene.remove(this.backdrop);
    }
  }
}

export { PALETTE };
