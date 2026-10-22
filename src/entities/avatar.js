/**
 * Player avatars — chunky toy characters (Fall Guys / Roblox energy).
 *
 * Design pillars, all achieved with primitives (no external assets):
 *  - BIG head, small body, stubby limbs: reads at a glance from any camera angle.
 *  - Thick black outline shells so characters pop against a busy arena.
 *  - Expressive face: two big eyes that blink and look where the body travels.
 *  - Per-character personality: headgear, ears, antennae, horns, fins.
 *  - Squash & stretch on jump/land, lean into turns, idle breathing.
 *
 * The rig exposes the same public surface as before (root/hips/head/armL/armR/
 * legL/legR/ring/tag/animate/setName/setEliminated) so nothing else has to
 * change. Only the visuals are new.
 */

import * as THREE from 'three';
import { PALETTE } from '@shared/constants.js';

// ── Shared geometry (built once, reused by every avatar) ────────────────────
const GEO = {
  // Head is the character: oversized, slightly squashed sphere.
  head: new THREE.SphereGeometry(0.46, 24, 18),
  // Rotund little torso, wider at the bottom.
  torso: new THREE.CapsuleGeometry(0.32, 0.30, 6, 16),
  belly: new THREE.SphereGeometry(0.30, 18, 14),
  // Stubby limbs.
  arm: new THREE.CapsuleGeometry(0.115, 0.26, 4, 10),
  leg: new THREE.CapsuleGeometry(0.135, 0.24, 4, 10),
  // Chunky boot.
  foot: new THREE.SphereGeometry(0.17, 14, 10),
  // Eye: white ball + pupil.
  eye: new THREE.SphereGeometry(0.135, 16, 12),
  pupil: new THREE.SphereGeometry(0.072, 12, 10),
  // Rim rings for headgear.
  rim: new THREE.TorusGeometry(0.40, 0.055, 8, 24),
  horn: new THREE.ConeGeometry(0.09, 0.26, 8),
  ear: new THREE.SphereGeometry(0.15, 12, 10),
  fin: new THREE.ConeGeometry(0.20, 0.34, 4),
  antenna: new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6),
  bulb: new THREE.SphereGeometry(0.095, 12, 10),
  goggle: new THREE.TorusGeometry(0.17, 0.045, 8, 18),
  cap: new THREE.SphereGeometry(0.47, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
  visorBand: new THREE.BoxGeometry(0.86, 0.17, 0.10),
};

const MAT_CACHE = new Map();

/**
 * Frothy, slightly rounded material. `roughness` stays high so the characters
 * read as vinyl toys, not chrome — chrome is illegible on a bright arena.
 */
function toyMat(color, { emissive = 0x000000, emissiveIntensity = 0, roughness = 0.62, metalness = 0.02 } = {}) {
  const key = `${color}|${emissive}|${emissiveIntensity}|${roughness}|${metalness}`;
  if (!MAT_CACHE.has(key)) {
    MAT_CACHE.set(key, new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity, roughness, metalness,
      flatShading: false,
    }));
  }
  return MAT_CACHE.get(key);
}

/** Thick cartoon outline: a back-facing shell rendered slightly larger. */
function outlineMat() {
  if (!MAT_CACHE.has('__outline')) {
    MAT_CACHE.set('__outline', new THREE.MeshBasicMaterial({
      color: 0x0b0d14, side: THREE.BackSide,
    }));
  }
  return MAT_CACHE.get('__outline');
}

const OUTLINE_SCALE = 1.055;

/**
 * Adds `mesh` to `parent` plus a matching back-face shell in the same place.
 * The shell is what gives the toy the sticker-like silhouette.
 */
function outlined(mesh, parent, scale = OUTLINE_SCALE) {
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  parent.add(mesh);
  if (mesh.geometry) {
    const shell = new THREE.Mesh(mesh.geometry, outlineMat());
    shell.scale.setScalar(scale);
    shell.renderOrder = -1;
    mesh.add(shell);
  }
  return mesh;
}

