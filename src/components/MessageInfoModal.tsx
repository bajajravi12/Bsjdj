import React from 'react';
import { Message } from '../types';
import { Info, Check, CheckCheck, Clock, Lock, X } from 'lucide-react';

interface MessageInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: Message | null;
}

export const MessageInfoModal: React.FC<MessageInfoModalProps> = ({
  isOpen,
  onClose,
  message,
}) => {
  if (!isOpen || !message) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Info className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Message Info</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Content Preview */}
        <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-200">
          <p className="font-medium">{message.text}</p>
        </div>

        {/* Status Details */}
        <div className="space-y-2 bg-slate-950 p-3 rounded-2xl border border-slate-800 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="text-slate-400 font-medium">Status</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1 capitalize">
              {message.status === 'read' ? (
                <>
                  <CheckCheck className="w-4 h-4 text-emerald-400" /> Read
                </>
              ) : message.status === 'delivered' ? (
                <>
                  <CheckCheck className="w-4 h-4 text-slate-400" /> Delivered
                </>
              ) : message.status === 'sent' ? (
                <>
                  <Check className="w-4 h-4 text-slate-400" /> Sent
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-amber-400" /> Sending...
                </>
              )}
            </span>
          </div>

          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="text-slate-400 font-medium">Sent At</span>
            <span className="text-slate-200 font-mono text-[11px]">{message.timestamp}</span>
          </div>

          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="text-slate-400 font-medium">ISO Timestamp</span>
            <span className="text-slate-400 font-mono text-[10px]">
              {new Date(message.isoDate || Date.now()).toLocaleTimeString()}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-medium">Encryption</span>
            <span className="text-emerald-400 font-bold text-[10px] flex items-center gap-1">
              <Lock className="w-3 h-3" /> E2EE Encrypted
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};
