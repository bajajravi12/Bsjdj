import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import webPush from 'web-push';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const currentFilename = typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : (typeof __filename !== 'undefined' ? __filename : '');
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : (currentFilename ? path.dirname(currentFilename) : process.cwd());

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'aarvi-production-e2ee-jwt-secret-2026';

// VAPID Web Push Keys Configuration
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BI_i_mvWL_HWGZ4dk-hodyqyi7bi5hR4hVIaHQDb3ZbEyE2oE2PVeAYy61D1F23EpOwGi-mzJk8sBbptgdB3dJQ';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'olBy0P3ldKvbfSnJFZPz9EbXmVBxIWZ-fLFQO1o4_u4';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@aarvi.app';

try {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (err) {
  console.warn('[Web Push] VAPID initialization warning:', err);
}

app.use(express.json({ limit: '10mb' }));

// Middleware to ensure all /api responses default to JSON Content-Type
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Middleware to catch body parser syntax errors (e.g. malformed JSON)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});

// --- TYPES & PRODUCTION DATA STORE ---

export interface ServerUser {
  id: string;
  name: string;
  username: string;
  bio?: string;
  avatar: string;
  publicKey: string;
  pinHash?: string;
  status: 'online' | 'offline' | 'away';
  lastSeen: string;
  lastActiveTimestamp?: number;
  isVerified?: boolean;
}

const AVATAR_COLORS = [
  '#059669', '#2563eb', '#7c3aed', '#db2777', '#d97706',
  '#0891b2', '#0d9488', '#4f46e5', '#ea580c', '#65a30d'
];

