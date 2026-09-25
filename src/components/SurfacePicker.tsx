/**
 * Tap-to-select countertops (no-AI mode).
 *
 * Shows the customer's photo split into regions; tapping a region marks it as
 * a countertop top (gold) or a vertical stone face such as a waterfall end
 * (teal). Tapping it again unmarks it. "Visualize" turns the selection into a
 * scene for the local stone renderer, the 3D walkthrough and the video.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Layers, PanelTop, Sparkles, Undo2 } from "lucide-react";
import type { SceneAnalysis } from "../../shared/scene";
import type { Segmentation } from "../../shared/segmentation";
import { loadImage } from "../lib/imageUtils";
import { buildManualScene, regionAt, segmentImage, type SurfaceMark } from "../render/manualScene";

interface Props {
  photo: string;
  stoneName: string;
  /** Why the picker is shown (e.g. "AI analysis is unavailable"). */
  reason?: string;
  onConfirm: (scene: SceneAnalysis) => void;
}

const FILL: Record<SurfaceMark, [number, number, number]> = { top: [212, 175, 55], face: [45, 212, 191] };

export default function SurfacePicker({ photo, stoneName, reason, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [seg, setSeg] = useState<Segmentation | null>(null);
  const [marks, setMarks] = useState<Map<number, SurfaceMark>>(new Map());
  const [history, setHistory] = useState<Map<number, SurfaceMark>[]>([]);
  const [mode, setMode] = useState<SurfaceMark>("top");
  const [hover, setHover] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Load + segment once per photo (off the first paint so the spinner shows).
  useEffect(() => {
    let alive = true;
    setSeg(null);
    setMarks(new Map());
    setHistory([]);
    loadImage(photo)
      .then((image) => {
        if (!alive) return;
        setImg(image);
        setTimeout(() => alive && setSeg(segmentImage(image)), 30);
      })
      .catch(() => alive && setError("Could not read the photo."));
    return () => {
      alive = false;
    };
  }, [photo]);

  // Region boundaries (static per segmentation).
  const edges = useMemo(() => {
    if (!seg) return null;
    const { width: w, height: h, labels } = seg;
    const e = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const l = labels[y * w + x];
        if ((x + 1 < w && labels[y * w + x + 1] !== l) || (y + 1 < h && labels[(y + 1) * w + x] !== l)) e[y * w + x] = 1;
      }
    return e;
  }, [seg]);

  // Draw overlay.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !seg || !edges) return;
    canvas.width = seg.width;
    canvas.height = seg.height;
    const ctx = canvas.getContext("2d")!;
    const out = ctx.createImageData(seg.width, seg.height);
    for (let i = 0; i < seg.width * seg.height; i++) {
      const l = seg.labels[i];
      const m = marks.get(l);
      const o = i * 4;
      if (m) {
        const [r, g, b] = FILL[m];
        out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = edges[i] ? 230 : 120;
      } else if (l === hover) {
        out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255; out.data[o + 3] = edges[i] ? 200 : 60;
      } else if (edges[i]) {
        out.data[o] = 255; out.data[o + 1] = 255; out.data[o + 2] = 255; out.data[o + 3] = 70;
      }
    }
    ctx.putImageData(out, 0, 0);
  }, [seg, edges, marks, hover]);

  const pointToRegion = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!seg) return 0;
    const r = e.currentTarget.getBoundingClientRect();
    return regionAt(seg, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  const toggle = (id: number) => {
    if (!id) return;
    setHistory((h) => [...h.slice(-30), marks]);
    setMarks((prev) => {
      const next = new Map(prev);
      if (next.get(id) === mode) next.delete(id);
      else next.set(id, mode);
      return next;
    });
  };

  const counts = { top: 0, face: 0 };
  for (const m of marks.values()) counts[m]++;

  const confirm = () => {
    if (!seg || marks.size === 0) return;
    const scene = buildManualScene(seg, marks, stoneName);
    if (scene.surfaces.length === 0) {
      setError("Those areas are too small to place stone on — select the whole countertop.");
      return;
    }
    onConfirm(scene);
  };

  const modeButton = (m: SurfaceMark, label: string, icon: React.ReactNode, testId: string) => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => setMode(m)}
      className={`px-4 py-2 rounded-xl text-xs font-medium border flex items-center gap-2 transition-colors ${
        mode === m
          ? m === "top"
            ? "bg-gold-500/20 border-gold-500/60 text-gold-300"
            : "bg-teal-400/15 border-teal-400/60 text-teal-200"
          : "bg-dark-700/50 border-white/10 text-gray-400 hover:text-gray-200"
      }`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div data-testid="surface-picker" className="bg-dark-800/50 p-6 rounded-[32px] shadow-premium border border-white/5 space-y-5">
      <div>
        <h3 className="text-lg font-display font-medium text-gray-100 flex items-center gap-2">
          <Layers className="w-5 h-5 text-gold-500" /> Tap your countertops
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          {reason ? `${reason} ` : ""}Tap every part of the countertops to cover them in {stoneName}. Use{" "}
          <span className="text-teal-300">Vertical faces</span> for waterfall ends and thick front edges. Tap again to undo a region.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {modeButton("top", "Countertop tops", <PanelTop className="w-4 h-4" />, "mode-top")}
        {modeButton("face", "Vertical faces", <Layers className="w-4 h-4" />, "mode-face")}
        <button
          type="button"
          onClick={() => history.length && (setMarks(history[history.length - 1]), setHistory((h) => h.slice(0, -1)))}
          disabled={!history.length}
          className="px-4 py-2 rounded-xl text-xs font-medium border bg-dark-700/50 border-white/10 text-gray-400 hover:text-gray-200 flex items-center gap-2 disabled:opacity-40"
        >
          <Undo2 className="w-4 h-4" /> Undo
        </button>
        <button
          type="button"
          onClick={() => (setHistory((h) => [...h, marks]), setMarks(new Map()))}
          disabled={!marks.size}
          className="px-4 py-2 rounded-xl text-xs font-medium border bg-dark-700/50 border-white/10 text-gray-400 hover:text-gray-200 flex items-center gap-2 disabled:opacity-40"
        >
          <Eraser className="w-4 h-4" /> Clear
        </button>
      </div>

      <div className="relative w-full rounded-2xl overflow-hidden bg-black select-none touch-manipulation">
        <img src={photo} alt="Your room" className="block w-full h-auto" draggable={false} />
        {seg ? (
          <canvas
            ref={canvasRef}
            data-testid="surface-picker-canvas"
            className="absolute inset-0 w-full h-full cursor-crosshair"
            onPointerDown={(e) => toggle(pointToRegion(e))}
            onPointerMove={(e) => e.pointerType === "mouse" && setHover(pointToRegion(e))}
            onPointerLeave={() => setHover(0)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-gray-200">
            {error ?? (img ? "Finding the surfaces in your photo…" : "Loading photo…")}
          </div>
        )}
      </div>

      {error && seg && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {counts.top} top region{counts.top === 1 ? "" : "s"} · {counts.face} vertical region{counts.face === 1 ? "" : "s"} selected
        </p>
        <button
          type="button"
          data-testid="surface-picker-confirm"
          onClick={confirm}
          disabled={!seg || marks.size === 0}
          className="px-8 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-gold-500 to-gold-400 text-dark-900 shadow-gold-glow hover:scale-[1.03] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none"
        >
          <Sparkles className="w-4 h-4" /> Visualize {stoneName}
        </button>
      </div>
    </div>
  );
}
