import React, { useState, useEffect, useRef } from 'react';
import { Chat, Message, User, AppSettings } from './types';
import { LoginScreen } from './components/LoginScreen';
import { SidebarChatList } from './components/SidebarChatList';
import { ChatWindow } from './components/ChatWindow';
import { NewChatModal } from './components/NewChatModal';
import { SecuritySettingsModal } from './components/SecuritySettingsModal';
import { ImageLightboxModal } from './components/ImageLightboxModal';
import { playSoundEffect } from './utils/audioEffects';
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

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  const [chats, setChats] = useState<Chat[]>([]);
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('offline');

  const lastSyncTimestampRef = useRef<string>(new Date().toISOString());

  // 1. Initial Authentication Check on Mount
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setIsAuthChecking(false);
      return;
    }

    apiGetMe()
      .then((res) => {
        if (res && res.user) {
          setCurrentUser(res.user);
          setIsLoggedIn(true);
        } else {
          clearAuthToken();
        }
      })
      .catch(() => clearAuthToken())
      .finally(() => setIsAuthChecking(false));
  }, []);

  // 2. Fetch Initial Chats and Message History on Login
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    apiFetchChats().then((data) => {
      const fetchedChats = data.chats || [];
      setChats(fetchedChats);

      if (fetchedChats.length > 0 && !activeChatId) {
        setActiveChatId(fetchedChats[0].id);
      }

      // Fetch message history for each chat
      fetchedChats.forEach((chat: Chat) => {
        apiFetchMessages(chat.id).then((mRes) => {
          setMessagesMap((prev) => ({
            ...prev,
            [chat.id]: mRes.messages || [],
          }));
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
            // De-duplication check
            if (currentMsgs.some((m) => m.id === message.id || (m.clientMsgId && m.clientMsgId === message.clientMsgId))) {
              return prevMap;
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
                  unreadCount: isCurrentActive || message.senderId === currentUser.id
                    ? (c.unreadCount || 0)
                    : (c.unreadCount || 0) + 1,
                };
              }
              return c;
            });
          });

          if (message.senderId !== currentUser.id) {
            playSoundEffect('receive');
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
        } else if (type === 'typing:change') {
          const { chatId, userId, isTyping } = data;
          if (userId !== currentUser.id) {
            setChats((prev) =>
              (prev || []).map((c) => (c.id === chatId ? { ...c, isTyping } : c))
            );
          }
        } else if (type === 'chat:new') {
          const { chat } = data;
          setChats((prev) => {
            if ((prev || []).some((c) => c.id === chat.id)) return prev;
            return [chat, ...(prev || [])];
          });
        } else if (type === 'presence:change') {
          const { userId, status, lastSeen } = data;
          setChats((prev) =>
            (prev || []).map((c) => ({
              ...c,
              members: (c.members || []).map((m) =>
                m.id === userId ? { ...m, status, lastSeen } : m
              ),
            }))
          );
        }
      },
      (status) => {
        setConnectionStatus(status);
        if (status === 'connected') {
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

  // 4. Background Recovery Handler (Visibility / Window Focus)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isLoggedIn) {
        apiSync(lastSyncTimestampRef.current).then((syncRes) => {
          if (syncRes && syncRes.chats) {
            setChats(syncRes.chats);
            if (syncRes.messagesMap) {
              setMessagesMap((prev) => ({ ...prev, ...syncRes.messagesMap }));
            }
            lastSyncTimestampRef.current = syncRes.timestamp;
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [isLoggedIn]);

  // Realtime Heartbeat & Auto-Offline Detection
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    // Initial online presence trigger
    apiSendPresence('online').catch(() => {});

    // Heartbeat every 22 seconds
    const interval = setInterval(() => {
      apiSendPresence('online').catch(() => {});
    }, 22000);

    const handleBeforeUnload = () => {
      try {
        const token = localStorage.getItem('aarvi_token') || '';
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

    const clientMsgId = `cmsg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Optimistic UI Message
    const optimisticMsg: Message = {
      id: clientMsgId,
      clientMsgId,
      chatId: activeChatId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isoDate: new Date().toISOString(),
      status: 'sending',
      mediaType,
      mediaUrl,
      replyToText: replyTo?.text,
      isEncrypted: true,
    };

    // Update Local State Optimistically
    setMessagesMap((prevMap) => ({
      ...prevMap,
      [activeChatId]: [...(prevMap[activeChatId] || []), optimisticMsg],
    }));

    setChats((prev) =>
      (prev || []).map((c) => (c.id === activeChatId ? { ...c, lastMessage: optimisticMsg } : c))
    );

    try {
      const ackRes = await apiSendMessage(
        activeChatId,
        text,
        mediaType,
        mediaUrl,
        replyTo?.id,
        replyTo?.text,
        clientMsgId
      );

      if (ackRes && ackRes.message) {
        const confirmedMsg = ackRes.message;
        // Reconcile optimistic message with server message
        setMessagesMap((prevMap) => {
          const currentMsgs = prevMap[activeChatId] || [];
          return {
            ...prevMap,
            [activeChatId]: currentMsgs.map((m) =>
              m.clientMsgId === clientMsgId || m.id === clientMsgId ? confirmedMsg : m
            ),
          };
        });

        setChats((prev) =>
          (prev || []).map((c) =>
            c.id === activeChatId ? { ...c, lastMessage: confirmedMsg } : c
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
    await apiSendMessage(targetChatId, text, message.mediaType, message.mediaUrl);
    setMessagesMap((prev) => {
      const targetMsgs = prev[targetChatId] || [];
      const fwdMsg: Message = {
        id: `fwd-${Date.now()}`,
        chatId: targetChatId,
        senderId: currentUser!.id,
        senderName: currentUser!.name,
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isoDate: new Date().toISOString(),
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
    <div className="h-screen w-screen overflow-hidden bg-slate-950 flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-slate-950">
      {/* Realtime Connection Status Indicator Banner */}
      {connectionStatus !== 'connected' && (
        <div className="bg-amber-950/80 border-b border-amber-900 text-amber-200 text-[11px] font-medium px-4 py-1 text-center flex items-center justify-center gap-2 z-50">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Realtime Connection Re-establishing... Retrying stream packet relay.</span>
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