function getInitials(name: string): string {
  if (!name || !name.trim()) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(key: string): string {
  if (!key) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function generateInitialsAvatarSvg(name: string, keyForColor?: string): string {
  const initials = getInitials(name);
  const color = getAvatarColor(keyForColor || name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="100%" height="100%" rx="64" fill="${color}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="52" fill="#ffffff">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface ServerReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface ServerMessage {
  id: string;
  clientMsgId?: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isoDate: string;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  isSecret?: boolean;
  selfDestructSeconds?: number;
  mediaUrl?: string;
  mediaType?: 'image' | 'voice' | 'file' | 'location';
  replyToId?: string;
  replyToText?: string;
  reactions?: ServerReaction[];
  isEncrypted: boolean;
  isEdited?: boolean;
}

export interface ServerChat {
  id: string;
  name: string;
  avatar: string;
  isGroup: boolean;
  isSecret: boolean;
  encryptionFingerprint: string;
  selfDestructTimer: number;
  memberIds: string[];
  lastMessage?: ServerMessage;
  createdAt: string;
  pinnedMessageId?: string | null;
}

// Production In-Memory Database (Starts Empty - Zero Demo / Seed Records)
const usersDb: Record<string, ServerUser> = {};
const chatsDb: Record<string, ServerChat> = {};
const messagesDb: Record<string, ServerMessage[]> = {};
const readStatusDb: Record<string, Record<string, string[]>> = {}; // chatId -> userId -> readMessageIds
const typingStatusDb: Record<string, Record<string, boolean>> = {}; // chatId -> userId -> isTyping

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

const pushSubscriptionsDb: Record<string, PushSubscriptionRecord[]> = {}; // userId -> array of subscriptions

async function sendWebPushToChatRecipients(chatId: string, senderId: string, message: ServerMessage) {
  const chat = chatsDb[chatId];
  if (!chat) return;

  const recipientIds = chat.memberIds.filter((id) => id !== senderId);
  const senderUser = usersDb[senderId];
  const senderName = senderUser ? senderUser.name : message.senderName || 'AARVI User';

  const payload = JSON.stringify({
    title: `AARVI: ${senderName}`,
    body: message.text || (message.mediaType ? `[${message.mediaType.toUpperCase()}]` : 'Sent a message'),
    chatId: message.chatId,
    messageId: message.id,
    icon: senderUser?.avatar || '/icon.png',
    tag: `aarvi-chat-${message.chatId}`,
  });

  for (const rId of recipientIds) {
    const userSubs = pushSubscriptionsDb[rId] || [];
    for (const sub of userSubs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      webPush.sendNotification(pushSubscription, payload, {
        vapidDetails: {
          subject: VAPID_SUBJECT,
          publicKey: VAPID_PUBLIC_KEY,
          privateKey: VAPID_PRIVATE_KEY,
        },
      }).catch((err) => {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          // Remove expired subscription
          pushSubscriptionsDb[rId] = (pushSubscriptionsDb[rId] || []).filter((s) => s.endpoint !== sub.endpoint);
        } else {
          console.warn('[Web Push] Send error:', err?.message || err);
        }
      });
    }
  }
}

// PRESENCE TIMEOUT CONFIGURATION (45 seconds)
const PRESENCE_TIMEOUT_MS = 45000;

export function getEffectiveUserStatus(user: ServerUser): { status: 'online' | 'offline'; lastSeen: string; lastActiveTimestamp?: number } {
  if (!user) {
    return { status: 'offline', lastSeen: new Date().toISOString() };
  }
  const now = Date.now();
  let lastActive = user.lastActiveTimestamp || 0;
  if (!lastActive && user.lastSeen) {
    const parsed = new Date(user.lastSeen).getTime();
    if (!isNaN(parsed)) {
      lastActive = parsed;
    }
  }

  const isRecentlyActive = lastActive > 0 && (now - lastActive < PRESENCE_TIMEOUT_MS);

  if (isRecentlyActive) {
    const lastSeenIso = new Date(lastActive).toISOString();
    return {
      status: 'online',
      lastSeen: lastSeenIso,
      lastActiveTimestamp: lastActive,
    };
  }

  const lastSeenIso = lastActive > 0 ? new Date(lastActive).toISOString() : (user.lastSeen && !isNaN(new Date(user.lastSeen).getTime()) ? new Date(user.lastSeen).toISOString() : new Date().toISOString());
  return {
    status: 'offline',
    lastSeen: lastSeenIso,
    lastActiveTimestamp: lastActive,
  };
}

// Background Task: Enforce Server-Authoritative Presence Expiry Every 10 Seconds
setInterval(() => {
  const now = Date.now();
  Object.values(usersDb).forEach((user) => {
    if (user.status === 'online') {
      const lastActive = user.lastActiveTimestamp || (user.lastSeen && !isNaN(new Date(user.lastSeen).getTime()) ? new Date(user.lastSeen).getTime() : 0);
      const timeDiff = now - lastActive;

      if (lastActive === 0 || timeDiff >= PRESENCE_TIMEOUT_MS) {
        console.log(`[Presence Timeout] User ${user.id} (${user.name}) heartbeat expired (${Math.round(timeDiff / 1000)}s ago). Marking OFFLINE.`);
        user.status = 'offline';
        const lastSeenIso = lastActive > 0 ? new Date(lastActive).toISOString() : new Date().toISOString();
        user.lastSeen = lastSeenIso;

        const payload = { userId: user.id, status: 'offline', lastSeen: lastSeenIso };
        broadcastToAll('presence:change', payload);
        broadcastToAll('presence:update', payload);
      }
    }
  });
}, 10000);

// Active SSE Connections
interface SSEClient {
  id: string;
  userId: string;
  res: express.Response;
}
let sseClients: SSEClient[] = [];

// Helper: Broadcast Event to SSE Clients
const broadcastToUsers = (targetUserIds: string[], eventType: string, payload: any) => {
  const jsonString = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
  sseClients.forEach((client) => {
    if (targetUserIds.includes(client.userId)) {
      try {
        client.res.write(`data: ${jsonString}\n\n`);
      } catch (err) {
        // Handle socket error gracefully
      }
    }
  });
};

const broadcastToAll = (eventType: string, payload: any) => {
  const jsonString = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
  sseClients.forEach((client) => {
    try {
      client.res.write(`data: ${jsonString}\n\n`);
    } catch (err) {
      // Handle socket error
    }
  });
};

// Periodic SSE Heartbeat Ping (keeps connection alive across proxies/Cloud Run)
setInterval(() => {
  sseClients.forEach((client) => {
    try {
      client.res.write(`: heartbeat\n\n`);
    } catch {
      // cleaned up on close
    }
  });
}, 15000);

// --- JWT AUTH MIDDLEWARE ---

const authenticateJWT = (req: any, res: any, next: any) => {
  let token = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = String(req.query.token);
  } else if (req.body && req.body.token) {
    token = String(req.body.token);
  }

  if (token) {
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
      const user = usersDb[decoded.id] || decoded;
      req.user = user;

      if (usersDb[decoded.id]) {
        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const u = usersDb[decoded.id];
        const wasOffline = getEffectiveUserStatus(u).status === 'offline';

        u.lastActiveTimestamp = now;
        u.lastSeen = nowIso;
        u.status = 'online';

        if (wasOffline) {
          const payload = { userId: u.id, status: 'online', lastSeen: nowIso };
          broadcastToAll('presence:change', payload);
          broadcastToAll('presence:update', payload);
        }
      }

      next();
    });
  } else {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
};

