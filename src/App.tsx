/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StoneSight AI — main application.
 *
 * One click on "Generate Visualization" produces three deliverables:
 *   1. A static image of the customer's room with the chosen stone
 *      (photoreal edit by a Gemini image model or an NVIDIA FLUX.1 Kontext NIM,
 *      composited into the original photo inside Claude's surface mask, or the
 *      local Claude-guided stone renderer when no editor is available).
 *   2. A first-person, eye-level walkthrough video
 *      (NVIDIA Cosmos image-to-video, or recorded in the browser from the 3D scene).
 *   3. An interactive first-person 3D walkthrough of the room.
 *
 * AI providers: Anthropic Claude (analysis, prompts, masks), Gemini image
 * models via an OpenAI-compatible gateway (photoreal edit) and NVIDIA
 * (Kontext / Cosmos NIMs). See docs/architecture.md.
 */

import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Upload,
  Search,
  Filter,
  Check,
  Loader2,
  Download,
  RefreshCcw,
  Maximize2,
  Image as ImageIcon,
  Video,
  ArrowRight,
  X,
  Info,
  CheckCircle2,
  LogOut,
  Shield,
  Code2,
  User as UserIcon,
  Clock,
  Box,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { BeforeAfterSlider } from "./components/BeforeAfterSlider";
import { Stone } from "./types";
import { STONE_DATABASE } from "./stones";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { saveGeneration } from "./services/generationService";
import { extractAndStorePatterns } from "./services/aiMemoryService";
import { GenerationGallery } from "./components/GenerationGallery";
import { defaultScene, type SceneAnalysis } from "../shared/scene";
import {
  API_URL,
  analyzeRoom,
  editImage,
  getCapabilities,
  startVideoJob,
  waitForVideo,
  type Capabilities,
} from "./lib/api";
import { downloadUrl, fileToDataUrl, loadImage, loadSwatch, urlToDataUrl } from "./lib/imageUtils";
import { compositeEditedImage, renderStoneLocally } from "./render/visualize";
import { buildRoomLayout } from "./scene/roomGeometry";

// three.js-based modules load on demand so the upload screen stays light.
const RoomWalkthrough3D = lazy(() => import("./components/RoomWalkthrough3D"));
const loadRecorder = () => import("./scene/recordWalkthrough");

// --- Components ---

// --- Components ---

const RoleBadge = ({ role }: { role: string }) => {
  const config = {
    admin: {
      icon: <Shield className="w-3 h-3" />,
      label: "Admin",
      classes: "border-amber-500/30 text-amber-400 bg-amber-500/10",
    },
    dev: {
      icon: <Code2 className="w-3 h-3" />,
      label: "Dev",
      classes: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    },
    user: {
      icon: <UserIcon className="w-3 h-3" />,
      label: "User",
      classes: "border-blue-500/30 text-blue-400 bg-blue-500/10",
    },
  }[role] || {
    icon: null,
    label: role,
    classes: "border-gray-500/30 text-gray-400 bg-gray-500/10",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border ${config.classes}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
};

const Header = () => {
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5 px-8 py-4 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <img src="/logo.jpg" alt="StoneSight Logo" className="w-12 h-12" />
          <div className="flex flex-col">
            <div className="flex items-baseline">
              <h1 className="text-xl font-bold tracking-tight text-white leading-none font-display">
                St
                <span className="text-gold-500 relative">
                  o
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px]">
                    ^
                  </span>
                </span>
                ne<span className="text-gold-500">Sight</span>
              </h1>
            </div>
            <span className="text-[8px] font-medium text-gray-400 tracking-[0.15em] mt-0.5 uppercase">
              Professional Stone & Surface Visualization
            </span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 px-4 py-2 bg-dark-800/50 hover:bg-gold-500/10 text-gray-400 hover:text-gold-400 border border-white/5 hover:border-gold-500/30 rounded-xl transition-all group"
          >
            <Clock className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-widest hidden sm:inline">
              History
            </span>
          </button>
          <button className="p-2 text-gray-400 hover:text-gold-500 transition-colors">
            <Filter className="w-5 h-5" />
          </button>
          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 hover:border-gold-500/30 transition-all"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-gold flex items-center justify-center text-dark-900 text-xs font-bold">
                {user?.name?.charAt(0).toUpperCase() || "?"}
              </div>
              <span className="text-sm text-gray-300 hidden sm:block">
                {user?.name}
              </span>
              {user && <RoleBadge role={user.role} />}
            </button>

            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-64 glass rounded-xl p-3 shadow-premium border border-white/10"
                >
                  <div className="px-3 py-2 border-b border-white/5 mb-2">
                    <p className="text-sm font-medium text-white">
                      {user?.name}
                    </p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                    <div className="mt-1.5">
                      {user && <RoleBadge role={user.role} />}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showHistory && (
          <GenerationGallery onClose={() => setShowHistory(false)} />
        )}
      </AnimatePresence>
    </>
  );
};

