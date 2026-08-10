import React, { useState } from 'react';
import { Chat, User } from '../types';
import { getDisplayAvatar } from '../utils/avatar';
import { formatMessageTime } from '../utils/date';
import { formatLastSeen } from '../utils/presence';
import { 
  Search, 
  Plus, 
  Lock, 
  ShieldCheck, 
  Users, 
  UserCheck, 
  Pin, 
  Settings, 
  CheckCheck, 
  Check, 
  MoreVertical, 
  MessageSquarePlus, 
  Flame, 
  LogOut, 
  Shield 
} from 'lucide-react';

interface SidebarChatListProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  currentUser: User;
  onOpenNewChatModal: () => void;
  onOpenSettingsModal: () => void;
  onLockApp: () => void;
  unreadTotal: number;
}

type FilterTab = 'all' | 'direct' | 'groups' | 'secret' | 'unread';

export const SidebarChatList: React.FC<SidebarChatListProps> = ({
  chats,
  activeChatId,
  onSelectChat,
  currentUser,
  onOpenNewChatModal,
  onOpenSettingsModal,
  onLockApp,
  unreadTotal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredChats = (chats || []).filter((chat) => {
    if (!chat) return false;
    const matchesSearch =
      (chat.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (chat.lastMessage?.text || '').toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeTab === 'direct') return !chat.isGroup && !chat.isSecret;
    if (activeTab === 'groups') return chat.isGroup;
    if (activeTab === 'secret') return chat.isSecret;
    if (activeTab === 'unread') return (chat.unreadCount || 0) > 0;
    return true;
  });

  const pinnedChats = filteredChats.filter((c) => c?.pinned);
  const otherChats = filteredChats.filter((c) => !c?.pinned);

  return (
    <div className="w-full md:w-80 lg:w-96 bg-slate-900 border-r border-slate-800/80 flex flex-col h-full select-none">
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-800/80 bg-slate-950/80 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-500 p-0.5 shadow-md flex items-center justify-center">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <h2 className="font-extrabold text-base tracking-tight text-white">AARVI</h2>
              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold px-1.5 py-0.2 rounded border border-emerald-500/30 flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" /> E2EE
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Private Encrypted Messaging</p>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={onOpenNewChatModal}
            className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all border border-emerald-500/30"
            title="New Chat or Secret Vault"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenSettingsModal}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Security Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={onLockApp}
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Lock Messenger"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="p-3 bg-slate-950/40 border-b border-slate-800/60">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search chats, messages or contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Telegram Filter Tabs */}
      <div className="flex items-center space-x-1 px-3 py-2 bg-slate-950/60 border-b border-slate-800/60 overflow-x-auto no-scrollbar text-xs">
        {[
          { id: 'all', label: 'All', badge: null },
          { id: 'direct', label: 'Direct', badge: null },
          { id: 'groups', label: 'Groups', badge: null },
          { id: 'secret', label: 'Secret 🔒', badge: null },
          { id: 'unread', label: 'Unread', badge: unreadTotal > 0 ? unreadTotal : null },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as FilterTab)}
              className={`px-3 py-1 rounded-lg font-medium text-[11px] whitespace-nowrap transition-all flex items-center space-x-1 ${
                isActive
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="bg-emerald-500 text-slate-950 font-bold text-[9px] px-1.5 py-0.2 rounded-full">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Chat List Stream */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
        {/* Pinned Section */}
        {pinnedChats.length > 0 && (
          <div className="py-1">
            <div className="px-3 py-1 text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center space-x-1">
              <Pin className="w-2.5 h-2.5 text-amber-400" />
              <span>Pinned Chats</span>
            </div>
            {pinnedChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                isSelected={chat.id === activeChatId}
                onSelect={() => onSelectChat(chat.id)}
                currentUserId={currentUser.id}
              />
            ))}
          </div>
        )}

        {/* Regular Section */}
        <div className="py-1">
          {pinnedChats.length > 0 && otherChats.length > 0 && (
            <div className="px-3 py-1 text-[10px] uppercase font-bold tracking-wider text-slate-500">
              All Conversations
            </div>
          )}
          {otherChats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              isSelected={chat.id === activeChatId}
              onSelect={() => onSelectChat(chat.id)}
              currentUserId={currentUser.id}
            />
          ))}

          {filteredChats.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-500 space-y-2">
              <MessageSquarePlus className="w-8 h-8 text-slate-700 mx-auto" />
              <p>No chats found matching criteria.</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Profile Bar */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/90 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="relative">
            <img
              src={getDisplayAvatar(currentUser.name, currentUser.avatar, currentUser.username)}
              alt={currentUser.name}
              className="w-9 h-9 rounded-full object-cover border border-slate-700 bg-slate-800"
            />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 absolute bottom-0 right-0 ring-2 ring-slate-950" />
          </div>
          <div className="overflow-hidden">
            <h4 className="font-bold text-xs text-white truncate">{currentUser.name}</h4>
            <p className="text-[10px] text-emerald-400 font-mono truncate">{currentUser.username}</p>
          </div>
        </div>

        <button
          onClick={onLockApp}
          className="text-slate-400 hover:text-rose-400 p-2 rounded-xl hover:bg-slate-800 transition-colors"
          title="Sign Out / Lock AARVI"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// Chat Row Item
interface ChatRowProps {
  chat: Chat;
  isSelected: boolean;
  onSelect: () => void;
  currentUserId?: string;
}

const ChatRow: React.FC<ChatRowProps> = ({ chat, isSelected, onSelect, currentUserId }) => {
  const lastMsg = chat.lastMessage;
  const otherMember = (chat.members || []).find((m) => m.id !== currentUserId && m.id !== 'usr-self');
  const presenceInfo = formatLastSeen(otherMember?.status, otherMember?.lastSeen);
  const isOtherOnline = presenceInfo.isOnline;
  const displayAvatar = getDisplayAvatar(chat.name, chat.avatar, chat.id);

  return (
    <div
      onClick={onSelect}
      className={`px-3.5 py-3 flex items-center space-x-3 cursor-pointer transition-all border-l-2 ${
        isSelected
          ? 'bg-slate-800/90 border-emerald-500'
          : 'border-transparent hover:bg-slate-800/40'
      }`}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <img
          src={displayAvatar}
          alt={chat.name}
          className="w-11 h-11 rounded-full object-cover border border-slate-800 bg-slate-800"
        />
        {chat.isSecret ? (
          <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[9px] flex items-center justify-center absolute -bottom-0.5 -right-0.5 ring-2 ring-slate-900 font-bold">
            🔒
          </span>
        ) : isOtherOnline ? (
          <span className="w-3 h-3 rounded-full bg-emerald-400 absolute bottom-0 right-0 ring-2 ring-slate-900" />
        ) : (
          <span className="w-3 h-3 rounded-full bg-slate-600 absolute bottom-0 right-0 ring-2 ring-slate-900" />
        )}
      </div>

      {/* Chat Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center space-x-1 truncate pr-2">
            <h4 className={`text-xs font-bold truncate ${chat.isSecret ? 'text-amber-300' : 'text-slate-100'}`}>
              {chat.name}
            </h4>
            {chat.isGroup && (
              <Users className="w-3 h-3 text-slate-400 flex-shrink-0" />
            )}
          </div>
          <span className="text-[10px] text-slate-500 flex-shrink-0 font-medium">
            {lastMsg ? formatMessageTime(lastMsg.isoDate, lastMsg.timestamp) : ''}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-400 truncate flex-1 pr-2">
            {chat.isTyping ? (
              <span className="text-emerald-400 font-semibold italic animate-pulse">
                typing...
              </span>
            ) : lastMsg ? (
              <span>
                {(lastMsg.senderId === currentUserId || lastMsg.senderId === 'usr-self') && (
                  <span className={`mr-1 font-bold ${lastMsg.status === 'read' ? 'text-cyan-400' : 'text-slate-400'}`}>
                    {lastMsg.status === 'read' ? '✓✓' : lastMsg.status === 'delivered' ? '✓✓' : '✓'}
                  </span>
                )}
                {lastMsg.mediaType ? `[${lastMsg.mediaType.toUpperCase()}] ` : ''}
                {lastMsg.text}
              </span>
            ) : (
              'No messages yet'
            )}
          </p>

          <div className="flex items-center space-x-1.5 flex-shrink-0">
            {chat.pinned && (
              <Pin className="w-3 h-3 text-amber-400/80" />
            )}
            {chat.unreadCount > 0 && (
              <span className="bg-emerald-500 text-slate-950 font-bold text-[10px] px-1.5 py-0.2 rounded-full">
                {chat.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