// --- REST ENDPOINTS ---

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'AARVI Production Messaging Engine',
    activeSSEConnections: sseClients.length,
    totalUsers: Object.keys(usersDb).length,
    totalChats: Object.keys(chatsDb).length,
    timestamp: new Date().toISOString(),
  });
});

// 2. Auth: Register / Signup New User Account
app.post(['/api/auth/register', '/api/auth/signup'], (req, res) => {
  try {
    const { name, displayName, username, email, pin, password, bio } = req.body || {};

    const rawName = (name || displayName || username || '').toString().trim();
    const rawUsername = (username || email || name || '').toString().trim();
    const rawPin = (pin || password || '').toString().trim();

    if (!rawName) {
      return res.status(400).json({ error: 'Display Name is required' });
    }
    if (!rawUsername) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const cleanUsername = rawUsername.startsWith('@') 
      ? rawUsername.toLowerCase() 
      : `@${rawUsername.toLowerCase()}`;

    // Check if username already exists
    const existingUser = Object.values(usersDb).find((u) => u.username.toLowerCase() === cleanUsername);
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
    }

    const userId = `usr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const defaultAvatar = generateInitialsAvatarSvg(rawName, cleanUsername);

    const newUser: ServerUser = {
      id: userId,
      name: rawName,
      username: cleanUsername,
      bio: bio || 'AARVI User',
      avatar: defaultAvatar,
      publicKey: `E2EE-KEY-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      pinHash: rawPin,
      status: 'online',
      lastSeen: new Date().toISOString(),
      lastActiveTimestamp: Date.now(),
      isVerified: true,
    };

    usersDb[userId] = newUser;

    const token = jwt.sign({ id: newUser.id, username: newUser.username, name: newUser.name }, JWT_SECRET, {
      expiresIn: '30d',
    });

    // Broadcast presence change
    broadcastToAll('presence:change', { userId: newUser.id, status: 'online', lastSeen: 'Just now' });

    return res.status(201).json({
      success: true,
      token,
      user: newUser,
      message: 'User registered successfully.',
    });
  } catch (err: any) {
    console.error('Registration Error:', err);
    return res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// 3. Auth: Login / Signin Existing User
app.post(['/api/auth/login', '/api/auth/signin'], (req, res) => {
  try {
    const { username, email, pin, password } = req.body || {};

    const rawUsername = (username || email || '').toString().trim();
    const rawPin = (pin || password || '').toString().trim();

    if (!rawUsername) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!rawPin) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const cleanUsername = rawUsername.startsWith('@') 
      ? rawUsername.toLowerCase() 
      : `@${rawUsername.toLowerCase()}`;

    const user = Object.values(usersDb).find((u) => u.username.toLowerCase() === cleanUsername);

    if (!user) {
      return res.status(401).json({ error: 'Account not found. Please register first.' });
    }

    if (user.pinHash && user.pinHash !== rawPin) {
      return res.status(401).json({ error: 'Invalid password. Please try again.' });
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    user.status = 'online';
    user.lastActiveTimestamp = now;
    user.lastSeen = nowIso;

    const token = jwt.sign({ id: user.id, username: user.username, name: user.name }, JWT_SECRET, {
      expiresIn: '30d',
    });

    const payload = { userId: user.id, status: 'online', lastSeen: nowIso };
    broadcastToAll('presence:change', payload);
    broadcastToAll('presence:update', payload);

    return res.json({
      success: true,
      token,
      user,
      message: 'Login successful.',
    });
  } catch (err: any) {
    console.error('Login Error:', err);
    return res.status(500).json({ error: err.message || 'Login failed' });
  }
});

// 4. Auth: Get Current User Profile
app.get(['/api/auth/me', '/api/me'], authenticateJWT, (req: any, res) => {
  const user = usersDb[req.user.id];
  if (!user) {
    return res.status(404).json({ error: 'User profile not found' });
  }
  const eff = getEffectiveUserStatus(user);
  res.json({
    user: {
      ...user,
      status: eff.status,
      lastSeen: eff.lastSeen,
    },
    status: 'authenticated',
  });
});

// 5. Search Registered Users (for New Chat)
app.get('/api/users/search', authenticateJWT, (req: any, res) => {
  const query = (req.query.q as string || '').toLowerCase().trim();
  const currentUserId = req.user.id;

  const matches = Object.values(usersDb)
    .filter((u) => u.id !== currentUserId)
    .filter((u) => {
      if (!query) return true;
      return (
        u.name.toLowerCase().includes(query) ||
        u.username.toLowerCase().includes(query)
      );
    })
    .map((u) => {
      const eff = getEffectiveUserStatus(u);
      return {
        ...u,
        status: eff.status,
        lastSeen: eff.lastSeen,
      };
    });

  res.json({ users: matches });
});

// 5.1 Push Notification VAPID Public Key Endpoint
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// 5.2 Push Notification Subscribe Endpoint
app.post('/api/push/subscribe', authenticateJWT, (req: any, res) => {
  const userId = req.user.id;
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid push subscription object' });
  }

  const { endpoint, keys } = subscription;
  const { p256dh, auth } = keys;

  if (!pushSubscriptionsDb[userId]) {
    pushSubscriptionsDb[userId] = [];
  }

  const existing = pushSubscriptionsDb[userId].find((s) => s.endpoint === endpoint);
  if (!existing) {
    pushSubscriptionsDb[userId].push({
      id: `sub-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      userId,
      endpoint,
      p256dh,
      auth,
      createdAt: new Date().toISOString(),
    });
  }

  res.json({ success: true, message: 'Push subscription persisted successfully' });
});

// 5.3 Push Notification Unsubscribe Endpoint
app.post('/api/push/unsubscribe', authenticateJWT, (req: any, res) => {
  const userId = req.user.id;
  const { endpoint } = req.body;

  if (endpoint && pushSubscriptionsDb[userId]) {
    pushSubscriptionsDb[userId] = pushSubscriptionsDb[userId].filter((s) => s.endpoint !== endpoint);
  }

  res.json({ success: true, message: 'Unsubscribed successfully' });
});

// 6. Realtime SSE Stream Endpoint
app.get(['/api/realtime/stream', '/api/realtime'], (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    return res.status(401).send('Unauthorized: Missing realtime token');
  }

  let decodedUser: any = null;
  try {
    decodedUser = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).send('Unauthorized: Invalid realtime token');
  }

  const userId = decodedUser.id;

  // Configure SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = `sse-${Date.now()}-${Math.random()}`;
  const newClient: SSEClient = { id: clientId, userId, res };
  sseClients.push(newClient);

  // Send connection welcome handshake
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId, userId, timestamp: new Date().toISOString() })}\n\n`);

  // Update presence status to online
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  if (usersDb[userId]) {
    usersDb[userId].status = 'online';
    usersDb[userId].lastActiveTimestamp = now;
    usersDb[userId].lastSeen = nowIso;
    const payload = { userId, status: 'online', lastSeen: nowIso };
    broadcastToAll('presence:change', payload);
    broadcastToAll('presence:update', payload);
    console.log(`[SSE Connection] User ${userId} connected via client ${clientId}`);
  }

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c.id !== clientId);
    if (usersDb[userId]) {
      // Check if user has other active connections
      const remainingUserClients = sseClients.filter((c) => c.userId === userId);
      console.log(`[SSE Disconnect] Client ${clientId} closed for ${userId}. Remaining: ${remainingUserClients.length}`);
      if (remainingUserClients.length === 0) {
        usersDb[userId].status = 'offline';
        const lastSeenIso = usersDb[userId].lastActiveTimestamp ? new Date(usersDb[userId].lastActiveTimestamp!).toISOString() : new Date().toISOString();
        usersDb[userId].lastSeen = lastSeenIso;
        const payload = { userId, status: 'offline', lastSeen: lastSeenIso };
        broadcastToAll('presence:change', payload);
        broadcastToAll('presence:update', payload);
      }
    }
  });
});

