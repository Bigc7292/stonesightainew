/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from "react";
import {
  Upload,
  ChevronRight,
  ChevronLeft,
  Search,
  Filter,
  Check,
  Loader2,
  Play,
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
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { BeforeAfterSlider } from "./components/BeforeAfterSlider";
import { Stone, StoneCategory, StoneTone } from "./types";
import { STONE_DATABASE } from "./stones";
import { useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { saveGeneration, generate3DModel, get3DModels } from "./services/generationService";
import { extractAndStorePatterns } from "./services/aiMemoryService";
import { GenerationGallery } from "./components/GenerationGallery";
import { supabase } from "./lib/supabase";
import { SplatViewer3D } from "./components/SplatViewer3D";

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

function StoneSightApp() {
  const { user, accessToken: contextToken } = useAuth();
  const [step, setStep] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [selectedStone, setSelectedStone] = useState<Stone | null>(null);
  const [hoveredStone, setHoveredStone] = useState<Stone | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultVideos, setResultVideos] = useState<{
    clockwise?: string;
    counter?: string;
  } | null>(null);
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 3D Generation State
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [isPolling3D, setIsPolling3D] = useState(false);
  const [resultSplat, setResultSplat] = useState<string | null>(null);
  const [splatFormat, setSplatFormat] = useState<'ply' | 'glb'>('ply');
  const [splatTaskId, setSplatTaskId] = useState<string | null>(null);
  const [splatProgress, setSplatProgress] = useState(0);
  const [splatError, setSplatError] = useState<string | null>(null);
  const [showSplatViewer, setShowSplatViewer] = useState(false);

  const [stones, setStones] = useState<Stone[]>(STONE_DATABASE);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTone, setActiveTone] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target?.result as string);
        setStep(1);
      };
      reader.readAsDataURL(file);
    }
  };

  // 3D Generation Function
  const generate3DScene = async () => {
    if (!resultImage || !selectedStone || !user) return;

    setIsGenerating3D(true);
    setIsPolling3D(true);
    setSplatError(null);
    setSplatProgress(0);
    setResultSplat(null);
    setSplatTaskId(null);

    const accessToken = contextToken || "";

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/3d/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            imageUrl: resultImage,
            prompt: `Generate high-quality 3D Gaussian Splat of kitchen with ${selectedStone.name} countertops`,
            userId: user.id,
            stoneName: selectedStone.name,
            stoneId: selectedStone.id,
          }),
        }
      );

      const result = await response.json();

      // Handle 401 Unauthorized - invalid API key
      if (!response.ok && result.details?.includes("TRIPO_API_KEY_INVALID")) {
        throw new Error(
          "Tripo v2 API key is invalid. The current key has 'tcli_' prefix (CLI key).\n" +
          "Get a valid v2 API key from https://platform.tripo3d.ai (no 'tcli_' prefix).\n" +
          "Update TRIPO_API_KEY in server/.env and restart server."
        );
      }

      if (!result.success) {
        throw new Error(result.details || result.error || "3D generation failed");
      }

      if (result.data?.taskId) {
        setSplatTaskId(result.data.taskId);
        setSplatFormat(result.data.format || 'ply');
        poll3DStatus(result.data.taskId);
      } else if (result.data?.modelUrl) {
        setResultSplat(result.data.modelUrl);
        setSplatFormat(result.data.format || 'ply');
        setIsGenerating3D(false);
        setIsPolling3D(false);
      }
    } catch (error) {
      console.error("3D generation failed:", error);
      setSplatError(error instanceof Error ? error.message : "3D generation failed");
      setIsGenerating3D(false);
      setIsPolling3D(false);
    }
  };

  // Poll 3D generation status
  const poll3DStatus = async (taskId: string) => {
    const accessToken = contextToken || "";
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${apiUrl}/api/3d/status/${taskId}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });

        // Handle 401 Unauthorized
        if (response.status === 401) {
          clearInterval(pollInterval);
          setIsPolling3D(false);
          setIsGenerating3D(false);
          setSplatError(
            "Tripo 3D API key is invalid or missing. Please add a valid TRIPO_API_KEY to your .env file. " +
            "Get your API key from https://developers.tripo3d.ai"
          );
          return;
        }

        const result = await response.json();

        if (result.success && result.data) {
          setSplatProgress(result.data.progress || 0);

          if (result.data.status === "success") {
            clearInterval(pollInterval);
            setIsPolling3D(false);
            setIsGenerating3D(false);
            
            if (result.data.output?.ply || result.data.output?.glb) {
              // The model should already be uploaded to Supabase by the backend
              // We'll need to fetch the actual URL from the backend
              // For now, we'll trigger a re-fetch or use the task result
              setResultSplat(result.data.output.ply || result.data.output.glb);
              setSplatFormat(result.data.output.ply ? 'ply' : 'glb');
            }
          } else if (result.data.status === "failed") {
            clearInterval(pollInterval);
            setIsPolling3D(false);
            setIsGenerating3D(false);
            setSplatError(result.data.error || "3D generation failed");
          }
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, 3000);

    // Cleanup after max attempts (5 minutes)
    setTimeout(() => {
      clearInterval(pollInterval);
      if (isPolling3D) {
        setIsPolling3D(false);
        setIsGenerating3D(false);
        setSplatError("3D generation timed out. Check History later.");
      }
    }, 300000);
  };

  // Reset 3D state when starting new visualization
  const reset3DState = () => {
    setIsGenerating3D(false);
    setIsPolling3D(false);
    setResultSplat(null);
    setSplatTaskId(null);
    setSplatProgress(0);
    setSplatError(null);
    setShowSplatViewer(false);
  };

  const startVisualization = async () => {
    if (!uploadedImage || !selectedStone) return;

    // Reset 3D state for new visualization
    reset3DState();
    
    // Check for API key selection if using Veo
    if (
      (window as any).aistudio &&
      !(await (window as any).aistudio.hasSelectedApiKey())
    ) {
      await (window as any).aistudio.openSelectKey();
      // Proceed after triggering the dialog as per instructions
    }

    setResultImage(null);
    setResultVideos(null);
    setIsProcessing(true);
    setStep(2);
    setProcessingStatus("Analyzing your kitchen layout...");

    try {
      // 1. Generate Edited Image via server API
      setProcessingStatus("Surgically applying " + selectedStone.name + "...");

      // Use token from context to avoid Lock broken errors
      const accessToken = contextToken || "";

      const imageResponse = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/image/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Include auth token if available (will be handled by auth middleware on server)
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            prompt: \`Perform a strict material swap that replaces ONLY the stone surfaces (countertop, island top, side-ledges, backsplash) in the kitchen with ${selectedStone.name}. Material Description: ${selectedStone.description}. Ensure the vein pattern flows naturally across all replaced surfaces while maintaining original ambient lighting, shadows, and reflections. Do not modify any non-stone elements - windows, sink, cabinets, flooring, appliances, walls, ceiling, fixtures, or any other non-stone objects must remain exactly as they appear, preserving lighting and reflections. Negative instruction: Do not alter, remove, or add any non-stone geometry or texture.\`,
            image: uploadedImage,
          }),
        },
      );

      if (!imageResponse.ok) {
        const errorData = await imageResponse.json();
        throw new Error(errorData.error || "Failed to generate image");
      }

      const imageResult = await imageResponse.json();
      const editedBase64 = imageResult.image;

      if (!editedBase64) throw new Error("Failed to generate image");
      setResultImage(editedBase64);
      setIsProcessing(false);

      let recordId: string | null = null;

      // Track generation in Supabase (non-blocking)
      if (user) {
        const startTime = Date.now();
        saveGeneration({
          userId: user.id,
          generationType: "image",
          inputImageUrl: uploadedImage,
          inputPrompt: `Apply ${selectedStone.name} to kitchen surfaces`,
          inputParameters: {
            stoneName: selectedStone.name,
            stoneCategory: selectedStone.category,
            stoneTone: selectedStone.tone,
          },
          outputUrl: editedBase64,
          outputMetadata: { stoneId: selectedStone.id },
          processingTimeMs: Date.now() - startTime,
          modelUsed: "nvidia-flux.1-kontext-dev",
          tags: [
            selectedStone.category,
            selectedStone.tone,
            selectedStone.name,
          ],
        })
          .then((result) => {
            if (result.data) {
              recordId = result.data.id;
              extractAndStorePatterns({
                id: result.data.id,
                generation_type: "image",
                input_parameters: {
                  stoneName: selectedStone.name,
                  stoneCategory: selectedStone.category,
                  stoneTone: selectedStone.tone,
                },
                processing_time_ms: result.data.processing_time_ms,
                model_used: "nvidia-flux.1-kontext-dev",
                tags: [
                  selectedStone.category,
                  selectedStone.tone,
                  selectedStone.name,
                ],
              }).catch(console.error);
            }
          })
          .catch(console.error);
      }

      // 2. Generate Videos via server API
      setIsGeneratingVideos(true);
      setProcessingStatus("Creating cinematic walkthroughs...");
      let isPending = false;

      try {
        // Run them in parallel for speed
        setProcessingStatus("Generating cinematic walkthroughs in parallel...");

        // Extract base64 data (remove data:image/png;base64, prefix if present)
        const imageBase64 = editedBase64.split(",")[1] || editedBase64;

        const clockwisePromise = fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/video/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Include auth token if available (will be handled by auth middleware on server)
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              prompt: `Cinematic 11-second architectural interior video. Starting from a fixed center point, the camera trucks right and performs a sweeping 180-degree arc around the kitchen island. Maintain smooth parallax movement to emphasize the depth of the room. Focus sharply on the ${selectedStone.name} grain and surface reflections. 4k resolution, fluid gimbal-style movement, no flickering.`,
              image: imageBase64,
            }),
          },
        );

        const counterPromise = fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/video/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Include auth token if available (will be handled by auth middleware on server)
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              prompt: `Cinematic 11-second architectural interior video. Starting from a fixed center point, the camera trucks left and performs a sweeping 180-degree arc around the kitchen island. Maintain smooth parallax movement to emphasize the depth of the room. Focus sharply on the ${selectedStone.name} grain and surface reflections. 4k resolution, fluid gimbal-style movement, no flickering.`,
              image: imageBase64,
            }),
          },
        );

        const [clockwiseResponse, counterResponse] = await Promise.all([
          clockwisePromise,
          counterPromise,
        ]);

        let clockwiseUrl: string | null = null;
        let counterUrl: string | null = null;

        // Process clockwise video
        if (clockwiseResponse.ok) {
          const clockwiseResult = await clockwiseResponse.json();
          clockwiseUrl = clockwiseResult.data?.videoUrl;
          if (clockwiseUrl?.startsWith("pending_operation:")) {
            isPending = true;
          } else {
            setResultVideos((prev: any) => ({
              ...(prev || {}),
              clockwise: clockwiseUrl,
            }));
          }
        } else {
          const errorData = await clockwiseResponse
            .json()
            .catch(() => ({ error: "Request failed" }));
          console.error(
            "Clockwise video failed:",
            errorData.error || "Unknown error",
          );
        }

        // Process counter-clockwise video
        if (counterResponse.ok) {
          const counterResult = await counterResponse.json();
          counterUrl = counterResult.data?.videoUrl;
          if (counterUrl?.startsWith("pending_operation:")) {
            isPending = true;
          } else {
            setResultVideos((prev: any) => ({
              ...(prev || {}),
              counter: counterUrl,
            }));
          }
        } else {
          const errorData = await counterResponse
            .json()
            .catch(() => ({ error: "Request failed" }));
          console.error(
            "Counter-clockwise video failed:",
            errorData.error || "Unknown error",
          );
        }

        // Save videos to Supabase once ready
        if (recordId && (clockwiseUrl || counterUrl)) {
          saveGeneration({
            userId: user.id,
            generationType: "video", // Keep type for tracking Or we could use an 'update' function
            outputUrl: clockwiseUrl || counterUrl || "",
            outputMetadata: {
              clockwise: clockwiseUrl,
              counter: counterUrl,
              parentGenerationId: recordId,
            },
          });
        }
      } catch (videoError: any) {
        console.error("Video generation process failed:", videoError);
        setProcessingStatus(
          videoError.message?.includes("timed out")
            ? "Video generation is taking longer than expected. It will appear in your history when ready."
            : "Video generation encountered an issue.",
        );
      } finally {
        if (isPending) {
          setProcessingStatus(
            "Videos are generating in the background. Check your History later to view them.",
          );
        } else {
          setIsGeneratingVideos(false);
          if (!processingStatus.includes("longer than expected")) {
            setProcessingStatus("Visualization complete.");
          }
        }
      }
    } catch (error) {
      console.error("Visualization failed:", error);
      setProcessingStatus("An error occurred. Please try again.");
      setIsProcessing(false);
    }
  };

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
                Redesign your architecture with high-fidelity stone mapping and
                Cinematic 4K walkthroughs.
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
                {resultImage && isGeneratingVideos && (
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-dark-800/50 border border-gold-500/30 p-4 rounded-2xl text-center text-sm text-gold-400 font-light shadow-premium flex items-center justify-center gap-4"
                  >
                    <Info className="w-5 h-5 text-gold-500 shrink-0" />
                    <span>
                      Image ready! Videos are generating in the background –
                      this usually takes 2-4 minutes.
                    </span>
                  </motion.div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <h2 className="text-3xl font-display font-medium text-gray-100 mb-2">
                      {isProcessing || isGeneratingVideos
                        ? "Crafting Your Vision"
                        : "Project: Modern Space"}
                    </h2>
                    <p className="text-gray-400 flex items-center gap-2 text-sm">
                      <span
                        className={`w-2 h-2 rounded-full ${isProcessing || isGeneratingVideos ? "bg-gold-500 animate-pulse" : "bg-gold-500"}`}
                      />
                      {isProcessing ? "Applying " : "Featuring "}
                      {selectedStone?.name}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                    <button
                      onClick={() => setStep(1)}
                      disabled={isProcessing || isGeneratingVideos}
                      className={`w-full sm:w-auto px-8 py-3 rounded-xl border font-medium text-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-gold-500 to-gold-400 text-dark-900 shadow-gold-glow hover:scale-[1.03] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none`}
                    >
                      <RefreshCcw className="w-4 h-4" /> Try Another Stone
                    </button>
                    <button
                      onClick={() => {
                        // Download image
                        const imgLink = document.createElement("a");
                        imgLink.href = resultImage!;
                        imgLink.download = `visualized-${selectedStone?.name.toLowerCase().replace(/\s+/g, "-")}.png`;
                        imgLink.click();

                        // Download videos if available
                        if (resultVideos?.clockwise) {
                          setTimeout(() => {
                            const v1 = document.createElement("a");
                            v1.href = resultVideos.clockwise!;
                            v1.download = "walkthrough-clockwise.mp4";
                            v1.click();
                          }, 500);
                        }
                        if (resultVideos?.counter) {
                          setTimeout(() => {
                            const v2 = document.createElement("a");
                            v2.href = resultVideos.counter!;
                            v2.download = "walkthrough-counter.mp4";
                            v2.click();
                          }, 1000);
                        }
                      }}
                      disabled={!resultImage}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl bg-dark-700/50 text-gray-300 font-medium text-sm border border-white/10 hover:bg-dark-600 hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4" /> Download All
                    </button>
                  </div>
                </div>

                {/* Main Result Image with Before/After Slider */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-gold-500" />{" "}
                      Interactive Comparison
                    </h3>
                    <div className="bg-dark-800/50 p-2 rounded-[32px] shadow-premium border border-white/5 aspect-video flex items-center justify-center">
                      {!resultImage ? (
                        <div className="text-center flex flex-col items-center justify-center p-4">
                          <div className="relative w-20 h-20 mx-auto mb-6">
                            <div className="absolute inset-0 rounded-full bg-gold-500/5 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                            <div className="absolute inset-0 rounded-full border-2 border-white/10 border-t-gold-500 animate-spin" />
                          </div>
                          <h3 className="font-medium text-gold-400">
                            Generating your stone-applied room...
                          </h3>
                          <p className="text-xs text-gray-500 mt-1">
                            (This part is fast!)
                          </p>
                        </div>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{
                            opacity: 1,
                            boxShadow: [
                              "0 0 0px rgba(212,175,55,0)",
                              "0 0 50px rgba(212,175,55,0.2)",
                              "0 0 0px rgba(212,175,55,0)",
                            ],
                          }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                          className="w-full h-full rounded-[24px] overflow-hidden"
                        >
                          <BeforeAfterSlider
                            beforeImage={uploadedImage!}
                            afterImage={resultImage!}
                            onFullscreen={() => setIsFullscreen(true)}
                          />
                        </motion.div>
                      )}
                    </div>
                    {resultImage && (
                      <div className="text-center text-xs text-gold-400/70 font-light bg-dark-800/30 border border-gold-500/20 rounded-lg px-4 py-2 flex items-center justify-center gap-2">
                        <Info className="w-4 h-4 shrink-0" />
                        <span>
                          Stone applied to main surfaces – re-generate if any
                          counters were missed.
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
                    </div>

                    <div className="bg-dark-800/50 p-8 rounded-[32px] shadow-premium border border-white/5 backdrop-blur-sm">
                      <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-4 flex items-center justify-between">
                        <span>Quick Actions</span>
                        <span className="text-[10px] bg-gold-500/10 text-gold-400 px-2.5 py-1 rounded-md border border-gold-500/20">
                          {!resultImage ? "Processing" : "Ready"}
                        </span>
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                        <button
                          onClick={() => setIsFullscreen(true)}
                          disabled={!resultImage}
                          className="p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Maximize2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          <span className="text-[10px] font-medium uppercase tracking-widest">
                            Fullscreen
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            const link = document.createElement("a");
                            link.href = resultImage!;
                            link.download = `visualized-${selectedStone?.name.toLowerCase().replace(/\s+/g, "-")}.png`;
                            link.click();
                          }}
                          disabled={!resultImage}
                          className="p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Download className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          <span className="text-[10px] font-medium uppercase tracking-widest">
                            Save Image
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            if (resultVideos?.clockwise) {
                              const link = document.createElement("a");
                              link.href = resultVideos.clockwise;
                              link.download = `walkthrough-clockwise.mp4`;
                              link.click();
                            }
                            if (resultVideos?.counter) {
                              const link = document.createElement("a");
                              link.href = resultVideos.counter;
                              link.download = `walkthrough-counter.mp4`;
                              link.click();
                            }
                          }}
                          disabled={
                            !resultVideos?.clockwise && !resultVideos?.counter
                          }
                          className={`p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed'}`}
                        >
                          {isGeneratingVideos ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Video className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          )}
                          <span className="text-[10px] font-medium uppercase tracking-widest">
                            {isGeneratingVideos
                              ? "Generating..."
                              : "Save Videos"}
                          </span>
                        </button>
                        <button
                          onClick={generate3DScene}
                          disabled={!resultImage || isGenerating3D || isGeneratingVideos || isProcessing}
                          className={`p-4 rounded-2xl bg-gradient-to-br from-gold-500 to-gold-400 text-dark-900 hover:scale-[1.02] active:scale-[0.98] flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-gold-500/50 shadow-gold-glow disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none transition-all ${
                            isGenerating3D ? "animate-pulse" : ""
                          }`}
                        >
                          {isGenerating3D ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Box className="w-5 h-5 group-hover:scale-110 transition-transform" />
                          )}
                          <span className="text-[10px] font-medium uppercase tracking-widest">
                            {isGenerating3D ? "Generating..." : "Generate 3D"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Video Walkthroughs */}
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                      <Video className="w-4 h-4 text-gold-500" /> Cinematic
                      Walkthroughs
                    </h3>
                    {isGeneratingVideos && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-gold-500/10 text-gold-400 rounded-lg text-[10px] font-medium uppercase tracking-widest animate-pulse border border-gold-500/20 self-start sm:self-auto">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="hidden sm:inline">
                          Generating in background...
                        </span>
                        <span className="sm:hidden">Generating...</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="aspect-video rounded-[24px] overflow-hidden bg-dark-900 relative group border border-white/5 shadow-premium">
                        {resultVideos?.clockwise ? (
                          <video
                            src={resultVideos.clockwise}
                            className="w-full h-full object-cover"
                            controls
                            playsInline
                            poster={resultImage!}
                          />
                        ) : (
                          <div className="absolute inset-0 bg-dark-900/50 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center overflow-hidden border border-white/5">
                            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(212,175,55,0.1),rgba(255,255,255,0))]" />
                            <div className="relative flex flex-col items-center justify-center">
                              <Loader2 className="w-8 h-8 animate-spin text-gold-500" />
                              <p className="mt-4 text-sm font-medium text-gold-400/80">
                                Preparing clockwise walkthrough...
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                (processing)
                              </p>
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            const link = document.createElement("a");
                            link.href = resultVideos.clockwise!;
                            link.download = `walkthrough-clockwise.mp4`;
                            link.click();
                          }}
                          disabled={!resultVideos?.clockwise}
                          className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:bg-gold-500/20 hover:text-gold-400 transition-all shadow-sm sm:opacity-0 sm:group-hover:opacity-100 border border-white/10 hover:border-gold-500/30 disabled:opacity-0"
                          title="Download Clockwise Tour"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="aspect-video rounded-[24px] overflow-hidden bg-dark-900 relative group border border-white/5 shadow-premium">
                        {resultVideos?.counter ? (
                          <video
                            src={resultVideos.counter}
                            className="w-full h-full object-cover"
                            controls
                            playsInline
                            poster={resultImage!}
                          />
                        ) : (
                          <div className="absolute inset-0 bg-dark-900/50 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center overflow-hidden border border-white/5">
                            <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(212,175,55,0.1),rgba(255,255,255,0))]" />
                            <div className="relative flex flex-col items-center justify-center">
                              <Loader2 className="w-8 h-8 animate-spin text-gold-500" />
                              <p className="mt-4 text-sm font-medium text-gold-400/80">
                                Preparing counter-clockwise walkthrough...
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                (processing)
                              </p>
                            </div>
                          </div>
                        )}
                        <button
                          onClick={() => {
                            const link = document.createElement("a");
                            link.href = resultVideos.counter!;
                            link.download = `walkthrough-counter.mp4`;
                            link.click();
                          }}
                          disabled={!resultVideos?.counter}
                          className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:bg-gold-500/20 hover:text-gold-400 transition-all shadow-sm sm:opacity-0 sm:group-hover:opacity-100 border border-white/10 hover:border-gold-500/30 disabled:opacity-0"
                          title="Download Anti-Clockwise Tour"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {resultSplat && (
            <motion.div
              key="step-3d"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full"
            >
              <StepIndicator currentStep={3} />
              
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <h2 className="text-3xl font-display font-medium text-gray-100 mb-2">
                      Interactive 3D Scene
                    </h2>
                    <p className="text-gray-400 flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-gold-500" />
                      {selectedStone?.name} · Gaussian Splat · {splatFormat.toUpperCase()}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                    <button
                      onClick={() => setShowSplatViewer(true)}
                      disabled={!resultSplat}
                      className={`w-full sm:w-auto px-8 py-3 rounded-xl font-medium text-sm tracking-wide flex items-center justify-center gap-2 bg-gradient-gold text-dark-900 shadow-gold-glow hover:scale-[1.03] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none`}
                    >
                      <Maximize2 className="w-4 h-4" /> Explore in 3D
                    </button>
                    <button
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = resultSplat!;
                        link.download = `3d-${selectedStone?.name.toLowerCase().replace(/\s+/g, "-")}.${splatFormat}`;
                        link.click();
                      }}
                      disabled={!resultSplat}
                      className="w-full sm:w-auto px-6 py-3 rounded-xl bg-dark-700/50 text-gray-300 font-medium text-sm border border-white/10 hover:bg-dark-600 hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4" /> Save 3D Model
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                    <Box className="w-4 h-4 text-gold-500" /> 3D Gaussian Splat
                  </h3>
                  <div className="aspect-video rounded-[24px] overflow-hidden bg-dark-900 relative group border border-white/5 shadow-premium">
                    <SplatViewer3D
                      splatUrl={resultSplat}
                      className="w-full h-full"
                      onLoad={() => console.log("3D viewer loaded")}
                      onError={(e) => console.error("3D viewer error:", e)}
                    />
                    {isGenerating3D && (
                      <div className="absolute inset-0 bg-dark-900/80 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center z-10">
                        <Loader2 className="w-10 h-10 animate-spin text-gold-500 mb-4" />
                        <p className="text-lg font-medium text-gold-400 mb-2">Generating 3D Scene...</p>
                        <p className="text-sm text-gray-400">
                          {splatProgress > 0 ? `${splatProgress}% complete` : "Initializing..."}
                        </p>
                        <div className="w-64 h-2 bg-dark-700 rounded-full mt-4 overflow-hidden">
                          <div 
                            className="h-full bg-gradient-gold rounded-full transition-all duration-300"
                            style={{ width: `${splatProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {splatError && (
                      <div className="absolute inset-0 bg-dark-900/90 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center text-red-400 z-10">
                        <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h4 className="text-lg font-medium mb-2">3D Generation Failed</h4>
                        <p className="text-sm text-gray-400 mb-4 max-w-md text-center">{splatError}</p>
                        <button
                          onClick={generate3DScene}
                          disabled={isGenerating3D}
                          className="px-4 py-2 bg-gold-500 text-dark-900 rounded-lg font-medium text-sm hover:bg-gold-400 transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => setShowSplatViewer(true)}
                      disabled={!resultSplat}
                      className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:bg-gold-500/20 hover:text-gold-400 transition-all shadow-sm sm:opacity-0 sm:group-hover:opacity-100 border border-white/10 hover:border-gold-500/30 disabled:opacity-0"
                      title="Open Fullscreen 3D Viewer"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fullscreen Modal */}
        <AnimatePresence>
          {isFullscreen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-dark-900/95 backdrop-blur-xl flex items-center justify-center p-6 md:p-12"
            >
              <div className="relative w-full h-full flex flex-col items-center justify-center">
                <div className="absolute top-0 left-0 right-0 flex flex-col sm:flex-row sm:items-center justify-between p-4 z-10 gap-4">
                  <div className="flex items-center gap-4">
                    <img
                      src="/logo.jpg"
                      alt="StoneSight Logo"
                      className="w-8 h-8"
                    />
                    <h3 className="text-gray-100 font-display font-medium tracking-tight truncate">
                      {selectedStone?.name} Visualization
                    </h3>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                    <button
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = resultImage!;
                        link.download = `visualized-${selectedStone?.name.toLowerCase().replace(/\s+/g, "-")}.png`;
                        link.click();
                      }}
                      className="p-3 bg-dark-800/50 hover:bg-dark-700 text-gold-400 border border-white/5 hover:border-gold-500/30 rounded-full transition-all flex items-center justify-center gap-2 px-6 flex-1 sm:flex-none"
                    >
                      <Download className="w-5 h-5" />
                      <span className="text-[10px] font-medium uppercase tracking-widest hidden sm:inline">
                        Download Image
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-widest sm:hidden">
                        Download
                      </span>
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
                  <div className="w-full h-full flex items-center justify-center p-4 md:p-12">
                    <div className="w-full h-full relative">
                      <BeforeAfterSlider
                        beforeImage={uploadedImage!}
                        afterImage={resultImage!}
                      />
                    </div>
                  </div>
                </motion.div>

                <div className="mt-8 text-center max-w-2xl">
                  <p className="text-gray-400 text-sm leading-relaxed font-light">
                    {selectedStone?.description}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Fullscreen 3D Viewer Modal */}
        <AnimatePresence>
          {showSplatViewer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-dark-900/98 backdrop-blur-xl flex items-center justify-center p-6 md:p-12"
            >
              <div className="relative w-full h-full flex flex-col items-center justify-center">
                <div className="absolute top-0 left-0 right-0 flex flex-col sm:flex-row sm:items-center justify-between p-4 z-10 gap-4">
                  <div className="flex items-center gap-4">
                    <img
                      src="/logo.jpg"
                      alt="StoneSight Logo"
                      className="w-8 h-8"
                    />
                    <h3 className="text-gray-100 font-display font-medium tracking-tight truncate">
                      {selectedStone?.name} 3D Interactive Scene
                    </h3>
                    <span className="px-2 py-1 bg-gold-500/10 text-gold-400 text-[10px] font-medium uppercase tracking-widest rounded-md border border-gold-500/20">
                      {splatFormat.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                    <button
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = resultSplat!;
                        link.download = `3d-${selectedStone?.name.toLowerCase().replace(/\s+/g, "-")}.${splatFormat}`;
                        link.click();
                      }}
                      className="p-3 bg-dark-800/50 hover:bg-dark-700 text-gold-400 border border-white/5 hover:border-gold-500/30 rounded-full transition-all flex items-center justify-center gap-2 px-6 flex-1 sm:flex-none"
                    >
                      <Download className="w-5 h-5" />
                      <span className="text-[10px] font-medium uppercase tracking-widest hidden sm:inline">
                        Save 3D Model
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-widest sm:hidden">
                        Download
                      </span>
                    </button>
                    <button
                      onClick={() => setShowSplatViewer(false)}
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
                  <div className="w-full h-full flex items-center justify-center p-4 md:p-12">
                    <div className="w-full h-full relative">
                      <SplatViewer3D
                        splatUrl={resultSplat}
                        className="w-full h-full"
                        onLoad={() => console.log("3D viewer loaded")}
                        onError={(e) => console.error("3D viewer error:", e)}
                      />
                    </div>
                  </div>
                </motion.div>

                <div className="mt-8 text-center max-w-2xl">
                  <p className="text-gray-400 text-sm leading-relaxed font-light">
                    {selectedStone?.description}
                  </p>
                </div>
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





