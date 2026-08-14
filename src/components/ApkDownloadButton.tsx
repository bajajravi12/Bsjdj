import React, { useState, useEffect } from 'react';
import { Smartphone, Download, CheckCircle2, Info } from 'lucide-react';

// Capture beforeinstallprompt globally early before component mounts
let globalBeforeInstallPromptEvent: any = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    globalBeforeInstallPromptEvent = e;
    window.dispatchEvent(new CustomEvent('aarvi-pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    globalBeforeInstallPromptEvent = null;
    window.dispatchEvent(new CustomEvent('aarvi-pwa-installed'));
  });
}

export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as any).standalone === true) ||
    document.referrer.includes('android-app://')
  );
}

export function getApkDownloadUrl(): string {
  return 'pwa';
}

interface ApkDownloadButtonProps {
  className?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}

export const ApkDownloadButton: React.FC<ApkDownloadButtonProps> = ({
  className = '',
  variant = 'outline',
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(globalBeforeInstallPromptEvent);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);

  useEffect(() => {
    setIsStandalone(isPwaStandalone());

    const handleInstallable = () => {
      setDeferredPrompt(globalBeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('aarvi-pwa-installable', handleInstallable);
    window.addEventListener('aarvi-pwa-installed', handleInstalled);

    return () => {
      window.removeEventListener('aarvi-pwa-installable', handleInstallable);
      window.removeEventListener('aarvi-pwa-installed', handleInstalled);
    };
  }, []);

  // 1. If running in standalone app mode or newly installed, show confirmation badge
  if (isStandalone || isInstalled) {
    return (
      <div className="w-full py-2.5 px-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center justify-center space-x-2 font-medium">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span>AARVI Installed as PWA App</span>
      </div>
    );
  }

  // 2. Real Chrome Native PWA Installation Handler
  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        console.log('[AARVI PWA] User accepted native PWA installation');
        setIsInstalled(true);
      } else {
        console.log('[AARVI PWA] User dismissed native PWA installation');
      }
    } catch (err) {
      console.error('[AARVI PWA] Installation prompt execution error:', err);
    } finally {
      globalBeforeInstallPromptEvent = null;
      setDeferredPrompt(null);
    }
  };

  const variantStyle =
    variant === 'primary'
      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold border-none shadow-lg shadow-emerald-500/20'
      : variant === 'secondary'
      ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700'
      : 'bg-slate-950 hover:bg-slate-800 text-emerald-400 font-semibold border border-slate-800';

  // 3. Native install prompt is available -> Show active Install App button
  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={handleInstallClick}
        className={`w-full py-3 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all active:scale-[0.98] ${variantStyle} ${className}`}
        title="Install AARVI as a Standalone App"
      >
        <Smartphone className="w-4 h-4 text-emerald-400" />
        <span className="font-semibold text-white">Install AARVI App</span>
        <Download className="w-3.5 h-3.5 ml-auto opacity-80 text-emerald-400" />
      </button>
    );
  }

  // 4. Native prompt is unavailable (or waiting for browser beforeinstallprompt) -> Show clean status info without alert popups
  return (
    <div className="w-full p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-xs space-y-1 text-slate-400">
      <div className="flex items-center space-x-2 text-slate-300 font-medium">
        <Info className="w-4 h-4 text-slate-400" />
        <span>PWA Install via Browser Menu</span>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed pl-6">
        Open Chrome menu (⋮) and tap <strong className="text-slate-200">"Install app"</strong> or <strong className="text-slate-200">"Add to Home screen"</strong>.
      </p>
    </div>
  );
};
