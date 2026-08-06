import React, { useState, useRef, useEffect } from 'react';
import { Chat, Message, User } from '../types';
import { apiSetTyping, apiMarkRead } from '../services/api';
import { 
  Lock, 
  Paperclip, 
  Send, 
  Mic, 
  Smile, 
  Image as ImageIcon, 
  MapPin, 
  X, 
  CheckCheck, 
  Check, 
  Clock, 
  CornerUpLeft, 
  Trash2, 
  Play, 
  Pause, 
  Flame, 
  ArrowLeft,
  Pin,
  Share2,
  Copy,
  Edit3,
  Info,
  MoreVertical
} from 'lucide-react';
import { playSoundEffect } from '../utils/audioEffects';
import { ForwardModal } from './ForwardModal';
import { MessageInfoModal } from './MessageInfoModal';

interface ChatWindowProps {
  chat: Chat;
  messages: Message[];
  onSendMessage: (
    text: string, 
    mediaType?: 'image' | 'voice' | 'file' | 'location', 
    mediaUrl?: string, 
    replyTo?: { id: string; text: string }
  ) => void;
  currentUser: User;
  onOpenImagePreview: (url: string) => void;
  onSetSelfDestructTimer: (chatId: string, seconds: number) => void;
  onBackToChatList?: () => void;
  onEditMessage?: (messageId: string, text: string) => void;
  onDeleteMessage?: (messageId: string, deleteForEveryone: boolean) => void;
  onReactMessage?: (messageId: string, emoji: string) => void;
  onPinMessage?: (chatId: string, messageId: string | null) => void;
  allChats?: Chat[];
  onForwardMessage?: (targetChatId: string, message: Message) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  chat,
  messages,
  onSendMessage,
  currentUser,
  onOpenImagePreview,
  onSetSelfDestructTimer,
  onBackToChatList,
  onEditMessage,
  onDeleteMessage,
  onReactMessage,
  onPinMessage,
  allChats = [],
  onForwardMessage,
}) => {
  const [inputText, setInputText] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<{ id: string; text: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activePlayingVoiceId, setActivePlayingVoiceId] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    message: Message | null;
  }>({ visible: false, x: 0, y: 0, message: null });

  // Modals state
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [infoMsg, setInfoMsg] = useState<Message | null>(null);

  // Toast feedback
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recordingTimerRef = useRef<any>(null);
  const typingTimerRef = useRef<any>(null);
  const longPressTimerRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chat.id]);

  // Read Receipts Trigger
  useEffect(() => {
    if (!chat || !chat.id) return;
    const markReadIfVisible = () => {
      if (document.hasFocus() && document.visibilityState === 'visible') {
        apiMarkRead(chat.id).catch(() => {});
      }
    };
    markReadIfVisible();
    window.addEventListener('focus', markReadIfVisible);
    document.addEventListener('visibilitychange', markReadIfVisible);
    return () => {
      window.removeEventListener('focus', markReadIfVisible);
      document.removeEventListener('visibilitychange', markReadIfVisible);
    };
  }, [chat.id, (messages || []).length]);

  // Handle Input Typing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (val.trim()) {
      apiSetTyping(chat.id, true).catch(() => {});
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        apiSetTyping(chat.id, false).catch(() => {});
      }, 2000);
    } else {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      apiSetTyping(chat.id, false).catch(() => {});
    }
  };

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu({ visible: false, x: 0, y: 0, message: null });
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible]);

  // Voice recording timer
  useEffect(() => {
    if (isRecordingVoice) {
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isRecordingVoice]);

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    apiSetTyping(chat.id, false).catch(() => {});

    // If Editing
    if (editingMessage) {
      if (onEditMessage) {
        onEditMessage(editingMessage.id, inputText.trim());
        showToast('Message edited');
      }
      setEditingMessage(null);
      setInputText('');
      return;
    }

    playSoundEffect('send');
    onSendMessage(
      inputText.trim(),
      undefined,
      undefined,
      replyToMessage || undefined
    );

    setInputText('');
    setReplyToMessage(null);
    setShowEmojiPicker(false);
    setShowAttachMenu(false);
  };

  const handleStartEdit = (msg: Message) => {
    setEditingMessage({ id: msg.id, text: msg.text });
    setInputText(msg.text);
    setReplyToMessage(null);
  };

  const handleFinishVoiceRecord = () => {
    setIsRecordingVoice(false);
    playSoundEffect('send');
    onSendMessage(
      `Voice Note (${recordingSeconds}s)`,
      'voice',
      'https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg',
      replyToMessage || undefined
    );
    setRecordingSeconds(0);
    setReplyToMessage(null);
  };

  const handleSendSampleImage = () => {
    setShowAttachMenu(false);
    playSoundEffect('send');
    onSendMessage(
      'Sent encrypted photo',
      'image',
      'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=800&q=80',
      replyToMessage || undefined
    );
  };

  const handleSendSampleLocation = () => {
    setShowAttachMenu(false);
    playSoundEffect('send');
    onSendMessage(
      'Shared Encrypted Location: 28.6139° N, 77.2090° E (New Delhi, India)',
      'location',
      undefined,
      replyToMessage || undefined
    );
  };

  const toggleVoicePlayback = (msgId: string) => {
    setActivePlayingVoiceId(activePlayingVoiceId === msgId ? null : msgId);
  };

  // Context Menu Trigger Handlers
  const openContextMenu = (e: React.MouseEvent | React.TouchEvent, msg: Message) => {
    e.preventDefault();
    e.stopPropagation();

    let clientX = 100;
    let clientY = 100;

    if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    // Keep context menu within viewport bounds
    const x = Math.min(clientX, window.innerWidth - 220);
    const y = Math.min(clientY, window.innerHeight - 280);

    setContextMenu({
      visible: true,
      x,
      y,
      message: msg,
    });
  };

  // Touch Long Press Handlers for Mobile
  const handleTouchStart = (e: React.TouchEvent, msg: Message) => {
    longPressTimerRef.current = setTimeout(() => {
      openContextMenu(e, msg);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('Message copied to clipboard');
  };

  const emojis = ['👍', '❤️', '🔥', '😂', '😮', '🔒', '🚀', '💯'];
  const reactionEmojis = ['👍', '❤️', '🔥', '😂', '😮', '👏', '📌', '💯'];

  const pinnedMsg = (messages || []).find((m) => m.id === chat.pinnedMessageId || m.isPinned);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 relative overflow-hidden font-sans select-none">
      {/* Toast Feedback */}
      {toastMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-slate-950 px-4 py-1.5 rounded-full font-bold text-xs shadow-xl animate-fade-in flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="p-3.5 bg-slate-900 border-b border-slate-800/80 flex items-center justify-between z-20 shadow-sm">
        <div className="flex items-center space-x-3">
          {onBackToChatList && (
            <button
              onClick={onBackToChatList}
              className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="relative">
            <img
              src={chat.avatar}
              alt={chat.name}
              className="w-10 h-10 rounded-full object-cover border border-slate-700"
            />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 absolute bottom-0 right-0 ring-2 ring-slate-900" />
          </div>

          <div>
            <div className="flex items-center space-x-1.5">
              <h3 className="font-bold text-sm text-slate-100">{chat.name}</h3>
              {chat.isSecret && (
                <span className="bg-amber-500/20 text-amber-300 text-[10px] font-semibold px-1.5 py-0.2 rounded border border-amber-500/30 flex items-center gap-0.5">
                  <Flame className="w-2.5 h-2.5" /> Secret Vault
                </span>
              )}
            </div>
            <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" /> E2EE Fingerprint: {chat.encryptionFingerprint.slice(0, 12)}...
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center space-x-1.5 sm:space-x-2">
          <div className="flex items-center space-x-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <select
              value={chat.selfDestructTimer || 0}
              onChange={(e) => onSetSelfDestructTimer(chat.id, Number(e.target.value))}
              className="bg-transparent text-slate-300 text-[11px] focus:outline-none cursor-pointer"
            >
              <option value={0}>Auto-delete: Off</option>
              <option value={10}>Auto-delete: 10s</option>
              <option value={30}>Auto-delete: 30s</option>
              <option value={60}>Auto-delete: 1m</option>
            </select>
          </div>
        </div>
      </div>

      {/* Secret Chat Banner */}
      {chat.isSecret && (
        <div className="bg-amber-950/40 border-b border-amber-900/50 px-4 py-2 text-[11px] text-amber-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>End-to-End Encrypted Secret Chat. Messages vanish on self-destruct timer.</span>
          </div>
          <span className="font-mono text-[10px] text-amber-400 font-bold">
            {chat.selfDestructTimer ? `${chat.selfDestructTimer}s Timer` : 'No Timer'}
          </span>
        </div>
      )}

      {/* Pinned Message Banner */}
      {pinnedMsg && (
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs z-10">
          <div className="flex items-center space-x-2 truncate">
            <Pin className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-emerald-400 font-bold">Pinned Message:</span>
            <span className="text-slate-300 truncate italic">"{pinnedMsg.text}"</span>
          </div>
          {onPinMessage && (
            <button
              onClick={() => onPinMessage(chat.id, null)}
              className="p-1 text-slate-400 hover:text-white"
              title="Unpin Message"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Messages Scroll View */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/60">
        <div className="text-center my-2">
          <span className="bg-slate-900/90 text-slate-400 text-[10px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full border border-slate-800">
            🔒 Production End-to-End Encrypted Session
          </span>
        </div>

        {(messages || []).length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 space-y-2 max-w-sm mx-auto mt-12">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 mx-auto">
              <Lock className="w-6 h-6" />
            </div>
            <p className="font-bold text-slate-300">No messages in this chat yet</p>
            <p className="text-[11px] text-slate-500">
              Messages are encrypted end-to-end and stored securely. Send a message below to start chatting!
            </p>
          </div>
        ) : (
          (messages || []).map((msg) => {
            const isSelf = msg.senderId === currentUser.id;
            const isVoice = msg.mediaType === 'voice';
            const isImage = msg.mediaType === 'image';
            const isLocation = msg.mediaType === 'location';

            return (
              <div
                key={msg.id}
                className={`flex flex-col group ${isSelf ? 'items-end' : 'items-start'}`}
                onContextMenu={(e) => openContextMenu(e, msg)}
                onTouchStart={(e) => handleTouchStart(e, msg)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[70%] rounded-2xl p-3.5 shadow-md relative transition-all ${
                    isSelf
                      ? 'bg-emerald-600 text-white rounded-br-none'
                      : 'bg-slate-900 text-slate-100 border border-slate-800 rounded-bl-none'
                  }`}
                >
                  {/* Sender Name */}
                  {!isSelf && (
                    <div className="text-[10px] font-bold text-emerald-400 mb-1 flex items-center justify-between">
                      <span>{msg.senderName}</span>
                    </div>
                  )}

                  {/* Reply Quote Banner */}
                  {msg.replyToText && (
                    <div className="mb-2 p-2 rounded-lg bg-black/20 border-l-2 border-emerald-300 text-[11px] opacity-90 truncate">
                      <span className="font-semibold block text-[10px]">Replying to:</span>
                      {msg.replyToText}
                    </div>
                  )}

                  {/* Image Attachment */}
                  {isImage && msg.mediaUrl && (
                    <div className="mb-2 overflow-hidden rounded-xl border border-black/20 cursor-pointer">
                      <img
                        src={msg.mediaUrl}
                        alt="Attachment"
                        onClick={() => onOpenImagePreview(msg.mediaUrl!)}
                        className="w-full max-h-60 object-cover hover:scale-105 transition-transform"
                      />
                    </div>
                  )}

                  {/* Voice Note Attachment */}
                  {isVoice && (
                    <div className="mb-2 p-2 rounded-xl bg-black/20 flex items-center space-x-3">
                      <button
                        onClick={() => toggleVoicePlayback(msg.id)}
                        className="w-9 h-9 rounded-full bg-slate-950 flex items-center justify-center text-emerald-400 shadow"
                      >
                        {activePlayingVoiceId === msg.id ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5" />
                        )}
                      </button>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-[10px] text-emerald-200 mb-1">
                          <span>Voice Recording</span>
                          <span>0:08</span>
                        </div>
                        <div className="h-1.5 bg-slate-950/60 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-emerald-400 transition-all ${
                              activePlayingVoiceId === msg.id ? 'w-full duration-8000' : 'w-1/3'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Location Attachment */}
                  {isLocation && (
                    <div className="mb-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center space-x-2 text-xs text-emerald-300">
                      <MapPin className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span>{msg.text}</span>
                    </div>
                  )}

                  {/* Text Body */}
                  {!isLocation && (
                    <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.text}
                    </p>
                  )}

                  {/* Emoji Reactions Pill Bar */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {msg.reactions.map((r) => {
                        const hasReacted = r.users.includes(currentUser.id);
                        return (
                          <button
                            key={r.emoji}
                            onClick={() => onReactMessage && onReactMessage(msg.id, r.emoji)}
                            className={`px-2 py-0.5 rounded-full text-[11px] flex items-center space-x-1 border transition-all ${
                              hasReacted
                                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                                : 'bg-black/20 border-black/30 text-slate-300'
                            }`}
                          >
                            <span>{r.emoji}</span>
                            <span>{r.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Message Footer */}
                  <div
                    className={`flex items-center justify-end space-x-1.5 mt-1 text-[9px] font-medium ${
                      isSelf ? 'text-emerald-100/80' : 'text-slate-400'
                    }`}
                  >
                    {msg.isEdited && <span className="italic opacity-80">(edited)</span>}
                    <Lock className="w-2.5 h-2.5 opacity-70" />
                    <span>{msg.timestamp}</span>

                    {isSelf && (
                      <span className="font-bold ml-0.5">
                        {msg.status === 'read' ? (
                          <CheckCheck className="w-3 h-3 text-emerald-300 inline" />
                        ) : msg.status === 'delivered' ? (
                          <CheckCheck className="w-3 h-3 opacity-80 inline" />
                        ) : msg.status === 'sent' ? (
                          <Check className="w-3 h-3 opacity-80 inline" />
                        ) : (
                          '🕒'
                        )}
                      </span>
                    )}
                  </div>

                  {/* Quick Action Button on Hover */}
                  <button
                    onClick={(e) => openContextMenu(e, msg)}
                    className="absolute -right-8 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-white"
                    title="Options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Reply Banner */}
      {replyToMessage && (
        <div className="bg-slate-900 px-4 py-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center space-x-2 truncate pr-2">
            <CornerUpLeft className="w-4 h-4 text-emerald-400" />
            <span className="truncate">Replying to: "{replyToMessage.text}"</span>
          </div>
          <button onClick={() => setReplyToMessage(null)} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit Banner */}
      {editingMessage && (
        <div className="bg-amber-950/60 px-4 py-2 border-t border-amber-800/80 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center space-x-2 truncate pr-2">
            <Edit3 className="w-4 h-4 text-amber-400" />
            <span className="truncate font-bold">Editing message: "{editingMessage.text}"</span>
          </div>
          <button
            onClick={() => {
              setEditingMessage(null);
              setInputText('');
            }}
            className="p-1 text-amber-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input Footer Bar */}
      <div className="p-3 bg-slate-900 border-t border-slate-800/80 relative z-20">
        {showAttachMenu && (
          <div className="absolute bottom-16 left-4 bg-slate-900 border border-slate-800 rounded-2xl p-2 shadow-2xl flex space-x-2 z-30">
            <button
              onClick={handleSendSampleImage}
              className="flex flex-col items-center p-2.5 hover:bg-slate-800 rounded-xl text-xs text-slate-200 transition-colors"
            >
              <ImageIcon className="w-5 h-5 text-emerald-400 mb-1" />
              <span>Photo</span>
            </button>
            <button
              onClick={handleSendSampleLocation}
              className="flex flex-col items-center p-2.5 hover:bg-slate-800 rounded-xl text-xs text-slate-200 transition-colors"
            >
              <MapPin className="w-5 h-5 text-cyan-400 mb-1" />
              <span>Location</span>
            </button>
          </div>
        )}

        {showEmojiPicker && (
          <div className="absolute bottom-16 left-12 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl z-30 grid grid-cols-4 gap-2">
            {emojis.map((e) => (
              <button
                key={e}
                onClick={() => {
                  setInputText((prev) => prev + e);
                  setShowEmojiPicker(false);
                }}
                className="text-lg p-2 hover:bg-slate-800 rounded-xl transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            className="p-2.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors"
            title="Attach Media"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-2.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-colors hidden sm:block"
            title="Emoji reactions"
          >
            <Smile className="w-5 h-5" />
          </button>

          {isRecordingVoice ? (
            <div className="flex-1 bg-slate-950 border border-emerald-500/50 rounded-2xl px-4 py-2 flex items-center justify-between text-xs text-emerald-300 animate-pulse">
              <div className="flex items-center space-x-2">
                <Mic className="w-4 h-4 text-emerald-400 animate-bounce" />
                <span className="font-bold">Recording Voice Note... ({recordingSeconds}s)</span>
              </div>
              <button
                type="button"
                onClick={handleFinishVoiceRecord}
                className="px-3 py-1 bg-emerald-500 text-slate-950 font-bold rounded-lg hover:bg-emerald-400 text-xs shadow"
              >
                Send Audio
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder={editingMessage ? 'Update message...' : 'Write an encrypted message...'}
              className="flex-1 bg-slate-950 border border-slate-800 text-slate-100 text-xs sm:text-sm rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          )}

          {inputText.trim() ? (
            <button
              type="submit"
              className="p-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-2xl shadow-lg transition-all active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (isRecordingVoice) handleFinishVoiceRecord();
                else setIsRecordingVoice(true);
              }}
              className={`p-3 rounded-2xl font-bold transition-all active:scale-95 ${
                isRecordingVoice
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700'
              }`}
              title="Record Voice Note"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {/* CONTEXT MENU POPOVER (Desktop Right-Click & Mobile Long-Press) */}
      {contextMenu.visible && contextMenu.message && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 bg-slate-900 border border-slate-800 rounded-2xl p-2 shadow-2xl w-56 space-y-1 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Reaction Emoji Strip */}
          <div className="flex items-center justify-between bg-slate-950 p-1.5 rounded-xl border border-slate-800 mb-1">
            {reactionEmojis.map((e) => (
              <button
                key={e}
                onClick={() => {
                  if (onReactMessage && contextMenu.message) {
                    onReactMessage(contextMenu.message.id, e);
                  }
                  setContextMenu({ visible: false, x: 0, y: 0, message: null });
                }}
                className="hover:scale-125 transition-transform p-0.5"
              >
                {e}
              </button>
            ))}
          </div>

          {/* Context Options */}
          <button
            onClick={() => {
              setReplyToMessage({ id: contextMenu.message!.id, text: contextMenu.message!.text });
              setContextMenu({ visible: false, x: 0, y: 0, message: null });
            }}
            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center space-x-2 transition-colors"
          >
            <CornerUpLeft className="w-4 h-4 text-emerald-400" />
            <span>Reply</span>
          </button>

          {contextMenu.message.senderId === currentUser.id && (
            <button
              onClick={() => {
                handleStartEdit(contextMenu.message!);
                setContextMenu({ visible: false, x: 0, y: 0, message: null });
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center space-x-2 transition-colors"
            >
              <Edit3 className="w-4 h-4 text-amber-400" />
              <span>Edit Message</span>
            </button>
          )}

          <button
            onClick={() => {
              handleCopy(contextMenu.message!.text);
              setContextMenu({ visible: false, x: 0, y: 0, message: null });
            }}
            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center space-x-2 transition-colors"
          >
            <Copy className="w-4 h-4 text-cyan-400" />
            <span>Copy Text</span>
          </button>

          <button
            onClick={() => {
              setForwardMsg(contextMenu.message);
              setContextMenu({ visible: false, x: 0, y: 0, message: null });
            }}
            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center space-x-2 transition-colors"
          >
            <Share2 className="w-4 h-4 text-indigo-400" />
            <span>Forward Message</span>
          </button>

          <button
            onClick={() => {
              if (onPinMessage) {
                const isCurrentlyPinned =
                  chat.pinnedMessageId === contextMenu.message!.id || contextMenu.message!.isPinned;
                onPinMessage(chat.id, isCurrentlyPinned ? null : contextMenu.message!.id);
                showToast(isCurrentlyPinned ? 'Message unpinned' : 'Message pinned');
              }
              setContextMenu({ visible: false, x: 0, y: 0, message: null });
            }}
            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center space-x-2 transition-colors"
          >
            <Pin className="w-4 h-4 text-emerald-400" />
            <span>
              {chat.pinnedMessageId === contextMenu.message.id ? 'Unpin Message' : 'Pin Message'}
            </span>
          </button>

          <button
            onClick={() => {
              setInfoMsg(contextMenu.message);
              setContextMenu({ visible: false, x: 0, y: 0, message: null });
            }}
            className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800 flex items-center space-x-2 transition-colors"
          >
            <Info className="w-4 h-4 text-teal-400" />
            <span>Message Info</span>
          </button>

          <div className="border-t border-slate-800 pt-1 space-y-1">
            <button
              onClick={() => {
                if (onDeleteMessage) {
                  onDeleteMessage(contextMenu.message!.id, false);
                  showToast('Deleted for you');
                }
                setContextMenu({ visible: false, x: 0, y: 0, message: null });
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-500/10 text-rose-400 flex items-center space-x-2 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete for me</span>
            </button>

            {(contextMenu.message.senderId === currentUser.id || chat.isGroup) && (
              <button
                onClick={() => {
                  if (onDeleteMessage) {
                    onDeleteMessage(contextMenu.message!.id, true);
                    showToast('Deleted for everyone');
                  }
                  setContextMenu({ visible: false, x: 0, y: 0, message: null });
                }}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-500/20 text-rose-500 font-bold flex items-center space-x-2 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete for everyone</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Forward Modal */}
      <ForwardModal
        isOpen={Boolean(forwardMsg)}
        onClose={() => setForwardMsg(null)}
        message={forwardMsg}
        chats={allChats}
        onForwardToChat={(targetChatId, msg) => {
          if (onForwardMessage) {
            onForwardMessage(targetChatId, msg);
            showToast('Message forwarded');
          }
        }}
      />

      {/* Message Info Modal */}
      <MessageInfoModal
        isOpen={Boolean(infoMsg)}
        onClose={() => setInfoMsg(null)}
        message={infoMsg}
      />
    </div>
  );
};