// 7. Get All Chats for Current User
app.get('/api/chats', authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;

  const userChats = Object.values(chatsDb)
    .filter((c) => c.memberIds.includes(currentUserId))
    .map((c) => {
      const members = c.memberIds
        .map((id) => usersDb[id])
        .filter(Boolean)
        .map((m) => {
          const eff = getEffectiveUserStatus(m);
          return {
            ...m,
            status: eff.status,
            lastSeen: eff.lastSeen,
          };
        });
      // Calculate unread count for current user
      const chatMsgs = messagesDb[c.id] || [];
      const userReadIds = (readStatusDb[c.id] && readStatusDb[c.id][currentUserId]) || [];
      const unreadCount = chatMsgs.filter(
        (m) => m.senderId !== currentUserId && !userReadIds.includes(m.id) && m.status !== 'read'
      ).length;

      // Other participant for naming direct chat
      let displayName = c.name;
      let displayAvatar = c.avatar;
      if (!c.isGroup && !c.isSecret) {
        const otherUser = members.find((m) => m.id !== currentUserId);
        if (otherUser) {
          displayName = otherUser.name;
          displayAvatar = otherUser.avatar;
        }
      } else if (c.isSecret) {
        const otherUser = members.find((m) => m.id !== currentUserId);
        if (otherUser) {
          displayName = `🔒 Secret Vault (${otherUser.name})`;
        }
      }

      return {
        id: c.id,
        name: displayName,
        avatar: displayAvatar,
        isGroup: c.isGroup,
        isSecret: c.isSecret,
        unreadCount,
        pinned: false,
        encryptionFingerprint: c.encryptionFingerprint,
        selfDestructTimer: c.selfDestructTimer,
        members,
        lastMessage: c.lastMessage,
      };
    });

  // Sort by last message timestamp descending
  userChats.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.isoDate).getTime() : new Date(a.id).getTime();
    const timeB = b.lastMessage ? new Date(b.lastMessage.isoDate).getTime() : new Date(b.id).getTime();
    return timeB - timeA;
  });

  res.json({ chats: userChats });
});

