/**
 * Renderer, camera rig, lighting and post-processing.
 * Quality tiers degrade gracefully: low = no shadows/bloom, fewer particles.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GRID, TILE } from '@shared/constants.js';

export class World {
  constructor(canvas, { quality = 'high', bloom = true, shadows = true } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.useBloom = bloom;
    this.useShadows = shadows;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = shadows && quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // Warm haze, much lighter than the old 0x140709 dungeon fog. A bright scene
    // is what makes toy characters read as friendly instead of menacing.
    this.scene.fog = new THREE.FogExp2(0x2a1a24, 0.0085);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
    this.camera.position.set(0, 14, 20);

    this._lights();
    this._composer();
    this.resize();
    window.addEventListener('resize', this._onResize = () => this.resize());

    // Context loss handling
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; }, false);
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    return Math.min(dpr, cap);
  }

  _lights() {
    // Neutral sky / warm ground bounce. The old ground colour was 0xff3300 at
    // 0.55: it washed every surface in orange, so the GREEN safe tiles rendered
    // as r=1 g=0.36 b=0.02 (orange) and the player literally could not see where
    // it was safe. Ambient must stay neutral; colour belongs to the tiles.
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6b5a52, 0.95);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfffaf0, 1.85);
    key.position.set(12, 26, 10);
    key.castShadow = this.renderer.shadowMap.enabled;
    if (key.castShadow) {
      const s = GRID * TILE * 0.75;
      key.shadow.camera.left = -s; key.shadow.camera.right = s;
      key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
      key.shadow.camera.near = 1; key.shadow.camera.far = 80;
      key.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
      key.shadow.bias = -0.0008;
      key.shadow.normalBias = 0.03;
      key.shadow.radius = 3;
    }
    this.scene.add(key);
    this.key = key;

    // Cool fill from the opposite side: kills the "flat lit sprite" look and
    // gives the toy bodies a readable rim.
    const fill = new THREE.DirectionalLight(0x8fc6ff, 0.55);
    fill.position.set(-14, 10, -12);
    this.scene.add(fill);
    this.fill = fill;

    // Lava bounce light, kept WEAK and BELOW the deck. At intensity 22 it dyed
    // the top surface of every tile orange and destroyed the green/red contrast
    // that the whole game depends on. The lava glow is carried by the basin
    // shader and bloom instead.
    this.lavaLight = new THREE.PointLight(0xff4010, 3.5, 26, 2);
    this.lavaLight.position.set(0, -4.5, 0);
    this.scene.add(this.lavaLight);

    // Two accents that react to the round
    this.accents = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0x55e8ff, 8, 28, 2);
      this.scene.add(l);
      this.accents.push(l);
    }
  }

  _composer() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (this.useBloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.7, 0.72);
      this.composer.addPass(this.bloomPass);
    }
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  setBloom(on) {
    this.useBloom = on;
    if (this.bloomPass) this.bloomPass.enabled = on;
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(this._pixelRatio());
    const shadowsOn = this.useShadows && q !== 'low';
    this.renderer.shadowMap.enabled = shadowsOn;
    this.key.castShadow = shadowsOn;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  onResize() { this.resize(); }

  render(t) {
    if (this.contextLost) return;
    const l = this.lavaLight;
    l.intensity = 18 + Math.sin(t * 2.3) * 4 + Math.sin(t * 7.1) * 1.5;
    this.accents.forEach((a, i) => {
      const ang = t * 0.35 + i * Math.PI;
      a.position.set(Math.cos(ang) * 12, 6 + Math.sin(t * 0.8 + i) * 2, Math.sin(ang) * 12);
    });
    if (this.useBloom || this.bloomPass?.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}

/**
 * Third-person orbit camera that follows a target with damping.
 * Handles mouse/touch look, collision-free zoom (simple), and spectator mode.
 */
export class CameraRig {
  constructor(camera, { sensitivity = 0.9, invertY = false } = {}) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.42;
    this.dist = 11;
    this.target = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.sensitivity = sensitivity;
    this.invertY = invertY;
    this.mode = 'follow';
    this.smoothPos = new THREE.Vector3(0, 14, 20);
    this.smoothLook = new THREE.Vector3(0, 0, 0);
    this.shake = 0;
  }

  addLook(dx, dy) {
    this.yaw -= (dx / 1000) * this.sensitivity * 2.2;
    this.pitch += (dy / 1000) * this.sensitivity * 1.8 * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.15, 1.25);
  }

  kick(amount = 0.4) { this.shake = Math.min(1, this.shake + amount); }

  follow(pos, dt) {
    this.target.set(pos.x, pos.y + 1.5, pos.z);
  }

  spectator(center, dt) {
    this.mode = 'spectator';
    this.target.set(center.x, center.y + 1, center.z);
    this.yaw += dt * 0.15;
    this.pitch = 0.72;
    this.dist = 26;
  }

  update(dt) {
    // Follow: the camera sits behind the yaw on a sphere around the player.
    const dist = this.dist;
    const cp = Math.cos(this.pitch);
    const offX = Math.sin(this.yaw) * cp * dist;
    const offZ = Math.cos(this.yaw) * cp * dist;
    const offY = Math.sin(this.pitch) * dist + 1.2;

    const desired = new THREE.Vector3(this.target.x + offX, this.target.y + offY, this.target.z + offZ);
    const k = 1 - Math.exp(-dt * (this.mode === 'spectator' ? 2.2 : 9));
    this.smoothPos.lerp(desired, k);
    this.smoothLook.lerp(this.target, 1 - Math.exp(-dt * 14));

    // shake
    let sx = 0, sy = 0, sz = 0;
    if (this.shake > 0.001) {
      const s = this.shake * 0.45;
      sx = (Math.random() - 0.5) * s; sy = (Math.random() - 0.5) * s; sz = (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 6);
    }

    this.camera.position.set(this.smoothPos.x + sx, this.smoothPos.y + sy, this.smoothPos.z + sz);
    this.camera.lookAt(this.smoothLook);
  }
}
