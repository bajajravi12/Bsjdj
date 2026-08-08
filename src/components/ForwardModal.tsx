import React from 'react';
import { Chat, Message } from '../types';
import { Share2, X, Send } from 'lucide-react';
import { getDisplayAvatar } from '../utils/avatar';

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: Message | null;
  chats: Chat[];
  onForwardToChat: (targetChatId: string, message: Message) => void;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  message,
  chats,
  onForwardToChat,
}) => {
  if (!isOpen || !message) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Share2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Forward Message</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Preview */}
        <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-300">
          <p className="text-[10px] text-emerald-400 font-bold mb-1">
            Forwarding from {message.senderName}:
          </p>
          <p className="italic line-clamp-3 font-mono">"{message.text}"</p>
        </div>

        {/* Chat List */}
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Select Chat
          </p>
          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => {
                onForwardToChat(chat.id, message);
                onClose();
              }}
              className="w-full p-2.5 rounded-2xl hover:bg-slate-800/80 bg-slate-950 border border-slate-800/60 flex items-center justify-between text-left transition-colors group"
            >
              <div className="flex items-center space-x-3">
                <img
                  src={getDisplayAvatar(chat.name, chat.avatar, chat.id)}
                  alt={chat.name}
                  className="w-9 h-9 rounded-full object-cover border border-slate-700 bg-slate-800"
                />
                <div>
                  <h4 className="text-xs font-bold text-slate-200 group-hover:text-emerald-400">
                    {chat.name}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    {chat.isGroup ? 'Group Chat' : 'Direct Message'}
                  </p>
                </div>
              </div>
              <Send className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
