import React, { useEffect, useRef, useState } from "react";

interface SplatViewer3DProps {
  splatUrl: string;
  posterUrl?: string;
  skyboxUrl?: string;
  collisionUrl?: string;
  className?: string;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  noUi?: boolean;
  noAnim?: boolean;
  noFx?: boolean;
  webgl?: boolean;
  ministats?: boolean;
  colorize?: boolean;
  budget?: number;
}

export function SplatViewer3D({
  splatUrl,
  posterUrl,
  skyboxUrl,
  collisionUrl,
  className = "",
  onLoad,
  onError,
  noUi = false,
  noAnim = false,
  noFx = false,
  webgl = false,
  ministats = false,
  colorize = false,
  budget,
}: SplatViewer3DProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!splatUrl || !iframeRef.current) return;

    setIsLoading(true);
    setHasError(false);

    const baseUrl = "https://viewer.supersplat.ai";
    const params = new URLSearchParams({
      content: splatUrl,
    });

    if (posterUrl) params.set("poster", posterUrl);
    if (skyboxUrl) params.set("skybox", skyboxUrl);
    if (collisionUrl) params.set("collision", collisionUrl);
    if (noUi) params.set("noui", "1");
    if (noAnim) params.set("noanim", "1");
    if (noFx) params.set("nofx", "1");
    if (ministats) params.set("ministats", "1");
    if (colorize) params.set("colorize", "1");
    if (budget) params.set("budget", String(budget));

    const viewerUrl = `${baseUrl}?${params.toString()}`;

    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = viewerUrl;
    }

    const handleLoad = () => {
      setIsLoading(false);
      onLoad?.();
    };

    const handleError = () => {
      setIsLoading(false);
      setHasError(true);
      onError?.(new Error("Failed to load SuperSplat viewer"));
    };

    iframe.addEventListener("load", handleLoad);
    iframe.addEventListener("error", handleError);

    return () => {
      iframe.removeEventListener("load", handleLoad);
      iframe.removeEventListener("error", handleError);
    };
  }, [
    splatUrl,
    posterUrl,
    skyboxUrl,
    collisionUrl,
    noUi,
    noAnim,
    noFx,
    ministats,
    colorize,
    budget,
    onLoad,
    onError,
  ]);

  if (hasError) {
    return (
      <div className={`bg-dark-800/50 border border-red-500/30 rounded-2xl p-8 text-center ${className}`}>
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-200 mb-2">Failed to load 3D scene</h3>
        <p className="text-sm text-gray-500 mb-4">Unable to load the 3D viewer. Please try again later.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-gold-500 text-dark-900 rounded-lg font-medium text-sm hover:bg-gold-400 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full bg-dark-900 rounded-2xl overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-dark-900/95 z-10 transition-opacity duration-300">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-gold-500/5 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <div className="absolute inset-0 rounded-full border-2 border-white/10 border-t-gold-500 animate-spin" />
          </div>
          <h3 className="font-medium text-gray-200 mb-2">Loading 3D Scene...</h3>
          <p className="text-xs text-gray-500">Initializing Gaussian Splat viewer</p>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="about:blank"
        className="w-full h-full border-0"
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="SuperSplat 3D Gaussian Splat Viewer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
      />
    </div>
  );
}

export default SplatViewer3D;