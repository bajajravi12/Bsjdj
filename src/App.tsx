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

/**
 * Safely merges incremental server updates with local messages.
 *
 * Important:
 * - Existing confirmed messages are preserved.
 * - Optimistic messages are replaced by their server-confirmed version.
 * - Incremental sync responses cannot wipe old messages.
 */
function mergeServerAndLocalMessages(
  existingMsgs: Message[] = [],
  incomingMsgs: Message[] = []
): Message[] {
  const messagesById = new Map<string, Message>();
  const clientIdToMessageId = new Map<string, string>();

  // Preserve existing local messages.
  for (const message of existingMsgs) {
    messagesById.set(message.id, message);

    if (message.clientMsgId) {
      clientIdToMessageId.set(message.clientMsgId, message.id);
    }
  }

  // Merge incoming server messages.
  for (const incoming of incomingMsgs) {
    let existing = messagesById.get(incoming.id);

    // Match server message with optimistic/local message.
    if (!existing && incoming.clientMsgId) {
      const localMessageId =
        clientIdToMessageId.get(incoming.clientMsgId);

      if (localMessageId) {
        existing = messagesById.get(localMessageId);

        // Remove optimistic message once server confirmation exists.
        if (localMessageId !== incoming.id) {
          messagesById.delete(localMessageId);
        }
      }
    }

    if (existing) {
      messagesById.set(incoming.id, {
        ...existing,
        ...incoming,

        // Preserve the original local timestamp.
        isoDate: existing.isoDate || incoming.isoDate,
        timestamp: existing.timestamp || incoming.timestamp
      });
    } else {
      messagesById.set(incoming.id, incoming);
    }

    if (incoming.clientMsgId) {
      clientIdToMessageId.set(
        incoming.clientMsgId,
        incoming.id
      );
    }
  }

  return Array.from(messagesById.values()).sort((a, b) => {
    const aTime = new Date(
      a.isoDate || a.timestamp
    ).getTime();

    const bTime = new Date(
      b.isoDate || b.timestamp
    ).getTime();

    return aTime - bTime;
  });
}

