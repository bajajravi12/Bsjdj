// Production API & Realtime SSE Client for AARVI

const API_BASE = '/api';

export const getAuthToken = (): string | null => {
  return localStorage.getItem('aarvi_jwt_token');
};

export const setAuthToken = (token: string) => {
  localStorage.setItem('aarvi_jwt_token', token);
};

export const clearAuthToken = () => {
  localStorage.removeItem('aarvi_jwt_token');
};

// Helper to safely parse JSON responses
const parseResponseJson = async (res: Response) => {
  const text = await res.text();

  if (!text || !text.trim()) {
    if (!res.ok) {
      throw new Error(`Server error (${res.status})`);
    }

    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new Error(
        `Server error (${res.status}): ${text.substring(0, 120)}`
      );
    }

    throw new Error('Invalid JSON response received from server');
  }
};

// ======================================================
// AUTH API
// ======================================================

export const apiRegister = async (
  name: string,
  username: string,
  pin: string
) => {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      username,
      pin,
    }),
  });

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Registration failed');
  }

  if (data.token) {
    setAuthToken(data.token);
  }

  return data;
};

export const apiLogin = async (
  username: string,
  pin: string
) => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      pin,
    }),
  });

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Login failed');
  }

  if (data.token) {
    setAuthToken(data.token);
  }

  return data;
};

export const apiGetMe = async () => {
  const token = getAuthToken();

  if (!token) {
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    return await parseResponseJson(res);
  } catch {
    return null;
  }
};

// ======================================================
// USERS SEARCH API
// ======================================================

export const apiSearchUsers = async (
  query: string
) => {
  const token = getAuthToken();

  if (!token) {
    return {
      users: [],
    };
  }

  try {
    const res = await fetch(
      `${API_BASE}/users/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      return {
        users: [],
      };
    }

    return await parseResponseJson(res);
  } catch {
    return {
      users: [],
    };
  }
};

// ======================================================
// CHATS API
// ======================================================

export const apiFetchChats = async () => {
  const token = getAuthToken();

  if (!token) {
    return {
      chats: [],
    };
  }

  try {
    const res = await fetch(`${API_BASE}/chats`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        chats: [],
      };
    }

    return await parseResponseJson(res);
  } catch {
    return {
      chats: [],
    };
  }
};

export const apiCreateChat = async (params: {
  recipientUserId?: string;
  name?: string;
  isGroup?: boolean;
  isSecret?: boolean;
  selfDestructTimer?: number;
}) => {
  const token = getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(`${API_BASE}/chats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Failed to create chat');
  }

  return data;
};

// ======================================================
// MESSAGES API
// ======================================================

export const apiFetchMessages = async (
  chatId: string
) => {
  const token = getAuthToken();

  if (!token) {
    return {
      messages: [],
    };
  }

  try {
    const res = await fetch(
      `${API_BASE}/chats/${encodeURIComponent(chatId)}/messages`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      return {
        messages: [],
      };
    }

    return await parseResponseJson(res);
  } catch {
    return {
      messages: [],
    };
  }
};

// ======================================================
// GUARANTEED MESSAGE DELIVERY
// ======================================================

export const apiSendMessage = async (
  chatId: string,
  text: string,
  mediaType?: string,
  mediaUrl?: string,
  replyToId?: string,
  replyToText?: string,
  clientMsgId?: string
) => {
  const token = getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  // IMPORTANT:
  // Create payload ONCE.
  // Same clientMsgId must be reused on retry.
  // This allows backend to deduplicate retries.
  const payload = {
    chatId,
    text,
    mediaType,
    mediaUrl,
    replyToId,
    replyToText,
    clientMsgId:
      clientMsgId ||
      `cmsg-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
    isoDate: new Date().toISOString(),
  };

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const data = await parseResponseJson(res);

      if (res.ok) {
        return data;
      }

      // Don't retry auth/client validation errors
      if (res.status >= 400 && res.status < 500) {
        throw new Error(
          data?.error ||
            `Message delivery failed (${res.status})`
        );
      }

      lastError = new Error(
        data?.error ||
          `Message delivery failed (${res.status})`
      );
    } catch (err) {
      lastError = err;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, 600 * attempt)
      );
    }
  }

  throw (
    lastError ||
    new Error('Message delivery failed after retries')
  );
};

// ======================================================
// MESSAGE FEATURES
// ======================================================

export const apiEditMessage = async (
  messageId: string,
  text: string
) => {
  const token = getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(
    `${API_BASE}/messages/${encodeURIComponent(messageId)}/edit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
    }
  );

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Failed to edit message');
  }

  return data;
};

