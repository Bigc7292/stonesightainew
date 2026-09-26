/**
 * Renders the first-person walkthrough video in the browser from the 3D
 * room scene (used when NVIDIA Cosmos is not configured or fails).
 *
 * A dedicated WebGL canvas renders the scripted camera path
 * (walkthroughPath.ts) frame by frame.
 *
 * Encoding:
 *   1. WebCodecs + mediabunny (Chrome, Edge, Safari 16.4+, Firefox 130+):
 *      every frame gets an exact timestamp, so the video is always `seconds`
 *      long at `fps`, however fast or slow the GPU is — and on a fast GPU it
 *      finishes much quicker than real time. H.264/MP4 when the browser can
 *      encode it, otherwise VP9/VP8 in WebM.
 *   2. MediaRecorder fallback (older browsers): real-time capture with
 *      explicit requestFrame() pacing.
 */
import * as THREE from "three";
import type { SceneColors } from "../../shared/scene";
import { RoomScene } from "./RoomScene";
import type { RoomLayout } from "./roomGeometry";
import { buildWalkthroughPath } from "./walkthroughPath";

export interface RecordOptions {
  photo: HTMLImageElement;
  swatch: HTMLImageElement | HTMLCanvasElement | null;
  layout: RoomLayout;
  colors: SceneColors;
  width?: number;
  height?: number;
  seconds?: number;
  fps?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface RecordedVideo {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: "mp4" | "webm";
  encoder: "webcodecs" | "mediarecorder";
}

export function pickRecorderMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

const hasWebCodecs = () => typeof window !== "undefined" && "VideoEncoder" in window;

export function canRecordVideo(): boolean {
  if (hasWebCodecs()) return true;
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype &&
    pickRecorderMime() !== ""
  );
}

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

async function encodeWithWebCodecs(
  canvas: HTMLCanvasElement,
  renderAt: (t: number) => void,
  { width, height, seconds, fps, onProgress, signal }: Required<Pick<RecordOptions, "width" | "height" | "seconds" | "fps">> & RecordOptions,
): Promise<{ blob: Blob; mimeType: string; extension: "mp4" | "webm" } | null> {
  const mb = await import("mediabunny");
  // H.264/MP4 plays everywhere; builds without an H.264 encoder (open-source
  // Chromium, some Firefox) get VP9/VP8 in WebM instead.
  const candidates = [
    { codec: "avc", mimeType: "video/mp4", extension: "mp4" as const, format: () => new mb.Mp4OutputFormat({ fastStart: "in-memory" }) },
    { codec: "vp9", mimeType: "video/webm", extension: "webm" as const, format: () => new mb.WebMOutputFormat() },
    { codec: "vp8", mimeType: "video/webm", extension: "webm" as const, format: () => new mb.WebMOutputFormat() },
  ] as const;
  let chosen: (typeof candidates)[number] | undefined;
  for (const c of candidates) {
    if (await mb.canEncodeVideo(c.codec, { width, height })) {
      chosen = c;
      break;
    }
  }
  if (!chosen) return null;

  const output = new mb.Output({ format: chosen.format(), target: new mb.BufferTarget() });
  const source = new mb.CanvasSource(canvas, { codec: chosen.codec, quality: mb.QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const total = Math.round(seconds * fps);
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      await output.cancel();
      throw new DOMException("aborted", "AbortError");
    }
    renderAt(i / (total - 1));
    await source.add(i / fps, 1 / fps); // awaits encoder back-pressure
    onProgress?.((i + 1) / total);
    if (i % 2 === 0) await yieldToBrowser(); // keep the live 3D view responsive while encoding
  }
  await output.finalize();
  const buffer = output.target.buffer;
  return buffer ? { blob: new Blob([buffer], { type: chosen.mimeType }), mimeType: chosen.mimeType, extension: chosen.extension } : null;
}

async function encodeWithMediaRecorder(
  canvas: HTMLCanvasElement,
  renderAt: (t: number) => void,
  { seconds, fps, onProgress, signal }: Required<Pick<RecordOptions, "seconds" | "fps">> & RecordOptions,
): Promise<{ blob: Blob; mimeType: string }> {
  const mimeType = pickRecorderMime();
  if (!mimeType) throw new Error("This browser cannot record video");
  const manual = canvas.captureStream(0);
  const manualTrack = manual.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const stream = manualTrack?.requestFrame ? manual : canvas.captureStream(fps);
  if (stream !== manual) manual.getTracks().forEach((t) => t.stop());
  const push = stream === manual ? () => manualTrack.requestFrame!() : () => undefined;

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start(250);

  const total = Math.round(seconds * fps);
  const frameMs = 1000 / fps;
  const nextTick = () =>
    new Promise<void>((r) => (document.hidden ? setTimeout(r, frameMs) : requestAnimationFrame(() => r())));
  let due = performance.now();
  for (let i = 0; i <= total; i++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    renderAt(i / total);
    push();
    onProgress?.(i / total);
    due += frameMs;
    do await nextTick();
    while (performance.now() < due - 2);
  }
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return { blob: new Blob(chunks, { type: mimeType.split(";")[0] }), mimeType };
}

/** True when WebGL runs on a CPU rasteriser (no GPU) — rendering is then ~10× slower. */
export function isSoftwareRenderer(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch {
    return false;
  }
}

export async function recordWalkthrough(opts: RecordOptions): Promise<RecordedVideo> {
  // Without a GPU, 540p keeps the fallback recording reasonably quick.
  const software = !opts.width && isSoftwareRenderer();
  const settings = {
    ...opts,
    width: opts.width ?? (software ? 960 : 1280),
    height: opts.height ?? (software ? 540 : 720),
    seconds: opts.seconds ?? 12,
    fps: opts.fps ?? 30,
  };
  const { width, height } = settings;

  // Attached but off-screen: some browsers only produce frames for canvases in the DOM.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  Object.assign(canvas.style, { position: "fixed", left: "-10000px", top: "0", width: `${width}px`, height: `${height}px`, pointerEvents: "none" });
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const room = new RoomScene(renderer, { photo: opts.photo, swatch: opts.swatch, layout: opts.layout, colors: opts.colors });
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.05, 80);
  camera.rotation.order = "YXZ";
  const poseAt = buildWalkthroughPath(opts.layout);
  const renderAt = (t: number) => {
    const pose = poseAt(t);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0, "YXZ");
    renderer.render(room.scene, camera);
  };

  try {
    renderAt(0);
    if (hasWebCodecs()) {
      try {
        const encoded = await encodeWithWebCodecs(canvas, renderAt, settings);
        if (encoded) return { ...encoded, url: URL.createObjectURL(encoded.blob), encoder: "webcodecs" };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        console.warn("[video] WebCodecs encoding failed, falling back to MediaRecorder", error);
      }
    }
    const { blob, mimeType } = await encodeWithMediaRecorder(canvas, renderAt, settings);
    return {
      blob,
      url: URL.createObjectURL(blob),
      mimeType,
      extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
      encoder: "mediarecorder",
    };
  } finally {
    room.dispose();
    renderer.dispose();
    canvas.remove();
  }
}
