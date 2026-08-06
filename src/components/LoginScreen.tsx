import React, { useState } from 'react';
import { Lock, ShieldCheck, ArrowRight, UserCheck, UserPlus, LogIn } from 'lucide-react';
import { apiLogin, apiRegister } from '../services/api';
import { User } from '../types';
import { ApkDownloadButton } from './ApkDownloadButton';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Display Name is required');
        if (!username.trim()) throw new Error('Username is required');
        if (!pin.trim()) throw new Error('Password is required');
        const res = await apiRegister(name.trim(), username.trim(), pin.trim());
        if (res.user) {
          onLoginSuccess(res.user);
        } else {
          throw new Error(res.error || 'Registration failed');
        }
      } else {
        if (!username.trim()) throw new Error('Username is required');
        if (!pin.trim()) throw new Error('Password is required');
        const res = await apiLogin(username.trim(), pin.trim());
        if (res.user) {
          onLoginSuccess(res.user);
        } else {
          throw new Error(res.error || 'Login failed');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative z-10 space-y-6">
        {/* Logo & Header */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 p-0.5 shadow-lg shadow-emerald-500/20 flex items-center justify-center">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-emerald-400" />
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              AARVI
            </h1>
            <p className="text-xs font-medium text-emerald-400 tracking-wider uppercase mt-0.5 flex items-center justify-center gap-1">
              <Lock className="w-3 h-3" /> Secure E2EE Messenger
            </p>
          </div>

          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
            Private end-to-end encrypted messaging, self-destructing secret chats, and instant realtime sync.
          </p>
        </div>

        {/* Tab Switcher: Register / Login */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg('');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-all ${
              mode === 'register'
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Account</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 transition-all ${
              mode === 'login'
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 rounded-xl text-xs text-center font-medium">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="Enter your display name"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Username (@username)
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder={mode === 'register' ? 'e.g. @username' : '@username'}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 text-white text-sm text-center rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isLoading ? (
              <span>Connecting to E2EE Vault...</span>
            ) : (
              <>
                <UserCheck className="w-4 h-4 text-slate-950" />
                <span>{mode === 'register' ? 'Register & Start Messaging' : 'Sign In to AARVI'}</span>
                <ArrowRight className="w-4 h-4 text-slate-950 ml-1" />
              </>
            )}
          </button>
        </form>

        <ApkDownloadButton variant="secondary" />

        {/* Footer info */}
        <div className="pt-2 border-t border-slate-800/80 text-center text-[11px] text-slate-500 space-y-1">
          <p>Zero telemetry &bull; End-to-End Encrypted &bull; Production Engine</p>
        </div>
      </div>
    </div>
  );
};