export const apiDeleteMessage = async (
  messageId: string,
  deleteForEveryone: boolean
) => {
  const token = getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(
    `${API_BASE}/messages/${encodeURIComponent(messageId)}/delete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        deleteForEveryone,
      }),
    }
  );

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete message');
  }

  return data;
};

export const apiReactToMessage = async (
  messageId: string,
  emoji: string
) => {
  const token = getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(
    `${API_BASE}/messages/${encodeURIComponent(messageId)}/react`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        emoji,
      }),
    }
  );

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Failed to react to message');
  }

  return data;
};

export const apiPinMessage = async (
  chatId: string,
  messageId: string | null
) => {
  const token = getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(
    `${API_BASE}/chats/${encodeURIComponent(chatId)}/pin-message`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messageId,
      }),
    }
  );

  const data = await parseResponseJson(res);

  if (!res.ok) {
    throw new Error(data.error || 'Failed to pin message');
  }

  return data;
};

// ======================================================
// READ RECEIPTS
// ======================================================

export const apiMarkRead = async (
  chatId: string
) => {
  const token = getAuthToken();

  if (!token) {
    return;
  }

  try {
    await fetch(
      `${API_BASE}/chats/${encodeURIComponent(chatId)}/read`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        keepalive: true,
      }
    );
  } catch {
    // non-critical
  }
};

// ======================================================
// TYPING STATUS
// ======================================================

export const apiSetTyping = async (
  chatId: string,
  isTyping: boolean
) => {
  const token = getAuthToken();

  if (!token) {
    return;
  }

  try {
    await fetch(
      `${API_BASE}/chats/${encodeURIComponent(chatId)}/typing`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isTyping,
        }),
        keepalive: true,
      }
    );
  } catch {
    // Typing is non-critical
  }
};

// ======================================================
// PRESENCE
// ======================================================

export const apiSendPresence = async (
  status: 'online' | 'offline' | 'away'
) => {
  const token = getAuthToken();

  if (!token) {
    return;
  }

  try {
    await fetch(`${API_BASE}/presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        status,
      }),
      keepalive: true,
      cache: 'no-store',
    });
  } catch {
    // Presence is best-effort
  }
};

export const apiFetchPresence = async (
  userIds?: string[]
) => {
  const token = getAuthToken();

  if (!token) {
    return {
      presence: [],
    };
  }

  try {
    const url =
      userIds && userIds.length > 0
        ? `${API_BASE}/presence?userIds=${encodeURIComponent(
            userIds.join(',')
          )}`
        : `${API_BASE}/presence`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        presence: [],
      };
    }

    return await parseResponseJson(res);
  } catch {
    return {
      presence: [],
    };
  }
};

// ======================================================
// FULL SYNC
// ======================================================

export const apiSync = async (
  since?: string
) => {
  const token = getAuthToken();

  if (!token) {
    return null;
  }

  try {
    const url = since
      ? `${API_BASE}/sync?since=${encodeURIComponent(since)}`
      : `${API_BASE}/sync`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    return await parseResponseJson(res);
  } catch {
    return null;
  }
};

// ======================================================
// REALTIME SSE
// ======================================================

// Each subscription gets its own EventSource.
// This avoids one React component cleanup closing another
// active realtime connection.

export const subscribeRealtimeEvents = (
  onEvent: (event: {
    type: string;
    data: any;
  }) => void,

  onStatusChange: (
    status:
      | 'connected'
      | 'reconnecting'
      | 'offline'
  ) => void
) => {
  let eventSource: EventSource | null = null;

  let reconnectTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  let manuallyClosed = false;

  let reconnectAttempts = 0;

  const closeCurrentConnection = () => {
    if (eventSource) {
      eventSource.onopen = null;
      eventSource.onmessage = null;
      eventSource.onerror = null;

      eventSource.close();

      eventSource = null;
    }
  };

  const scheduleReconnect = () => {
    if (manuallyClosed) {
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    reconnectAttempts += 1;

    // Controlled exponential reconnect
    const delay = Math.min(
      1000 * Math.pow(1.5, reconnectAttempts - 1),
      8000
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;

      if (
        !manuallyClosed &&
        getAuthToken()
      ) {
        connect();
      }
    }, delay);
  };

  const connect = () => {
    if (manuallyClosed) {
      return;
    }

    const token = getAuthToken();

    if (!token) {
      onStatusChange('offline');
      return;
    }

    closeCurrentConnection();

    onStatusChange('reconnecting');

    try {
      const sseUrl =
        `${API_BASE}/realtime/stream?token=` +
        encodeURIComponent(token);

      eventSource = new EventSource(sseUrl);

      eventSource.onopen = () => {
        reconnectAttempts = 0;
        onStatusChange('connected');
      };

      eventSource.onmessage = (
        event: MessageEvent
      ) => {
        try {
          const payload = JSON.parse(event.data);

          if (
            payload &&
            payload.type === 'connected'
          ) {
            reconnectAttempts = 0;
            onStatusChange('connected');
            return;
          }

          if (
            payload &&
            payload.type
          ) {
            onEvent(payload);
          }
        } catch (err) {
          console.warn(
            'SSE Parse error:',
            err
          );
        }
      };

      eventSource.onerror = () => {
        if (manuallyClosed) {
          return;
        }

        onStatusChange('reconnecting');

        closeCurrentConnection();

        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
  };

  connect();

  return () => {
    manuallyClosed = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    closeCurrentConnection();

    onStatusChange('offline');
  };
};