// ── Headgear personalities ──────────────────────────────────────────────────
// Each returns a group that is parented to the head. Purely decorative.
const HEADGEAR = {
  antennae(head, mats) {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const stem = new THREE.Mesh(GEO.antenna, mats.dark);
      stem.position.set(side * 0.17, 0.44, 0);
      stem.rotation.z = side * 0.32;
      outlined(stem, g, 1.12);
      const bulb = new THREE.Mesh(GEO.bulb, mats.glow);
      bulb.position.set(side * 0.30, 0.62, 0);
      g.add(bulb);
    }
    head.add(g);
    return g;
  },
  horns(head, mats) {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(GEO.horn, mats.accent);
      horn.position.set(side * 0.29, 0.36, 0.02);
      horn.rotation.z = side * 0.45;
      outlined(horn, g, 1.1);
    }
    head.add(g);
    return g;
  },
  cap(head, mats) {
    const g = new THREE.Group();
    const cap = new THREE.Mesh(GEO.cap, mats.accent);
    cap.position.y = 0.06;
    cap.scale.set(1.02, 0.82, 1.02);
    outlined(cap, g, 1.03);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.065, 20, 1, false, 0, Math.PI), mats.accent);
    brim.position.set(0, 0.06, 0.34);
    brim.rotation.x = -0.12;
    outlined(brim, g, 1.04);
    head.add(g);
    return g;
  },
  goggles(head, mats) {
    const g = new THREE.Group();
    const band = new THREE.Mesh(GEO.visorBand, mats.dark);
    band.position.set(0, 0.20, 0.02);
    band.scale.set(1, 1, 1);
    outlined(band, g, 1.06);
    const bandBack = new THREE.Mesh(GEO.visorBand, mats.dark);
    bandBack.position.set(0, 0.20, -0.02);
    bandBack.rotation.y = Math.PI / 2;
    bandBack.scale.set(0.86, 1, 1);
    g.add(bandBack);
    head.add(g);
    return g;
  },
  ears(head, mats) {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(GEO.ear, mats.accent);
      ear.position.set(side * 0.40, 0.22, -0.04);
      ear.scale.set(0.62, 1, 0.62);
      outlined(ear, g, 1.09);
    }
    head.add(g);
    return g;
  },
  fin(head, mats) {
    const g = new THREE.Group();
    const fin = new THREE.Mesh(GEO.fin, mats.accent);
    fin.position.set(0, 0.46, -0.06);
    fin.scale.set(0.55, 1, 0.85);
    outlined(fin, g, 1.1);
    head.add(g);
    return g;
  },
  rim(head, mats) {
    const g = new THREE.Group();
    const rim = new THREE.Mesh(GEO.rim, mats.glow);
    rim.position.y = 0.24;
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    head.add(g);
    return g;
  },
  crown(head, mats) {
    const g = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.13, 16), mats.glow);
    band.position.y = 0.40;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(GEO.horn, mats.glow);
      spike.position.set(Math.cos(a) * 0.26, 0.55, Math.sin(a) * 0.26);
      spike.scale.set(0.7, 0.85, 0.7);
      outlined(spike, g, 1.1);
    }
    head.add(g);
    return g;
  },
};

const HEADGEAR_KINDS = Object.keys(HEADGEAR);

