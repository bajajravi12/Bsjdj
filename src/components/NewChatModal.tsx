import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { apiSearchUsers, apiCreateChat } from '../services/api';
import { getDisplayAvatar } from '../utils/avatar';
import { 
  Plus, 
  X, 
  MessageSquare, 
  Lock, 
  Users, 
  Flame, 
  ShieldCheck, 
  Check,
  Search,
  UserPlus
} from 'lucide-react';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChatCreated: (chat: any) => void;
  currentUserId: string;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({
  isOpen,
  onClose,
  onChatCreated,
  currentUserId,
}) => {
  const [chatType, setChatType] = useState<'direct' | 'secret'>('direct');
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selfDestructTimer, setSelfDestructTimer] = useState<number>(30);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch registered users matching search query
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setIsLoading(true);

    apiSearchUsers(searchQuery)
      .then((data) => {
        if (isMounted) {
          setUsers(data.users || []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, searchQuery]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setErrorMsg('');
    setIsLoading(true);

    try {
      const data = await apiCreateChat({
        recipientUserId: selectedUserId,
        isSecret: chatType === 'secret',
        selfDestructTimer: chatType === 'secret' ? selfDestructTimer : 0,
      });

      onChatCreated(data.chat);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create conversation');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Start New Conversation</h3>
              <p className="text-[11px] text-slate-400">Search registered users in production DB</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chat Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setChatType('direct');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              chatType === 'direct'
                ? 'bg-emerald-600 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Direct Chat</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setChatType('secret');
            }}
            className={`py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              chatType === 'secret'
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Secret Vault 🔒</span>
          </button>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-2.5 rounded-xl text-xs text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Self destruct timer selector if Secret */}
          {chatType === 'secret' && (
            <div className="bg-amber-950/30 p-3 rounded-2xl border border-amber-900/50 space-y-1.5">
              <label className="block text-xs font-bold text-amber-300 flex items-center gap-1">
                <Flame className="w-3.5 h-3.5" /> Self-Destruct Timer
              </label>
              <select
                value={selfDestructTimer}
                onChange={(e) => setSelfDestructTimer(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 text-amber-200 text-xs rounded-xl px-3 py-2"
              >
                <option value={10}>Auto-delete: 10 Seconds</option>
                <option value={30}>Auto-delete: 30 Seconds</option>
                <option value={60}>Auto-delete: 1 Minute</option>
                <option value={3600}>Auto-delete: 1 Hour</option>
              </select>
            </div>
          )}

          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search users by name or @username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-white text-xs rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Select Contact List */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Registered Users
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Searching database...</div>
              ) : (users || []).length > 0 ? (
                (users || []).map((u) => {
                  const isSelected = selectedUserId === u.id;
                  return (
                    <div
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className={`p-2.5 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-slate-800 border-emerald-500 text-white'
                          : 'bg-slate-950 border-slate-800/80 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <img
                          src={getDisplayAvatar(u.name, u.avatar, u.username)}
                          alt={u.name}
                          className="w-8 h-8 rounded-full object-cover bg-slate-800"
                        />
                        <div>
                          <h5 className="font-bold text-xs">{u.name}</h5>
                          <p className="text-[10px] text-emerald-400 font-mono">{u.username}</p>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-center text-xs text-slate-500 space-y-2 bg-slate-950/60 rounded-2xl border border-slate-800">
                  <UserPlus className="w-6 h-6 text-slate-600 mx-auto" />
                  <p>No registered users found matching "{searchQuery}".</p>
                  <p className="text-[10px] text-slate-600">
                    Share your username with a friend or open a new browser tab/device to create a second account!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer buttons */}
          <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedUserId || isLoading}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg disabled:opacity-50 transition-all"
            >
              Start Conversation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