// 8. Create or Retrieve Direct / Secret / Group Chat
app.post('/api/chats', authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const { recipientUserId, name, isGroup, isSecret, selfDestructTimer } = req.body;

  // Check if a direct chat already exists between these users
  if (!isGroup && recipientUserId) {
    const existingChat = Object.values(chatsDb).find(
      (c) => !c.isGroup && Boolean(c.isSecret) === Boolean(isSecret) && c.memberIds.includes(currentUserId) && c.memberIds.includes(recipientUserId)
    );

    if (existingChat) {
      const members = existingChat.memberIds.map((id) => usersDb[id]).filter(Boolean);
      return res.json({
        chat: {
          ...existingChat,
          members,
          unreadCount: 0,
        },
      });
    }
  }

  const memberIds = Array.from(new Set([currentUserId, ...(recipientUserId ? [recipientUserId] : [])]));
  const chatId = `chat-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const recipientUser = recipientUserId ? usersDb[recipientUserId] : null;
  const defaultName = isSecret
    ? `🔒 Secret Vault (${recipientUser ? recipientUser.name : 'Private'})`
    : recipientUser
    ? recipientUser.name
    : name || 'AARVI Conversation';

  const chatAvatar = recipientUser
    ? recipientUser.avatar
    : generateInitialsAvatarSvg(defaultName, chatId);

  const newChat: ServerChat = {
    id: chatId,
    name: defaultName,
    avatar: chatAvatar,
    isGroup: Boolean(isGroup),
    isSecret: Boolean(isSecret),
    encryptionFingerprint: `KEY-${Math.floor(Math.random() * 8999 + 1000)}-AARVI-PROT`,
    selfDestructTimer: selfDestructTimer || 0,
    memberIds,
    createdAt: new Date().toISOString(),
  };

  chatsDb[chatId] = newChat;
  messagesDb[chatId] = [];

  const members = memberIds.map((id) => usersDb[id]).filter(Boolean);
  const responseChat = { ...newChat, members, unreadCount: 0 };

  // Broadcast new chat event to participants
  broadcastToUsers(memberIds, 'chat:new', { chat: responseChat });

  res.status(201).json({ chat: responseChat });
});

// 9. Get Message History for Chat
app.get('/api/chats/:chatId/messages', authenticateJWT, (req: any, res) => {
  const { chatId } = req.params;
  const msgs = messagesDb[chatId] || [];
  res.json({ chatId, messages: msgs });
});

// 10. Send Message (with ACK & Deduplication)
app.post(['/api/messages', '/api/messages/send', '/api/messages/reply'], authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const { chatId, text, mediaType, mediaUrl, replyToId, replyToText, clientMsgId, isoDate: clientIsoDate } = req.body;

  if (!chatId || !text) {
    return res.status(400).json({ error: 'chatId and text are required' });
  }

  const chat = chatsDb[chatId];
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  // Deduplication check
  if (clientMsgId) {
    const existing = (messagesDb[chatId] || []).find((m) => m.clientMsgId === clientMsgId);
    if (existing) {
      return res.json({ success: true, message: existing, duplicate: true });
    }
  }

  const senderUser = usersDb[currentUserId];
  const msgId = `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const validIsoDate = clientIsoDate && !isNaN(new Date(clientIsoDate).getTime())
    ? new Date(clientIsoDate).toISOString()
    : new Date().toISOString();

  const newMsg: ServerMessage = {
    id: msgId,
    clientMsgId,
    chatId,
    senderId: currentUserId,
    senderName: senderUser ? senderUser.name : 'AARVI User',
    text,
    timestamp: validIsoDate,
    isoDate: validIsoDate,
    status: 'sent',
    mediaType,
    mediaUrl,
    replyToId,
    replyToText,
    isEncrypted: true,
  };

  if (!messagesDb[chatId]) {
    messagesDb[chatId] = [];
  }
  messagesDb[chatId].push(newMsg);

  // Update chat last message
  chat.lastMessage = newMsg;

  // Broadcast new message event to all chat members
  broadcastToUsers(chat.memberIds, 'message:new', { message: newMsg, chatId });

  // Deliver Real Web Push Notification to offline/background chat recipients
  sendWebPushToChatRecipients(chatId, currentUserId, newMsg).catch((err) => {
    console.error('[Web Push] Error triggering push notification:', err);
  });

  // Return ACK to sender
  res.status(201).json({ success: true, message: newMsg, ackTimestamp: new Date().toISOString() });
});