export class Avatar {
  /**
   * @param {number} colorIndex index into PALETTE
   * @param {number} [variant] which headgear to wear; defaults to colorIndex
   */
  constructor(colorIndex = 0, variant = null) {
    const c = PALETTE[colorIndex % PALETTE.length];
    this.root = new THREE.Group();
    this.root.name = 'avatar';

    // Body / accent / glow. Glow is the emissive "toy LED" trim.
    const bodyMat = toyMat(c.body, { roughness: 0.55 });
    const accentMat = toyMat(c.accent, { roughness: 0.6 });
    const darkMat = toyMat(0x14161f, { roughness: 0.72 });
    const whiteMat = toyMat(0xfdfdff, { roughness: 0.42 });
    const pupilMat = toyMat(0x141018, { roughness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: c.body, emissive: c.body, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.1,
    });
    this.mats = [bodyMat, accentMat, glowMat];
    this._glowMat = glowMat;

    // ── Hips: the animated root of the body ─────────────────────────────────
    this.hips = new THREE.Group();
    this.hips.position.y = 0.80;
    this.root.add(this.hips);
    this.hipsBaseY = 0.80;

    // Torso: a fat little pod.
    const torso = new THREE.Mesh(GEO.torso, bodyMat);
    torso.position.y = 0.30;
    outlined(torso, this.hips);
    this.torso = torso;

    // Belly patch in the accent colour: gives the toy its "outfit".
    const belly = new THREE.Mesh(GEO.belly, accentMat);
    belly.position.set(0, 0.20, 0.16);
    belly.scale.set(1.02, 0.86, 0.72);
    this.hips.add(belly);

    // Collar ring: a bright band that separates head from body.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.052, 8, 22), glowMat);
    collar.position.y = 0.56;
    collar.rotation.x = Math.PI / 2;
    this.hips.add(collar);

    // ── Head: oversized, the whole personality ──────────────────────────────
    this.head = new THREE.Group();
    this.head.position.y = 0.86;
    this.hips.add(this.head);

    const skull = new THREE.Mesh(GEO.head, bodyMat);
    skull.scale.set(1, 0.94, 1);
    outlined(skull, this.head, 1.045);
    this.skull = skull;

    // Eyes: big, white, with dark pupils. Grouped so pupils can look around.
    this.eyes = [];
    this.pupils = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(GEO.eye, whiteMat);
      eye.position.set(side * 0.175, 0.05, 0.375);
      eye.scale.set(0.92, 1.05, 0.7);
      eye.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.148, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x120f16, side: THREE.BackSide }),
      ));
      this.head.add(eye);
      this.eyes.push(eye);

      const pupil = new THREE.Mesh(GEO.pupil, pupilMat);
      pupil.position.set(0, 0, 0.085);
      eye.add(pupil);
      this.pupils.push(pupil);
    }
    this.blinkTimer = 1 + Math.random() * 3;

    // Mouth: a small dark capsule, tilted into a grin.
    const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.10, 3, 8), pupilMat);
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0, -0.19, 0.415);
    mouth.scale.set(1, 1, 0.55);
    this.head.add(mouth);
    this.mouth = mouth;

    // Cheeks: two soft blush dots.
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), toyMat(c.accent, { roughness: 0.85 }));
      cheek.position.set(side * 0.255, -0.11, 0.34);
      cheek.scale.set(1, 0.7, 0.4);
      this.head.add(cheek);
    }

    // ── Headgear (personality) ──────────────────────────────────────────────
    const kind = HEADGEAR_KINDS[(variant ?? colorIndex) % HEADGEAR_KINDS.length];
    this.headgearKind = kind;
    this.headgear = HEADGEAR[kind](this.head, { accent: accentMat, dark: darkMat, glow: glowMat });

    // ── Arms: stubby, hanging from the shoulders ────────────────────────────
    this.armL = new THREE.Group();
    this.armL.position.set(-0.34, 0.48, 0);
    this.hips.add(this.armL);
    outlined(new THREE.Mesh(GEO.arm, bodyMat), this.armL);
    const handL = new THREE.Mesh(GEO.foot, accentMat);
    handL.position.y = -0.26;
    handL.scale.setScalar(0.82);
    this.armL.add(handL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.34, 0.48, 0);
    this.hips.add(this.armR);
    outlined(new THREE.Mesh(GEO.arm, bodyMat), this.armR);
    const handR = new THREE.Mesh(GEO.foot, accentMat);
    handR.position.y = -0.26;
    handR.scale.setScalar(0.82);
    this.armR.add(handR);

    // ── Legs: short, with big boots ─────────────────────────────────────────
    this.legL = new THREE.Group();
    this.legL.position.set(-0.155, 0.06, 0);
    this.hips.add(this.legL);
    outlined(new THREE.Mesh(GEO.leg, accentMat), this.legL);
    const bootL = new THREE.Mesh(GEO.foot, darkMat);
    bootL.position.set(0, -0.27, 0.045);
    bootL.scale.set(1.05, 0.82, 1.35);
    bootL.castShadow = true;
    this.legL.add(bootL);

    this.legR = new THREE.Group();
    this.legR.position.set(0.155, 0.06, 0);
    this.hips.add(this.legR);
    outlined(new THREE.Mesh(GEO.leg, accentMat), this.legR);
    const bootR = new THREE.Mesh(GEO.foot, darkMat);
    bootR.position.set(0, -0.27, 0.045);
    bootR.scale.set(1.05, 0.82, 1.35);
    bootR.castShadow = true;
    this.legR.add(bootR);

    // ── Ground ring: readability at distance + team colour ──────────────────
    const ringGeo = new THREE.RingGeometry(0.50, 0.66, 32);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: c.body, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    // Soft contact shadow blob: sells the "toy standing on a plate" look and
    // keeps the character readable even when real shadows are disabled.
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    this.root.add(blob);
    this.blob = blob;

    this.tag = null;
    this.phase = Math.random() * Math.PI * 2;   // desyncs idle animations
    this.state = 'idle';
    this.color = c;
    this.velocity = new THREE.Vector3();

    // Animation state
    this._squash = 0;        // >0 stretch (jumping), <0 squash (landing)
    this._wasAirborne = false;
    this._lookX = 0;
    this._lookZ = 0;
  }

  /** Update the floating name tag. Same visual contract as before. */
  setName(name) {
    if (this.tag) {
      this.root.remove(this.tag);
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 52px Rajdhani, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    const w = Math.min(500, ctx.measureText(name).width + 56);
    // Rounded pill with a solid dark body and a colour bar on the left.
    ctx.fillStyle = 'rgba(10,12,20,0.82)';
    ctx.beginPath();
    ctx.roundRect(256 - w / 2, 22, w, 84, 26);
    ctx.fill();

    ctx.strokeStyle = this.color.body;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(256 - w / 2, 22, w, 84, 26);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, 256, 66);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    }));
    sprite.scale.set(3.2, 0.8, 1);
    sprite.position.y = 2.55;
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
    this.phase += dt * (3.2 + run * 15);
    const ease = (k) => 1 - Math.exp(-dt * k);

    // ── Eliminated: flop forward and sink ───────────────────────────────────
    if (!st.alive) {
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, -1.35, ease(6));
      this.hips.position.y = THREE.MathUtils.lerp(this.hips.position.y, 0.30, ease(6));
      this.head.rotation.z = THREE.MathUtils.lerp(this.head.rotation.z, 0.5, ease(4));
      this.ring.material.opacity = Math.max(0, this.ring.material.opacity - dt);
      this.blob.material.opacity = Math.max(0, this.blob.material.opacity - dt * 0.8);
      for (const e of this.eyes) e.scale.y = THREE.MathUtils.lerp(e.scale.y, 0.12, ease(9));
      return;
    }

    const onGround = st.onGround;

    // ── Squash & stretch ────────────────────────────────────────────────────
    if (!onGround && this._wasAirborne === false) {
      this._squash = 0.55;                       // took off: stretch
    } else if (onGround && this._wasAirborne === true) {
      this._squash = -0.65;                      // landed: squash
    }
    this._wasAirborne = !onGround;
    this._squash *= Math.exp(-dt * 7);

    const sy = 1 + this._squash * 0.5;
    const sxz = 1 - this._squash * 0.30;
    this.hips.scale.set(sxz, sy, sxz);

    // ── Limbs ───────────────────────────────────────────────────────────────
    if (!onGround) {
      const rising = st.vy > 0;
      // Tuck legs, throw arms up: the classic "wahey!" jump pose.
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, rising ? -0.95 : 0.55, ease(11));
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, rising ? 0.45 : -0.35, ease(11));
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -2.35, ease(11));
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -2.35, ease(11));
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, 0.55, ease(9));
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, -0.55, ease(9));
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, rising ? -0.18 : 0.14, ease(8));
    } else {
      // Waddle-run: exaggerated leg swing and counter-swinging arms.
      const legSwing = Math.sin(this.phase) * (0.22 + run * 1.0);
      const armSwing = -Math.sin(this.phase) * (0.18 + run * 1.05);
      this.legL.rotation.x = legSwing;
      this.legR.rotation.x = -legSwing;
      this.armL.rotation.x = armSwing;
      this.armR.rotation.x = -armSwing;
      this.armL.rotation.z = 0.16 + run * 0.16;
      this.armR.rotation.z = -0.16 - run * 0.16;

      // Bob + idle breathing when standing still.
      const bob = Math.abs(Math.sin(this.phase)) * (0.015 + run * 0.075);
      const breathe = Math.sin(this.phase * 0.42) * 0.012 * (1 - run);
      this.hips.position.y = this.hipsBaseY + bob + breathe;
      // Lean into the sprint.
      this.hips.rotation.x = THREE.MathUtils.lerp(this.hips.rotation.x, run * 0.20, ease(8));
    }

    // ── Head: counter-rotate slightly, hover on the body ────────────────────
    const headBob = Math.sin(this.phase * 0.5) * 0.012 * (1 - run);
    this.head.position.y = 0.86 + headBob;
    this.head.rotation.z = THREE.MathUtils.lerp(
      this.head.rotation.z, -Math.sin(this.phase) * run * 0.07, ease(9),
    );
    this.head.rotation.x = THREE.MathUtils.lerp(this.head.rotation.x, run * -0.06, ease(8));

    // ── Eyes: pupils track travel direction, plus periodic blinks ───────────
    if (speed > 0.6) {
      this._lookX = THREE.MathUtils.lerp(this._lookX, THREE.MathUtils.clamp(st.vx / 7, -1, 1), ease(8));
      this._lookZ = THREE.MathUtils.lerp(this._lookZ, THREE.MathUtils.clamp(st.vz / 7, -1, 1), ease(8));
    } else {
      this._lookX = THREE.MathUtils.lerp(this._lookX, 0, ease(5));
      this._lookZ = THREE.MathUtils.lerp(this._lookZ, 0, ease(5));
    }
    for (const p of this.pupils) {
      p.position.x = this._lookX * 0.045;
      p.position.z = 0.085 + Math.abs(this._lookZ) * this._lookZ * 0.02;
    }

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) this.blinkTimer = 2.2 + Math.random() * 3.4;
    const blink = this.blinkTimer < 0.11 ? 0.12 : 1;
    for (const e of this.eyes) {
      e.scale.y = THREE.MathUtils.lerp(e.scale.y, 1.05 * blink, ease(26));
    }

    // Mouth widens when sprinting — reads as effort from a distance.
    this.mouth.scale.x = 1 + run * 0.6;

    // ── Emissive trim brightens with speed ──────────────────────────────────
    this._glowMat.emissiveIntensity = 0.65 + run * 0.75 + Math.sin(this.phase * 0.8) * 0.08;

    // ── Ground ring ─────────────────────────────────────────────────────────
    this.ring.material.opacity = 0.6 + run * 0.35;
    this.ring.rotation.z += dt * (0.6 + run * 2.2);
    this.blob.scale.setScalar(1 - Math.max(0, this._squash) * 0.25);
  }

  setEliminated() {
    this.root.visible = false;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o === this.tag) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
