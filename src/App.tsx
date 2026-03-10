/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
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
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { BeforeAfterSlider } from './components/BeforeAfterSlider';
import { Stone, StoneCategory, StoneTone } from './types';
import { STONE_DATABASE } from './stones';

// --- Components ---

const Header = () => (
  <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5 px-8 py-4 flex justify-between items-center">
    <div className="flex items-center gap-4">
      {/* Custom Logo based on screenshot */}
      <div className="relative w-8 h-8 flex items-center justify-center">
        <svg viewBox="0 0 100 100" className="w-full h-full text-gold-500 fill-current">
          <path d="M50 10 L80 40 L20 40 Z" className="text-gold-400" />
          <path d="M15 45 L85 45 L80 60 L20 60 Z" className="text-gold-500" />
          <path d="M10 65 L90 65 L85 80 L15 80 Z" className="text-gold-600" />
        </svg>
      </div>
      <div className="flex flex-col">
        <div className="flex items-baseline">
          <h1 className="text-xl font-bold tracking-tight text-white leading-none font-display">
            St<span className="text-gold-500 relative">o<span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px]">^</span></span>ne<span className="text-gold-500">Sight</span>
          </h1>
        </div>
        <span className="text-[8px] font-medium text-gray-400 tracking-[0.15em] mt-0.5 uppercase">See Your Home, Stone by Stone</span>
      </div>
    </div>
    <div className="flex items-center gap-6">
      <button className="p-2 text-gray-400 hover:text-gold-500 transition-colors">
        <Search className="w-5 h-5" />
      </button>
      <button className="p-2 text-gray-400 hover:text-gold-500 transition-colors">
        <Filter className="w-5 h-5" />
      </button>
      <button className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-gray-400 hover:border-gold-500 hover:text-gold-500 transition-all">
        <div className="w-4 h-4 rounded-full border-2 border-current" />
      </button>
    </div>
  </header>
);

