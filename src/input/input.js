/**
 * Input: keyboard + mouse (pointer lock) + touch (joystick, jump, drag-look).
 * Normalised into the same {x, z, jump, sprint} frame the server validates.
 */

export class Input {
  constructor(dom = window) {
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.jumpQueued = false;
    this.jump = false;
    this.joystick = { x: 0, z: 0, active: false, id: null };
    this.touchLook = { id: null, x: 0, y: 0 };
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.enabled = true;
    this.pointerLocked = false;

    this._onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onPointerLock = () => { this.pointerLocked = document.pointerLockElement != null; };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLock);
    window.addEventListener('blur', () => this.keys.clear());
  }

  requestPointerLock(canvas) {
    if (this.isTouch) return;
    canvas?.requestPointerLock?.();
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Attach touch handlers to the HUD elements. */
  bindTouch({ joy, knob, jumpBtn, lookZone }) {
    if (!joy) return;
    const RADIUS = 52;
    let jid = null;

    const move = (t) => {
      const r = joy.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) { dx = (dx / d) * RADIUS; dy = (dy / d) * RADIUS; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joystick.x = dx / RADIUS;
      this.joystick.z = dy / RADIUS;
    };

    joy.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      jid = t.identifier; this.joystick.active = true; this.joystick.id = jid;
      move(t);
    }, { passive: false });
    joy.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === jid) move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === jid) {
        jid = null; this.joystick.active = false;
        this.joystick.x = 0; this.joystick.z = 0;
        knob.style.transform = 'translate(0,0)';
      }
    };
    joy.addEventListener('touchend', end);
    joy.addEventListener('touchcancel', end);

    jumpBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.jumpQueued = true;
    }, { passive: false });

    lookZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.touchLook.id = t.identifier;
      this.touchLook.x = t.clientX; this.touchLook.y = t.clientY;
    }, { passive: true });
    lookZone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touchLook.id) continue;
        this.mouseDX += (t.clientX - this.touchLook.x) * 1.6;
        this.mouseDY += (t.clientY - this.touchLook.y) * 1.6;
        this.touchLook.x = t.clientX; this.touchLook.y = t.clientY;
      }
    }, { passive: true });
    lookZone.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.touchLook.id) this.touchLook.id = null;
    });
  }

  /** Read + consume per-frame camera delta. */
  takeLook() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  /**
   * Movement frame in camera space: forward is -Z of the camera yaw.
   * Returns {x, z} already normalised by the caller.
   */
  frame() {
    if (!this.enabled) return { x: 0, z: 0, jump: false, sprint: false };
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (this.joystick.active) { x += this.joystick.x; z += this.joystick.z; }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || len > 0.9;
    return { x, z, jump, sprint };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLock);
  }
}
