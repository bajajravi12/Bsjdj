import React, { useEffect, useState } from 'react';
import { CallState } from '../types';
import { 
  PhoneOff, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Monitor, 
  ShieldCheck, 
  Lock 
} from 'lucide-react';

interface CallModalProps {
  callState: CallState;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  callState,
  onEndCall,
  onToggleMute,
  onToggleVideo,
}) => {
  const [timerSeconds, setTimerSeconds] = useState(0);

  useEffect(() => {
    let interval: any = null;
    if (callState.active) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callState.active]);

  if (!callState.active) return null;

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-xl flex flex-col items-center justify-between p-6 sm:p-10 font-sans">
      {/* Top Security Banner */}
      <div className="flex items-center space-x-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-4 py-1.5 rounded-full text-xs font-semibold">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span>AARVI HD {callState.type.toUpperCase()} CALL • End-to-End Encrypted</span>
      </div>

      {/* Main Call View */}
      <div className="flex flex-col items-center justify-center space-y-6 my-auto max-w-lg w-full text-center">
        {callState.type === 'video' && !callState.isVideoOff ? (
          <div className="relative w-full aspect-video bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex items-center justify-center">
            {/* Simulated Peer Video Stream */}
            <img
              src={callState.contactAvatar}
              alt={callState.contactName}
              className="w-full h-full object-cover filter brightness-90"
            />
            {/* Self PIP Thumbnail */}
            <div className="absolute bottom-4 right-4 w-28 h-20 bg-slate-950 rounded-xl border-2 border-emerald-500/80 overflow-hidden shadow-lg">
              <div className="w-full h-full bg-slate-900 flex items-center justify-center text-[10px] text-slate-400 font-semibold">
                Your Camera
              </div>
            </div>
            <div className="absolute top-3 left-3 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-800 text-[11px] text-white font-mono">
              {formatTimer(timerSeconds)}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative mx-auto">
              <img
                src={callState.contactAvatar}
                alt={callState.contactName}
                className="w-32 h-32 rounded-full object-cover border-4 border-emerald-500/80 shadow-2xl"
              />
              <span className="absolute bottom-1 right-1 w-6 h-6 bg-emerald-400 rounded-full ring-4 ring-slate-950 flex items-center justify-center text-[10px] text-slate-950 font-bold">
                ✓
              </span>
            </div>

            <div>
              <h2 className="text-2xl font-extrabold text-white">{callState.contactName}</h2>
              <p className="text-xs text-emerald-400 font-mono mt-1">
                Connected &bull; {formatTimer(timerSeconds)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Control Dock */}
      <div className="flex items-center space-x-4 bg-slate-900/90 p-4 rounded-3xl border border-slate-800 shadow-2xl">
        <button
          onClick={onToggleMute}
          className={`p-4 rounded-2xl transition-all ${
            callState.isMuted
              ? 'bg-rose-600 text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
          title="Toggle Mute"
        >
          {callState.isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <button
          onClick={onToggleVideo}
          className={`p-4 rounded-2xl transition-all ${
            callState.isVideoOff
              ? 'bg-rose-600 text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
          title="Toggle Video"
        >
          {callState.isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>

        <button
          onClick={onEndCall}
          className="p-4 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-lg shadow-rose-600/30 transition-all active:scale-95"
          title="End Call"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
