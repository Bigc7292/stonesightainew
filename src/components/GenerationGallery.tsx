import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Loader2, Download, Trash2, Maximize2, X, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const GenerationGallery: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, generations } = useAuth();
  const [loading, setLoading] = useState(!user); // Loading if no user yet
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Set loading state when user changes
  React.useEffect(() => {
    if (user) {
      setLoading(false);
    }
  }, [user]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-dark-900/98 backdrop-blur-2xl flex flex-col p-6 md:p-12"
    >
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gold-500/10 rounded-2xl border border-gold-500/20">
            <Clock className="w-6 h-6 text-gold-400" />
          </div>
          <div>
            <h2 className="text-3xl font-display font-medium text-white">Your Visualization History</h2>
            <p className="text-gray-500 text-sm">Review and revisit your previous stone mappings</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-3 bg-dark-800/50 hover:bg-dark-700 text-gray-400 hover:text-white border border-white/5 rounded-full transition-all"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-white/10">
        {loading ? (
          <div className="flex items-center justify-center p-20">
            <Loader2 className="w-10 h-10 animate-spin text-gold-500" />
          </div>
        ) : generations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-center">
            <div className="w-20 h-20 rounded-full bg-dark-800 flex items-center justify-center mb-6">
              <Download className="w-8 h-8 text-gray-600" />
            </div>
            <h3 className="text-xl font-medium text-gray-300">No generations yet</h3>
            <p className="text-gray-500 mt-2">Start a visualization to see your history here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
            {generations.map((gen) => (
              <motion.div 
                key={gen.id}
                whileHover={{ y: -5 }}
                className="group relative bg-dark-800/50 rounded-3xl overflow-hidden border border-white/5 hover:border-gold-500/30 transition-all shadow-premium"
              >
                <div className="aspect-[4/5] relative">
                  <img 
                    src={gen.output_url} 
                    alt={gen.input_prompt} 
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-dark-900/90 via-transparent to-transparent" />
                  
                  <div className="absolute top-4 left-4">
                    <span className="px-2.5 py-1 bg-dark-900/80 backdrop-blur-md rounded-lg text-[9px] font-medium uppercase tracking-widest text-gray-400 border border-white/10">
                      {new Date(gen.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                    <p className="text-xs font-medium text-white truncate max-w-[60%]">{gen.input_parameters?.stoneName || 'Stone Mapping'}</p>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                         onClick={() => setSelectedImage(gen.output_url)}
                        className="p-2 bg-gold-500/10 text-gold-400 rounded-lg border border-gold-500/20 hover:bg-gold-500 text-[10px] hover:text-dark-900 transition-all"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-dark-900/95 flex items-center justify-center p-6"
            onClick={() => setSelectedImage(null)}
          >
            <div className="relative max-w-6xl w-full h-full flex flex-col items-center justify-center gap-4">
              <div className="flex gap-4 w-full h-[80%]">
                <div className="flex-1 flex flex-col gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-gray-400 font-medium">Original Upload</span>
                  <img 
                    src={generations.find(g => g.output_url === selectedImage)?.input_image_url || ''} 
                    alt="Original" 
                    className="w-full h-full object-contain rounded-2xl shadow-xl border border-white/5"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-2">
                   <span className="text-[10px] uppercase tracking-widest text-gold-400 font-medium">Visualization</span>
                   <img 
                    src={selectedImage} 
                    alt="Selected" 
                    className="w-full h-full object-contain rounded-2xl shadow-xl border border-white/5"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                 <button 
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = selectedImage;
                    link.download = `stonesight-export.png`;
                    link.click();
                  }}
                  className="px-6 py-2 bg-gold-500 text-dark-900 rounded-xl font-medium text-sm flex items-center gap-2 hover:scale-105 transition-transform"
                >
                  <Download className="w-4 h-4" /> Download Visualization
                </button>
              </div>
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-4 -right-4 p-4 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-8 h-8" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
