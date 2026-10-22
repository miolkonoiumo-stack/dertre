/**
 * Player avatars: procedural low-poly characters with a visible skeleton-ish
 * rig (grouped limbs animated in code). No external assets required.
 */

import * as THREE from 'three';
import { PALETTE } from '@shared/constants.js';

const GEO = {
  torso: new THREE.CapsuleGeometry(0.34, 0.52, 4, 10),
  head: new THREE.SphereGeometry(0.27, 16, 12),
  visor: new THREE.BoxGeometry(0.40, 0.12, 0.10),
  limb: new THREE.CapsuleGeometry(0.11, 0.42, 3, 8),
  foot: new THREE.BoxGeometry(0.20, 0.11, 0.30),
};
const MAT_CACHE = new Map();

function mat(color, emissive, intensity = 0.35) {
  const key = `${color}-${emissive}-${intensity}`;
  if (!MAT_CACHE.has(key)) {
    MAT_CACHE.set(key, new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity: intensity, roughness: 0.42, metalness: 0.25,
    }));
  }
  return MAT_CACHE.get(key);
}

export class Avatar {
  constructor(colorIndex = 0) {
    const c = PALETTE[colorIndex % PALETTE.length];
    this.root = new THREE.Group();
    this.root.name = 'avatar';

    const bodyMat = mat(c.body, c.body, 0.28);
    const accentMat = mat(c.accent, c.body, 0.05);
    this.mats = [bodyMat, accentMat];

    // hips → torso → head
    this.hips = new THREE.Group();
    this.hips.position.y = 0.86;
    this.root.add(this.hips);

    const torso = new THREE.Mesh(GEO.torso, bodyMat);
    torso.position.y = 0.34;
    torso.castShadow = true;
    this.hips.add(torso);
    this.torso = torso;

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.30), accentMat);
    chest.position.y = 0.46;
    chest.castShadow = true;
    this.hips.add(chest);

    this.head = new THREE.Group();
    this.head.position.y = 0.82;
    this.hips.add(this.head);
    const skull = new THREE.Mesh(GEO.head, bodyMat);
    skull.castShadow = true;
    this.head.add(skull);
    const visor = new THREE.Mesh(GEO.visor, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    visor.position.set(0, 0.02, 0.19);
    this.head.add(visor);
    this.visor = visor;

    // Arms
    this.armL = new THREE.Group();
    this.armL.position.set(-0.40, 0.56, 0);
    this.hips.add(this.armL);
    const uaL = new THREE.Mesh(GEO.limb, bodyMat); uaL.position.y = -0.24; uaL.castShadow = true;
    this.armL.add(uaL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.40, 0.56, 0);
    this.hips.add(this.armR);
    const uaR = new THREE.Mesh(GEO.limb, bodyMat); uaR.position.y = -0.24; uaR.castShadow = true;
    this.armR.add(uaR);

    // Legs
    this.legL = new THREE.Group();
    this.legL.position.set(-0.16, 0, 0);
    this.hips.add(this.legL);
    const ll = new THREE.Mesh(GEO.limb, accentMat); ll.position.y = -0.30; ll.castShadow = true;
    this.legL.add(ll);
    const fl = new THREE.Mesh(GEO.foot, bodyMat); fl.position.set(0, -0.58, 0.06); fl.castShadow = true;
    this.legL.add(fl);

    this.legR = new THREE.Group();
    this.legR.position.set(0.16, 0, 0);
    this.hips.add(this.legR);
    const lr = new THREE.Mesh(GEO.limb, accentMat); lr.position.y = -0.30; lr.castShadow = true;
    this.legR.add(lr);
    const fr = new THREE.Mesh(GEO.foot, bodyMat); fr.position.set(0, -0.58, 0.06); fr.castShadow = true;
    this.legR.add(fr);

    // Ground ring to make the player readable from far away
    const ringGeo = new THREE.RingGeometry(0.46, 0.58, 24);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: c.body, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);

    // tag sprite (name) — canvas texture
    this.tag = null;
    this.phase = 0;
    this.state = 'idle';
    this.color = c;
    this.velocity = new THREE.Vector3();
  }

  setName(name) {
    if (this.tag) { this.root.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 30px Rajdhani, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = Math.min(248, ctx.measureText(name).width + 28);
    ctx.beginPath();
    ctx.roundRect(128 - w / 2, 10, w, 44, 12); ctx.fill();
    ctx.fillStyle = this.color.body;
    ctx.fillText(name, 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.y = 2.35;
    sprite.renderOrder = 10;
    this.tag = sprite;
    this.root.add(sprite);
  }

  /**
   * Animate from movement data. Called every frame.
   * @param {number} dt
   * @param {{vx:number,vy:number,vz:number,alive:boolean,onGround:boolean}} st
   */
  animate(dt, st) {
    const speed = Math.hypot(st.vx, st.vz);
    const run = Math.min(1, speed / 7);
    this.phase += dt * (4 + run * 14);

    if (!st.alive) {
      // ragdoll-ish collapse
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, -1.35, 1 - Math.exp(-dt * 6));
      this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, 0.35, 1 - Math.exp(-dt * 6));
      this.ring.material.opacity = Math.max(0, this.ring.material.opacity - dt);
      return;
    }

    const onGround = st.onGround;
    let legSwing = Math.sin(this.phase) * (0.25 + run * 0.85);
    let armSwing = -Math.sin(this.phase) * (0.2 + run * 0.9);

    if (!onGround) {
      const rising = st.vy > 0;
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, rising ? -0.7 : 0.35, 1 - Math.exp(-dt * 10));
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, rising ? 0.35 : -0.25, 1 - Math.exp(-dt * 10));
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -2.1, 1 - Math.exp(-dt * 10));
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -2.1, 1 - Math.exp(-dt * 10));
      this.armL.rotation.z = 0.35; this.armR.rotation.z = -0.35;
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, rising ? -0.15 : 0.12, 1 - Math.exp(-dt * 8));
    } else {
      this.legL.rotation.x = legSwing;
      this.legR.rotation.x = -legSwing;
      this.armL.rotation.x = armSwing;
      this.armR.rotation.x = -armSwing;
      this.armL.rotation.z = 0.12 + run * 0.12;
      this.armR.rotation.z = -0.12 - run * 0.12;
      const bob = Math.abs(Math.sin(this.phase)) * (0.02 + run * 0.06);
      this.hips.position.y = 0.86 + bob;
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, run * 0.16, 1 - Math.exp(-dt * 8));
    }
    this.visor.material.color.setHSL(0.5, 1, 0.65 + 0.2 * Math.sin(this.phase * 0.5));
    this.ring.material.opacity = 0.55 + run * 0.35;
  }

  setEliminated() {
    this.root.visible = false;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.material && o.material.map && o !== this.tag) { /* shared mats: skip */ }
      if (o === this.tag) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
