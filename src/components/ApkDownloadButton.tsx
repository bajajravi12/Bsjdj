import React from 'react';
import { Smartphone, Download } from 'lucide-react';

interface ApkDownloadButtonProps {
  className?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}

export const ApkDownloadButton: React.FC<ApkDownloadButtonProps> = ({
  className = '',
  variant = 'outline',
}) => {
  const envUrl = (import.meta as any).env?.VITE_APK_DOWNLOAD_URL || (process.env as any)?.VITE_APK_DOWNLOAD_URL || '';
  const apkUrl = String(envUrl).trim();
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

  const handleClick = () => {
    if (apkUrl) {
      window.open(apkUrl, '_blank');
    } else {
      alert('Android APK Download URL is not configured.\nSet VITE_APK_DOWNLOAD_URL in environment to enable.');
    }
  };

  const variantStyle =
    variant === 'primary'
      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold border-none'
      : variant === 'secondary'
      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700'
      : 'bg-slate-950 hover:bg-slate-800 text-emerald-400 font-semibold border border-slate-800';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all active:scale-[0.98] ${variantStyle} ${className}`}
      title={apkUrl ? 'Download Android APK' : 'APK download URL not set'}
    >
      <Smartphone className="w-4 h-4 text-emerald-400" />
      <span>Download Android App (.APK)</span>
      <Download className="w-3.5 h-3.5 ml-auto opacity-70" />
      {isAndroid && (
        <span className="bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded font-mono uppercase ml-1">
          Android
        </span>
      )}
    </button>
  );
};
