/**
 * Three.js scene for the interactive walkthrough and the recorded video.
 *
 * Rendering technique — projective texturing with visibility:
 *   The generated photo is projected from the original camera pose onto the
 *   reconstructed room (floor, walls, ceiling, cabinet bodies, stone slabs).
 *   A depth pre-pass from that projector tells each fragment whether the
 *   photo actually saw it; fragments the photo could not see (behind the
 *   island, behind the photographer, outside the frame) fall back to Claude's
 *   estimated room colours — or, for stone, to the real swatch texture with a
 *   polished sheen. From the start viewpoint the scene reproduces the
 *   generated image exactly; walking around reveals true 3D parallax.
 */
import * as THREE from "three";
import type { SceneColors } from "../../shared/scene";
import type { Pt } from "../render/homography";
import type { PanelLayout, RoomLayout, SlabLayout } from "./roomGeometry";

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D photoMap;
uniform sampler2D depthMap;
uniform sampler2D fallbackMap;
uniform bool useFallbackMap;
uniform bool useDepth;
uniform mat4 projViewProj;
uniform vec3 projPos;
uniform float projNear;
uniform float projFar;
uniform vec3 fallbackColor;
uniform float gloss;
uniform float ceilingHeight;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 base = useFallbackMap ? texture2D(fallbackMap, vUv).rgb : fallbackColor;
  float heightShade = 0.86 + 0.14 * smoothstep(0.0, ceilingHeight, vWorldPos.y);
  float upShade = 0.92 + 0.08 * n.y;
  vec3 shaded = base * heightShade * upShade;
  if (gloss > 0.0) {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 h1 = normalize(viewDir + normalize(vec3(0.3, 1.0, 0.4)));
    vec3 h2 = normalize(viewDir + normalize(vec3(-0.5, 1.0, -0.6)));
    float spec = pow(max(dot(n, h1), 0.0), 80.0) + 0.6 * pow(max(dot(n, h2), 0.0), 40.0);
    shaded += vec3(gloss * spec);
  }

  float w = 0.0;
  vec3 photo = vec3(0.0);
  vec4 clip = projViewProj * vec4(vWorldPos, 1.0);
  if (clip.w > 0.0) {
    vec3 ndc = clip.xyz / clip.w;
    vec2 uv = ndc.xy * 0.5 + 0.5;
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      float visible = 1.0;
      if (useDepth) {
        float sceneDist = -perspectiveDepthToViewZ(texture2D(depthMap, uv).x, projNear, projFar);
        visible = 1.0 - smoothstep(sceneDist * 1.015 + 0.02, sceneDist * 1.04 + 0.06, clip.w);
      }
      vec2 edge = smoothstep(vec2(0.0), vec2(0.012), uv) * smoothstep(vec2(0.0), vec2(0.012), 1.0 - uv);
      float facing = abs(dot(n, normalize(projPos - vWorldPos)));
      w = visible * edge.x * edge.y * smoothstep(0.03, 0.18, facing);
      photo = texture2D(photoMap, uv).rgb;
    }
  }
  gl_FragColor = vec4(mix(shaded, photo, w), 1.0);
  #include <colorspace_fragment>
}`;

export interface RoomSceneInput {
  photo: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  swatch: HTMLImageElement | HTMLCanvasElement | null;
  layout: RoomLayout;
  colors: SceneColors;
  /** Real-world size of one swatch tile in metres. */
  tileMeters?: number;
}

type V3 = THREE.Vector3;
const v3 = (p: Pt, y: number) => new THREE.Vector3(p.x, y, p.y);

/** Non-indexed geometry from triangles with explicit normals and UVs. */
class GeometryBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];

  quad(a: V3, b: V3, c: V3, d: V3, normal: V3, uv: [number, number][]) {
    const tri = (p: V3[], t: [number, number][]) => {
      p.forEach((v, i) => {
        this.positions.push(v.x, v.y, v.z);
        this.normals.push(normal.x, normal.y, normal.z);
        this.uvs.push(t[i][0], t[i][1]);
      });
    };
    tri([a, b, c], [uv[0], uv[1], uv[2]]);
    tri([a, c, d], [uv[0], uv[2], uv[3]]);
  }

  polygon(pts: V3[], normal: V3, uvOf: (p: V3) => [number, number]) {
    for (let i = 1; i < pts.length - 1; i++) {
      [pts[0], pts[i], pts[i + 1]].forEach((v) => {
        this.positions.push(v.x, v.y, v.z);
        this.normals.push(normal.x, normal.y, normal.z);
        const [u, t] = uvOf(v);
        this.uvs.push(u, t);
      });
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Closed prism over a convex-ish footprint with metre-based UVs along `axis`. */
function prism(footprint: Pt[], y0: number, y1: number, tile: number, axis?: Pt): THREE.BufferGeometry {
  const gb = new GeometryBuilder();
  const origin = footprint[0];
  const e1 = axis ?? (() => {
    const d = { x: footprint[1].x - origin.x, y: footprint[1].y - origin.y };
    const l = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / l, y: d.y / l };
  })();
  const e2 = { x: -e1.y, y: e1.x };
  const planUv = (p: V3): [number, number] => {
    const dx = p.x - origin.x;
    const dz = p.z - origin.y;
    return [(dx * e1.x + dz * e1.y) / tile, (dx * e2.x + dz * e2.y) / tile];
  };
  gb.polygon(footprint.map((p) => v3(p, y1)), new THREE.Vector3(0, 1, 0), planUv);
  gb.polygon(footprint.map((p) => v3(p, y0)), new THREE.Vector3(0, -1, 0), planUv);

  const cx = footprint.reduce((s, p) => s + p.x, 0) / footprint.length;
  const cz = footprint.reduce((s, p) => s + p.y, 0) / footprint.length;
  let run = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let n = new THREE.Vector3(b.y - a.y, 0, -(b.x - a.x)).normalize();
    const mid = { x: (a.x + b.x) / 2 - cx, z: (a.y + b.y) / 2 - cz };
    if (n.x * mid.x + n.z * mid.z < 0) n = n.negate();
    const u0 = run / tile;
    const u1 = (run + len) / tile;
    gb.quad(v3(a, y0), v3(b, y0), v3(b, y1), v3(a, y1), n, [
      [u0, y0 / tile],
      [u1, y0 / tile],
      [u1, y1 / tile],
      [u0, y1 / tile],
    ]);
    run += len;
  }
  return gb.build();
}

function insetPolygon(pts: Pt[], amount: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map((p) => {
    const dx = p.x - cx;
    const dz = p.y - cz;
    const l = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, l - amount) / l;
    return { x: cx + dx * k, y: cz + dz * k };
  });
}

export class RoomScene {
  readonly scene = new THREE.Scene();
  readonly projector: THREE.PerspectiveCamera;
  private depthTarget: THREE.WebGLRenderTarget;
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    private input: RoomSceneInput,
  ) {
    const { layout } = input;
    const cam = layout.camera;
    this.projector = new THREE.PerspectiveCamera((cam.vfov * 180) / Math.PI, cam.aspect, 0.05, 80);
    this.projector.position.set(0, cam.eye, 0);
    this.projector.rotation.set(cam.pitch, 0, 0, "YXZ");
    this.projector.updateMatrixWorld(true);

    const dw = 1024;
    const dh = Math.max(64, Math.round(dw / cam.aspect));
    this.depthTarget = new THREE.WebGLRenderTarget(dw, dh, {
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(dw, dh),
    });

    this.scene.background = new THREE.Color(input.colors.walls);
    this.build();
    this.renderDepth();
  }

  private texture(source: TexImageSource, repeat: boolean): THREE.Texture {
    const t = new THREE.Texture(source as HTMLImageElement);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    if (repeat) {
      t.wrapS = THREE.MirroredRepeatWrapping;
      t.wrapT = THREE.MirroredRepeatWrapping;
    }
    t.needsUpdate = true;
    this.textures.push(t);
    return t;
  }

  private material(opts: { color: string; map?: THREE.Texture | null; gloss?: number }): THREE.ShaderMaterial {
    const projViewProj = new THREE.Matrix4().multiplyMatrices(
      this.projector.projectionMatrix,
      this.projector.matrixWorldInverse,
    );
    const m = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      uniforms: {
        photoMap: { value: this.photoTexture },
        depthMap: { value: this.depthTarget.depthTexture },
        fallbackMap: { value: opts.map ?? null },
        useFallbackMap: { value: !!opts.map },
        useDepth: { value: false }, // enabled after the depth pre-pass
        projViewProj: { value: projViewProj },
        projPos: { value: this.projector.position.clone() },
        projNear: { value: this.projector.near },
        projFar: { value: this.projector.far },
        fallbackColor: { value: new THREE.Color(opts.color) },
        gloss: { value: opts.gloss ?? 0 },
        ceilingHeight: { value: this.input.layout.ceilingHeight },
      },
    });
    this.materials.push(m);
    return m;
  }

  private photoTexture!: THREE.Texture;

  private add(geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    this.scene.add(mesh);
  }

  private build() {
    const { layout, colors, swatch } = this.input;
    const tile = this.input.tileMeters ?? 0.9;
    this.photoTexture = this.texture(this.input.photo as TexImageSource, false);
    const swatchTexture = swatch ? this.texture(swatch as TexImageSource, true) : null;

    const [bl, br, fr, fl] = layout.corners;
    const H = layout.ceilingHeight;
    const up = new THREE.Vector3(0, 1, 0);
    const shell = new GeometryBuilder();
    const floor = new GeometryBuilder();
    const ceiling = new GeometryBuilder();
    floor.polygon([v3(bl, 0), v3(br, 0), v3(fr, 0), v3(fl, 0)], up, (p) => [p.x, p.z]);
    ceiling.polygon([v3(bl, H), v3(br, H), v3(fr, H), v3(fl, H)], up.clone().negate(), (p) => [p.x, p.z]);
    const walls: [Pt, Pt][] = [[bl, br], [br, fr], [fr, fl], [fl, bl]];
    const cx = (bl.x + fr.x) / 2;
    const cz = (bl.y + fr.y) / 2;
    for (const [a, b] of walls) {
      let n = new THREE.Vector3(b.y - a.y, 0, -(b.x - a.x)).normalize();
      if (n.x * (cx - a.x) + n.z * (cz - a.y) < 0) n = n.negate(); // face inwards
      shell.quad(v3(a, 0), v3(b, 0), v3(b, H), v3(a, H), n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    this.add(floor.build(), this.material({ color: colors.floor }), "floor");
    this.add(ceiling.build(), this.material({ color: colors.ceiling }), "ceiling");
    this.add(shell.build(), this.material({ color: colors.walls }), "walls");

    const stone = this.material({ color: "#d8d4ce", map: swatchTexture, gloss: 0.35 });
    const cabinets = this.material({ color: colors.cabinets });

    layout.slabs.forEach((slab: SlabLayout) => {
      const bottom = slab.topY - slab.thickness;
      this.add(prism(slab.footprint, bottom, slab.topY, tile), stone, `slab:${slab.id}`);
      if (slab.hasBase && bottom > 0.1) {
        this.add(prism(insetPolygon(slab.footprint, 0.03), 0, bottom, 1), cabinets, `base:${slab.id}`);
      } else if (!slab.hasBase && bottom > 0.3) {
        const c = slab.footprint.reduce((s, p) => ({ x: s.x + p.x / slab.footprint.length, y: s.y + p.y / slab.footprint.length }), { x: 0, y: 0 });
        const r = 0.08;
        const pedestal = [
          { x: c.x - r, y: c.y - r },
          { x: c.x + r, y: c.y - r },
          { x: c.x + r, y: c.y + r },
          { x: c.x - r, y: c.y + r },
        ];
        this.add(prism(pedestal, 0, bottom, 1), cabinets, `pedestal:${slab.id}`);
      }
    });

    layout.panels.forEach((p: PanelLayout) => {
      const front = 0.005; // keep off coplanar walls to avoid z-fighting
      const a = { x: p.a.x + p.normal.x * front, y: p.a.y + p.normal.y * front };
      const b = { x: p.b.x + p.normal.x * front, y: p.b.y + p.normal.y * front };
      const back = { x: -p.normal.x * p.thickness, y: -p.normal.y * p.thickness };
      const footprint = [a, b, { x: b.x + back.x, y: b.y + back.y }, { x: a.x + back.x, y: a.y + back.y }];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      this.add(
        prism(footprint, p.bottomY, p.topY, tile, { x: (b.x - a.x) / len, y: (b.y - a.y) / len }),
        stone,
        `panel:${p.id}`,
      );
    });
  }

  /** Depth pre-pass from the photo's camera (visibility for projective texturing). */
  private renderDepth() {
    const override = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const previousTarget = this.renderer.getRenderTarget();
    this.scene.overrideMaterial = override;
    this.renderer.setRenderTarget(this.depthTarget);
    this.renderer.render(this.scene, this.projector);
    this.renderer.setRenderTarget(previousTarget);
    this.scene.overrideMaterial = null;
    override.dispose();
    for (const m of this.materials) {
      if (m instanceof THREE.ShaderMaterial) m.uniforms.useDepth.value = true;
    }
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.depthTarget.dispose();
  }
}
