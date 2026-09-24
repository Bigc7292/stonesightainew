/**
 * First-person, eye-level navigation for the 3D walkthrough.
 *
 * Desktop: click the view to capture the mouse (pointer lock) and look
 * around; W/A/S/D or arrow keys to walk, Shift to walk faster, Esc to release.
 * Without pointer lock, click-and-drag also looks around.
 * Touch: drag to look; the on-screen pad (see RoomWalkthrough3D) sets `moveInput`.
 *
 * Movement is collision-checked against the room walls and the reconstructed
 * counters/islands (see `isWalkable`), sliding along obstacles like a game.
 */
import * as THREE from "three";
import { isWalkable, type RoomLayout, type Viewpoint } from "./roomGeometry";

const PITCH_LIMIT = (80 * Math.PI) / 180;
const WALK_SPEED = 1.3; // m/s — relaxed walking pace
const RUN_FACTOR = 2;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const shortestAngle = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
};

interface Flight {
  from: { pos: THREE.Vector3; yaw: number; pitch: number };
  to: { pos: THREE.Vector3; yaw: number; pitch: number };
  t: number;
  duration: number;
}

export class FirstPersonController {
  yaw = 0;
  pitch = 0;
  readonly position = new THREE.Vector3();
  /** Analogue movement from on-screen controls: forward/right in [-1, 1]. */
  readonly moveInput = { forward: 0, right: 0 };
  locked = false;
  onLockChange?: (locked: boolean) => void;

  private keys = new Set<string>();
  private dragging: { x: number; y: number; moved: boolean; pointerType: string } | null = null;
  private flight: Flight | null = null;
  private walkTime = 0;
  private cleanup: (() => void)[] = [];

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private layout: RoomLayout,
  ) {
    this.camera.rotation.order = "YXZ";
  }

  attach() {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document | Window,
      type: K | string,
      fn: (e: any) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    };

    on(this.dom, "keydown", (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "q", "e"].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    on(this.dom, "keyup", (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    on(window, "blur", () => this.keys.clear());

    on(this.dom, "pointerdown", (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-ui]")) return; // overlay buttons
      this.dom.focus();
      this.dragging = { x: e.clientX, y: e.clientY, moved: false, pointerType: e.pointerType };
    });
    on(document, "pointermove", (e: PointerEvent) => {
      if (this.locked) {
        this.look(e.movementX * 0.0022, e.movementY * 0.0022);
      } else if (this.dragging) {
        const dx = e.clientX - this.dragging.x;
        const dy = e.clientY - this.dragging.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragging.moved = true;
        this.dragging.x = e.clientX;
        this.dragging.y = e.clientY;
        const k = this.dragging.pointerType === "touch" ? 0.006 : 0.0045;
        this.look(dx * k, dy * k);
      }
    });
    on(document, "pointerup", () => {
      const d = this.dragging;
      this.dragging = null;
      // A click (not a drag) with a mouse captures the pointer for FPS-style look.
      if (d && !d.moved && d.pointerType === "mouse" && !this.locked && this.dom.requestPointerLock) {
        try {
          const request = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
          request?.catch?.(() => undefined);
        } catch {
          /* pointer lock unavailable (e.g. iframe sandbox) — drag-to-look still works */
        }
      }
    });
    on(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
  }

  detach() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  private look(dYaw: number, dPitch: number) {
    this.flight = null;
    this.yaw -= dYaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dPitch));
  }

  /** Jumps (or glides) to a viewpoint. */
  goTo(vp: Viewpoint, animate = true) {
    const to = { pos: new THREE.Vector3(vp.position.x, vp.position.y, vp.position.z), yaw: vp.yaw, pitch: vp.pitch };
    if (!animate) {
      this.position.copy(to.pos);
      this.yaw = to.yaw;
      this.pitch = to.pitch;
      this.flight = null;
      this.apply(0);
      return;
    }
    this.flight = {
      from: { pos: this.position.clone(), yaw: this.yaw, pitch: this.pitch },
      to: { ...to, yaw: shortestAngle(this.yaw, to.yaw) },
      t: 0,
      duration: Math.min(1.6, 0.6 + this.position.distanceTo(to.pos) * 0.15),
    };
  }

  /** Teleports to a floor point (x, z) if walkable, keeping the view direction. */
  walkTo(x: number, z: number) {
    if (!isWalkable(this.layout, { x, y: z }, 0.25)) return false;
    this.goTo({ id: "map", label: "", position: { x, y: this.position.y, z }, yaw: this.yaw, pitch: this.pitch });
    return true;
  }

  update(dt: number) {
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = easeInOut(f.t);
      this.position.lerpVectors(f.from.pos, f.to.pos, e);
      this.yaw = f.from.yaw + (f.to.yaw - f.from.yaw) * e;
      this.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
      if (f.t >= 1) this.flight = null;
      this.apply(0);
      return;
    }

    const k = this.keys;
    let forward = this.moveInput.forward + (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    let right = this.moveInput.right + (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
    // Arrow left/right turn the head (easier for non-gamers); Q/E also turn.
    const turn = (k.has("arrowleft") || k.has("q") ? 1 : 0) - (k.has("arrowright") || k.has("e") ? 1 : 0);
    if (turn) this.yaw += turn * 1.6 * dt;

    const mag = Math.hypot(forward, right);
    if (mag > 1) {
      forward /= mag;
      right /= mag;
    }
    let bob = 0;
    if (mag > 0.01) {
      const speed = WALK_SPEED * (k.has("shift") ? RUN_FACTOR : 1) * dt;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const dx = (-sin * forward + cos * right) * speed;
      const dz = (-cos * forward - sin * right) * speed;
      this.tryMove(dx, dz);
      this.walkTime += dt;
      bob = Math.sin(this.walkTime * 8.5) * 0.012; // subtle head bob — "human eyes" feel
    }
    this.apply(bob);
  }

  private tryMove(dx: number, dz: number) {
    const p = this.position;
    const free = (x: number, z: number) => isWalkable(this.layout, { x, y: z }, 0.25);
    // Allow walking out of a blocked spot (e.g. the photo view sits in a corner).
    const stuck = !free(p.x, p.z);
    if (stuck || free(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
    } else if (free(p.x + dx, p.z)) {
      p.x += dx;
    } else if (free(p.x, p.z + dz)) {
      p.z += dz;
    }
  }

  private apply(bob: number) {
    this.camera.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }
}