const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = [
    { name: "Home", icon: <ImageIcon className="w-4 h-4" /> },
    { name: "Samples", icon: <Filter className="w-4 h-4" /> },
    { name: "Projects", icon: <CheckCircle2 className="w-4 h-4" /> },
  ];
  return (
    <div className="flex items-center justify-center gap-8 mb-12 border-b border-white/10 pb-4">
      {steps.map((step, idx) => (
        <div
          key={step.name}
          className="relative flex flex-col items-center gap-2 cursor-pointer group"
        >
          <span
            className={`text-sm font-medium transition-colors ${currentStep === idx ? "text-gold-500" : "text-gray-500 group-hover:text-gray-300"}`}
          >
            {step.name}
          </span>
          {currentStep === idx && (
            <motion.div
              layoutId="activeStep"
              className="absolute -bottom-4 left-0 right-0 h-0.5 bg-gold-500"
            />
          )}
        </div>
      ))}
    </div>
  );
};

interface VideoState {
  status: "idle" | "generating" | "rendering" | "ready" | "error";
  url?: string;
  source?: "nvidia-cosmos" | "browser";
  extension?: string;
  progress?: number;
  message?: string;
}

const slug = (s?: string) => (s || "stone").toLowerCase().replace(/[^a-z0-9]+/g, "-");

