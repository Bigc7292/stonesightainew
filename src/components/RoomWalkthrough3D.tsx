/**
 * Interactive first-person 3D walkthrough of the customer's room with the
 * chosen stone, reconstructed from the generated image + Claude's scene
 * analysis (see src/scene/*).
 *
 * Controls: click to capture the mouse and look around, W/A/S/D or arrows to
 * walk (Shift = faster), Q/E or ←/→ to turn, Esc to release. Viewpoint
 * buttons jump to each corner of the room; clicking the mini-map walks
 * there. Touch devices get drag-to-look plus an on-screen movement pad.
 */
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Loader2, Maximize2, Minimize2, MousePointer2, Move, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { SceneAnalysis } from "../../shared/scene";
import { loadImage, loadSwatch } from "../lib/imageUtils";
import { buildRoomLayout, type RoomLayout, type Viewpoint } from "../scene/roomGeometry";
import { RoomScene } from "../scene/RoomScene";
import { FirstPersonController } from "../scene/FirstPersonController";

interface Props {
  photoUrl: string;
  swatchUrl: string;
  analysis: SceneAnalysis;
  stoneName: string;
  className?: string;
}

type Status = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

function drawMinimap(canvas: HTMLCanvasElement, layout: RoomLayout, pos: THREE.Vector3, yaw: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const pts = layout.corners;
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const pad = 10;
  const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 0.1);
  const ox = pad + ((size - pad * 2) - (maxX - minX) * scale) / 2;
  const oz = pad + ((size - pad * 2) - (maxZ - minZ) * scale) / 2;
  const map = (x: number, z: number) => [ox + (x - minX) * scale, oz + (z - minZ) * scale] as const;
  (canvas as any)._toWorld = (mx: number, my: number) => ({ x: (mx - ox) / scale + minX, z: (my - oz) / scale + minZ });

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(10,10,10,0.72)";
  ctx.fillRect(0, 0, size, size);
  const poly = (p: { x: number; y: number }[], fill: string, stroke: string) => {
    ctx.beginPath();
    p.forEach((q, i) => {
      const [x, y] = map(q.x, q.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  poly(pts, "rgba(255,255,255,0.06)", "rgba(212,175,55,0.7)");
  layout.obstacles.forEach((o) => poly(o, "rgba(212,175,55,0.45)", "rgba(212,175,55,0.9)"));

  // Where the photo was taken.
  const [sx, sy] = map(0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(sx - 2, sy - 2, 4, 4);

  // Viewer + field-of-view wedge.
  const [px, py] = map(pos.x, pos.z);
  const dir = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)); // canvas angle of forward vector
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, 22, dir - 0.5, dir + 0.5);
  ctx.closePath();
  ctx.fillStyle = "rgba(212,175,55,0.3)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#f5d76e";
  ctx.fill();
}

export function RoomWalkthrough3D({ photoUrl, swatchUrl, analysis, stoneName, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<FirstPersonController | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([]);
  const [activeView, setActiveView] = useState("start");
  const [locked, setLocked] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [isTouch] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let cleanup = () => {};
    setStatus({ state: "loading" });

    (async () => {
      try {
        const [photo, swatch] = await Promise.all([loadImage(photoUrl), loadSwatch(swatchUrl).catch(() => null)]);
        if (disposed || !canvasRef.current || !containerRef.current) return;
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const layout = buildRoomLayout(analysis, photo.naturalWidth / photo.naturalHeight);

        let renderer: THREE.WebGLRenderer;
        try {
          renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        } catch {
          throw new Error("WebGL is not available in this browser, so the 3D walkthrough cannot be shown.");
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const room = new RoomScene(renderer, { photo, swatch, layout, colors: analysis.colors });
        const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.05, 80);
        const controller = new FirstPersonController(camera, container, layout);
        controller.onLockChange = (l) => {
          setLocked(l);
          setInteracted(true);
        };
        controller.attach();
        controller.goTo(layout.viewpoints[0], false);
        controllerRef.current = controller;
        (container as any).__stonesight = { layout, controller, camera }; // debugging / e2e hook
        setViewpoints(layout.viewpoints);

        const resize = () => {
          const w = container.clientWidth || 1;
          const h = container.clientHeight || 1;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();

        const clock = new THREE.Clock();
        const loop = () => {
          frame = requestAnimationFrame(loop);
          controller.update(Math.min(0.1, clock.getDelta()));
          renderer.render(room.scene, camera);
          if (minimapRef.current) drawMinimap(minimapRef.current, layout, controller.position, controller.yaw);
        };
        loop();
        setStatus({ state: "ready" });

        cleanup = () => {
          cancelAnimationFrame(frame);
          ro.disconnect();
          controller.detach();
          room.dispose();
          renderer.dispose();
          controllerRef.current = null;
        };
      } catch (error) {
        if (!disposed) setStatus({ state: "error", message: error instanceof Error ? error.message : "3D scene failed to load" });
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [photoUrl, swatchUrl, analysis]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const go = (vp: Viewpoint) => {
    controllerRef.current?.goTo(vp);
    setActiveView(vp.id);
    setInteracted(true);
    containerRef.current?.focus();
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().catch(() => undefined);
  };

  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const rect = c.getBoundingClientRect();
    const toWorld = (c as any)._toWorld as ((x: number, y: number) => { x: number; z: number }) | undefined;
    if (!toWorld) return;
    const w = toWorld(((e.clientX - rect.left) / rect.width) * c.width, ((e.clientY - rect.top) / rect.height) * c.height);
    if (controllerRef.current?.walkTo(w.x, w.z)) setActiveView("");
  };

  const hold = (forward: number, right: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      if (controllerRef.current) Object.assign(controllerRef.current.moveInput, { forward, right });
      setInteracted(true);
    },
    onPointerUp: () => controllerRef.current && Object.assign(controllerRef.current.moveInput, { forward: 0, right: 0 }),
    onPointerLeave: () => controllerRef.current && Object.assign(controllerRef.current.moveInput, { forward: 0, right: 0 }),
  });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-testid="walkthrough-3d"
      className={`relative w-full h-full overflow-hidden bg-dark-900 outline-none select-none touch-none ${fullscreen ? "" : "rounded-[24px]"} ${className}`}
      aria-label={`Interactive 3D walkthrough of your room with ${stoneName}`}
    >
      <canvas ref={canvasRef} className="block w-full h-full cursor-crosshair" />

      {status.state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/90 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gold-500 mb-3" />
          <p className="text-sm text-gold-400">Building your 3D room…</p>
        </div>
      )}
      {status.state === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-900/95 p-6 text-center">
          <p className="text-sm text-red-300 max-w-md">{status.message}</p>
        </div>
      )}

      {status.state === "ready" && (
        <>
          {!interacted && !locked && (
            <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-dark-900/80 border border-gold-500/30 text-[11px] text-gray-200 flex items-center gap-2 backdrop-blur-md">
              {isTouch ? <Move className="w-3.5 h-3.5 text-gold-400" /> : <MousePointer2 className="w-3.5 h-3.5 text-gold-400" />}
              {isTouch ? "Drag to look around · use the pad to walk" : "Click to look around · W A S D / arrows to walk · Esc to release"}
            </div>
          )}
          {locked && (
            <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-dark-900/70 text-[10px] text-gray-300">
              Esc to release the mouse
            </div>
          )}
          {/* Crosshair */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white/60" />

          <div data-ui className="absolute top-3 right-3 flex gap-2">
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:text-gold-400 border border-white/10"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>

          <div data-ui className="absolute bottom-3 left-3 right-[180px] flex flex-wrap gap-2">
            {viewpoints.map((vp) => (
              <button
                key={vp.id}
                onClick={() => go(vp)}
                data-viewpoint={vp.id}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-medium uppercase tracking-widest border backdrop-blur-md transition-colors ${
                  activeView === vp.id
                    ? "bg-gold-500/20 border-gold-500 text-gold-300"
                    : "bg-dark-900/75 border-white/10 text-gray-300 hover:text-gold-300 hover:border-gold-500/40"
                }`}
              >
                {vp.label}
              </button>
            ))}
          </div>

          <canvas
            data-ui
            ref={minimapRef}
            width={160}
            height={160}
            onClick={onMinimapClick}
            title="Click the map to walk there"
            className="absolute bottom-3 right-3 w-[150px] h-[150px] rounded-xl border border-white/10 cursor-pointer"
          />

          {isTouch && (
            <div data-ui className="absolute bottom-16 left-4 grid grid-cols-3 gap-1">
              <span />
              <button {...hold(1, 0)} className="p-3 rounded-xl bg-dark-900/75 border border-white/10 text-gray-200"><ChevronUp className="w-5 h-5" /></button>
              <span />
              <button {...hold(0, -1)} className="p-3 rounded-xl bg-dark-900/75 border border-white/10 text-gray-200"><ChevronLeft className="w-5 h-5" /></button>
              <button {...hold(-1, 0)} className="p-3 rounded-xl bg-dark-900/75 border border-white/10 text-gray-200"><ChevronDown className="w-5 h-5" /></button>
              <button {...hold(0, 1)} className="p-3 rounded-xl bg-dark-900/75 border border-white/10 text-gray-200"><ChevronRight className="w-5 h-5" /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RoomWalkthrough3D;
