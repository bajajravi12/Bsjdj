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

// Helper to safely parse JSON responses without throwing "Unexpected end of JSON input"
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
      throw new Error(`Server error (${res.status}): ${text.substring(0, 80)}`);
    }
    throw new Error('Invalid JSON response received from server');
  }
};

// --- AUTH API ---

export const apiRegister = async (name: string, username: string, pin: string) => {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, username, pin }),
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

export const apiLogin = async (username: string, pin: string) => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
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
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await parseResponseJson(res);
  } catch {
    return null;
  }
};

// --- USERS SEARCH API ---

export const apiSearchUsers = async (query: string) => {
  const token = getAuthToken();
  if (!token) return { users: [] };
  try {
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { users: [] };
    return await parseResponseJson(res);
  } catch {
    return { users: [] };
  }
};

// --- CHATS & MESSAGES API ---

export const apiFetchChats = async () => {
  const token = getAuthToken();
  if (!token) return { chats: [] };
  try {
    const res = await fetch(`${API_BASE}/chats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { chats: [] };
    return await parseResponseJson(res);
  } catch {
    return { chats: [] };
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
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/chats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });
  const data = await parseResponseJson(res);
  if (!res.ok) throw new Error(data.error || 'Failed to create chat');
  return data;
};

export const apiFetchMessages = async (chatId: string) => {
  const token = getAuthToken();
  if (!token) return { messages: [] };
  try {
    const res = await fetch(`${API_BASE}/chats/${chatId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { messages: [] };
    return await parseResponseJson(res);
  } catch {
    return { messages: [] };
  }
};

// Guaranteed Message Delivery with ACK & Retry
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
  if (!token) throw new Error('Not authenticated');

  const payload = {
    chatId,
    text,
    mediaType,
    mediaUrl,
    replyToId,
    replyToText,
    clientMsgId: clientMsgId || `cmsg-${Date.now()}-${Math.random()}`,
  };

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      attempts++;
      const res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return await parseResponseJson(res);
      }
    } catch (err) {
      if (attempts >= maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempts)));
    }
  }

  throw new Error('Message delivery failed after retries');
};

// Edit Message
export const apiEditMessage = async (messageId: string, text: string) => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/messages/${messageId}/edit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  });
  return await parseResponseJson(res);
};

// Delete Message
export const apiDeleteMessage = async (messageId: string, deleteForEveryone: boolean) => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/messages/${messageId}/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ deleteForEveryone }),
  });
  return await parseResponseJson(res);
};

// Toggle Emoji Reaction
export const apiReactToMessage = async (messageId: string, emoji: string) => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/messages/${messageId}/react`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ emoji }),
  });
  return await parseResponseJson(res);
};

// Pin / Unpin Message in Chat
export const apiPinMessage = async (chatId: string, messageId: string | null) => {
  const token = getAuthToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/chats/${chatId}/pin-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messageId }),
  });
  return await parseResponseJson(res);
};

// Read Receipt
export const apiMarkRead = async (chatId: string) => {
  const token = getAuthToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/chats/${chatId}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // ignore non-critical
  }
};

// Typing status
export const apiSetTyping = async (chatId: string, isTyping: boolean) => {
  const token = getAuthToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/chats/${chatId}/typing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isTyping }),
    });
  } catch {
    // ignore
  }
};

// Presence status
export const apiSendPresence = async (status: 'online' | 'offline' | 'away') => {
  const token = getAuthToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
  } catch {
    // ignore
  }
};

// Full Sync (Offline Catchup)
export const apiSync = async (since?: string) => {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const url = since ? `${API_BASE}/sync?since=${encodeURIComponent(since)}` : `${API_BASE}/sync`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await parseResponseJson(res);
  } catch {
    return null;
  }
};

export const apiUploadR2Media = async (fileName: string, dataUrl: string) => {
  const token = getAuthToken();
  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ fileName, dataUrl }),
    });
    return await parseResponseJson(res);
  } catch {
    return { publicUrl: dataUrl };
  }
};

// --- REALTIME SSE STREAM SUBSCRIPTION ---

let eventSourceInstance: EventSource | null = null;
let reconnectTimer: any = null;

export const subscribeRealtimeEvents = (
  onEvent: (event: { type: string; data: any }) => void,
  onStatusChange: (status: 'connected' | 'reconnecting' | 'offline') => void
) => {
  const token = getAuthToken();
  if (!token) {
    onStatusChange('offline');
    return () => {};
  }

  const connect = () => {
    if (eventSourceInstance) {
      eventSourceInstance.close();
    }

    onStatusChange('reconnecting');

    const sseUrl = `${API_BASE}/realtime/stream?token=${encodeURIComponent(token)}`;
    eventSourceInstance = new EventSource(sseUrl);

    eventSourceInstance.onopen = () => {
      onStatusChange('connected');
    };

    eventSourceInstance.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'connected') {
          onStatusChange('connected');
        } else {
          onEvent(payload);
        }
      } catch (err) {
        console.warn('SSE Parse error:', err);
      }
    };

    eventSourceInstance.onerror = () => {
      onStatusChange('reconnecting');
      if (eventSourceInstance) {
        eventSourceInstance.close();
        eventSourceInstance = null;
      }
      // Reconnect after 3 seconds
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (getAuthToken()) {
          connect();
        }
      }, 3000);
    };
  };

  connect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (eventSourceInstance) {
      eventSourceInstance.close();
      eventSourceInstance = null;
    }
    onStatusChange('offline');
  };
};
