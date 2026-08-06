import React from 'react';
import { X, Download, Lock } from 'lucide-react';

interface ImageLightboxModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  imageUrl,
  onClose,
}) => {
  if (!imageUrl) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none">
      <div className="absolute top-4 right-4 flex items-center space-x-2 z-10">
        <a
          href={imageUrl}
          download="aarvi_encrypted_photo.jpg"
          target="_blank"
          rel="noreferrer"
          className="p-2.5 bg-slate-900 border border-slate-800 text-slate-200 hover:text-white rounded-xl transition-colors"
          title="Download Photo"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          onClick={onClose}
          className="p-2.5 bg-slate-900 border border-slate-800 text-slate-200 hover:text-white rounded-xl transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="max-w-4xl max-h-[85vh] p-2 bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden relative">
        <img
          src={imageUrl}
          alt="Encrypted Lightbox"
          className="w-full h-full object-contain rounded-2xl max-h-[80vh]"
        />
        <div className="absolute bottom-4 left-4 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-800 text-[10px] text-emerald-400 font-medium flex items-center gap-1">
          <Lock className="w-3 h-3" /> Encrypted Media Attachment
        </div>
      </div>
    </div>
  );
};
