/**
 * Scripted first-person camera path for the walkthrough video: the viewer
 * stands where the photo was taken, looks left, looks right across the room,
 * then walks towards the main stone surface and looks down at it — all at
 * human eye level, collision-free.
 *
 * Pure function of the layout (unit-tested); used by recordWalkthrough().
 */
import { isWalkable, yawTowards, type RoomLayout, type Vec3 } from "./roomGeometry";

export interface Pose {
  position: Vec3;
  yaw: number;
  pitch: number;
}

interface Key extends Pose {
  t: number;
}

const DEG = Math.PI / 180;
const smooth = (t: number) => t * t * (3 - 2 * t);

function segmentWalkable(layout: RoomLayout, a: Vec3, b: Vec3): boolean {
  for (let i = 1; i <= 24; i++) {
    const k = i / 24;
    if (!isWalkable(layout, { x: a.x + (b.x - a.x) * k, y: a.z + (b.z - a.z) * k }, 0.25)) return false;
  }
  return true;
}

export function buildWalkthroughPath(layout: RoomLayout): (t: number) => Pose {
  const start = layout.viewpoints.find((v) => v.id === "start")!;
  const stone = layout.viewpoints.find((v) => v.id === "stone");
  const eye = start.position.y;
  const basePitch = Math.max(-20 * DEG, start.pitch * 0.7);
  const s: Vec3 = { ...start.position };

  // Where do we walk to? Prefer the stone close-up, else as far forward as is free.
  let target: Vec3 = { ...s };
  let targetYaw = 0;
  let targetPitch = basePitch - 8 * DEG;
  if (stone && segmentWalkable(layout, s, stone.position)) {
    target = { ...stone.position, y: eye };
    targetYaw = stone.yaw;
    targetPitch = stone.pitch;
  } else {
    for (let d = 2.2; d >= 0.3; d -= 0.1) {
      const cand = { x: s.x, y: eye, z: s.z - d };
      if (segmentWalkable(layout, s, cand)) {
        target = cand;
        break;
      }
    }
    const main = layout.slabs[0];
    if (main) {
      const c = main.footprint.reduce((acc, p) => ({ x: acc.x + p.x / main.footprint.length, y: acc.y + p.y / main.footprint.length }), { x: 0, y: 0 });
      targetYaw = yawTowards({ x: target.x, y: target.z }, c);
      const dist = Math.hypot(c.x - target.x, c.y - target.z);
      targetPitch = -Math.atan2(eye - main.topY, Math.max(0.5, dist));
    }
  }
  const mid: Vec3 = {
    x: s.x + (target.x - s.x) * 0.35,
    y: eye,
    z: s.z + (target.z - s.z) * 0.35,
  };

  const keys: Key[] = [
    { t: 0, position: s, yaw: 0, pitch: basePitch },
    { t: 0.2, position: s, yaw: 32 * DEG, pitch: basePitch + 3 * DEG },
    { t: 0.45, position: mid, yaw: -30 * DEG, pitch: basePitch },
    { t: 0.8, position: target, yaw: targetYaw, pitch: targetPitch },
    { t: 1, position: target, yaw: targetYaw - 14 * DEG, pitch: targetPitch + 2 * DEG },
  ];

  return (t: number): Pose => {
    const x = Math.min(1, Math.max(0, t));
    let i = 0;
    while (i < keys.length - 2 && x > keys[i + 1].t) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const k = smooth((x - a.t) / (b.t - a.t || 1));
    const lerp = (p: number, q: number) => p + (q - p) * k;
    // Gentle walking bob only while the position changes.
    const moving = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z) > 0.05;
    const bob = moving ? Math.sin(x * 60) * 0.01 : 0;
    return {
      position: {
        x: lerp(a.position.x, b.position.x),
        y: lerp(a.position.y, b.position.y) + bob,
        z: lerp(a.position.z, b.position.z),
      },
      yaw: lerp(a.yaw, b.yaw),
      pitch: lerp(a.pitch, b.pitch),
    };
  };
}