function StoneSightApp() {
  const { user, accessToken } = useAuth();
  const [step, setStep] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [selectedStone, setSelectedStone] = useState<Stone | null>(null);
  const [hoveredStone, setHoveredStone] = useState<Stone | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [imageEngine, setImageEngine] = useState("");
  const [analysis, setAnalysis] = useState<SceneAnalysis | null>(null);
  const [video, setVideo] = useState<VideoState>({ status: "idle" });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  const [stones] = useState<Stone[]>(STONE_DATABASE);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTone, setActiveTone] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Incremented per run so a stale run never overwrites a newer one. */
  const runRef = useRef(0);
  const videoBlobRef = useRef<string | null>(null);

  useEffect(() => {
    getCapabilities().then(setCapabilities);
  }, []);

  useEffect(
    () => () => {
      if (videoBlobRef.current) URL.revokeObjectURL(videoBlobRef.current);
    },
    [],
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // Normalise orientation and size once; every pipeline uses these pixels.
      setUploadedImage(await fileToDataUrl(file));
      setStep(1);
    } catch {
      setErrorMessage("That file could not be read as an image. Please try a JPEG or PNG photo.");
    }
  };

  const addNotice = (run: number, text: string) => {
    if (run === runRef.current) setNotices((n) => [...n, text]);
  };

  /** Produces the walkthrough video: NVIDIA Cosmos first, browser recording as fallback. */
  const produceVideo = async (run: number, image: string, scene: SceneAnalysis, stone: Stone, caps: Capabilities) => {
    const current = () => run === runRef.current;
    if (caps.video.length > 0) {
      setVideo({ status: "generating", source: "nvidia-cosmos" });
      try {
        const { jobId } = await startVideoJob(accessToken, image, scene.video_prompt, stone);
        const url = await waitForVideo(accessToken, jobId);
        if (!current()) return;
        setVideo({ status: "ready", url, source: "nvidia-cosmos", extension: "mp4" });
        if (user) {
          saveGeneration({
            userId: user.id,
            generationType: "video",
            inputPrompt: scene.video_prompt,
            outputUrl: url,
            outputMetadata: { stoneId: stone.id, source: "nvidia-cosmos" },
            modelUsed: "nvidia-cosmos",
            tags: [stone.category, stone.tone, stone.name],
          }).catch(console.error);
        }
        return;
      } catch (error) {
        addNotice(run, `NVIDIA Cosmos video unavailable (${error instanceof Error ? error.message : "error"}) — rendering the walkthrough from your 3D scene instead.`);
      }
    }
    if (!current()) return;
    const { canRecordVideo, recordWalkthrough } = await loadRecorder();
    if (!canRecordVideo()) {
      setVideo({ status: "error", message: "This browser cannot record video. Use the interactive 3D walkthrough below." });
      return;
    }
    setVideo({ status: "rendering", source: "browser", progress: 0 });
    try {
      const [photo, swatch] = await Promise.all([loadImage(image), loadSwatch(stone.swatchUrl).catch(() => null)]);
      const layout = buildRoomLayout(scene, photo.naturalWidth / photo.naturalHeight);
      const recorded = await recordWalkthrough({
        photo,
        swatch,
        layout,
        colors: scene.colors,
        onProgress: (p) => current() && setVideo((v) => ({ ...v, progress: p })),
      });
      if (!current()) {
        URL.revokeObjectURL(recorded.url);
        return;
      }
      if (videoBlobRef.current) URL.revokeObjectURL(videoBlobRef.current);
      videoBlobRef.current = recorded.url;
      setVideo({ status: "ready", url: recorded.url, source: "browser", extension: recorded.extension });
    } catch (error) {
      if (current()) setVideo({ status: "error", message: error instanceof Error ? error.message : "Video rendering failed" });
    }
  };

  const startVisualization = async () => {
    if (!uploadedImage || !selectedStone) return;
    const run = ++runRef.current;
    const stone = selectedStone;
    const photo = uploadedImage;
    const current = () => run === runRef.current;

    setResultImage(null);
    setAnalysis(null);
    setImageEngine("");
    setNotices([]);
    setErrorMessage(null);
    setVideo({ status: "idle" });
    setIsProcessing(true);
    setStep(2);

    try {
      const caps = capabilities ?? (await getCapabilities());
      setCapabilities(caps);
      setProcessingStatus("Preparing your photo…");
      const swatch = await urlToDataUrl(stone.swatchUrl, 768).catch(() => null);

      // 1. Scene analysis (Claude, or the NVIDIA VLM fallback).
      let scene: SceneAnalysis | null = null;
      if (caps.analysis) {
        setProcessingStatus(
          caps.analysis === "claude"
            ? "Claude is mapping your room's stone surfaces…"
            : "NVIDIA vision model is mapping your room's stone surfaces…",
        );
        try {
          scene = (await analyzeRoom(accessToken, photo, swatch, stone)).analysis;
        } catch (error) {
          addNotice(run, `Scene analysis failed: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      if (!current()) return;
      const hasSurfaces = !!scene && scene.surfaces.length > 0;

      // 2. Static image: photoreal edit (NVIDIA Kontext NIM or Gemini image,
      //    composited into the original inside Claude's stone mask), else the
      //    local Claude-guided renderer.
      let result: string | null = null;
      let engine = "";
      if (caps.image.length > 0) {
        setProcessingStatus(`Installing ${stone.name} on your surfaces…`);
        try {
          const edited = await editImage(accessToken, photo, scene?.edit_instruction ?? "", stone, {
            swatch,
            scene: hasSurfaces ? scene : null,
          });
          const editor = edited.provider === "gemini-image" ? `Gemini ${edited.model ?? "image"}` : "NVIDIA FLUX.1 Kontext";
          if (edited.composited) {
            result = edited.image;
            engine = `${editor} · Claude precision mask`;
          } else if (hasSurfaces) {
            setProcessingStatus("Preserving everything except the stone…");
            result = await compositeEditedImage(photo, edited.image, scene!);
            engine = `${editor} · Claude precision mask`;
          } else {
            result = edited.image;
            engine = editor;
          }
        } catch (error) {
          addNotice(run, `Photoreal image editing unavailable (${error instanceof Error ? error.message : "error"}).`);
        }
      }
      if (!result && hasSurfaces) {
        setProcessingStatus(`Rendering ${stone.name} onto the surfaces Claude mapped…`);
        result = await renderStoneLocally(photo, stone.swatchUrl, scene!);
        engine = "StoneSight renderer · Claude surface map";
      }
      if (!current()) return;
      if (!result) {
        // Explain the real cause: nothing configured, services failed, or no surfaces found.
        throw new Error(
          caps.reachable === false
            ? `Can't reach the StoneSight server at ${API_URL}. Start it (npm run server) or, on a hosted site, set VITE_API_URL to the deployed server's address — see README.`
            : !caps.analysis && caps.image.length === 0
            ? "The AI services are not configured on the server. Add ANTHROPIC_API_KEY (and IMAGE_EDIT_BASE_URL + IMAGE_EDIT_API_KEY for photoreal edits) to the server's environment — see README — and restart it."
            : scene
              ? "We couldn't find any stone surfaces in this photo. Try a wider, well-lit photo that clearly shows the countertops."
              : "Scene analysis and NVIDIA image editing both failed (see the notes above). Add or check ANTHROPIC_API_KEY, or deploy the NVIDIA Kontext NIM (FLUX_INFERENCE_URL), then try again.",
        );
      }

      const finalScene = scene ?? defaultScene();
      setResultImage(result);
      setImageEngine(engine);
      setAnalysis(finalScene);
      setIsProcessing(false);
      setProcessingStatus("Visualization complete.");

      if (user) {
        saveGeneration({
          userId: user.id,
          generationType: "image",
          inputImageUrl: photo,
          inputPrompt: finalScene.edit_instruction || `Apply ${stone.name} to stone surfaces`,
          inputParameters: { stoneName: stone.name, stoneCategory: stone.category, stoneTone: stone.tone },
          outputUrl: result,
          outputMetadata: { stoneId: stone.id, engine, surfaces: finalScene.surfaces.length },
          modelUsed: engine,
          tags: [stone.category, stone.tone, stone.name],
        })
          .then((saved) => {
            if (saved.data) {
              extractAndStorePatterns({
                id: saved.data.id,
                generation_type: "image",
                input_parameters: { stoneName: stone.name, stoneCategory: stone.category, stoneTone: stone.tone },
                processing_time_ms: saved.data.processing_time_ms,
                model_used: engine,
                tags: [stone.category, stone.tone, stone.name],
              }).catch(console.error);
            }
          })
          .catch(console.error);
      }

      // 3. Video (runs in the background while the user explores the 3D scene).
      produceVideo(run, result, finalScene, stone, caps);
    } catch (error) {
      if (!current()) return;
      console.error("Visualization failed:", error);
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setProcessingStatus("");
      setIsProcessing(false);
    }
  };

  const downloadImage = () =>
    resultImage && downloadUrl(resultImage, `stonesight-${slug(selectedStone?.name)}.jpg`);
  const downloadVideo = () =>
    video.url && downloadUrl(video.url, `stonesight-walkthrough-${slug(selectedStone?.name)}.${video.extension || "mp4"}`);

  const videoBusy = video.status === "generating" || video.status === "rendering";

  const filteredStones = stones.filter(
    (stone: {
      name: string;
      description: string;
      category: any;
      tone: any;
    }) => {
      const matchesSearch =
        stone.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        stone.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        !activeCategory || stone.category === activeCategory;
      const matchesTone = !activeTone || stone.tone === activeTone;
      return matchesSearch && matchesCategory && matchesTone;
    },
  );

  return (
    <div className="min-h-screen bg-dark-900 text-gray-100 font-sans selection:bg-gold-500/30 selection:text-gold-400">
      <Header />

      <main className="pt-32 pb-20 px-6 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div
              key="step-0"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center text-center max-w-3xl mx-auto pt-10"
            >
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-gold-500/20 blur-3xl rounded-full" />
                <div className="relative w-32 h-32 flex flex-col items-center justify-center">
                  <img
                    src="/logo.jpg"
                    alt="StoneSight Logo"
                    className="w-32 h-32"
                  />
                </div>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 leading-[1.1] font-display">
                Visualize <br />
                <span className="text-gradient-gold">New Horizons</span>
              </h1>
              <p className="text-lg text-gray-400 mb-12 max-w-xl font-light">
                See your own room in new stone: a photoreal image, a first-person
                walkthrough video and a 3D room you can walk around.
              </p>

              <div
                onClick={() => {
                  console.log('[Upload] Click detected');
                  fileInputRef.current?.click();
                }}
                className="w-full max-w-md aspect-video border border-white/10 rounded-[24px] flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-gold-500/50 hover:bg-white/5 transition-all group mb-12 bg-dark-800/50 backdrop-blur-sm shadow-premium relative z-10"
              >
                <div className="w-16 h-16 rounded-full bg-dark-700 flex items-center justify-center group-hover:bg-gold-500/20 group-hover:text-gold-400 transition-colors text-gray-400 border border-white/5 group-hover:border-gold-500/30">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-gray-200">
                    Tap to upload space
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    High-quality photo recommended
                  </p>
                </div>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="sr-only"
                accept="image/*"
              />

              {/* Photo Guide */}
              <div className="w-full max-w-4xl bg-dark-800/50 rounded-[24px] p-8 shadow-premium border border-white/5 text-left backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-gold-500/10 text-gold-400 rounded-xl border border-gold-500/20">
                    <Info className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-200">
                    Photography Guidelines
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Guideline 1: Natural Lighting */}
                  <motion.div
                    className="space-y-4 p-4 bg-dark-700/50 rounded-xl border border-white/5 hover:border-gold-500/30 transition-all cursor-pointer group"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    whileHover={{
                      y: -5,
                      boxShadow:
                        "0 10px 15px -3px rgba(212, 175, 55, 0.1), 0 4px 6px -2px rgba(212, 175, 55, 0.05)",
                    }}
                  >
                    <h4 className="font-medium text-sm mb-1 text-gray-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-gold-500 group-hover:scale-110 transition-transform" />
                      Natural Lighting
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Ensure the room is well-lit, preferably with natural
                      daylight. Avoid harsh shadows.
                    </p>
                  </motion.div>

                  {/* Guideline 2: Clear Surfaces */}
                  <motion.div
                    className="space-y-4 p-4 bg-dark-700/50 rounded-xl border border-white/5 hover:border-gold-500/30 transition-all cursor-pointer group"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.3 }}
                    whileHover={{
                      y: -5,
                      boxShadow:
                        "0 10px 15px -3px rgba(212, 175, 55, 0.1), 0 4px 6px -2px rgba(212, 175, 55, 0.05)",
                    }}
                  >
                    <h4 className="font-medium text-sm mb-1 text-gray-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-gold-500 group-hover:scale-110 transition-transform" />
                      Clear Surfaces
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Capture a wide angle showing existing countertops clearly.
                      Remove clutter.
                    </p>
                  </motion.div>

                  {/* Guideline 3: Direct Angle */}
                  <motion.div
                    className="space-y-4 p-4 bg-dark-700/50 rounded-xl border border-white/5 hover:border-gold-500/30 transition-all cursor-pointer group"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.3 }}
                    whileHover={{
                      y: -5,
                      boxShadow:
                        "0 10px 15px -3px rgba(212, 175, 55, 0.1), 0 4px 6px -2px rgba(212, 175, 55, 0.05)",
                    }}
                  >
                    <h4 className="font-medium text-sm mb-1 text-gray-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-gold-500 group-hover:scale-110 transition-transform" />
                      Direct Angle
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Take the photo straight on or at a slight angle, avoiding
                      extreme perspectives.
                    </p>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full"
            >
              <StepIndicator currentStep={1} />

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                {/* Left: Preview & Filters */}
                <div className="lg:col-span-4 space-y-8">
                  <div className="bg-dark-800/50 p-6 rounded-[24px] shadow-premium border border-white/5 backdrop-blur-sm">
                    <h3 className="text-xs font-medium uppercase tracking-widest mb-4 flex items-center gap-2 text-gray-400">
                      <ImageIcon className="w-4 h-4 text-gold-500" /> Your Space
                    </h3>
                    <div className="aspect-video rounded-xl overflow-hidden bg-dark-900 relative group border border-white/5">
                      <img
                        src={uploadedImage!}
                        alt="Preview"
                        className="w-full h-full object-cover opacity-80"
                        referrerPolicy="no-referrer"
                      />

                      {/* Real-time Hover Preview Overlay */}
                      <AnimatePresence>
                        {hoveredStone && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 pointer-events-none"
                          >
                            <img
                              src={hoveredStone.swatchUrl}
                              onLoad={() => setIsPreviewLoading(false)}
                              onError={() => setIsPreviewLoading(false)}
                              referrerPolicy="no-referrer"
                              className={`w-full h-full object-cover mix-blend-overlay opacity-50 transition-opacity duration-300 ${isPreviewLoading ? "opacity-0" : "opacity-50"}`}
                              alt="Preview Overlay"
                            />

                            <div className="absolute top-3 right-3 px-3 py-1.5 bg-dark-900/80 border border-gold-500/30 text-gold-400 text-[10px] font-medium rounded-lg uppercase tracking-widest shadow-lg flex items-center gap-2 backdrop-blur-md">
                              {isPreviewLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <div className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-pulse" />
                              )}
                              {isPreviewLoading
                                ? "Loading..."
                                : hoveredStone.name}
                            </div>

                            {isPreviewLoading && (
                              <div className="absolute inset-0 flex items-center justify-center bg-dark-900/40 backdrop-blur-[2px]">
                                <div className="flex flex-col items-center gap-2">
                                  <Loader2 className="w-6 h-6 animate-spin text-gold-500" />
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        onClick={() => setStep(0)}
                        className="absolute inset-0 bg-dark-900/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white font-medium transition-opacity backdrop-blur-sm"
                      >
                        Change Photo
                      </button>
                    </div>
                  </div>

                  <div className="bg-dark-800/50 p-6 rounded-[24px] shadow-premium border border-white/5 backdrop-blur-sm">
                    <h3 className="text-xs font-medium uppercase tracking-widest mb-6 flex items-center gap-2 text-gray-400">
                      <Filter className="w-4 h-4 text-gold-500" /> Collection
                      Filter
                    </h3>

                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3 block">
                          Material
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {["Quartz", "Dekton", "Marble", "Granite"].map(
                            (cat) => (
                              <button
                                key={cat}
                                onClick={() =>
                                  setActiveCategory(
                                    activeCategory === cat ? null : cat,
                                  )
                                }
                                className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                                  activeCategory === cat
                                    ? "bg-gold-500/10 border-gold-500 text-gold-400 shadow-gold-glow"
                                    : "bg-dark-700/50 border-white/5 text-gray-400 hover:bg-dark-600 hover:text-gray-200"
                                }`}
                              >
                                {cat}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3 block">
                          Tone
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {["Light", "Dark", "Warm"].map((tone) => (
                            <button
                              key={tone}
                              onClick={() =>
                                setActiveTone(activeTone === tone ? null : tone)
                              }
                              className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                                activeTone === tone
                                  ? "bg-gold-500/10 border-gold-500 text-gold-400 shadow-gold-glow"
                                  : "bg-dark-700/50 border-white/5 text-gray-400 hover:bg-dark-600 hover:text-gray-200"
                              }`}
                            >
                              {tone}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(activeCategory || activeTone || searchQuery) && (
                        <button
                          onClick={() => {
                            setActiveCategory(null);
                            setActiveTone(null);
                            setSearchQuery("");
                          }}
                          className="w-full py-2 text-[10px] font-medium text-gray-500 uppercase tracking-widest hover:text-gold-400 transition-colors"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    disabled={!selectedStone}
                    onClick={startVisualization}
                    className={`w-full py-5 rounded-2xl font-medium text-sm tracking-wide flex items-center justify-center gap-3 transition-all ${
                      selectedStone
                        ? "bg-gradient-gold text-dark-900 shadow-gold-glow hover:scale-[1.02] active:scale-[0.98]"
                        : "bg-dark-700/50 text-gray-600 cursor-not-allowed border border-white/5"
                    }`}
                  >
                    Generate Visualization <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Right: Stone Grid */}
                <div className="lg:col-span-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-baseline gap-4">
                      <h2 className="text-2xl font-display font-medium text-gray-100">
                        Stone Collection
                      </h2>
                    </div>
                    <div className="relative w-full md:w-auto">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e: { target: { value: any } }) =>
                          setSearchQuery(e.target.value)
                        }
                        placeholder="Search collection..."
                        className="pl-11 pr-6 py-2.5 bg-dark-800/50 rounded-xl border border-white/10 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50 transition-all w-full md:w-64 text-sm text-gray-200 placeholder:text-gray-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                    {filteredStones.length === 0 ? (
                      <div className="col-span-full py-20 text-center text-gray-500">
                        <p className="font-medium text-sm">
                          No stones found matching your criteria.
                        </p>
                      </div>
                    ) : (
                      filteredStones.map((stone: Stone, index: number) => (
                        <motion.div
                          key={`${stone.name || "stone"}-${index}`}
                          whileHover={{ y: -4 }}
                          onMouseEnter={() => {
                            setHoveredStone(stone);
                            setIsPreviewLoading(true);
                          }}
                          onMouseLeave={() => {
                            setHoveredStone(null);
                            setIsPreviewLoading(false);
                          }}
                          onClick={() => setSelectedStone(stone)}
                          className={`group cursor-pointer bg-dark-800/50 rounded-[20px] overflow-hidden border transition-all duration-300 hover:shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:border-gold-500/50 ${
                            selectedStone?.id === stone.id
                              ? "border-gold-500 shadow-gold-glow"
                              : "border-white/5"
                          }`}
                        >
                          <div className="aspect-[4/5] relative">
                            <img
                              src={stone.swatchUrl}
                              alt={stone.name}
                              className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute top-3 left-3">
                              <span className="px-2.5 py-1 bg-dark-900/80 backdrop-blur-md rounded-md text-[9px] font-medium uppercase tracking-widest text-gray-300 border border-white/10">
                                {stone.category}
                              </span>
                            </div>
                            {selectedStone?.id === stone.id && (
                              <div className="absolute inset-0 bg-gold-500/10 flex items-center justify-center backdrop-blur-[1px]">
                                <div className="w-10 h-10 rounded-full bg-gold-500 text-dark-900 flex items-center justify-center shadow-lg">
                                  <Check className="w-5 h-5" />
                                </div>
                              </div>
                            )}

                            {/* Elegant Label at bottom of image */}
                            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-dark-900/90 to-transparent">
                              <h4
                                className={`font-medium text-sm truncate transition-colors ${selectedStone?.id === stone.id ? "text-gold-400" : "text-gray-200"}`}
                              >
                                {stone.name}
                              </h4>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full"
            >
              <StepIndicator currentStep={2} />

              <div className="space-y-12">
                {errorMessage && (
                  <div
                    data-testid="error-banner"
                    className="bg-red-500/10 border border-red-500/30 p-4 rounded-2xl text-sm text-red-300 flex items-start gap-3"
                  >
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}
                {notices.length > 0 && (
                  <div className="bg-dark-800/50 border border-white/10 p-4 rounded-2xl text-xs text-gray-400 space-y-1">
                    {notices.map((n, i) => (
                      <p key={i} className="flex items-start gap-2">
                        <Info className="w-4 h-4 shrink-0 text-gold-500" />
                        {n}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <h2 className="text-3xl font-display font-medium text-gray-100 mb-2">
                      {isProcessing ? "Crafting Your Vision" : `Your Space in ${selectedStone?.name ?? "Stone"}`}
                    </h2>
                    <p className="text-gray-400 flex items-center gap-2 text-sm" data-testid="processing-status">
                      <span className={`w-2 h-2 rounded-full bg-gold-500 ${isProcessing || videoBusy ? "animate-pulse" : ""}`} />
                      {isProcessing ? processingStatus : imageEngine ? `Rendered with ${imageEngine}` : processingStatus}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                    <button
                      onClick={() => setStep(1)}
                      disabled={isProcessing}
                      className="w-full sm:w-auto px-8 py-3 rounded-xl border font-medium text-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-gold-500 to-gold-400 text-dark-900 shadow-gold-glow hover:scale-[1.03] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none"
                    >
                      <RefreshCcw className="w-4 h-4" /> Try Another Stone
                    </button>
                    <button
                      onClick={() => {
                        downloadImage();
                        if (video.url) setTimeout(downloadVideo, 500);
                      }}
                      disabled={!resultImage}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl bg-dark-700/50 text-gray-300 font-medium text-sm border border-white/10 hover:bg-dark-600 hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4" /> Download All
                    </button>
                  </div>
                </div>

                {/* 1 — Static image with Before/After slider */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-gold-500" /> Stone Visualization · Before / After
                    </h3>
                    <div className="bg-dark-800/50 p-2 rounded-[32px] shadow-premium border border-white/5 aspect-video flex items-center justify-center">
                      {!resultImage ? (
                        <div className="text-center flex flex-col items-center justify-center p-4">
                          {isProcessing ? (
                            <>
                              <div className="relative w-20 h-20 mx-auto mb-6">
                                <div className="absolute inset-0 rounded-full bg-gold-500/5 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                                <div className="absolute inset-0 rounded-full border-2 border-white/10 border-t-gold-500 animate-spin" />
                              </div>
                              <h3 className="font-medium text-gold-400">{processingStatus}</h3>
                            </>
                          ) : (
                            <p className="text-sm text-gray-500">No visualization yet.</p>
                          )}
                        </div>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 1 }}
                          className="w-full h-full rounded-[24px] overflow-hidden"
                          data-testid="result-image"
                        >
                          <BeforeAfterSlider
                            beforeImage={uploadedImage!}
                            afterImage={resultImage}
                            onFullscreen={() => setIsFullscreen(true)}
                          />
                        </motion.div>
                      )}
                    </div>
                    {resultImage && (
                      <div className="text-center text-xs text-gold-400/70 font-light bg-dark-800/30 border border-gold-500/20 rounded-lg px-4 py-2 flex items-center justify-center gap-2">
                        <Info className="w-4 h-4 shrink-0" />
                        <span>
                          {analysis?.surfaces.length
                            ? `${analysis.surfaces.length} stone surface${analysis.surfaces.length === 1 ? "" : "s"} replaced — everything else is your original photo.`
                            : "Stone applied to the main surfaces."}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-8">
                    <div className="bg-dark-800/50 p-8 rounded-[32px] shadow-premium border border-white/5 backdrop-blur-sm">
                      <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-6">
                        Material Details
                      </h3>
                      <div className="flex flex-col sm:flex-row items-start gap-6">
                        <img
                          src={selectedStone?.swatchUrl}
                          alt="Swatch"
                          className="w-24 h-24 rounded-2xl object-cover shadow-md border border-white/10 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <h4 className="text-2xl font-display font-medium mb-2 text-gray-100">
                            {selectedStone?.name}
                          </h4>
                          <div className="flex flex-wrap gap-2 mb-4">
                            <span className="px-3 py-1 bg-dark-700 rounded-lg text-[10px] font-medium uppercase tracking-widest text-gray-300 border border-white/5">
                              {selectedStone?.category}
                            </span>
                            <span className="px-3 py-1 bg-dark-700 rounded-lg text-[10px] font-medium uppercase tracking-widest text-gray-300 border border-white/5">
                              {selectedStone?.tone} Tone
                            </span>
                          </div>
                          <p className="text-sm text-gray-400 leading-relaxed font-light">
                            {selectedStone?.description}
                          </p>
                        </div>
                      </div>
                      {analysis?.summary && (
                        <p className="mt-6 text-xs text-gray-500 leading-relaxed flex gap-2">
                          <Sparkles className="w-4 h-4 text-gold-500 shrink-0" /> {analysis.summary}
                        </p>
                      )}
                    </div>

                    <div className="bg-dark-800/50 p-8 rounded-[32px] shadow-premium border border-white/5 backdrop-blur-sm">
                      <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-4 flex items-center justify-between">
                        <span>Quick Actions</span>
                        <span className="text-[10px] bg-gold-500/10 text-gold-400 px-2.5 py-1 rounded-md border border-gold-500/20">
                          {isProcessing ? "Processing" : resultImage ? "Ready" : "—"}
                        </span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                        {[
                          { label: "Fullscreen", icon: <Maximize2 className="w-5 h-5" />, onClick: () => setIsFullscreen(true), disabled: !resultImage },
                          { label: "Save Image", icon: <Download className="w-5 h-5" />, onClick: downloadImage, disabled: !resultImage },
                          {
                            label: videoBusy ? "Rendering…" : "Save Video",
                            icon: videoBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />,
                            onClick: downloadVideo,
                            disabled: video.status !== "ready",
                          },
                          {
                            label: "Explore 3D",
                            icon: <Box className="w-5 h-5" />,
                            onClick: () => document.getElementById("walkthrough-3d")?.scrollIntoView({ behavior: "smooth" }),
                            disabled: !resultImage,
                          },
                        ].map((a) => (
                          <button
                            key={a.label}
                            onClick={a.onClick}
                            disabled={a.disabled}
                            className="p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {a.icon}
                            <span className="text-[10px] font-medium uppercase tracking-widest">{a.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2 — First-person walkthrough video */}
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                      <Video className="w-4 h-4 text-gold-500" /> First-Person Walkthrough Video
                    </h3>
                    {video.status === "ready" && (
                      <span className="text-[10px] uppercase tracking-widest text-gray-500">
                        {video.source === "nvidia-cosmos" ? "Generated by NVIDIA Cosmos" : "Rendered from your 3D room"}
                      </span>
                    )}
                  </div>
                  <div className="aspect-video rounded-[24px] overflow-hidden bg-dark-900 relative group border border-white/5 shadow-premium">
                    {video.status === "ready" && video.url ? (
                      <>
                        <video
                          data-testid="walkthrough-video"
                          src={video.url}
                          className="w-full h-full object-cover"
                          controls
                          playsInline
                          autoPlay
                          muted
                          loop
                          poster={resultImage ?? undefined}
                        />
                        <button
                          onClick={downloadVideo}
                          className="absolute top-4 right-4 p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:text-gold-400 border border-white/10"
                          title="Download walkthrough video"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                        {resultImage && <img src={resultImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" />}
                        <div className="relative flex flex-col items-center">
                          {video.status === "error" ? (
                            <p className="text-sm text-red-300 max-w-md">{video.message}</p>
                          ) : (
                            <>
                              <Loader2 className={`w-8 h-8 text-gold-500 ${resultImage ? "animate-spin" : "opacity-40"}`} />
                              <p className="mt-4 text-sm font-medium text-gold-400/80">
                                {video.status === "generating"
                                  ? "NVIDIA Cosmos is generating your eye-level walkthrough…"
                                  : video.status === "rendering"
                                    ? `Filming your walkthrough at eye level… ${Math.round((video.progress ?? 0) * 100)}%`
                                    : "Your walkthrough starts once the image is ready."}
                              </p>
                              {video.status === "generating" && (
                                <p className="text-xs text-gray-500 mt-1">This usually takes a few minutes — explore the 3D room meanwhile.</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3 — Interactive 3D walkthrough */}
                <div className="space-y-6" id="walkthrough-3d">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                      <Box className="w-4 h-4 text-gold-500" /> Interactive 3D Walkthrough
                    </h3>
                    <span className="text-[10px] uppercase tracking-widest text-gray-500">
                      Click to look · WASD to walk · corners & map to jump
                    </span>
                  </div>
                  <div className="aspect-video rounded-[24px] overflow-hidden bg-dark-900 border border-white/5 shadow-premium">
                    {resultImage && analysis && selectedStone ? (
                      <Suspense
                        fallback={
                          <div className="w-full h-full flex items-center justify-center text-sm text-gold-400">
                            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading 3D engine…
                          </div>
                        }
                      >
                        <RoomWalkthrough3D
                          photoUrl={resultImage}
                          swatchUrl={selectedStone.swatchUrl}
                          analysis={analysis}
                          stoneName={selectedStone.name}
                        />
                      </Suspense>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">
                        {isProcessing ? "Your 3D room is built right after the image." : "No 3D scene yet."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fullscreen image modal */}
        <AnimatePresence>
          {isFullscreen && resultImage && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-dark-900/95 backdrop-blur-xl flex items-center justify-center p-6 md:p-12"
            >
              <div className="relative w-full h-full flex flex-col items-center justify-center">
                <div className="absolute top-0 left-0 right-0 flex flex-col sm:flex-row sm:items-center justify-between p-4 z-10 gap-4">
                  <div className="flex items-center gap-4">
                    <img src="/logo.jpg" alt="StoneSight Logo" className="w-8 h-8" />
                    <h3 className="text-gray-100 font-display font-medium tracking-tight truncate">
                      {selectedStone?.name} Visualization
                    </h3>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                    <button
                      onClick={downloadImage}
                      className="p-3 bg-dark-800/50 hover:bg-dark-700 text-gold-400 border border-white/5 hover:border-gold-500/30 rounded-full transition-all flex items-center justify-center gap-2 px-6 flex-1 sm:flex-none"
                    >
                      <Download className="w-5 h-5" />
                      <span className="text-[10px] font-medium uppercase tracking-widest">Download Image</span>
                    </button>
                    <button
                      onClick={() => setIsFullscreen(false)}
                      className="p-3 bg-dark-800/50 hover:bg-dark-700 text-gray-400 hover:text-white border border-white/5 rounded-full transition-all shrink-0"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </div>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-full h-[85vh] max-w-7xl rounded-[32px] overflow-hidden shadow-premium border border-white/10 bg-dark-900 flex items-center justify-center"
                >
                  <div className="w-full h-full p-4 md:p-12">
                    <div className="w-full h-full relative">
                      <BeforeAfterSlider beforeImage={uploadedImage!} afterImage={resultImage} />
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, #1a1a1a 0%, #0a0a0a 100%)",
        }}
      >
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo.jpg"
            alt="StoneSight"
            className="w-16 h-16 animate-pulse"
          />
          <div className="w-6 h-6 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <StoneSightApp />;
}