const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  const steps = [
    { name: 'Home', icon: <ImageIcon className="w-4 h-4" /> },
    { name: 'Samples', icon: <Filter className="w-4 h-4" /> },
    { name: 'Projects', icon: <CheckCircle2 className="w-4 h-4" /> }
  ];
  return (
    <div className="flex items-center justify-center gap-8 mb-12 border-b border-white/10 pb-4">
      {steps.map((step, idx) => (
        <div key={step.name} className="relative flex flex-col items-center gap-2 cursor-pointer group">
          <span className={`text-sm font-medium transition-colors ${currentStep === idx ? 'text-gold-500' : 'text-gray-500 group-hover:text-gray-300'}`}>
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

export default function App() {
  const [step, setStep] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [selectedStone, setSelectedStone] = useState<Stone | null>(null);
  const [hoveredStone, setHoveredStone] = useState<Stone | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultVideos, setResultVideos] = useState<{ clockwise?: string; counter?: string } | null>(null);
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [stones, setStones] = useState<Stone[]>(STONE_DATABASE);
  
  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
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

  const startVisualization = async () => {
    if (!uploadedImage || !selectedStone) return;
    
    // Check for API key selection if using Veo
    if ((window as any).aistudio && !(await (window as any).aistudio.hasSelectedApiKey())) {
      await (window as any).aistudio.openSelectKey();
      // Proceed after triggering the dialog as per instructions
    }

    setResultImage(null);
    setResultVideos(null);
    setIsProcessing(true);
    setStep(2);
    setProcessingStatus('Analyzing your kitchen layout...');

    try {
      // Use process.env.API_KEY if available (selected key), otherwise fallback to GEMINI_API_KEY
      let currentApiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY!;
      let ai = new GoogleGenAI({ apiKey: currentApiKey });
      
      // 1. Generate Edited Image
      setProcessingStatus('Surgically applying ' + selectedStone.name + '...');
      
      let imageResponse: { candidates: { content: { parts: any; }; }[]; };
      try {
        imageResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [
              {
                inlineData: {
                  data: uploadedImage.split(',')[1],
                  mimeType: 'image/png',
                },
              },
              {
                text: `You are an expert image editor and visualiser. Generate a single, highly realistic, photograph-quality image based on the following descriptions. This task requires generating exactly one image.\n\nUsing the provided kitchen_photo as the base image, surgically replace all existing countertops and any other visible stone surfaces in the image with the material described in stone_selection.\n\nThe output image must be a perfectly photorealistic representation, matching the lighting, shadows, reflections, perspective, and overall aesthetic of the original photograph as if it were taken at the same moment.\n\nEvery other element of the kitchen_photo MUST remain 100% identical and unchanged. This includes, but is not limited to: all cabinets, appliances, windows, flooring, lighting conditions, shadows, reflections, perspective, and any objects present on countertops, floors, or elsewhere in the room (such as boxes, tape, or tools). Absolutely no elements may be added, removed, moved, or redesigned.\n\nThe appearance of the new stone countertops must perfectly match the detailed catalogue description provided in stone_selection, without any creative interpretation, random variation, or substitution. Focus on replicating the material type, base color, exact vein color and pattern, finish (polished, honed, leathered, etc.), and any other visual characteristics described in the stone selection with absolute precision.\n\nIMPORTANT: Generate exactly one image.\n\nstone_selection:\nName: ${selectedStone.name}\nMaterial Details: ${(selectedStone as any).promptDescription || selectedStone.description}`,
              },
            ],
          },
        });
      } catch (imgErr: any) {
        if (imgErr.message?.includes("Requested entity was not found") || imgErr.message?.includes("entity not found")) {
          if ((window as any).aistudio) await (window as any).aistudio.openSelectKey();
          // Retry once with new key
          currentApiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY!;
          ai = new GoogleGenAI({ apiKey: currentApiKey });
          imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ inlineData: { data: uploadedImage.split(',')[1], mimeType: 'image/png' } }, { text: `Surgically replace countertops with ${selectedStone.name}. Material description: ${(selectedStone as any).promptDescription || selectedStone.description}. Ensure the veining, color, and finish match this description exactly.` }] }
          });
        } else {
          throw imgErr;
        }
      }

      let editedBase64 = '';
      for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          editedBase64 = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (!editedBase64) throw new Error('Failed to generate image');
      setResultImage(editedBase64);
      setIsProcessing(false);

      // 2. Generate Videos in background
      setIsGeneratingVideos(true);
      setProcessingStatus('Creating cinematic walkthroughs...');
      
      const generateVideo = async (prompt: string, type: 'clockwise' | 'anti-clockwise') => {
        let retries = 3;
        while (retries >= 0) {
          const videoApiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY!;
          const videoAi = new GoogleGenAI({ apiKey: videoApiKey });

          try {
            setProcessingStatus(`Generating ${type} walkthrough...`);
            let operation = await videoAi.models.generateVideos({
              model: 'veo-3.1-generate-preview',
              prompt: prompt,
              image: {
                imageBytes: editedBase64.split(',')[1],
                mimeType: 'image/png',
              },
              config: {
                numberOfVideos: 1,
                resolution: '1080p',
                aspectRatio: '16:9'
              }
            });

            while (!operation.done) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              operation = await videoAi.operations.getVideosOperation({ operation: operation });
            }

            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (!downloadLink) throw new Error('Video generation failed: No download link received');
            
            const videoResponse = await fetch(downloadLink, {
              method: 'GET',
              headers: {
                'x-goog-api-key': videoApiKey,
              },
            });

            if (!videoResponse.ok) {
              const errorText = await videoResponse.text();
              if (errorText.includes("Requested entity was not found")) {
                if ((window as any).aistudio) await (window as any).aistudio.openSelectKey();
              }
              throw new Error(`Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}`);
            }

            const blob = await videoResponse.blob();
            return URL.createObjectURL(blob);
          } catch (err: any) {
            console.error(`Video generation attempt failed for ${type}:`, err);
            const is500 = err.status === 500 || err.code === 500 || (err.message && err.message.includes('500'));
            if (is500 && retries > 0) {
              retries--;
              setProcessingStatus(`Retrying ${type} walkthrough (${3 - retries}/3)...`);
              await new Promise(r => setTimeout(r, 10000));
              continue;
            }
            if (err.message?.includes("Requested entity was not found") || err.message?.includes("entity not found")) {
              if ((window as any).aistudio) await (window as any).aistudio.openSelectKey();
            }
            throw err;
          }
        }
        throw new Error(`${type} video generation failed after retries`);
      };

      try {
        // Run them in parallel for speed
        setProcessingStatus('Generating cinematic walkthroughs in parallel...');
        
        const clockwisePromise = generateVideo(`A high-end architectural walkthrough of a modern kitchen. The camera performs a slow, cinematic clockwise pan of exactly 180 degrees, starting from the left side of the room and sweeping smoothly across to the right, covering exactly half of the full room area. This highlights the new ${selectedStone.name} countertops from a wide perspective. Material details: ${selectedStone.description}. Focus on the realistic representation of the stone's unique veining and polished finish. 8k resolution, photorealistic, professional cinematography.`, 'clockwise');
        
        const counterPromise = generateVideo(`A high-end architectural walkthrough of a modern kitchen. The camera performs a slow, cinematic counter-clockwise pan of exactly 180 degrees, starting from the right side of the room and sweeping smoothly back to the left, covering the other half of the full room area. This provides a reverse perspective of the space and the new ${selectedStone.name} countertops. Material details: ${selectedStone.description}. Focus on how the stone interacts with different lighting angles from this opposite viewpoint. 8k resolution, photorealistic, professional cinematography.`, 'anti-clockwise');

        const [clockwiseUrl, counterUrl] = await Promise.all([
          clockwisePromise.then(url => {
            setResultVideos((prev: any) => ({ ...(prev || {}), clockwise: url }));
            return url;
          }).catch(e => {
            console.error('Clockwise video failed:', e);
            return null;
          }),
          counterPromise.then(url => {
            setResultVideos((prev: any) => ({ ...(prev || {}), counter: url }));
            return url;
          }).catch(e => {
            console.error('Counter-clockwise video failed:', e);
            return null;
          })
        ]);

      } catch (videoError) {
        console.error('Video generation process failed:', videoError);
      } finally {
        setIsGeneratingVideos(false);
        setProcessingStatus('Visualization complete.');
      }
    } catch (error) {
      console.error('Visualization failed:', error);
      setProcessingStatus('An error occurred. Please try again.');
      setIsProcessing(false);
    }
  };

  const filteredStones = stones.filter((stone: { name: string; description: string; category: any; tone: any; }) => {
    const matchesSearch = stone.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         stone.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !activeCategory || stone.category === activeCategory;
    const matchesTone = !activeTone || stone.tone === activeTone;
    return matchesSearch && matchesCategory && matchesTone;
  });

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
                  <svg viewBox="0 0 100 100" className="w-full h-full text-gold-500 fill-current drop-shadow-[0_0_15px_rgba(212,175,55,0.3)]">
                    <path d="M50 10 L80 40 L20 40 Z" className="text-gold-400" />
                    <path d="M15 45 L85 45 L80 60 L20 60 Z" className="text-gold-500" />
                    <path d="M10 65 L90 65 L85 80 L15 80 Z" className="text-gold-600" />
                  </svg>
                </div>
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 leading-[1.1] font-display">
                Visualize <br />
                <span className="text-gradient-gold">My Home</span>
              </h1>
              <p className="text-lg text-gray-400 mb-12 max-w-xl font-light">
                Upload a photo of your space and instantly see our premium collections applied with stunning realism.
              </p>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-md aspect-video border border-white/10 rounded-[24px] flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-gold-500/50 hover:bg-white/5 transition-all group mb-12 bg-dark-800/50 backdrop-blur-sm shadow-premium"
              >
                <div className="w-16 h-16 rounded-full bg-dark-700 flex items-center justify-center group-hover:bg-gold-500/20 group-hover:text-gold-400 transition-colors text-gray-400 border border-white/5 group-hover:border-gold-500/30">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-gray-200">Tap to upload space</p>
                  <p className="text-sm text-gray-500 mt-1">High-quality photo recommended</p>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept="image/*"
                />
              </div>

              {/* Photo Guide */}
              <div className="w-full max-w-4xl bg-dark-800/50 rounded-[24px] p-8 shadow-premium border border-white/5 text-left backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-gold-500/10 text-gold-400 rounded-xl border border-gold-500/20">
                    <Info className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-200">Photography Guidelines</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-4">
                    <div className="aspect-[4/3] rounded-xl overflow-hidden bg-dark-700 relative border border-white/5">
                      <div className="absolute top-3 right-3 bg-dark-900/80 backdrop-blur-sm text-gold-400 p-1.5 rounded-full border border-white/10">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1 text-gray-200">Natural Lighting</h4>
                      <p className="text-xs text-gray-500 leading-relaxed">Ensure the room is well-lit, preferably with natural daylight. Avoid harsh shadows.</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="aspect-[4/3] rounded-xl overflow-hidden bg-dark-700 relative border border-white/5">
                      <div className="absolute top-3 right-3 bg-dark-900/80 backdrop-blur-sm text-gold-400 p-1.5 rounded-full border border-white/10">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1 text-gray-200">Clear Surfaces</h4>
                      <p className="text-xs text-gray-500 leading-relaxed">Capture a wide angle showing existing countertops clearly. Remove clutter.</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="aspect-[4/3] rounded-xl overflow-hidden bg-dark-700 relative border border-white/5">
                      <div className="absolute top-3 right-3 bg-dark-900/80 backdrop-blur-sm text-gold-400 p-1.5 rounded-full border border-white/10">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1 text-gray-200">Direct Angle</h4>
                      <p className="text-xs text-gray-500 leading-relaxed">Take the photo straight on or at a slight angle, avoiding extreme perspectives.</p>
                    </div>
                  </div>
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
                      <img src={uploadedImage!} alt="Preview" className="w-full h-full object-cover opacity-80" referrerPolicy="no-referrer" />
                      
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
                              className={`w-full h-full object-cover mix-blend-overlay opacity-50 transition-opacity duration-300 ${isPreviewLoading ? 'opacity-0' : 'opacity-50'}`} 
                              alt="Preview Overlay"
                            />
                            
                            <div className="absolute top-3 right-3 px-3 py-1.5 bg-dark-900/80 border border-gold-500/30 text-gold-400 text-[10px] font-medium rounded-lg uppercase tracking-widest shadow-lg flex items-center gap-2 backdrop-blur-md">
                              {isPreviewLoading ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <div className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-pulse" />
                              )}
                              {isPreviewLoading ? 'Loading...' : hoveredStone.name}
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
                      <Filter className="w-4 h-4 text-gold-500" /> Collection Filter
                    </h3>
                    
                    <div className="space-y-6">
                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3 block">Material</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {['Quartz', 'Dekton', 'Marble', 'Granite', 'Quartzite'].map(cat => (
                            <button 
                              key={cat} 
                              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                              className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                                activeCategory === cat 
                                  ? 'bg-gold-500/10 border-gold-500 text-gold-400 shadow-gold-glow' 
                                  : 'bg-dark-700/50 border-white/5 text-gray-400 hover:bg-dark-600 hover:text-gray-200'
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3 block">Tone</label>
                        <div className="grid grid-cols-3 gap-2">
                          {['Light', 'Dark', 'Warm'].map(tone => (
                            <button 
                              key={tone} 
                              onClick={() => setActiveTone(activeTone === tone ? null : tone)}
                              className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                                activeTone === tone 
                                  ? 'bg-gold-500/10 border-gold-500 text-gold-400 shadow-gold-glow' 
                                  : 'bg-dark-700/50 border-white/5 text-gray-400 hover:bg-dark-600 hover:text-gray-200'
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
                            setSearchQuery('');
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
                        ? 'bg-gradient-gold text-dark-900 shadow-gold-glow hover:scale-[1.02] active:scale-[0.98]' 
                        : 'bg-dark-700/50 text-gray-600 cursor-not-allowed border border-white/5'
                    }`}
                  >
                    Generate Visualization <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Right: Stone Grid */}
                <div className="lg:col-span-8">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                    <div className="flex items-baseline gap-4">
                      <h2 className="text-2xl font-display font-medium text-gray-100">Stone Collection</h2>
                    </div>
                    <div className="relative w-full md:w-auto">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e: { target: { value: any; }; }) => setSearchQuery(e.target.value)}
                        placeholder="Search collection..." 
                        className="pl-11 pr-6 py-2.5 bg-dark-800/50 rounded-xl border border-white/10 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50 transition-all w-full md:w-64 text-sm text-gray-200 placeholder:text-gray-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                    <>
                      {filteredStones.length === 0 ? (
                        <div className="col-span-full py-20 text-center text-gray-500">
                          <p className="font-medium text-sm">No stones found matching your criteria.</p>
                        </div>
                      ) : (
                        filteredStones.map((stone: { id: any; swatchUrl: any; name: any; category: any; }) => (
                          <motion.div
                            key={stone.id}
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
                              selectedStone?.id === stone.id ? 'border-gold-500 shadow-gold-glow' : 'border-white/5'
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
                                <h4 className={`font-medium text-sm truncate transition-colors ${selectedStone?.id === stone.id ? 'text-gold-400' : 'text-gray-200'}`}>
                                  {stone.name}
                                </h4>
                              </div>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </>
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
              {isProcessing ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="relative mb-12">
                    <div className="w-32 h-32 rounded-full border border-white/10 border-t-gold-500 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg viewBox="0 0 100 100" className="w-12 h-12 text-gold-500 fill-current">
                        <path d="M50 10 L80 40 L20 40 Z" className="text-gold-400" />
                        <path d="M15 45 L85 45 L80 60 L20 60 Z" className="text-gold-500" />
                        <path d="M10 65 L90 65 L85 80 L15 80 Z" className="text-gold-600" />
                      </svg>
                    </div>
                  </div>
                  <h2 className="text-3xl font-display font-medium mb-4 text-gray-100">Crafting Your Vision</h2>
                  <p className="text-lg text-gray-400 mb-12 font-light">{processingStatus}</p>
                  
                  <div className="max-w-md w-full space-y-4 text-left bg-dark-800/50 p-8 rounded-[24px] border border-white/5 shadow-premium backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${resultImage ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'border-white/10 text-gray-600'}`}>
                        {resultImage ? <Check className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin text-gold-500" />}
                      </div>
                      <span className={`text-xs font-medium uppercase tracking-widest ${resultImage ? 'text-gold-400' : 'text-gray-500'}`}>1. Material Integration</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${resultVideos ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'border-white/10 text-gray-600'}`}>
                        {resultVideos ? <Check className="w-3 h-3" /> : (resultImage ? <Loader2 className="w-3 h-3 animate-spin text-gold-500" /> : <div className="w-1.5 h-1.5 bg-gray-600 rounded-full" />)}
                      </div>
                      <span className={`text-xs font-medium uppercase tracking-widest ${resultVideos ? 'text-gold-400' : (resultImage ? 'text-gray-300' : 'text-gray-600')}`}>2. Cinematic Rendering</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${resultVideos ? 'bg-gold-500/20 border-gold-500 text-gold-400' : 'border-white/10 text-gray-600'}`}>
                        {resultVideos ? <Check className="w-3 h-3" /> : <div className="w-1.5 h-1.5 bg-gray-600 rounded-full" />}
                      </div>
                      <span className="text-xs font-medium uppercase tracking-widest text-gray-600">3. Finalizing Assets</span>
                    </div>
                  </div>

                  <div className="mt-12 max-w-md w-full bg-dark-800/50 h-1 rounded-full overflow-hidden border border-white/5">
                    <motion.div 
                      className="h-full bg-gradient-gold"
                      initial={{ width: "0%" }}
                      animate={{ width: resultVideos ? "100%" : (resultImage ? "70%" : "30%") }}
                      transition={{ duration: 2, ease: "easeOut" }}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-12">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                      <h2 className="text-3xl font-display font-medium text-gray-100 mb-2">Project: Modern Space</h2>
                      <p className="text-gray-400 flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-gold-500" />
                        Featuring {selectedStone?.name}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                      <button 
                        onClick={() => setStep(1)}
                        className="w-full sm:w-auto px-6 py-2.5 rounded-xl border border-white/10 font-medium text-sm hover:bg-white/5 transition-colors text-gray-300 flex items-center justify-center gap-2"
                      >
                        <RefreshCcw className="w-4 h-4" /> Try Another Stone
                      </button>
                      <button 
                        onClick={() => {
                          // Download image
                          const imgLink = document.createElement('a');
                          imgLink.href = resultImage!;
                          imgLink.download = `visualized-${selectedStone?.name.toLowerCase().replace(/\s+/g, '-')}.png`;
                          imgLink.click();
                          
                          // Download videos if available
                          if (resultVideos?.clockwise) {
                            setTimeout(() => {
                              const v1 = document.createElement('a');
                              v1.href = resultVideos.clockwise!;
                              v1.download = 'walkthrough-clockwise.mp4';
                              v1.click();
                            }, 500);
                          }
                          if (resultVideos?.counter) {
                            setTimeout(() => {
                              const v2 = document.createElement('a');
                              v2.href = resultVideos.counter!;
                              v2.download = 'walkthrough-counter.mp4';
                              v2.click();
                            }, 1000);
                          }
                        }}
                        className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-gold text-dark-900 font-medium text-sm shadow-gold-glow hover:scale-[1.02] transition-transform flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4" /> Download All
                      </button>
                    </div>
                  </div>

                  {/* Main Result Image with Before/After Slider */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-gold-500" /> Interactive Comparison
                      </h3>
                      <div className="bg-dark-800/50 p-2 rounded-[32px] shadow-premium border border-white/5">
                        <BeforeAfterSlider 
                          beforeImage={uploadedImage!} 
                          afterImage={resultImage!} 
                          onFullscreen={() => setIsFullscreen(true)}
                        />
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="bg-dark-800/50 p-8 rounded-[32px] shadow-premium border border-white/5 backdrop-blur-sm">
                        <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-6">Material Details</h3>
                        <div className="flex flex-col sm:flex-row items-start gap-6">
                          <img 
                            src={selectedStone?.swatchUrl} 
                            alt="Swatch" 
                            className="w-24 h-24 rounded-2xl object-cover shadow-md border border-white/10 shrink-0" 
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <h4 className="text-2xl font-display font-medium mb-2 text-gray-100">{selectedStone?.name}</h4>
                            <div className="flex flex-wrap gap-2 mb-4">
                              <span className="px-3 py-1 bg-dark-700 rounded-lg text-[10px] font-medium uppercase tracking-widest text-gray-300 border border-white/5">{selectedStone?.category}</span>
                              <span className="px-3 py-1 bg-dark-700 rounded-lg text-[10px] font-medium uppercase tracking-widest text-gray-300 border border-white/5">{selectedStone?.tone} Tone</span>
                            </div>
                            <p className="text-sm text-gray-400 leading-relaxed font-light">{selectedStone?.description}</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-dark-800/50 p-8 rounded-[32px] shadow-premium border border-white/5 backdrop-blur-sm">
                        <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-4 flex items-center justify-between">
                          <span>Quick Actions</span>
                          <span className="text-[10px] bg-gold-500/10 text-gold-400 px-2.5 py-1 rounded-md border border-gold-500/20">Ready</span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <button 
                            onClick={() => setIsFullscreen(true)}
                            className="p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300"
                          >
                            <Maximize2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-medium uppercase tracking-widest">Fullscreen</span>
                          </button>
                          <button 
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = resultImage!;
                              link.download = `visualized-${selectedStone?.name.toLowerCase().replace(/\s+/g, '-')}.png`;
                              link.click();
                            }}
                            className="p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300"
                          >
                            <Download className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-medium uppercase tracking-widest">Save Image</span>
                          </button>
                          <button 
                            onClick={() => {
                              if (resultVideos?.clockwise) {
                                const link = document.createElement('a');
                                link.href = resultVideos.clockwise;
                                link.download = `walkthrough-clockwise.mp4`;
                                link.click();
                              }
                              if (resultVideos?.counter) {
                                const link = document.createElement('a');
                                link.href = resultVideos.counter;
                                link.download = `walkthrough-counter.mp4`;
                                link.click();
                              }
                            }}
                            disabled={!resultVideos?.clockwise && !resultVideos?.counter}
                            className={`p-4 rounded-2xl bg-dark-700/50 hover:bg-dark-600 hover:text-gold-400 transition-all flex sm:flex-col items-center justify-center gap-3 sm:gap-2 group border border-white/5 hover:border-gold-500/30 text-gray-300 ${(!resultVideos?.clockwise && !resultVideos?.counter) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <Video className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            <span className="text-[10px] font-medium uppercase tracking-widest">Save Videos</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Video Walkthroughs */}
                  <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <h3 className="text-xs font-medium uppercase tracking-widest text-gray-400 flex items-center gap-2">
                        <Video className="w-4 h-4 text-gold-500" /> Cinematic Walkthroughs
                      </h3>
                      {isGeneratingVideos && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-gold-500/10 text-gold-400 rounded-lg text-[10px] font-medium uppercase tracking-widest animate-pulse border border-gold-500/20 self-start sm:self-auto">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span className="hidden sm:inline">Generating in background...</span>
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
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-dark-900/90 backdrop-blur-sm">
                              <Loader2 className="w-8 h-8 animate-spin text-gold-500" />
                              <p className="text-[10px] font-medium uppercase tracking-widest text-gray-400">Rendering Clockwise Tour...</p>
                            </div>
                          )}
                          <div className="absolute top-4 left-4 sm:top-6 sm:left-6 px-3 py-1.5 bg-dark-900/80 backdrop-blur-md rounded-lg text-[10px] font-medium uppercase tracking-widest text-gray-300 border border-white/10 shadow-sm">
                            Clockwise Tour
                          </div>
                          <button 
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = resultVideos.clockwise!;
                              link.download = `walkthrough-clockwise.mp4`;
                              link.click();
                            }}
                            className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:bg-gold-500/20 hover:text-gold-400 transition-all shadow-sm sm:opacity-0 sm:group-hover:opacity-100 border border-white/10 hover:border-gold-500/30"
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
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-dark-900/90 backdrop-blur-sm">
                              <Loader2 className="w-8 h-8 animate-spin text-gold-500" />
                              <p className="text-[10px] font-medium uppercase tracking-widest text-gray-400">Rendering Anti-Clockwise Tour...</p>
                            </div>
                          )}
                          <div className="absolute top-4 left-4 sm:top-6 sm:left-6 px-3 py-1.5 bg-dark-900/80 backdrop-blur-md rounded-lg text-[10px] font-medium uppercase tracking-widest text-gray-300 border border-white/10 shadow-sm">
                            Anti-Clockwise Tour
                          </div>
                          <button 
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = resultVideos.counter!;
                              link.download = `walkthrough-anti-clockwise.mp4`;
                              link.click();
                            }}
                            className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 hover:bg-gold-500/20 hover:text-gold-400 transition-all shadow-sm sm:opacity-0 sm:group-hover:opacity-100 border border-white/10 hover:border-gold-500/30"
                            title="Download Anti-Clockwise Tour"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
                    <div className="w-8 h-8 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 100 100" className="w-full h-full text-gold-500 fill-current">
                        <path d="M50 10 L80 40 L20 40 Z" className="text-gold-400" />
                        <path d="M15 45 L85 45 L80 60 L20 60 Z" className="text-gold-500" />
                        <path d="M10 65 L90 65 L85 80 L15 80 Z" className="text-gold-600" />
                      </svg>
                    </div>
                    <h3 className="text-gray-100 font-display font-medium tracking-tight truncate">{selectedStone?.name} Visualization</h3>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                    <button 
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = resultImage!;
                        link.download = `visualized-${selectedStone?.name.toLowerCase().replace(/\s+/g, '-')}.png`;
                        link.click();
                      }}
                      className="p-3 bg-dark-800/50 hover:bg-dark-700 text-gold-400 border border-white/5 hover:border-gold-500/30 rounded-full transition-all flex items-center justify-center gap-2 px-6 flex-1 sm:flex-none"
                    >
                      <Download className="w-5 h-5" />
                      <span className="text-[10px] font-medium uppercase tracking-widest hidden sm:inline">Download Image</span>
                      <span className="text-[10px] font-medium uppercase tracking-widest sm:hidden">Download</span>
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
                  className="w-full h-full max-w-6xl max-h-[85vh] rounded-[32px] overflow-hidden shadow-premium border border-white/10 bg-dark-900"
                >
                  <BeforeAfterSlider 
                    beforeImage={uploadedImage!} 
                    afterImage={resultImage!} 
                  />
                </motion.div>
                
                <div className="mt-8 text-center max-w-2xl">
                  <p className="text-gray-400 text-sm leading-relaxed font-light">{selectedStone?.description}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