export default function App() {
  const [currentUser, setCurrentUser] =
    useState<User | null>(null);

  const [isLoggedIn, setIsLoggedIn] =
    useState<boolean>(false);

  const [isAuthChecking, setIsAuthChecking] =
    useState<boolean>(true);

  const [chats, setChats] =
    useState<Chat[]>([]);

  const [messagesMap, setMessagesMap] =
    useState<Record<string, Message[]>>(() => {
      try {
        const cached = localStorage.getItem(
          'aarvi_messages_cache'
        );

        if (cached) {
          return JSON.parse(cached);
        }
      } catch {}

      return {};
    });

  const [activeChatId, setActiveChatId] =
    useState<string | null>(null);

  const [showNewChatModal, setShowNewChatModal] =
    useState(false);

  const [showSettingsModal, setShowSettingsModal] =
    useState(false);

  const [lightboxImage, setLightboxImage] =
    useState<string | null>(null);

  const [connectionStatus, setConnectionStatus] =
    useState<'connected' | 'reconnecting' | 'offline'>(
      'offline'
    );

  const [inAppToast, setInAppToast] =
    useState<{
      id: string;
      chatId: string;
      senderName: string;
      text: string;
      avatar?: string;
    } | null>(null);

  /*
   * Sync timestamp starts empty.
   * Backend decides what the first sync should return.
   */
  const lastSyncTimestampRef =
    useRef<string>('');

  const typingTimeoutRefs =
    useRef<Record<string, any>>({});

  const toastTimerRef =
    useRef<any>(null);

  const activeChatIdRef =
    useRef<string | null>(activeChatId);

  const chatsRef =
    useRef<Chat[]>(chats);

  const sessionStartTimeRef =
    useRef<number>(Date.now());

  // Prevents overlapping apiSync() calls when SSE reconnect,
  // the 30s interval, and a focus/visibility event fire close together.
  const isSyncingRef =
    useRef<boolean>(false);

  const handleSelectChatRef =
    useRef<(chatId: string) => void>(() => {});

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  /*
   * Cache messages.
   */
  useEffect(() => {
    if (
      messagesMap &&
      Object.keys(messagesMap).length > 0
    ) {
      try {
        localStorage.setItem(
          'aarvi_messages_cache',
          JSON.stringify(messagesMap)
        );
      } catch {}
    }
  }, [messagesMap]);

  /*
   * Register service worker.
   */
  useEffect(() => {
    registerServiceWorker();

    const handleSwMessage = (
      event: MessageEvent
    ) => {
      if (
        event.data &&
        event.data.type === 'OPEN_CHAT' &&
        event.data.chatId
      ) {
        handleSelectChatRef.current(
          event.data.chatId
        );
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener(
        'message',
        handleSwMessage
      );
    }

    (window as any).__aarvi_openChat =
      (chatId: string) => {
        if (chatId) {
          handleSelectChatRef.current(chatId);
        }
      };

    try {
      const params = new URLSearchParams(
        window.location.search
      );

      const targetChatId =
        params.get('chatId');

      if (targetChatId) {
        setTimeout(() => {
          handleSelectChatRef.current(
            targetChatId
          );
        }, 100);

        window.history.replaceState(
          {},
          '',
          window.location.pathname
        );
      }
    } catch {}

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener(
          'message',
          handleSwMessage
        );
      }

      delete (window as any).__aarvi_openChat;
    };
  }, []);

  /*
   * Initial authentication.
   */
  useEffect(() => {
    const token = getAuthToken();

    if (!token) {
      setIsAuthChecking(false);
      return;
    }

    apiGetMe()
      .then((res) => {
        if (
          res &&
          res.user &&
          res.user.id
        ) {
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
      .finally(() => {
        setIsAuthChecking(false);
      });
  }, []);

  /*
   * Initial chats and message history.
   */
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    subscribePushManager().catch(() => {});

    apiFetchChats()
      .then((data) => {
        const fetchedChats =
          data.chats || [];

        setChats(fetchedChats);

        fetchedChats.forEach(
          (chat: Chat) => {
            apiFetchMessages(chat.id)
              .then((mRes) => {
                if (
                  mRes &&
                  mRes.messages
                ) {
                  seedHistoricMessageIds(
                    mRes.messages.map(
                      (m: Message) => m.id
                    )
                  );

                  setMessagesMap(
                    (prev) => ({
                      ...prev,
                      [chat.id]:
                        mergeServerAndLocalMessages(
                          prev[chat.id] || [],
                          mRes.messages
                        )
                    })
                  );
                }
              })
              .catch(() => {});
          }
        );
      })
      .catch(() => {});
  }, [
    isLoggedIn,
    currentUser?.id
  ]);

  /*
   * Realtime SSE subscription.
   *
   * IMPORTANT:
   * activeChatId is intentionally NOT a dependency.
   * Switching chats must not reconnect SSE.
   */
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;

    const unsubscribe =
      subscribeRealtimeEvents(
        (event) => {
          const { type, data } = event;

          if (type === 'message:new') {
            const {
              message,
              chatId
            } = data;

            setMessagesMap((prevMap) => ({
              ...prevMap,
              [chatId]:
                mergeServerAndLocalMessages(
                  prevMap[chatId] || [],
                  [message]
                )
            }));

            setChats((prevChats) =>
              (prevChats || []).map((chat) => {
                if (chat.id !== chatId) {
                  return chat;
                }

                const isCurrentActive =
                  activeChatIdRef.current ===
                    chatId &&
                  document.hasFocus();

                return {
                  ...chat,
                  lastMessage: message,
                  isTyping: false,
                  typingUserName: undefined,

                  unreadCount:
                    isCurrentActive ||
                    message.senderId ===
                      currentUser.id
                      ? (
                          chat.unreadCount ||
                          0
                        )
                      : (
                          chat.unreadCount ||
                          0
                        ) + 1
                };
              })
            );

            /*
             * Notifications.
             */
            if (
              message.senderId !==
                currentUser.id &&
              appSettings.notifications !== false
            ) {
              playSoundEffect('receive');

              if ('vibrate' in navigator) {
                try {
                  navigator.vibrate([
                    120,
                    80,
                    120
                  ]);
                } catch {}
              }

              const currentChatList =
                chatsRef.current || [];

              const targetChat =
                currentChatList.find(
                  (c) =>
                    c.id === chatId
                );

              const otherMember =
                (
                  targetChat?.members ||
                  []
                ).find(
                  (member) =>
                    member.id ===
                    message.senderId
                );

              const senderName =
                message.senderName ||
                otherMember?.name ||
                targetChat?.name ||
                'AARVI User';

              const senderAvatar =
                message.senderAvatar ||
                otherMember?.avatar ||
                targetChat?.avatar;

              const previewText =
                message.text ||
                (
                  message.mediaType
                    ? `[${message.mediaType.toUpperCase()}]`
                    : 'Sent a message'
                );

              const isViewingCurrentChat =
                activeChatIdRef.current ===
                  chatId &&
                document.hasFocus();

              if (!isViewingCurrentChat) {
                showNativeNotification(
                  `AARVI: ${senderName}`,
                  {
                    body: previewText,
                    senderName,
                    avatarUrl:
                      senderAvatar,
                    chatId,
                    messageId:
                      message.id
                  }
                );
              } else {
                markMessageAsNotified(
                  message.id
                );
              }

              if (!isViewingCurrentChat) {
                if (
                  toastTimerRef.current
                ) {
                  clearTimeout(
                    toastTimerRef.current
                  );
                }

                setInAppToast({
                  id: message.id,
                  chatId,
                  senderName,
                  text: previewText,
                  avatar:
                    senderAvatar
                });

                toastTimerRef.current =
                  setTimeout(() => {
                    setInAppToast(null);
                  }, 4500);
              }
            }
          }

          else if (
            type === 'message:read'
          ) {
            const {
              chatId,
              readMessageIds
            } = data;

            setMessagesMap(
              (prevMap) => ({
                ...prevMap,

                [chatId]:
                  (
                    prevMap[
                      chatId
                    ] || []
                  ).map((m) =>
                    (
                      !readMessageIds ||
                      readMessageIds.length ===
                        0 ||
                      readMessageIds.includes(
                        m.id
                      )
                    )
                      ? {
                          ...m,
                          status:
                            'read'
                        }
                      : m
                  )
              })
            );
          }

          else if (
            type ===
            'message:delivered'
          ) {
            const {
              chatId,
              deliveredMessageIds
            } = data;

            setMessagesMap(
              (prevMap) => ({
                ...prevMap,

                [chatId]:
                  (
                    prevMap[
                      chatId
                    ] || []
                  ).map((m) =>
                    (
                      !deliveredMessageIds ||
                      deliveredMessageIds.includes(
                        m.id
                      )
                    )
                      ? {
                          ...m,
                          status:
                            m.status === 'read'
                              ? 'read'
                              : 'delivered'
                        }
                      : m
                  )
              })
            );
          }

          else if (
            type === 'message:edit'
          ) {
            const {
              chatId,
              messageId,
              text
            } = data;

            setMessagesMap(
              (prevMap) => ({
                ...prevMap,

                [chatId]:
                  (
                    prevMap[
                      chatId
                    ] || []
                  ).map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          text,
                          isEdited: true
                        }
                      : m
                  )
              })
            );
          }

          else if (
            type === 'message:delete'
          ) {
            const {
              chatId,
              messageId
            } = data;

            setMessagesMap(
              (prevMap) => ({
                ...prevMap,

                [chatId]:
                  (
                    prevMap[
                      chatId
                    ] || []
                  ).filter(
                    (m) =>
                      m.id !==
                      messageId
                  )
              })
            );
          }

          else if (
            type === 'message:react'
          ) {
            const {
              chatId,
              messageId,
              reactions
            } = data;

            setMessagesMap(
              (prevMap) => ({
                ...prevMap,

                [chatId]:
                  (
                    prevMap[
                      chatId
                    ] || []
                  ).map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          reactions
                        }
                      : m
                  )
              })
            );
          }

          else if (
            type ===
            'chat:pin_message'
          ) {
            const {
              chatId,
              pinnedMessageId
            } = data;

            setChats((prev) =>
              (
                prev || []
              ).map((chat) =>
                chat.id === chatId
                  ? {
                      ...chat,
                      pinnedMessageId
                    }
                  : chat
              )
            );
          }

          /*
           * Typing indicator.
           */
          else if (
            type ===
              'typing:change' ||
            type ===
              'typing:start' ||
            type ===
              'typing:stop'
          ) {
            const {
              chatId,
              userId,
              userName,
              isTyping
            } = data;

            const isTypingActive =
              type === 'typing:stop'
                ? false
                : Boolean(isTyping);

            if (
              userId !==
              currentUser.id
            ) {
              setChats((prev) =>
                (
                  prev || []
                ).map((chat) =>
                  chat.id ===
                  chatId
                    ? {
                        ...chat,
                        isTyping:
                          isTypingActive,
                        typingUserName:
                          isTypingActive
                            ? (
                                userName ||
                                'Someone'
                              )
                            : undefined
                      }
                    : chat
                )
              );

              if (
                typingTimeoutRefs
                  .current[
                    chatId
                  ]
              ) {
                clearTimeout(
                  typingTimeoutRefs
                    .current[
                      chatId
                    ]
                );
              }

              if (
                isTypingActive
              ) {
                typingTimeoutRefs
                  .current[
                    chatId
                  ] =
                  setTimeout(
                    () => {
                      setChats(
                        (prev) =>
                          (
                            prev ||
                            []
                          ).map(
                            (
                              chat
                            ) =>
                              chat.id ===
                                chatId &&
                              chat.isTyping
                                ? {
                                    ...chat,
                                    isTyping: false,
                                    typingUserName:
                                      undefined
                                  }
                                : chat
                          )
                      );
                    },
                    4000
                  );
              }
            }
          }

          /*
           * New chat.
           */
          else if (
            type === 'chat:new'
          ) {
            const { chat } = data;

            setChats((prev) => {
              if (
                (
                  prev || []
                ).some(
                  (c) =>
                    c.id ===
                    chat.id
                )
              ) {
                return prev;
              }

              return [
                chat,
                ...(prev || [])
              ];
            });
          }

          /*
           * Online/offline/last seen presence.
           *
           * This remains enabled.
           */
          else if (
            type ===
              'presence:change' ||
            type ===
              'presence:update'
          ) {
            const {
              userId,
              status,
              lastSeen
            } = data;

            setChats((prev) =>
              (
                prev || []
              ).map((chat) => {
                const isMember =
                  (
                    chat.memberIds ||
                    []
                  ).includes(
                    userId
                  ) ||
                  (
                    chat.members ||
                    []
                  ).some(
                    (member) =>
                      member.id ===
                      userId
                  );

                if (!isMember) {
                  return chat;
                }

                const newMembers =
                  (
                    chat.members ||
                    []
                  ).map(
                    (member) =>
                      member.id ===
                      userId
                        ? {
                            ...member,
                            status,
                            lastSeen
                          }
                        : member
                  );

                return {
                  ...chat,
                  members:
                    newMembers
                };
              })
            );
          }
        },

        /*
         * Connection status callback.
         */
        (status) => {
          setConnectionStatus(
            status
          );

          if (
            status ===
            'connected'
          ) {
            apiSendPresence(
              'online'
            ).catch(() => {});

            if (isSyncingRef.current) {
              return;
            }
            isSyncingRef.current = true;

            apiSync(
              lastSyncTimestampRef.current
            )
              .then(
                (syncRes) => {
                  if (!syncRes) {
                    return;
                  }

                  if (
                    syncRes.chats
                  ) {
                    setChats(
                      (
                        prevChats
                      ) => {
                        const typingMap =
                          new Map(
                            (
                              prevChats ||
                              []
                            ).map(
                              (
                                chat
                              ) => [
                                chat.id,
                                chat.isTyping
                              ]
                            )
                          );

                        const updated =
                          syncRes.chats.map(
                            (
                              chat: Chat
                            ) => ({
                              ...chat,
                              isTyping:
                                typingMap.get(
                                  chat.id
                                ) ||
                                false
                            })
                          );

                        // Partial sync: server only sent chats that
                        // actually changed — merge them into the
                        // existing list instead of replacing it.
                        if (syncRes.isPartial) {
                          const updatedMap =
                            new Map(
                              updated.map(
                                (c: Chat) => [c.id, c]
                              )
                            );
                          return (prevChats || []).map(
                            (c) => updatedMap.get(c.id) || c
                          );
                        }

                        return updated;
                      }
                    );
                  }

                  if (
                    syncRes.timestamp
                  ) {
                    lastSyncTimestampRef.current =
                      syncRes.timestamp;
                  }
                }
              )
              .catch(() => {})
              .finally(() => {
                isSyncingRef.current = false;
              });
          }
        }
      );

    return () => {
      unsubscribe();
    };

  }, [
    isLoggedIn,
    currentUser?.id
  ]);

  /*
   * Background fallback sync.
   *
   * SSE handles realtime.
   * This runs every 30 seconds only as recovery.
   */
  useEffect(() => {
    if (!isLoggedIn || !currentUser) {
      return;
    }

    const pollSync =
      async () => {
        if (isSyncingRef.current) {
          return;
        }
        isSyncingRef.current = true;
        try {
          const syncRes =
            await apiSync(
              lastSyncTimestampRef.current
            );

          if (!syncRes) {
            return;
          }

          if (
            syncRes.chats
          ) {
            setChats(
              (
                prevChats
              ) => {
                const typingMap =
                  new Map(
                    (
                      prevChats ||
                      []
                    ).map(
                      (
                        chat
                      ) => [
                        chat.id,
                        chat.isTyping
                      ]
                    )
                  );

                const updated =
                  syncRes.chats.map(
                    (
                      chat: Chat
                    ) => ({
                      ...chat,
                      isTyping:
                        typingMap.get(
                          chat.id
                        ) ||
                        false
                    })
                  );

                // Partial sync: server only sent chats that
                // actually changed — merge into existing list.
                if (syncRes.isPartial) {
                  const updatedMap =
                    new Map(
                      updated.map(
                        (c: Chat) => [c.id, c]
                      )
                    );
                  return (prevChats || []).map(
                    (c) => updatedMap.get(c.id) || c
                  );
                }

                return updated;
              }
            );
          }

          if (
            syncRes.messagesMap
          ) {
            for (
              const [
                cId,
                msgs
              ] of Object.entries(
                syncRes.messagesMap
              )
            ) {
              const incomingMsgs =
                msgs as Message[];

              for (
                const msg of
                  incomingMsgs
              ) {
                if (
                  msg.senderId !==
                    currentUser.id &&
                  !isMessageNotified(
                    msg.id
                  )
                ) {
                  markMessageAsNotified(
                    msg.id
                  );

                  const msgTime =
                    new Date(
                      msg.isoDate ||
                      msg.timestamp
                    ).getTime();

                  if (
                    msgTime >=
                    sessionStartTimeRef.current -
                      10000
                  ) {
                    const isViewingCurrentChat =
                      activeChatIdRef.current ===
                        cId &&
                      document.hasFocus();

                    if (
                      !isViewingCurrentChat &&
                      appSettings.notifications !==
                        false
                    ) {
                      const targetChat =
                        (
                          chatsRef.current ||
                          []
                        ).find(
                          (
                            chat
                          ) =>
                            chat.id ===
                            cId
                        );

                      const otherMember =
                        (
                          targetChat?.members ||
                          []
                        ).find(
                          (
                            member
                          ) =>
                            member.id ===
                            msg.senderId
                        );

                      const senderName =
                        msg.senderName ||
                        otherMember?.name ||
                        targetChat?.name ||
                        'AARVI User';

                      const senderAvatar =
                        msg.senderAvatar ||
                        otherMember?.avatar ||
                        targetChat?.avatar;

                      const previewText =
                        msg.text ||
                        (
                          msg.mediaType
                            ? `[${msg.mediaType.toUpperCase()}]`
                            : 'Sent a message'
                        );

                      showNativeNotification(
                        `AARVI: ${senderName}`,
                        {
                          body:
                            previewText,
                          senderName,
                          avatarUrl:
                            senderAvatar,
                          chatId:
                            cId,
                          messageId:
                            msg.id
                        }
                      );
                    }
                  }
                }
              }
            }

            setMessagesMap(
              (
                prevMap
              ) => {
                const nextMap = {
                  ...prevMap
                };

                let updated =
                  false;

                for (
                  const [
                    cId,
                    msgs
                  ] of Object.entries(
                    syncRes.messagesMap
                  )
                ) {
                  const merged =
                    mergeServerAndLocalMessages(
                      prevMap[cId] ||
                        [],
                      msgs as Message[]
                    );

                  nextMap[cId] =
                    merged;

                  updated = true;
                }

                return updated
                  ? nextMap
                  : prevMap;
              }
            );
          }

          if (
            syncRes.timestamp
          ) {
            lastSyncTimestampRef.current =
              syncRes.timestamp;
          }

        } catch {
        } finally {
          isSyncingRef.current = false;
        }
      };

    /*
     * Initial recovery sync.
     */
    pollSync();

    /*
     * Reduced database polling.
     */
    const syncInterval =
      setInterval(
        pollSync,
        30000
      );

    const handleVisibilityChange =
      () => {
        if (
          document.visibilityState ===
          'visible'
        ) {
          pollSync();
        }
      };

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    );

    window.addEventListener(
      'focus',
      handleVisibilityChange
    );

    return () => {
      clearInterval(
        syncInterval
      );

      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      );

      window.removeEventListener(
        'focus',
        handleVisibilityChange
      );
    };

  }, [
    isLoggedIn,
    currentUser?.id
  ]);

  /*
   * Presence heartbeat.
   *
   * Online/offline system remains active.
   */
  useEffect(() => {
    if (!isLoggedIn || !currentUser) {
      return;
    }

    apiSendPresence(
      'online'
    ).catch(() => {});

    const interval =
      setInterval(
        () => {
          apiSendPresence(
            'online'
          ).catch(() => {});
        },
        45000
      );

    const handleBeforeUnload =
      () => {
        try {
          const blob =
            new Blob(
              [
                JSON.stringify({
                  status:
                    'offline'
                })
              ],
              {
                type:
                  'application/json'
              }
            );

          navigator.sendBeacon(
            '/api/presence',
            blob
          );
        } catch {}
      };

    window.addEventListener(
      'beforeunload',
      handleBeforeUnload
    );

    window.addEventListener(
      'pagehide',
      handleBeforeUnload
    );

    return () => {
      clearInterval(
        interval
      );

      window.removeEventListener(
        'beforeunload',
        handleBeforeUnload
      );

      window.removeEventListener(
        'pagehide',
        handleBeforeUnload
      );
    };

  }, [
    isLoggedIn,
    currentUser?.id
  ]);

  /*
   * App settings.
   */
  const [
    appSettings,
    setAppSettings
  ] = useState<AppSettings>(
    () => {
      try {
        const saved =
          localStorage.getItem(
            'aarvi_app_settings'
          );

        if (saved) {
          return JSON.parse(
            saved
          );
        }
      } catch {}

      return {
        theme:
          'dark',
        wallpaper:
          'default',
        fontSize:
          'medium',
        notifications:
          true
      };
    }
  );

  const handleUpdateSettings =
    (
      newSet:
        Partial<AppSettings>
    ) => {
      setAppSettings(
        (prev) => {
          const updated = {
            ...prev,
            ...newSet
          };

          localStorage.setItem(
            'aarvi_app_settings',
            JSON.stringify(
              updated
            )
          );

          return updated;
        }
      );
    };

  /*
   * Chat selection.
   */
  const handleSelectChat =
    (
      chatId: string
    ) => {
      setActiveChatId(
        chatId
      );

      if (
        window.history.state
          ?.chatId !==
        chatId
      ) {
        window.history.pushState(
          {
            chatOpen:
              true,
            chatId
          },
          ''
        );
      }

      setChats((prev) =>
        (
          prev || []
        ).map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                unreadCount:
                  0
              }
            : chat
        )
      );

      apiFetchMessages(
        chatId
      )
        .then(
          (
            mRes
          ) => {
            if (
              mRes &&
              mRes.messages
            ) {
              setMessagesMap(
                (prev) => ({
                  ...prev,
                  [chatId]:
                    mergeServerAndLocalMessages(
                      prev[
                        chatId
                      ] || [],
                      mRes.messages
                    )
                })
              );
            }
          }
        )
        .catch(() => {});
    };

  useEffect(() => {
    handleSelectChatRef.current =
      handleSelectChat;
  });

  useEffect(() => {
    const handlePopState =
      () => {
        if (
          activeChatId
        ) {
          setActiveChatId(
            null
          );
        }
      };

    window.addEventListener(
      'popstate',
      handlePopState
    );

    return () => {
      window.removeEventListener(
        'popstate',
        handlePopState
      );
    };
  }, [
    activeChatId
  ]);

  /*
   * Send message.
   */
  const handleSendMessage =
    async (
      text: string,
      mediaType?:
        | 'image'
        | 'voice'
        | 'file'
        | 'location',
      mediaUrl?: string,
      replyTo?: {
        id: string;
        text: string;
      }
    ) => {
      if (
        !activeChatId ||
        !currentUser
      ) {
        return;
      }

      const targetChatId =
        activeChatId;

      const clientMsgId =
        `cmsg-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 8)}`;

      const nowIso =
        new Date()
          .toISOString();

      const optimisticMsg:
        Message = {
          id:
            clientMsgId,
          clientMsgId,
          chatId:
            targetChatId,
          senderId:
            currentUser.id,
          senderName:
            currentUser.name,
          text,
          timestamp:
            nowIso,
          isoDate:
            nowIso,
          status:
            'sending',
          mediaType,
          mediaUrl,
          replyToText:
            replyTo?.text,
          isEncrypted:
            true
        };

      setMessagesMap(
        (prevMap) => ({
          ...prevMap,
          [targetChatId]:
            mergeServerAndLocalMessages(
              prevMap[
                targetChatId
              ] || [],
              [
                optimisticMsg
              ]
            )
        })
      );

      setChats((prev) =>
        (
          prev || []
        ).map((chat) =>
          chat.id ===
          targetChatId
            ? {
                ...chat,
                lastMessage:
                  optimisticMsg
              }
            : chat
        )
      );

      try {
        const ackRes =
          await apiSendMessage(
            targetChatId,
            text,
            mediaType,
            mediaUrl,
            replyTo?.id,
            replyTo?.text,
            clientMsgId
          );

        if (
          ackRes &&
          ackRes.message
        ) {
          const confirmedMsg =
            ackRes.message;

          setMessagesMap(
            (prevMap) => ({
              ...prevMap,
              [targetChatId]:
                mergeServerAndLocalMessages(
                  prevMap[
                    targetChatId
                  ] || [],
                  [
                    confirmedMsg
                  ]
                )
            })
          );

          setChats((prev) =>
            (
              prev || []
            ).map((chat) =>
              chat.id ===
              targetChatId
                ? {
                    ...chat,
                    lastMessage:
                      confirmedMsg
                  }
                : chat
            )
          );
        }

      } catch (err) {
        console.error(
          'Failed to deliver message:',
          err
        );
      }
    };

  /*
   * Message edit.
   */
  const handleEditMessage =
    async (
      messageId: string,
      text: string
    ) => {
      if (
        !activeChatId
      ) return;

      setMessagesMap(
        (prev) => ({
          ...prev,
          [activeChatId]:
            (
              prev[
                activeChatId
              ] || []
            ).map((m) =>
              m.id ===
              messageId
                ? {
                    ...m,
                    text,
                    isEdited:
                      true
                  }
                : m
            )
        })
      );

      try {
        await apiEditMessage(
          messageId,
          text
        );
      } catch (
        err
      ) {
        console.error(
          'Edit message failed:',
          err
        );
      }
    };

  /*
   * Delete message.
   */
  const handleDeleteMessage =
    async (
      messageId: string,
      deleteForEveryone: boolean
    ) => {
      if (
        !activeChatId
      ) return;

      setMessagesMap(
        (prev) => ({
          ...prev,
          [activeChatId]:
            (
              prev[
                activeChatId
              ] || []
            ).filter(
              (m) =>
                m.id !==
                messageId
            )
        })
      );

      try {
        await apiDeleteMessage(
          messageId,
          deleteForEveryone
        );
      } catch (
        err
      ) {
        console.error(
          'Delete message failed:',
          err
        );
      }
    };

  /*
   * React to message.
   */
  const handleReactMessage =
    async (
      messageId: string,
      emoji: string
    ) => {
      if (
        !activeChatId ||
        !currentUser
      ) {
        return;
      }

      setMessagesMap(
        (prev) => {
          const msgs =
            prev[
              activeChatId
            ] || [];

          return {
            ...prev,
            [activeChatId]:
              msgs.map(
                (message) => {
                  if (
                    message.id !==
                    messageId
                  ) {
                    return message;
                  }

                  const reactions =
                    message.reactions ||
                    [];

                  const existing =
                    reactions.find(
                      (r) =>
                        r.emoji ===
                        emoji
                    );

                  let updatedReactions;

                  if (
                    existing
                  ) {
                    const hasUser =
                      existing.users.includes(
                        currentUser.id
                      );

                    if (
                      hasUser
                    ) {
                      const newUsers =
                        existing.users.filter(
                          (userId) =>
                            userId !==
                            currentUser.id
                        );

                      updatedReactions =
                        reactions
                          .map(
                            (
                              reaction
                            ) =>
                              reaction.emoji ===
                              emoji
                                ? {
                                    ...reaction,
                                    count:
                                      newUsers.length,
                                    users:
                                      newUsers
                                  }
                                : reaction
                          )
                          .filter(
                            (
                              reaction
                            ) =>
                              reaction.count >
                              0
                          );
                    } else {
                      const newUsers =
                        [
                          ...existing.users,
                          currentUser.id
                        ];

                      updatedReactions =
                        reactions.map(
                          (
                            reaction
                          ) =>
                            reaction.emoji ===
                            emoji
                              ? {
                                  ...reaction,
                                  count:
                                    newUsers.length,
                                  users:
                                    newUsers
                                }
                              : reaction
                        );
                    }
                  } else {
                    updatedReactions =
                      [
                        ...reactions,
                        {
                          emoji,
                          count:
                            1,
                          users:
                            [
                              currentUser.id
                            ]
                        }
                      ];
                  }

                  return {
                    ...message,
                    reactions:
                      updatedReactions
                  };
                }
              )
          };
        }
      );

      try {
        await apiReactToMessage(
          messageId,
          emoji
        );
      } catch (
        err
      ) {
        console.error(
          'React message failed:',
          err
        );
      }
    };

  /*
   * Pin message.
   */
  const handlePinMessage =
    async (
      chatId: string,
      messageId:
        | string
        | null
    ) => {
      setChats((prev) =>
        (
          prev || []
        ).map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                pinnedMessageId:
                  messageId ||
                  undefined
              }
            : chat
        )
      );

      try {
        await apiPinMessage(
          chatId,
          messageId
        );
      } catch (
        err
      ) {
        console.error(
          'Pin message failed:',
          err
        );
      }
    };

  /*
   * Forward message.
   */
  const handleForwardMessage =
    async (
      targetChatId: string,
      message: Message
    ) => {
      const text =
        `[Forwarded from ${message.senderName}]: ${message.text}`;

      const fwdIso =
        new Date()
          .toISOString();

      await apiSendMessage(
        targetChatId,
        text,
        message.mediaType,
        message.mediaUrl
      );

      setMessagesMap(
        (prev) => {
          const targetMsgs =
            prev[
              targetChatId
            ] || [];

          const fwdMsg:
            Message = {
              id:
                `fwd-${Date.now()}`,
              chatId:
                targetChatId,
              senderId:
                currentUser!.id,
              senderName:
                currentUser!.name,
              text,
              timestamp:
                fwdIso,
              isoDate:
                fwdIso,
              status:
                'sent',
              mediaType:
                message.mediaType,
              mediaUrl:
                message.mediaUrl,
              isEncrypted:
                true
            };

          return {
            ...prev,
            [targetChatId]:
              [
                ...targetMsgs,
                fwdMsg
              ]
          };
        }
      );
    };

  /*
   * New chat.
   */
  const handleChatCreated =
    (
      newChat: Chat
    ) => {
      setChats((prev) => {
        if (
          (
            prev || []
          ).some(
            (chat) =>
              chat.id ===
              newChat.id
          )
        ) {
          return prev;
        }

        return [
          newChat,
          ...(prev || [])
        ];
      });

      setActiveChatId(
        newChat.id
      );
    };

  const handleSetSelfDestructTimer =
    (
      chatId: string,
      seconds: number
    ) => {
      setChats((prev) =>
        (
          prev || []
        ).map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                selfDestructTimer:
                  seconds
              }
            : chat
        )
      );
    };

  /*
   * Logout.
   */
  const handleLogout =
    () => {
      clearAuthToken();

      try {
        localStorage.removeItem(
          'aarvi_messages_cache'
        );
      } catch {}

      setIsLoggedIn(
        false
      );

      setCurrentUser(
        null
      );

      setChats([]);

      setMessagesMap({});

      setActiveChatId(
        null
      );
    };

  const unreadTotal =
    (chats || []).reduce(
      (
        total,
        chat
      ) =>
        total +
        (
          chat?.unreadCount ||
          0
        ),
      0
    );

  const activeChat =
    (
      chats || []
    ).find(
      (chat) =>
        chat.id ===
        activeChatId
    ) || null;

  const activeMessages =
    activeChatId
      ? (
          messagesMap[
            activeChatId
          ] || []
        )
      : [];

  if (
    isAuthChecking
  ) {
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

  if (
    !isLoggedIn ||
    !currentUser
  ) {
    return (
      <LoginScreen
        onLoginSuccess={
          (user) => {
            setCurrentUser(
              user
            );

            setIsLoggedIn(
              true
            );
          }
        }
      />
    );
  }

  return (
    <div className="h-[100dvh] w-full max-w-full overflow-hidden bg-slate-950 flex flex-col font-sans antialiased selection:bg-emerald-500 selection:text-slate-950">

      {connectionStatus !==
        'connected' && (
        <div className="bg-amber-950/80 border-b border-amber-900 text-amber-200 text-[11px] font-medium px-4 py-1 text-center flex items-center justify-center gap-2 z-50">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />

          <span>
            Realtime Connection Re-establishing...
          </span>
        </div>
      )}

      {inAppToast && (
        <div
          onClick={() => {
            handleSelectChat(
              inAppToast.chatId
            );

            setInAppToast(
              null
            );
          }}
          className="fixed top-4 right-4 z-[100] bg-slate-900/95 border border-emerald-500/50 text-white rounded-2xl p-3.5 shadow-2xl flex items-center space-x-3.5 max-w-sm w-[92vw] sm:w-auto cursor-pointer animate-in fade-in slide-in-from-top-4 duration-300 hover:border-emerald-400 transition-all backdrop-blur-md"
        >
          <div className="relative flex-shrink-0">
            <img
              src={getDisplayAvatar(
                inAppToast.senderName,
                inAppToast.avatar,
                inAppToast.chatId
              )}
              alt={
                inAppToast.senderName
              }
              className="w-11 h-11 rounded-full object-cover border border-emerald-500/40 bg-slate-800"
            />

            <span className="absolute -top-1 -right-1 bg-emerald-500 text-slate-950 p-1 rounded-full shadow-md">
              <Bell className="w-3 h-3" />
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-xs font-bold text-emerald-400 truncate">
                {
                  inAppToast.senderName
                }
              </h5>

              <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                New Message
              </span>
            </div>

            <p className="text-xs text-slate-200 truncate mt-0.5">
              {
                inAppToast.text
              }
            </p>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();

              setInAppToast(
                null
              );
            }}
            className="p-1 text-slate-400 hover:text-white rounded-lg flex-shrink-0 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">

        <div
          className={`w-full md:w-80 lg:w-96 flex-shrink-0 h-full ${
            activeChatId
              ? 'hidden md:flex'
              : 'flex'
          }`}
        >
          <SidebarChatList
            chats={chats}
            activeChatId={
              activeChatId
            }
            onSelectChat={
              handleSelectChat
            }
            currentUser={
              currentUser
            }
            onOpenNewChatModal={() =>
              setShowNewChatModal(
                true
              )
            }
            onOpenSettingsModal={() =>
              setShowSettingsModal(
                true
              )
            }
            onLockApp={
              handleLogout
            }
            unreadTotal={
              unreadTotal
            }
          />
        </div>

        <div
          className={`flex-1 h-full flex flex-col ${
            !activeChatId
              ? 'hidden md:flex'
              : 'flex'
          }`}
        >
          {activeChat ? (
            <ChatWindow
              chat={
                activeChat
              }
              messages={
                activeMessages
              }
              onSendMessage={
                handleSendMessage
              }
              currentUser={
                currentUser
              }
              onOpenImagePreview={
                (url) =>
                  setLightboxImage(
                    url
                  )
              }
              onSetSelfDestructTimer={
                handleSetSelfDestructTimer
              }
              onBackToChatList={() =>
                setActiveChatId(
                  null
                )
              }
              onEditMessage={
                handleEditMessage
              }
              onDeleteMessage={
                handleDeleteMessage
              }
              onReactMessage={
                handleReactMessage
              }
              onPinMessage={
                handlePinMessage
              }
              allChats={
                chats
              }
              onForwardMessage={
                handleForwardMessage
              }
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-500 space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400">
                🔒
              </div>

              <h3 className="text-lg font-bold text-white">
                AARVI Production Messenger
              </h3>

              <p className="text-xs max-w-sm">
                Select a conversation or click{' '}
                <span className="text-emerald-400 font-bold">
                  +
                </span>{' '}
                to start an end-to-end encrypted chat with any registered user.
              </p>
            </div>
          )}
        </div>
      </div>

      <NewChatModal
        isOpen={
          showNewChatModal
        }
        onClose={() =>
          setShowNewChatModal(
            false
          )
        }
        onChatCreated={
          handleChatCreated
        }
        currentUserId={
          currentUser.id
        }
      />

      <SecuritySettingsModal
        isOpen={
          showSettingsModal
        }
        onClose={() =>
          setShowSettingsModal(
            false
          )
        }
        currentUser={
          currentUser
        }
        onClearStorage={
          handleLogout
        }
        onLogout={
          handleLogout
        }
        settings={
          appSettings
        }
        onUpdateSettings={
          handleUpdateSettings
        }
      />

      <ImageLightboxModal
        imageUrl={
          lightboxImage
        }
        onClose={() =>
          setLightboxImage(
            null
          )
        }
      />
    </div>
  );
}
