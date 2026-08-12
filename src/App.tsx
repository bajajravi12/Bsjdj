import React, { useState, useEffect, useRef } from 'react';
import { Chat, Message, User, AppSettings } from './types';
import { LoginScreen } from './components/LoginScreen';
import { SidebarChatList } from './components/SidebarChatList';
import { ChatWindow } from './components/ChatWindow';
import { NewChatModal } from './components/NewChatModal';
import { SecuritySettingsModal } from './components/SecuritySettingsModal';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { playSoundEffect } from './utils/audioEffects';
import { getDisplayAvatar } from './utils/avatar';
import { Bell, X } from 'lucide-react';
import { 
  registerServiceWorker, 
  showNativeNotification, 
  seedHistoricMessageIds,
  markMessageAsNotified,
  isMessageNotified,
  subscribePushManager
} from './services/notifications';
import { 
  apiGetMe, 
  apiFetchChats, 
  apiFetchMessages, 
  apiSendMessage, 
  apiEditMessage,
  apiDeleteMessage,
  apiReactToMessage,
  apiPinMessage,
  apiSendPresence,
  subscribeRealtimeEvents, 
  apiSync, 
  clearAuthToken, 
  getAuthToken 
} from './services/api';

// Helper to safely merge server messages with local state, preserving in-flight optimistic messages
function mergeServerAndLocalMessages(existingMsgs: Message[] = [], incomingMsgs: Message[] = []): Message[] {
  const serverIds = new Set(incomingMsgs.map((m) => m.id));
  const serverClientIds = new Set(incomingMsgs.map((m) => m.clientMsgId).filter(Boolean) as string[]);

  const existingMap = new Map<string, Message>();
  for (const m of existingMsgs) {
    existingMap.set(m.id, m);
    if (m.clientMsgId) existingMap.set(m.clientMsgId, m);
  }

  // 1. Process server messages, enriching with existing local timestamps
  const mergedServer = incomingMsgs.map((inc) => {
    const ext = existingMap.get(inc.id) || (inc.clientMsgId ? existingMap.get(inc.clientMsgId) : undefined);
    if (ext) {
      return {
        ...inc,
        isoDate: ext.isoDate || inc.isoDate,
        timestamp: ext.timestamp || inc.timestamp,
      };
    }
    return inc;
  });

  // 2. Preserve any in-flight / optimistic messages that server has not yet acknowledged
  const pendingMsgs = existingMsgs.filter((m) => {
    const isPending = m.status === 'sending' || m.id.startsWith('cmsg-');
    if (!isPending) return false;
    const matchesServerId = serverIds.has(m.id);
    const matchesServerClientId = m.clientMsgId ? serverClientIds.has(m.clientMsgId) : false;
    return !matchesServerId && !matchesServerClientId;
  });

  return [...mergedServer, ...pendingMsgs];
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>(() => {
    try {
      const cached = localStorage.getItem('aarvi_messages_cache');
      if (cached) return JSON.parse(cached);
    } catch {}
    return {};
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // Sync messagesMap cache to localStorage
  useEffect(() => {
    if (messagesMap && Object.keys(messagesMap).length > 0) {
      try {
        localStorage.setItem('aarvi_messages_cache', JSON.stringify(messagesMap));
      } catch {}
    }
  }, [messagesMap]);

  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('offline');

  const [inAppToast, setInAppToast] = useState<{
    id: string;
    chatId: string;
    senderName: string;
    text: string;
    avatar?: string;
  } | null>(null);

  const lastSyncTimestampRef = useRef<string>(new Date().toISOString());
  const typingTimeoutRefs = useRef<Record<string, any>>({});
  const toastTimerRef = useRef<any>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  const chatsRef = useRef<Chat[]>(chats);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  // 0. Register Service Worker & Handle SW Notification Clicks
  useEffect(() => {
    registerServiceWorker();

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OPEN_CHAT' && event.data.chatId) {
        setActiveChatId(event.data.chatId);
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    (window as any).__aarvi_openChat = (chatId: string) => {
      setActiveChatId(chatId);
    };

    try {
      const params = new URLSearchParams(window.location.search);
      const targetChatId = params.get('chatId');
      if (targetChatId) {
        setActiveChatId(targetChatId);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {}

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      delete (window as any).__aarvi_openChat;
    };
  }, []);

  // 1. Initial Authentication Check on Mount
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setIsAuthChecking(false);
      return;
    }

    apiGetMe()
      .then((res) => {
        if (res && res.user && res.user.id) {
          setCurrentUser(res.user);
          setIsLoggedIn(true);
        } else {
          clearAuthToken();
          setCurrentUser(null);
          setIsLoggedIn(false);
        }
      })
      .catch(() => {
        clearAuthToken();
        setCurrentUser(null);
        setIsLoggedIn(false);
      })
      .finally(() => setIsAuthChecking(false));
  }, []);

  // 2. Fetch Initial Chats and Message History on Login
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    // Automatically subscribe to Web PushManager if permission granted
    subscribePushManager().catch(() => {});

    apiFetchChats().then((data) => {
      const fetchedChats = data.chats || [];
      setChats(fetchedChats);

      // Fetch message history for each chat with safe merging
      fetchedChats.forEach((chat: Chat) => {
        apiFetchMessages(chat.id).then((mRes) => {
          if (mRes && mRes.messages) {
            seedHistoricMessageIds(mRes.messages.map((m: Message) => m.id));
            setMessagesMap((prev) => ({
              ...prev,
              [chat.id]: mergeServerAndLocalMessages(prev[chat.id] || [], mRes.messages),
            }));
          }
        });
      });
    });
  }, [isLoggedIn, currentUser?.id]);

  // 3. Realtime SSE Event Subscription & Cross-Tab/Device Sync Engine
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    const unsubscribe = subscribeRealtimeEvents(
      (event) => {
        const { type, data } = event;

        if (type === 'message:new') {
          const { message, chatId } = data;

          setMessagesMap((prevMap) => {
            const currentMsgs = prevMap[chatId] || [];
            // Reconcile or append incoming message
            const idx = currentMsgs.findIndex(
              (m) =>
                m.id === message.id ||
                (m.clientMsgId && m.clientMsgId === message.clientMsgId) ||
                (message.clientMsgId && m.id === message.clientMsgId)
            );

            if (idx !== -1) {
              const updated = [...currentMsgs];
              updated[idx] = {
                ...message,
                isoDate: updated[idx].isoDate || message.isoDate,
                timestamp: updated[idx].timestamp || message.timestamp,
              };
              return {
                ...prevMap,
                [chatId]: updated,
              };
            }

            return {
              ...prevMap,
              [chatId]: [...currentMsgs, message],
            };
          });

          setChats((prevChats) => {
            return (prevChats || []).map((c) => {
              if (c.id === chatId) {
                const isCurrentActive = chatId === activeChatId && document.hasFocus();
                return {
                  ...c,
                  lastMessage: message,
                  isTyping: false,
                  typingUserName: undefined,
                  unreadCount: isCurrentActive || message.senderId === currentUser.id
                    ? (c.unreadCount || 0)
                    : (c.unreadCount || 0) + 1,
                };
              }
              return c;
            });
          });

          if (message.senderId !== currentUser.id && appSettings.notifications !== false) {
            playSoundEffect('receive');

            if ('vibrate' in navigator) {
              try { navigator.vibrate([120, 80, 120]); } catch {}
            }

            const currentChatList = chatsRef.current || [];
            const targetChat = currentChatList.find((c) => c.id === chatId);
            const otherMember = (targetChat?.members || []).find((m) => m.id === message.senderId);
            const senderName = message.senderName || otherMember?.name || targetChat?.name || 'AARVI User';
            const senderAvatar = message.senderAvatar || otherMember?.avatar || targetChat?.avatar;
            const previewText = message.text || (message.mediaType ? `[${message.mediaType.toUpperCase()}]` : 'Sent a message');

            const isViewingCurrentChat = activeChatIdRef.current === chatId && document.hasFocus();

            // Native Browser System Push Notification
            if (!isViewingCurrentChat) {
              showNativeNotification(`AARVI: ${senderName}`, {
                body: previewText,
                senderName,
                avatarUrl: senderAvatar,
                chatId,
                messageId: message.id,
              });
            } else {
              markMessageAsNotified(message.id);
            }

            // In-App Toast Notification
            if (!isViewingCurrentChat) {
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              setInAppToast({
                id: message.id,
                chatId,
                senderName,
                text: previewText,
                avatar: senderAvatar,
              });
              toastTimerRef.current = setTimeout(() => {
                setInAppToast(null);
              }, 4500);
            }
          }
        } else if (type === 'message:read') {
          const { chatId, readMessageIds } = data;
          setMessagesMap((prevMap) => {
            const currentMsgs = prevMap[chatId] || [];
            return {
              ...prevMap,
              [chatId]: currentMsgs.map((m) =>
                (!readMessageIds || readMessageIds.length === 0 || readMessageIds.includes(m.id))
                  ? { ...m, status: 'read' as const }
                  : m
              ),
            };
          });
          setChats((prev) =>
            (prev || []).map((c) =>
              c.id === chatId && c.lastMessage
                ? { ...c, lastMessage: { ...c.lastMessage, status: 'read' } }
                : c
            )
          );
        } else if (type === 'message:delivered') {
          const { chatId, deliveredMessageIds } = data;
          setMessagesMap((prevMap) => {
            const currentMsgs = prevMap[chatId] || [];
            return {
              ...prevMap,
              [chatId]: currentMsgs.map((m) =>
                (!deliveredMessageIds || deliveredMessageIds.includes(m.id))
                  ? { ...m, status: m.status === 'read' ? 'read' : ('delivered' as const) }
                  : m
              ),
            };
          });
          setChats((prev) =>
            (prev || []).map((c) =>
              c.id === chatId && c.lastMessage && c.lastMessage.status !== 'read'
                ? { ...c, lastMessage: { ...c.lastMessage, status: 'delivered' } }
                : c
            )
          );
        } else if (type === 'message:edit') {
          const { chatId, messageId, text } = data;
          setMessagesMap((prevMap) => {
            const currentMsgs = prevMap[chatId] || [];
            return {
              ...prevMap,
              [chatId]: currentMsgs.map((m) =>
                m.id === messageId ? { ...m, text, isEdited: true } : m
              ),
            };
          });
        } else if (type === 'message:delete') {
          const { chatId, messageId } = data;
          setMessagesMap((prevMap) => {
            const currentMsgs = prevMap[chatId] || [];
            return {
              ...prevMap,
              [chatId]: currentMsgs.filter((m) => m.id !== messageId),
            };
          });
        } else if (type === 'message:react') {
          const { chatId, messageId, reactions } = data;
          setMessagesMap((prevMap) => {
            const currentMsgs = prevMap[chatId] || [];
            return {
              ...prevMap,
              [chatId]: currentMsgs.map((m) =>
                m.id === messageId ? { ...m, reactions } : m
              ),
            };
          });
        } else if (type === 'chat:pin_message') {
          const { chatId, pinnedMessageId } = data;
          setChats((prev) =>
            (prev || []).map((c) => (c.id === chatId ? { ...c, pinnedMessageId } : c))
          );
        } else if (type === 'typing:change' || type === 'typing:start' || type === 'typing:stop') {
          const { chatId, userId, userName, isTyping } = data;
          const isTypingActive = type === 'typing:stop' ? false : Boolean(isTyping);
          if (userId !== currentUser.id) {
            setChats((prev) =>
              (prev || []).map((c) =>
                c.id === chatId
                  ? { ...c, isTyping: isTypingActive, typingUserName: isTypingActive ? (userName || 'Someone') : undefined }
                  : c
              )
            );

            // 4-second timeout safety per chat
            if (typingTimeoutRefs.current[chatId]) {
              clearTimeout(typingTimeoutRefs.current[chatId]);
            }

            if (isTypingActive) {
              typingTimeoutRefs.current[chatId] = setTimeout(() => {
                setChats((prev) =>
                  (prev || []).map((c) =>
                    c.id === chatId && c.isTyping ? { ...c, isTyping: false, typingUserName: undefined } : c
                  )
                );
              }, 4000);
            }
          }
        } else if (type === 'chat:new') {
          const { chat } = data;
          setChats((prev) => {
            if ((prev || []).some((c) => c.id === chat.id)) return prev;
            return [chat, ...(prev || [])];
          });
        } else if (type === 'presence:change' || type === 'presence:update') {
          const { userId, status, lastSeen } = data;
          setChats((prev) =>
            (prev || []).map((c) => {
              const isMember = (c.memberIds || []).includes(userId) || (c.members || []).some((m) => m.id === userId);
              if (!isMember) return c;

              const hasMemberObj = (c.members || []).some((m) => m.id === userId);
              const newMembers = hasMemberObj
                ? (c.members || []).map((m) => (m.id === userId ? { ...m, status, lastSeen } : m))
                : [...(c.members || []), { id: userId, name: 'User', username: '@user', avatar: '', status, lastSeen, isVerified: true }];

              return {
                ...c,
                members: newMembers,
              };
            })
          );
        }
      },
      (status) => {
        setConnectionStatus(status);
        if (status === 'connected') {
          // Send presence heartbeat immediately on reconnect
          apiSendPresence('online').catch(() => {});
          // Recover missed background events on reconnect
          apiSync(lastSyncTimestampRef.current).then((syncRes) => {
            if (syncRes && syncRes.chats) {
              setChats(syncRes.chats);
              lastSyncTimestampRef.current = syncRes.timestamp;
            }
          });
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [isLoggedIn, currentUser?.id, activeChatId]);

  // 4. Background Periodic Sync & Recovery Handler
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    const pollSync = async () => {
      try {
        const syncRes = await apiSync();
        if (syncRes && syncRes.chats) {
          setChats((prevChats) => {
            const typingMap = new Map((prevChats || []).map((c) => [c.id, c.isTyping]));
            return syncRes.chats.map((c: Chat) => ({
              ...c,
              isTyping: typingMap.get(c.id) || false,
            }));
          });

          if (syncRes.messagesMap) {
            // Check for unnotified new messages from other senders (e.g. delivered while SSE was reconnecting)
            for (const [cId, msgs] of Object.entries(syncRes.messagesMap)) {
              const incomingMsgs = msgs as Message[];
              for (const msg of incomingMsgs) {
                if (
                  msg.senderId !== currentUser.id &&
                  !isMessageNotified(msg.id)
                ) {
                  const isViewingCurrentChat = activeChatIdRef.current === cId && document.hasFocus();
                  markMessageAsNotified(msg.id);

                  if (!isViewingCurrentChat && appSettings.notifications !== false) {
                    const currentChatList = chatsRef.current || [];
                    const targetChat = currentChatList.find((c) => c.id === cId);
                    const otherMember = (targetChat?.members || []).find((m) => m.id === msg.senderId);
                    const senderName = msg.senderName || otherMember?.name || targetChat?.name || 'AARVI User';
                    const senderAvatar = msg.senderAvatar || otherMember?.avatar || targetChat?.avatar;
                    const previewText = msg.text || (msg.mediaType ? `[${msg.mediaType.toUpperCase()}]` : 'Sent a message');

                    showNativeNotification(`AARVI: ${senderName}`, {
                      body: previewText,
                      senderName,
                      avatarUrl: senderAvatar,
                      chatId: cId,
                      messageId: msg.id,
                    });
                  }
                }
              }
            }

            setMessagesMap((prevMap) => {
              let updated = false;
              const nextMap = { ...prevMap };

              for (const [cId, msgs] of Object.entries(syncRes.messagesMap)) {
                const incomingMsgs = msgs as Message[];
                const existingMsgs = prevMap[cId] || [];

                const merged = mergeServerAndLocalMessages(existingMsgs, incomingMsgs);

                if (existingMsgs.length !== merged.length) {
                  nextMap[cId] = merged;
                  updated = true;
                } else {
                  for (let i = 0; i < merged.length; i++) {
                    if (
                      existingMsgs[i]?.id !== merged[i]?.id ||
                      existingMsgs[i]?.status !== merged[i]?.status ||
                      existingMsgs[i]?.text !== merged[i]?.text ||
                      existingMsgs[i]?.isEdited !== merged[i]?.isEdited ||
                      JSON.stringify(existingMsgs[i]?.reactions) !== JSON.stringify(merged[i]?.reactions)
                    ) {
                      nextMap[cId] = merged;
                      updated = true;
                      break;
                    }
                  }
                }
              }

              return updated ? nextMap : prevMap;
            });
          }
        }
      } catch (err) {}
    };

    // Auto-poll every 3 seconds for seamless cross-isolate sync
    const syncInterval = setInterval(pollSync, 3000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      clearInterval(syncInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [isLoggedIn, currentUser?.id]);

  // Realtime Heartbeat & Auto-Offline Detection
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    // Initial online presence trigger
    apiSendPresence('online').catch(() => {});

    // Heartbeat every 18 seconds (server timeout is 45s)
    const interval = setInterval(() => {
      apiSendPresence('online').catch(() => {});
    }, 18000);

    const handleBeforeUnload = () => {
      try {
        const token = getAuthToken() || '';
        const blob = new Blob([JSON.stringify({ status: 'offline' })], { type: 'application/json' });
        navigator.sendBeacon('/api/presence', blob);
      } catch (e) {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [isLoggedIn, currentUser?.id]);

  // 5. App Settings State
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('aarvi_app_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { theme: 'dark', wallpaper: 'default', fontSize: 'medium', notifications: true };
  });

  const handleUpdateSettings = (newSet: Partial<AppSettings>) => {
    setAppSettings((prev) => {
      const updated = { ...prev, ...newSet };
      localStorage.setItem('aarvi_app_settings', JSON.stringify(updated));
      return updated;
    });
  };

  // 6. Mobile Back Button (History API) Handler
  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    if (window.history.state?.chatId !== chatId) {
      window.history.pushState({ chatOpen: true, chatId }, '');
    }
    setChats((prev) =>
      (prev || []).map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c))
    );

    // Fetch latest messages for this chat in background and merge with local state
    apiFetchMessages(chatId)
      .then((mRes) => {
        if (mRes && mRes.messages) {
          setMessagesMap((prev) => ({
            ...prev,
            [chatId]: mergeServerAndLocalMessages(prev[chatId] || [], mRes.messages),
          }));
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (activeChatId) {
        // User pressed device/browser back button while in chat
        setActiveChatId(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeChatId]);

  // 7. Send Message Handler with Optimistic UI & Server Reconciliation
  const handleSendMessage = async (
    text: string,
    mediaType?: 'image' | 'voice' | 'file' | 'location',
    mediaUrl?: string,
    replyTo?: { id: string; text: string }
  ) => {
    if (!activeChatId || !currentUser) return;

    const targetChatId = activeChatId;
    const clientMsgId = `cmsg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const nowIso = new Date().toISOString();

    // Optimistic UI Message
    const optimisticMsg: Message = {
      id: clientMsgId,
      clientMsgId,
      chatId: targetChatId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      text,
      timestamp: nowIso,
      isoDate: nowIso,
      status: 'sending',
      mediaType,
      mediaUrl,
      replyToText: replyTo?.text,
      isEncrypted: true,
    };

    // Update Local State Optimistically
    setMessagesMap((prevMap) => ({
      ...prevMap,
      [targetChatId]: [...(prevMap[targetChatId] || []), optimisticMsg],
    }));

    setChats((prev) =>
      (prev || []).map((c) => (c.id === targetChatId ? { ...c, lastMessage: optimisticMsg } : c))
    );

    try {
      const ackRes = await apiSendMessage(
        targetChatId,
        text,
        mediaType,
        mediaUrl,
        replyTo?.id,
        replyTo?.text,
        clientMsgId
      );

      if (ackRes && ackRes.message) {
        const confirmedMsg = ackRes.message;
        // Reconcile optimistic message with server message while preserving initial client creation timestamp
        setMessagesMap((prevMap) => {
          const currentMsgs = prevMap[targetChatId] || [];
          const idx = currentMsgs.findIndex(
            (m) => m.clientMsgId === clientMsgId || m.id === clientMsgId || m.id === confirmedMsg.id
          );

          if (idx !== -1) {
            const updated = [...currentMsgs];
            const preservedIso = currentMsgs[idx].isoDate || confirmedMsg.isoDate || nowIso;
            const preservedTs = currentMsgs[idx].timestamp || confirmedMsg.timestamp || preservedIso;
            updated[idx] = {
              ...confirmedMsg,
              isoDate: preservedIso,
              timestamp: preservedTs,
            };
            return {
              ...prevMap,
              [targetChatId]: updated,
            };
          }

          return {
            ...prevMap,
            [targetChatId]: [...currentMsgs, confirmedMsg],
          };
        });

        setChats((prev) =>
          (prev || []).map((c) =>
            c.id === targetChatId ? { ...c, lastMessage: confirmedMsg } : c
          )
        );
      }
    } catch (err) {
      console.error('Failed to deliver message:', err);
    }
  };

  // 8. Message Feature Handlers: Edit, Delete, React, Pin, Forward
  const handleEditMessage = async (messageId: string, text: string) => {
    if (!activeChatId) return;
    setMessagesMap((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).map((m) =>
        m.id === messageId ? { ...m, text, isEdited: true } : m
      ),
    }));
    try {
      await apiEditMessage(messageId, text);
    } catch (err) {
      console.error('Edit message failed:', err);
    }
  };

  const handleDeleteMessage = async (messageId: string, deleteForEveryone: boolean) => {
    if (!activeChatId) return;
    setMessagesMap((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).filter((m) => m.id !== messageId),
    }));
    try {
      await apiDeleteMessage(messageId, deleteForEveryone);
    } catch (err) {
      console.error('Delete message failed:', err);
    }
  };

  const handleReactMessage = async (messageId: string, emoji: string) => {
    if (!activeChatId || !currentUser) return;
    setMessagesMap((prev) => {
      const msgs = prev[activeChatId] || [];
      return {
        ...prev,
        [activeChatId]: msgs.map((m) => {
          if (m.id !== messageId) return m;
          const reactions = m.reactions || [];
          const existing = reactions.find((r) => r.emoji === emoji);
          let updatedReactions;
          if (existing) {
            const hasUser = existing.users.includes(currentUser.id);
            if (hasUser) {
              const newUsers = existing.users.filter((u) => u !== currentUser.id);
              updatedReactions = reactions
                .map((r) => (r.emoji === emoji ? { ...r, count: newUsers.length, users: newUsers } : r))
                .filter((r) => r.count > 0);
            } else {
              const newUsers = [...existing.users, currentUser.id];
              updatedReactions = reactions.map((r) =>
                r.emoji === emoji ? { ...r, count: newUsers.length, users: newUsers } : r
              );
            }
          } else {
            updatedReactions = [...reactions, { emoji, count: 1, users: [currentUser.id] }];
          }
          return { ...m, reactions: updatedReactions };
        }),
      };
    });
    try {
      await apiReactToMessage(messageId, emoji);
    } catch (err) {
      console.error('React message failed:', err);
    }
  };

  const handlePinMessage = async (chatId: string, messageId: string | null) => {
    setChats((prev) =>
      (prev || []).map((c) => (c.id === chatId ? { ...c, pinnedMessageId: messageId || undefined } : c))
    );
    try {
      await apiPinMessage(chatId, messageId);
    } catch (err) {
      console.error('Pin message failed:', err);
    }
  };

  const handleForwardMessage = async (targetChatId: string, message: Message) => {
    const text = `[Forwarded from ${message.senderName}]: ${message.text}`;
    const fwdIso = new Date().toISOString();
    await apiSendMessage(targetChatId, text, message.mediaType, message.mediaUrl);
    setMessagesMap((prev) => {
      const targetMsgs = prev[targetChatId] || [];
      const fwdMsg: Message = {
        id: `fwd-${Date.now()}`,
        chatId: targetChatId,
        senderId: currentUser!.id,
        senderName: currentUser!.name,
        text,
        timestamp: fwdIso,
        isoDate: fwdIso,
        status: 'sent',
        mediaType: message.mediaType,
        mediaUrl: message.mediaUrl,
        isEncrypted: true,
      };
      return { ...prev, [targetChatId]: [...targetMsgs, fwdMsg] };
    });
  };

  // 9. Chat Creation Handler from Modal
  const handleChatCreated = (newChat: Chat) => {
    setChats((prev) => {
      if ((prev || []).some((c) => c.id === newChat.id)) return prev;
      return [newChat, ...(prev || [])];
    });
    setActiveChatId(newChat.id);
  };

  const handleSetSelfDestructTimer = (chatId: string, seconds: number) => {
    setChats((prev) =>
      (prev || []).map((c) => (c.id === chatId ? { ...c, selfDestructTimer: seconds } : c))
    );
  };

  const handleLogout = () => {
    clearAuthToken();
    setIsLoggedIn(false);
    setCurrentUser(null);
    setChats([]);
    setMessagesMap({});
    setActiveChatId(null);
  };

  const unreadTotal = (chats || []).reduce((acc, c) => acc + (c?.unreadCount || 0), 0);
  const activeChat = (chats || []).find((c) => c.id === activeChatId) || null;
  const activeMessages = activeChatId ? messagesMap[activeChatId] || [] : [];

  if (isAuthChecking) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex flex-col items-center justify-center text-emerald-400 font-sans space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center animate-pulse">
          🔒
        </div>
        <p className="text-xs font-bold tracking-wider uppercase text-slate-300">
          Initializing AARVI Production Messenger Engine...
        </p>
      </div>
    );
  }

  if (!isLoggedIn || !currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsLoggedIn(true);
        }}
      />
    );
  }

  return (
    <div className="h-[100dvh] w-full max-w-full overflow-hidden bg-slate-950 flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-slate-950">
      {/* Realtime Connection Status Indicator Banner */}
      {connectionStatus !== 'connected' && (
        <div className="bg-amber-950/80 border-b border-amber-900 text-amber-200 text-[11px] font-medium px-4 py-1 text-center flex items-center justify-center gap-2 z-50">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Realtime Connection Re-establishing... Retrying stream packet relay.</span>
        </div>
      )}

      {/* Floating In-App Message Notification Toast */}
      {inAppToast && (
        <div
          onClick={() => {
            setActiveChatId(inAppToast.chatId);
            setInAppToast(null);
          }}
          className="fixed top-4 right-4 z-[100] bg-slate-900/95 border border-emerald-500/50 text-white rounded-2xl p-3.5 shadow-2xl flex items-center space-x-3.5 max-w-sm w-[92vw] sm:w-auto cursor-pointer animate-in fade-in slide-in-from-top-4 duration-300 hover:border-emerald-400 transition-all backdrop-blur-md"
        >
          <div className="relative flex-shrink-0">
            <img
              src={getDisplayAvatar(inAppToast.senderName, inAppToast.avatar, inAppToast.chatId)}
              alt={inAppToast.senderName}
              className="w-11 h-11 rounded-full object-cover border border-emerald-500/40 bg-slate-800"
            />
            <span className="absolute -top-1 -right-1 bg-emerald-500 text-slate-950 p-1 rounded-full shadow-md">
              <Bell className="w-3 h-3" />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-xs font-bold text-emerald-400 truncate">{inAppToast.senderName}</h5>
              <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">New Message</span>
            </div>
            <p className="text-xs text-slate-200 truncate mt-0.5">{inAppToast.text}</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setInAppToast(null);
            }}
            className="p-1 text-slate-400 hover:text-white rounded-lg flex-shrink-0 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Telegram Layout Container */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Chat List */}
        <div
          className={`w-full md:w-80 lg:w-96 flex-shrink-0 h-full ${
            activeChatId ? 'hidden md:flex' : 'flex'
          }`}
        >
          <SidebarChatList
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={handleSelectChat}
            currentUser={currentUser}
            onOpenNewChatModal={() => setShowNewChatModal(true)}
            onOpenSettingsModal={() => setShowSettingsModal(true)}
            onLockApp={handleLogout}
            unreadTotal={unreadTotal}
          />
        </div>

        {/* Chat Window Main View */}
        <div
          className={`flex-1 h-full flex flex-col ${
            !activeChatId ? 'hidden md:flex' : 'flex'
          }`}
        >
          {activeChat ? (
            <ChatWindow
              chat={activeChat}
              messages={activeMessages}
              onSendMessage={handleSendMessage}
              currentUser={currentUser}
              onOpenImagePreview={(url) => setLightboxImage(url)}
              onSetSelfDestructTimer={handleSetSelfDestructTimer}
              onBackToChatList={() => setActiveChatId(null)}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onReactMessage={handleReactMessage}
              onPinMessage={handlePinMessage}
              allChats={chats}
              onForwardMessage={handleForwardMessage}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-500 space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400">
                🔒
              </div>
              <h3 className="text-lg font-bold text-white">AARVI Production Messenger</h3>
              <p className="text-xs max-w-sm">
                Select a conversation or click <span className="text-emerald-400 font-bold">+</span> to start an end-to-end encrypted chat with any registered user.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modals & Overlay Screens */}
      <NewChatModal
        isOpen={showNewChatModal}
        onClose={() => setShowNewChatModal(false)}
        onChatCreated={handleChatCreated}
        currentUserId={currentUser.id}
      />

      <SecuritySettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        currentUser={currentUser}
        onClearStorage={handleLogout}
        onLogout={handleLogout}
        settings={appSettings}
        onUpdateSettings={handleUpdateSettings}
      />

      <ImageLightboxModal
        imageUrl={lightboxImage}
        onClose={() => setLightboxImage(null)}
      />
    </div>
  );
}