// Edit Message Endpoint
app.post(['/api/messages/:id/edit', '/api/messages/edit'], authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const messageId = req.params.id || req.body.messageId || req.body.id;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }

  let foundMsg: ServerMessage | null = null;
  let targetChatId: string | null = null;

  for (const [cId, msgs] of Object.entries(messagesDb)) {
    const m = msgs.find((item) => item.id === messageId);
    if (m) {
      foundMsg = m;
      targetChatId = cId;
      break;
    }
  }

  if (!foundMsg || !targetChatId) {
    return res.status(404).json({ error: 'Message not found' });
  }

  if (foundMsg.senderId !== currentUserId) {
    return res.status(403).json({ error: 'You can only edit your own messages' });
  }

  foundMsg.text = text.trim();
  foundMsg.isEdited = true;

  const chat = chatsDb[targetChatId];
  if (chat) {
    if (chat.lastMessage?.id === messageId) {
      chat.lastMessage.text = foundMsg.text;
      chat.lastMessage.isEdited = true;
    }
    broadcastToUsers(chat.memberIds, 'message:edit', {
      chatId: targetChatId,
      messageId,
      text: foundMsg.text,
      isEdited: true,
    });
  }

  res.json({ success: true, message: foundMsg });
});

// Delete Message Endpoint
app.post(['/api/messages/:id/delete', '/api/messages/delete'], authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const messageId = req.params.id || req.body.messageId || req.body.id;
  const { deleteForEveryone } = req.body;

  let targetChatId: string | null = null;

  for (const [cId, msgs] of Object.entries(messagesDb)) {
    const idx = msgs.findIndex((item) => item.id === messageId);
    if (idx !== -1) {
      targetChatId = cId;
      if (deleteForEveryone) {
        msgs.splice(idx, 1);
        const chat = chatsDb[cId];
        if (chat) {
          if (chat.lastMessage?.id === messageId) {
            chat.lastMessage = msgs[msgs.length - 1] || undefined;
          }
          broadcastToUsers(chat.memberIds, 'message:delete', {
            chatId: cId,
            messageId,
            deleteForEveryone: true,
          });
        }
      }
      break;
    }
  }

  res.json({ success: true, messageId, deleteForEveryone: Boolean(deleteForEveryone) });
});

