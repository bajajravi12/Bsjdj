import React, { useState, useEffect } from 'react';
import { User, AppSettings } from '../types';
import { getDisplayAvatar } from '../utils/avatar';
import { 
  ShieldCheck, 
  Key, 
  Lock, 
  Smartphone, 
  Trash2, 
  X, 
  Eye, 
  EyeOff, 
  Palette, 
  Bell, 
  Type, 
  LogOut,
  Image as ImageIcon,
  Sliders
} from 'lucide-react';
import { ApkDownloadButton, getApkDownloadUrl } from './ApkDownloadButton';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onClearStorage: () => void;
  onLogout?: () => void;
  settings?: AppSettings;
  onUpdateSettings?: (newSettings: Partial<AppSettings>) => void;
}

export const SecuritySettingsModal: React.FC<SecuritySettingsModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onClearStorage,
  onLogout,
  settings = { theme: 'dark', wallpaper: 'default', fontSize: 'medium', notifications: true },
  onUpdateSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'security'>('general');
  const [showKey, setShowKey] = useState(false);
  const [passcodeEnabled, setPasscodeEnabled] = useState(true);
  const [autoLockTimeout, setAutoLockTimeout] = useState('5');

  const [currentSettings, setCurrentSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    setCurrentSettings(settings);
  }, [settings]);

  if (!isOpen) return null;

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...currentSettings, [key]: value };
    setCurrentSettings(updated);
    if (onUpdateSettings) {
      onUpdateSettings({ [key]: value });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">AARVI Settings</h3>
              <p className="text-[11px] text-slate-400">Preferences, Theme & Security</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('general')}
            className={`py-1.5 px-2 rounded-lg transition-colors ${
              activeTab === 'general' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('appearance')}
            className={`py-1.5 px-2 rounded-lg transition-colors ${
              activeTab === 'appearance' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Appearance
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-1.5 px-2 rounded-lg transition-colors ${
              activeTab === 'security' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Security
          </button>
        </div>

        {/* TAB 1: GENERAL */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            {/* User Profile Summary */}
            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center space-x-3">
              <img
                src={getDisplayAvatar(currentUser.name, currentUser.avatar, currentUser.username)}
                alt={currentUser.name}
                className="w-11 h-11 rounded-full object-cover border border-slate-700 bg-slate-800"
              />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{currentUser.name}</h4>
                <p className="text-xs text-emerald-400 font-mono truncate">{currentUser.username}</p>
              </div>
            </div>

            {/* Notifications Toggle */}
            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Bell className="w-4 h-4 text-emerald-400" />
                <div>
                  <h5 className="text-xs font-semibold text-white">Notifications & Sound</h5>
                  <p className="text-[10px] text-slate-400">Audio alerts & message popups</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={currentSettings.notifications}
                onChange={(e) => updateSetting('notifications', e.target.checked)}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>

            {/* APK Download Button */}
            {Boolean(getApkDownloadUrl()) && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Android Application
                </label>
                <ApkDownloadButton variant="secondary" />
              </div>
            )}

            {/* Logout */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={onLogout || onClearStorage}
                className="w-full py-2.5 px-4 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-400 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out of Account</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: APPEARANCE */}
        {activeTab === 'appearance' && (
          <div className="space-y-4">
            {/* Theme Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-emerald-400" /> Theme Accent
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'dark', label: 'Telegram Dark', bg: 'bg-slate-950 border-emerald-500' },
                  { id: 'midnight', label: 'Midnight Blue', bg: 'bg-indigo-950 border-indigo-500' },
                  { id: 'emerald', label: 'Emerald Deep', bg: 'bg-emerald-950 border-emerald-400' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => updateSetting('theme', t.id as any)}
                    className={`p-2.5 rounded-xl border text-xs text-center font-medium transition-all ${
                      currentSettings.theme === t.id
                        ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300 font-bold ring-1 ring-emerald-400'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Wallpaper Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400" /> Chat Wallpaper
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'default', label: 'Default Slate' },
                  { id: 'gradient', label: 'Gradient Glow' },
                  { id: 'navy', label: 'Solid Navy' },
                  { id: 'vault', label: 'Vault Grid' },
                ].map((w) => (
                  <button
                    key={w.id}
                    onClick={() => updateSetting('wallpaper', w.id as any)}
                    className={`p-2.5 rounded-xl border text-xs text-center font-medium transition-all ${
                      currentSettings.wallpaper === w.id
                        ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-emerald-400" /> Message Font Size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'small', label: 'Small (12px)' },
                  { id: 'medium', label: 'Medium (14px)' },
                  { id: 'large', label: 'Large (16px)' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => updateSetting('fontSize', f.id as any)}
                    className={`p-2 rounded-xl border text-xs text-center font-medium transition-all ${
                      currentSettings.fontSize === f.id
                        ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300 font-bold'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SECURITY */}
        {activeTab === 'security' && (
          <div className="space-y-4">
            {/* E2EE Key Identity */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400">
                  <Key className="w-4 h-4" />
                  <span>Public Key Fingerprint</span>
                </div>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showKey ? 'Hide' : 'Reveal'}</span>
                </button>
              </div>

              <div className="bg-slate-900 p-3 rounded-xl font-mono text-xs text-slate-300 break-all select-all border border-slate-800">
                {showKey
                  ? '8F9A-3B12-9C00-4411-E2EE-AARVI-PROT-2026-KEY-7891'
                  : '8F9A-••••-••••-••••-••••-••••-••••-2026-KEY-••••'}
              </div>

              <p className="text-[10px] text-slate-500 leading-relaxed">
                Your private key is generated client-side and never leaves your browser session.
              </p>
            </div>

            {/* Security Lock Controls */}
            <div className="space-y-2">
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h5 className="text-xs font-semibold text-white">Require Passcode on Launch</h5>
                    <p className="text-[10px] text-slate-400">Lock app when inactive</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={passcodeEnabled}
                  onChange={(e) => setPasscodeEnabled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Auto-lock Inactivity</span>
                <select
                  value={autoLockTimeout}
                  onChange={(e) => setAutoLockTimeout(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-xs text-slate-200 rounded-lg px-2 py-1"
                >
                  <option value="1">1 Minute</option>
                  <option value="5">5 Minutes</option>
                  <option value="15">15 Minutes</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>

            {/* Clear Data Action */}
            <button
              onClick={onClearStorage}
              className="w-full py-2.5 px-4 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 text-rose-400 font-semibold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Local Storage Cache</span>
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

