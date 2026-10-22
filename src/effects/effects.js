/**
 * GPU-friendly particle pools: embers, elimination bursts, landing dust,
 * lava splashes. One Points object per pool, recycled — no GC churn.
 */

import * as THREE from 'three';

class SpritePool {
  constructor(scene, count, { size = 0.4, color = 0xffcc66, gravity = -3, drag = 1.2, additive = true } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.cursor = 0;
    this.gravity = gravity;
    this.drag = drag;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float aLife; attribute float aSize;
        uniform float uScale; varying float vLife;
        void main(){
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.001, -mv.z) * (0.4 + aLife);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vLife;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5 || vLife <= 0.0) discard;
          float a = smoothstep(0.5, 0.0, r) * vLife;
          gl_FragColor = vec4(uColor * (0.6 + vLife * 0.8), a);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    this.mat = mat;
    // Park unused particles far below the world
    for (let i = 0; i < count; i++) { this.pos[i * 3 + 1] = -999; }
    scene.add(this.points);
  }

  emit(x, y, z, opts = {}) {
    const {
      vx = 0, vy = 0, vz = 0, spread = 1, life = 1, size = 0.4, up = 0,
    } = opts;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 1] = vy + Math.random() * spread + up;
    this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size * (0.6 + Math.random() * 0.8);
  }

  update(dt) {
    const { pos, vel, life } = this;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= dt / Math.max(0.0001, this.maxLife[i]);
      if (life[i] <= 0) { pos[i * 3 + 1] = -999; continue; }
      vel[i * 3 + 1] += this.gravity * dt;
      const d = Math.exp(-this.drag * dt);
      vel[i * 3] *= d; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aLife.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.geo.dispose(); this.mat.dispose();
  }
}

export class Effects {
  constructor(scene, { particles = true } = {}) {
    this.scene = scene;
    this.enabled = particles;
    this.embers = new SpritePool(scene, 160, { color: 0xffaa44, gravity: 1.6, drag: 0.4, size: 0.14 });
    this.bursts = new SpritePool(scene, 220, { color: 0xff6a3d, gravity: -6, drag: 2.2, size: 0.34 });
    this.dust = new SpritePool(scene, 90, { color: 0xd9c6a5, gravity: -2.5, drag: 3.4, size: 0.24, additive: false });
    this.sparks = new SpritePool(scene, 110, { color: 0xffe08a, gravity: -9, drag: 1.4, size: 0.2 });
    this.timer = 0;
    this.flash = 0;
    this.shakeFn = null;
  }

  /** Ambient embers rising from the lava. Kept sparse on purpose: heavy embers
   *  made it impossible to see your own avatar move. */
  ambient(dt, count = 1) {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.16;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 16;
      this.embers.emit(Math.cos(a) * r, -2.4, Math.sin(a) * r, {
        up: 0.8 + Math.random() * 1.4, spread: 0.3, life: 2.4 + Math.random() * 2, size: 0.12,
      });
    }
  }

  land(x, z) {
    if (!this.enabled) return;
    for (let i = 0; i < 10; i++) {
      this.dust.emit(x, 0.05, z, { spread: 2.6, vy: 0.4, life: 0.55, size: 0.3 });
    }
  }

  death(x, y, z, color = 0xff6633) {
    this.bursts.mat.uniforms.uColor.value.set(color);
    for (let i = 0; i < 34; i++) {
      this.bursts.emit(x, y + 0.8, z, {
        spread: 9, vy: 4, life: 0.9 + Math.random() * 0.8, size: 0.3,
      });
    }
    for (let i = 0; i < 14; i++) {
      this.sparks.emit(x, y + 0.8, z, { spread: 12, vy: 6, life: 0.8, size: 0.16 });
    }
    // A full-screen white flash made the arena unreadable; keep it as a tint.
    this.flash = 0.45;
    this.shakeFn?.(0.35);
  }

  splash(x, z) {
    if (!this.enabled) return;
    for (let i = 0; i < 12; i++) {
      this.sparks.emit(x, -0.3, z, { spread: 4.5, vy: 7 + Math.random() * 4, life: 0.9, size: 0.18 });
    }
  }

  swapBurst(safeTiles) {
    if (!this.enabled) return;
    this.flash = 0.35;
    this.shakeFn?.(0.2);
    for (let i = 0; i < safeTiles.length; i += 3) {
      const t = safeTiles[i];
      this.embers.emit(t.x, -0.2, t.z, { up: 2.4, spread: 0.6, life: 1.4, size: 0.3 });
    }
  }

  update(dt, { x = 0, z = 0 } = {}) {
    this.ambient(dt);
    this.embers.update(dt);
    this.bursts.update(dt);
    this.dust.update(dt);
    this.sparks.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    return this.flash;
  }

  dispose() {
    this.embers.dispose(); this.bursts.dispose(); this.dust.dispose(); this.sparks.dispose();
  }
}