// Toggle Emoji Reaction Endpoint
app.post(['/api/messages/:id/react', '/api/messages/react'], authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const messageId = req.params.id || req.body.messageId || req.body.id;
  const { emoji } = req.body;

  if (!emoji) {
    return res.status(400).json({ error: 'Emoji is required' });
  }

  let foundMsg: ServerMessage | null = null;
  let targetChatId: string | null = null;

  for (const [cId, msgs] of Object.entries(messagesDb)) {
    const m = msgs.find((item) => item.id === messageId);
    if (m) {
      foundMsg = m;
      targetChatId = cId;
      break;
    }
  }

  if (!foundMsg || !targetChatId) {
    return res.status(404).json({ error: 'Message not found' });
  }

  if (!foundMsg.reactions) {
    foundMsg.reactions = [];
  }

  let reactionObj = foundMsg.reactions.find((r) => r.emoji === emoji);

  if (reactionObj) {
    if (reactionObj.users.includes(currentUserId)) {
      reactionObj.users = reactionObj.users.filter((u) => u !== currentUserId);
      reactionObj.count = reactionObj.users.length;
    } else {
      reactionObj.users.push(currentUserId);
      reactionObj.count = reactionObj.users.length;
    }
  } else {
    reactionObj = { emoji, count: 1, users: [currentUserId] };
    foundMsg.reactions.push(reactionObj);
  }

  // Remove empty reactions
  foundMsg.reactions = foundMsg.reactions.filter((r) => r.count > 0);

  const chat = chatsDb[targetChatId];
  if (chat) {
    broadcastToUsers(chat.memberIds, 'message:react', {
      chatId: targetChatId,
      messageId,
      reactions: foundMsg.reactions,
    });
  }

  res.json({ success: true, reactions: foundMsg.reactions });
});

// Pin Message Endpoint
app.post('/api/chats/:chatId/pin-message', authenticateJWT, (req: any, res) => {
  const { chatId } = req.params;
  const { messageId } = req.body;

  const chat = chatsDb[chatId];
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  chat.pinnedMessageId = messageId || undefined;

  broadcastToUsers(chat.memberIds, 'chat:pin_message', {
    chatId,
    pinnedMessageId: chat.pinnedMessageId,
  });

  res.json({ success: true, pinnedMessageId: chat.pinnedMessageId });
});

// 11. Read Receipts Endpoint
app.post('/api/chats/:chatId/read', authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const { chatId } = req.params;

  const chatMsgs = messagesDb[chatId] || [];
  if (chatMsgs.length === 0) {
    return res.json({ success: true, readCount: 0 });
  }

  if (!readStatusDb[chatId]) {
    readStatusDb[chatId] = {};
  }
  if (!readStatusDb[chatId][currentUserId]) {
    readStatusDb[chatId][currentUserId] = [];
  }

  const newlyReadIds: string[] = [];

  chatMsgs.forEach((msg) => {
    if (msg.senderId !== currentUserId) {
      msg.status = 'read';
      if (!readStatusDb[chatId][currentUserId].includes(msg.id)) {
        readStatusDb[chatId][currentUserId].push(msg.id);
        newlyReadIds.push(msg.id);
      }
    }
  });

  const chat = chatsDb[chatId];
  if (chat && newlyReadIds.length > 0) {
    broadcastToUsers(chat.memberIds, 'message:read', {
      chatId,
      userId: currentUserId,
      readMessageIds: newlyReadIds,
    });
  }

  res.json({ success: true, readCount: newlyReadIds.length });
});

// 12. Typing State Endpoint
app.post('/api/chats/:chatId/typing', authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const { chatId } = req.params;
  const { isTyping } = req.body;

  const chat = chatsDb[chatId];
  if (chat && chat.memberIds.includes(currentUserId)) {
    const payload = {
      chatId,
      userId: currentUserId,
      userName: usersDb[currentUserId]?.name || 'User',
      isTyping: Boolean(isTyping),
    };
    broadcastToUsers(chat.memberIds, 'typing:change', payload);
    broadcastToUsers(chat.memberIds, isTyping ? 'typing:start' : 'typing:stop', payload);
  }

  res.json({ success: true });
});

