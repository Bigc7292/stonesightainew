import React, { useState, useRef, useEffect } from 'react';
import { Maximize2 } from 'lucide-react';

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  onFullscreen?: () => void;
}

export const BeforeAfterSlider: React.FC<BeforeAfterSliderProps> = ({ beforeImage, afterImage, onFullscreen }) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;
    setSliderPosition(percentage);
  };

  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) handleMove(e.clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging) handleMove(e.touches[0].clientX);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      className="relative aspect-[16/10] rounded-[32px] overflow-hidden shadow-premium border border-white/10 bg-dark-900 select-none group cursor-ew-resize"
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
    >
      {/* After Image (The Result) */}
      <img 
        src={afterImage} 
        alt="After" 
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
        referrerPolicy="no-referrer"
      />

      {/* Before Image (The Original) - Clipped */}
      <img 
        src={beforeImage} 
        alt="Before" 
        className="absolute inset-0 w-full h-full object-cover"
        style={{ 
          clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`,
          WebkitClipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`
        }}
        draggable={false}
        referrerPolicy="no-referrer"
      />

      {/* Slider Handle */}
      <div 
        className="absolute inset-y-0 w-1 bg-gold-500 shadow-[0_0_15px_rgba(212,175,55,0.5)] flex items-center justify-center"
        style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
      >
        <div className="w-10 h-10 rounded-full bg-dark-900 shadow-gold-glow flex items-center justify-center border-2 border-gold-500">
          <div className="flex gap-1">
            <div className="w-0.5 h-4 bg-gold-500 rounded-full" />
            <div className="w-0.5 h-4 bg-gold-500 rounded-full" />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-6 left-6 px-4 py-2 bg-dark-900/80 backdrop-blur-md rounded-xl text-gray-300 text-[10px] font-medium uppercase tracking-widest pointer-events-none border border-white/10 shadow-sm">
        Original
      </div>
      <div className="absolute top-6 right-6 px-4 py-2 bg-gold-500/90 backdrop-blur-md rounded-xl text-dark-900 text-[10px] font-medium uppercase tracking-widest pointer-events-none shadow-sm">
        Transformed
      </div>

      <button 
        onClick={(e) => {
          e.stopPropagation();
          onFullscreen?.();
        }}
        className="absolute bottom-6 right-6 p-4 bg-dark-900/80 backdrop-blur-md rounded-2xl shadow-premium opacity-0 group-hover:opacity-100 transition-all hover:bg-gold-500/20 hover:text-gold-400 border border-white/10 hover:border-gold-500/30 text-gray-300"
      >
        <Maximize2 className="w-5 h-5" />
      </button>
    </div>
  );
};