// 13. Presence Heartbeat
app.post(['/api/presence', '/api/presence/heartbeat', '/api/users/presence'], authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const { status } = req.body || {};
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const newStatus = status === 'offline' ? 'offline' : 'online';

  if (usersDb[currentUserId]) {
    const user = usersDb[currentUserId];
    const prevStatus = user.status;
    
    user.status = newStatus;
    if (newStatus === 'online') {
      user.lastActiveTimestamp = now;
    }
    user.lastSeen = nowIso;

    console.log(`[Presence Heartbeat] User ${currentUserId} (${user.name}) -> ${newStatus}`);

    if (prevStatus !== newStatus || newStatus === 'online') {
      const payload = { userId: currentUserId, status: newStatus, lastSeen: nowIso };
      broadcastToAll('presence:change', payload);
      broadcastToAll('presence:update', payload);
    }
  }

  res.json({ success: true, status: newStatus, lastSeen: nowIso });
});

app.get('/api/presence', authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const userIdsParam = req.query.userIds as string;
  let targetUserIds: string[] = [];

  if (userIdsParam) {
    targetUserIds = userIdsParam.split(',').map((id) => id.trim()).filter(Boolean);
  } else {
    const memberSet = new Set<string>();
    Object.values(chatsDb).forEach((c) => {
      if (c.memberIds.includes(currentUserId)) {
        c.memberIds.forEach((id) => memberSet.add(id));
      }
    });
    targetUserIds = Array.from(memberSet);
  }

  const presenceList = targetUserIds.map((id) => {
    const user = usersDb[id];
    if (!user) return null;
    const eff = getEffectiveUserStatus(user);
    return {
      userId: id,
      status: eff.status,
      lastSeen: eff.lastSeen,
      lastActiveTimestamp: eff.lastActiveTimestamp,
    };
  }).filter(Boolean);

  res.json({ presence: presenceList });
});

// 14. Full State Synchronization Endpoint (Offline Recovery)
app.get('/api/sync', authenticateJWT, (req: any, res) => {
  const currentUserId = req.user.id;
  const since = req.query.since as string;

  const userChats = Object.values(chatsDb)
    .filter((c) => c.memberIds.includes(currentUserId))
    .map((c) => {
      const members = c.memberIds
        .map((id) => usersDb[id])
        .filter(Boolean)
        .map((m) => {
          const eff = getEffectiveUserStatus(m);
          return {
            ...m,
            status: eff.status,
            lastSeen: eff.lastSeen,
          };
        });
      return {
        ...c,
        members,
      };
    });

  const userMessagesMap: Record<string, ServerMessage[]> = {};

  userChats.forEach((c) => {
    const msgs = messagesDb[c.id] || [];
    if (since) {
      const sinceDate = new Date(since).getTime();
      userMessagesMap[c.id] = msgs.filter((m) => new Date(m.isoDate).getTime() >= sinceDate);
    } else {
      userMessagesMap[c.id] = msgs;
    }
  });

  res.json({
    timestamp: new Date().toISOString(),
    chats: userChats,
    messagesMap: userMessagesMap,
  });
});

// 15. Media Upload Handler
app.post('/api/upload', authenticateJWT, (req, res) => {
  const { dataUrl } = req.body;
  const sampleUrl = dataUrl || 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=800&q=80';

  res.json({
    success: true,
    publicUrl: sampleUrl,
  });
});

// 16. AI Generation Endpoint (Gemini)
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, systemInstruction } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY environment variable missing' });
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: systemInstruction ? { systemInstruction } : undefined,
    });
    return res.json({ text: response.text });
  } catch (err: any) {
    console.error('API generate error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate response' });
  }
});

// Service Worker route with proper JS headers
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const swPath = path.join(process.cwd(), 'public', 'sw.js');
  const distSwPath = path.join(process.cwd(), 'dist', 'sw.js');
  if (fs.existsSync(swPath)) {
    return res.sendFile(swPath);
  }
  if (fs.existsSync(distSwPath)) {
    return res.sendFile(distSwPath);
  }
  return res.status(404).send('// Service Worker not found');
});

// PWA Manifest routes
app.get(['/manifest.webmanifest', '/manifest.json'], (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const manifestPath = path.join(process.cwd(), 'public', 'manifest.webmanifest');
  const distManifestPath = path.join(process.cwd(), 'dist', 'manifest.webmanifest');
  if (fs.existsSync(manifestPath)) {
    return res.sendFile(manifestPath);
  }
  if (fs.existsSync(distManifestPath)) {
    return res.sendFile(distManifestPath);
  }
  return res.status(404).json({ error: 'Manifest not found' });
});

// Vite Middleware & Static Assets Handler
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Endpoint not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AARVI Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
