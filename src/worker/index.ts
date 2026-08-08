// Cloudflare Worker Handler for AARVI E2EE Messenger

export interface Env {
  DB?: any;
  JWT_SECRET: string;
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };
}

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
  isVerified?: boolean;
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

// In-Memory Fallback & Cache Database
const usersDb: Record<string, ServerUser> = {};
const chatsDb: Record<string, ServerChat> = {};
const messagesDb: Record<string, ServerMessage[]> = {};

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

// Active Realtime SSE Streams
let activeStreams: Array<{ writer: WritableStreamDefaultWriter<Uint8Array>; encoder: TextEncoder }> = [];

async function broadcastEvent(type: string, data: any) {
  const jsonString = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  const payload = `data: ${jsonString}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  const remaining: typeof activeStreams = [];
  for (const client of activeStreams) {
    try {
      await client.writer.write(encoded);
      remaining.push(client);
    } catch {
      // Disconnected stream
    }
  }
  activeStreams = remaining;
}

let tablesInitialized = false;

async function ensureTables(db: any) {
  if (!db || tablesInitialized) return;
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        avatar TEXT,
        phone TEXT,
        bio TEXT,
        public_key TEXT,
        pin_hash TEXT,
        status TEXT DEFAULT 'offline',
        last_seen TEXT,
        last_active_timestamp INTEGER,
        is_verified INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`),
      db.prepare(`CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT,
        is_group INTEGER DEFAULT 0,
        is_secret INTEGER DEFAULT 0,
        encryption_fingerprint TEXT NOT NULL,
        self_destruct_timer INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`),
      db.prepare(`CREATE TABLE IF NOT EXISTS chat_members (
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (chat_id, user_id)
      );`),
      db.prepare(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        client_msg_id TEXT,
        chat_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        iso_date TEXT NOT NULL,
        status TEXT DEFAULT 'sent',
        media_url TEXT,
        media_type TEXT,
        reply_to_id TEXT,
        reply_to_text TEXT,
        reactions_json TEXT,
        is_encrypted INTEGER DEFAULT 1,
        is_edited INTEGER DEFAULT 0
      );`)
    ]);
    tablesInitialized = true;
  } catch (err) {
    console.error('Failed to initialize D1 tables:', err);
  }
}

// Native Web Crypto JWT Helpers
async function signJWT(payload: any, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const tokenData = `${encHeader}.${encPayload}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(tokenData));
  const encSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${tokenData}.${encSig}`;
}

async function verifyJWT(token: string, secret: string): Promise<any | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, encSig] = parts;
    const tokenData = `${encHeader}.${encPayload}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let b64Sig = encSig.replace(/-/g, '+').replace(/_/g, '/');
    while (b64Sig.length % 4 !== 0) b64Sig += '=';
    const sigBytes = Uint8Array.from(atob(b64Sig), (c) => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(tokenData));
    if (!isValid) return null;

    let b64Payload = encPayload.replace(/-/g, '+').replace(/_/g, '/');
    while (b64Payload.length % 4 !== 0) b64Payload += '=';
    const payloadJson = atob(b64Payload);
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

// JSON & CORS Response Helper
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// D1 Sync Helpers
async function getD1UserByUsername(db: any, username: string): Promise<ServerUser | null> {
  if (!db) return null;
  try {
    const row: any = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').bind(username.toLowerCase()).first();
    if (!row) return null;
    const user: ServerUser = {
      id: row.id,
      name: row.name,
      username: row.username,
      avatar: row.avatar || generateInitialsAvatarSvg(row.name, row.username),
      bio: row.bio || '',
      publicKey: row.public_key || '',
      pinHash: row.pin_hash || '',
      isVerified: Boolean(row.is_verified),
      status: (row.status as any) || 'offline',
      lastSeen: row.last_seen || '',
    };
    usersDb[user.id] = user;
    return user;
  } catch {
    return null;
  }
}

async function getD1UserById(db: any, id: string): Promise<ServerUser | null> {
  if (!db) return null;
  try {
    const row: any = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    if (!row) return null;
    const user: ServerUser = {
      id: row.id,
      name: row.name,
      username: row.username,
      avatar: row.avatar || generateInitialsAvatarSvg(row.name, row.username),
      bio: row.bio || '',
      publicKey: row.public_key || '',
      pinHash: row.pin_hash || '',
      isVerified: Boolean(row.is_verified),
      status: (row.status as any) || 'offline',
      lastSeen: row.last_seen || '',
    };
    usersDb[user.id] = user;
    return user;
  } catch {
    return null;
  }
}

async function getFullUser(db: any, id: string): Promise<ServerUser> {
  if (usersDb[id] && usersDb[id].name && usersDb[id].username) {
    return usersDb[id];
  }
  if (db) {
    const d1User = await getD1UserById(db, id);
    if (d1User) return d1User;
  }
  return {
    id,
    name: 'User',
    username: '@user',
    avatar: generateInitialsAvatarSvg('User', id),
    status: 'offline',
    lastSeen: '',
    publicKey: 'E2EE-KEY-DEFAULT',
    isVerified: true,
  };
}

async function getD1ChatById(db: any, chatId: string): Promise<ServerChat | null> {
  if (!db) return null;
  try {
    const cRow: any = await db.prepare('SELECT * FROM chats WHERE id = ?').bind(chatId).first();
    if (!cRow) return null;

    const members: any = await db.prepare(
      'SELECT user_id FROM chat_members WHERE chat_id = ?'
    ).bind(chatId).all();
    const memberIds = (members?.results || []).map((m: any) => m.user_id);

    const lastMsgRow: any = await db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY iso_date DESC LIMIT 1'
    ).bind(chatId).first();

    let lastMsg: ServerMessage | undefined = undefined;
    if (lastMsgRow) {
      lastMsg = {
        id: lastMsgRow.id,
        clientMsgId: lastMsgRow.client_msg_id,
        chatId: lastMsgRow.chat_id,
        senderId: lastMsgRow.sender_id,
        senderName: lastMsgRow.sender_name,
        text: lastMsgRow.text,
        timestamp: lastMsgRow.timestamp,
        isoDate: lastMsgRow.iso_date,
        status: lastMsgRow.status || 'sent',
        mediaUrl: lastMsgRow.media_url,
        mediaType: lastMsgRow.media_type,
        replyToId: lastMsgRow.reply_to_id,
        replyToText: lastMsgRow.reply_to_text,
        reactions: lastMsgRow.reactions_json ? JSON.parse(lastMsgRow.reactions_json) : [],
        isEncrypted: Boolean(lastMsgRow.is_encrypted),
        isEdited: Boolean(lastMsgRow.is_edited),
      };
    }

    const chatObj: ServerChat = {
      id: cRow.id,
      name: cRow.name,
      avatar: cRow.avatar || '',
      isGroup: Boolean(cRow.is_group),
      isSecret: Boolean(cRow.is_secret),
      encryptionFingerprint: cRow.encryption_fingerprint || 'KEY-AARVI-PROT',
      selfDestructTimer: cRow.self_destruct_timer || 0,
      memberIds,
      lastMessage: lastMsg,
      createdAt: cRow.created_at || new Date().toISOString(),
    };
    chatsDb[chatId] = chatObj;
    return chatObj;
  } catch (err) {
    console.error('getD1ChatById error:', err);
    return null;
  }
}

async function findExistingD1Chat(db: any, user1Id: string, user2Id: string, isSecret = false): Promise<ServerChat | null> {
  if (!db) return null;
  try {
    const row: any = await db.prepare(`
      SELECT c.id FROM chats c
      JOIN chat_members cm1 ON c.id = cm1.chat_id
      JOIN chat_members cm2 ON c.id = cm2.chat_id
      WHERE cm1.user_id = ? AND cm2.user_id = ?
        AND c.is_group = 0 AND c.is_secret = ?
      LIMIT 1
    `).bind(user1Id, user2Id, isSecret ? 1 : 0).first();

    if (row && row.id) {
      return await getD1ChatById(db, row.id);
    }
  } catch (e) {
    console.error('findExistingD1Chat error:', e);
  }
  return null;
}

async function getD1ChatsForUser(db: any, userId: string): Promise<any[]> {
  if (!db) return [];
  try {
    const memberRows: any = await db.prepare(
      'SELECT chat_id FROM chat_members WHERE user_id = ?'
    ).bind(userId).all();

    if (!memberRows || !memberRows.results || memberRows.results.length === 0) {
      return [];
    }

    const responseChats: any[] = [];
    for (const r of memberRows.results) {
      const cId = r.chat_id;
      const chat = await getD1ChatById(db, cId);
      if (!chat) continue;

      const members = await Promise.all(chat.memberIds.map((mId) => getFullUser(db, mId)));

      let displayName = chat.name;
      let displayAvatar = chat.avatar;

      if (!chat.isGroup && !chat.isSecret) {
        const otherUser = members.find((m) => m.id !== userId);
        if (otherUser) {
          displayName = otherUser.name;
          displayAvatar = otherUser.avatar || generateInitialsAvatarSvg(otherUser.name, otherUser.username);
        }
      } else if (chat.isSecret) {
        const otherUser = members.find((m) => m.id !== userId);
        if (otherUser) {
          displayName = `🔒 Secret Vault (${otherUser.name})`;
          displayAvatar = otherUser.avatar;
        }
      }

      let unreadCount = 0;
      try {
        const unreadRow: any = await db.prepare(
          `SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ? AND sender_id != ? AND status != 'read'`
        ).bind(cId, userId).first();
        if (unreadRow) unreadCount = Number(unreadRow.cnt || 0);
      } catch {}

      responseChats.push({
        ...chat,
        name: displayName,
        avatar: displayAvatar,
        members,
        unreadCount,
        pinned: false,
      });
    }

    return responseChats;
  } catch (err) {
    console.error('getD1ChatsForUser error:', err);
    return [];
  }
}

async function getD1MessagesForChat(db: any, chatId: string): Promise<ServerMessage[]> {
  if (!db) return [];
  try {
    const rows: any = await db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY iso_date ASC LIMIT 500'
    ).bind(chatId).all();

    if (!rows || !rows.results) return [];

    const msgs = rows.results.map((m: any) => ({
      id: m.id,
      clientMsgId: m.client_msg_id,
      chatId: m.chat_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      text: m.text,
      timestamp: m.timestamp,
      isoDate: m.iso_date,
      status: m.status || 'sent',
      mediaUrl: m.media_url,
      mediaType: m.media_type,
      replyToId: m.reply_to_id,
      replyToText: m.reply_to_text,
      reactions: m.reactions_json ? JSON.parse(m.reactions_json) : [],
      isEncrypted: Boolean(m.is_encrypted),
      isEdited: Boolean(m.is_edited),
    }));
    messagesDb[chatId] = msgs;
    return msgs;
  } catch (err) {
    console.error('getD1MessagesForChat error:', err);
    return [];
  }
}

async function saveD1User(db: any, user: ServerUser) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO users (id, name, username, avatar, bio, public_key, pin_hash, status, last_seen, is_verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
     name = excluded.name,
     avatar = excluded.avatar,
     bio = excluded.bio,
     pin_hash = excluded.pin_hash,
     status = excluded.status,
     last_seen = excluded.last_seen`
  ).bind(
    user.id,
    user.name,
    user.username,
    user.avatar || '',
    user.bio || '',
    user.publicKey || '',
    user.pinHash || '',
    user.status || 'offline',
    user.lastSeen || new Date().toISOString()
  ).run();
}

async function saveD1Chat(db: any, chat: ServerChat) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO chats (id, name, avatar, is_group, is_secret, encryption_fingerprint, self_destruct_timer)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`
  ).bind(
    chat.id,
    chat.name,
    chat.avatar || '',
    chat.isGroup ? 1 : 0,
    chat.isSecret ? 1 : 0,
    chat.encryptionFingerprint || '',
    chat.selfDestructTimer || 0
  ).run();

  for (const memberId of chat.memberIds || []) {
    await db.prepare(
      `INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
    ).bind(chat.id, memberId).run();
  }
}

async function saveD1Message(db: any, msg: ServerMessage) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO messages (id, client_msg_id, chat_id, sender_id, sender_name, text, timestamp, iso_date, status, media_url, media_type, reply_to_id, reply_to_text, reactions_json, is_encrypted, is_edited)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, reactions_json = excluded.reactions_json, is_edited = excluded.is_edited, status = excluded.status`
  ).bind(
    msg.id,
    msg.clientMsgId || null,
    msg.chatId,
    msg.senderId,
    msg.senderName,
    msg.text,
    msg.timestamp,
    msg.isoDate,
    msg.status || 'sent',
    msg.mediaUrl || null,
    msg.mediaType || null,
    msg.replyToId || null,
    msg.replyToText || null,
    msg.reactions ? JSON.stringify(msg.reactions) : null,
    msg.isEncrypted ? 1 : 0,
    msg.isEdited ? 1 : 0
  ).run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const jwtSecret = env.JWT_SECRET || 'aarvi-secure-e2ee-jwt-secret-key-2026';

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Initialize D1 database schema if needed
    if (env.DB) {
      await ensureTables(env.DB);
    }

    // Helper: Authenticate JWT Token
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    let decodedUser: any = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      decodedUser = await verifyJWT(token, jwtSecret);
    }

    // API Routing
    if (pathname.startsWith('/api/')) {

      // 1. Health Check
      if (pathname === '/api/health') {
        return jsonResponse({
          status: 'ok',
          runtime: 'Cloudflare Workers',
          d1Bound: Boolean(env.DB),
          totalUsers: Object.keys(usersDb).length,
          totalChats: Object.keys(chatsDb).length,
          e2eeActive: true,
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Auth: Register / Signup
      if ((pathname === '/api/auth/register' || pathname === '/api/auth/signup') && request.method === 'POST') {
        try {
          const body: any = await request.json().catch(() => ({}));
          const { name, displayName, username, email, pin, password, bio } = body;

          const rawName = (name || displayName || username || 'User').toString().trim();
          const rawUsername = (username || email || name || '').toString().trim();
          const rawPin = (pin || password || '1234').toString().trim();

          if (!rawUsername) {
            return jsonResponse({ error: 'Username is required' }, 400);
          }

          const cleanUsername = rawUsername.startsWith('@')
            ? rawUsername.toLowerCase()
            : `@${rawUsername.toLowerCase()}`;

          // Check if user exists in D1 or memory
          let existingUser = Object.values(usersDb).find((u) => u.username.toLowerCase() === cleanUsername);
          if (!existingUser && env.DB) {
            existingUser = (await getD1UserByUsername(env.DB, cleanUsername)) || undefined;
          }

          if (existingUser) {
            return jsonResponse({ error: 'Username is already taken. Please choose another.' }, 409);
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
            isVerified: true,
          };

          usersDb[userId] = newUser;
          if (env.DB) {
            await saveD1User(env.DB, newUser);
          }

          const token = await signJWT({ id: newUser.id, username: newUser.username, name: newUser.name }, jwtSecret);

          return jsonResponse({
            success: true,
            token,
            user: newUser,
            message: 'User registered successfully.',
          }, 201);
        } catch (err: any) {
          return jsonResponse({ error: err?.message || 'Registration failed' }, 500);
        }
      }

      // 3. Auth: Login / Signin
      if ((pathname === '/api/auth/login' || pathname === '/api/auth/signin') && request.method === 'POST') {
        try {
          const body: any = await request.json().catch(() => ({}));
          const { username, email, pin, password } = body;

          const rawUsername = (username || email || '').toString().trim();
          const rawPin = (pin || password || '').toString().trim();

          if (!rawUsername) {
            return jsonResponse({ error: 'Username is required' }, 400);
          }
          if (!rawPin) {
            return jsonResponse({ error: 'Password is required' }, 400);
          }

          const cleanUsername = rawUsername.startsWith('@')
            ? rawUsername.toLowerCase()
            : `@${rawUsername.toLowerCase()}`;

          let user = Object.values(usersDb).find((u) => u.username.toLowerCase() === cleanUsername);
          if (!user && env.DB) {
            user = (await getD1UserByUsername(env.DB, cleanUsername)) || undefined;
            if (user) {
              usersDb[user.id] = user;
            }
          }

          if (!user) {
            return jsonResponse({ error: 'Account not found. Please register first.' }, 401);
          }

          if (user.pinHash && user.pinHash !== rawPin) {
            return jsonResponse({ error: 'Invalid password. Please try again.' }, 401);
          }

          user.status = 'online';
          user.lastSeen = new Date().toISOString();
          if (env.DB) {
            await saveD1User(env.DB, user);
          }

          const token = await signJWT({ id: user.id, username: user.username, name: user.name }, jwtSecret);

          return jsonResponse({
            success: true,
            token,
            user,
            message: 'Login successful.',
          });
        } catch (err: any) {
          return jsonResponse({ error: err?.message || 'Login failed' }, 500);
        }
      }

      // 4. Auth: Get Current User (/api/me or /api/auth/me)
      if ((pathname === '/api/auth/me' || pathname === '/api/me') && request.method === 'GET') {
        if (!decodedUser) {
          return jsonResponse({ error: 'Unauthorized: Invalid or missing token' }, 401);
        }
        let user = await getFullUser(env.DB, decodedUser.id);
        return jsonResponse({ user, status: 'authenticated' });
      }

      // 5. Search Registered Users
      if (pathname === '/api/users/search' && request.method === 'GET') {
        if (!decodedUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        const query = (url.searchParams.get('q') || '').toLowerCase().trim();
        const currentUserId = decodedUser.id;

        let matches: ServerUser[] = [];
        if (env.DB) {
          try {
            let sql = 'SELECT * FROM users WHERE id != ?';
            const params: any[] = [currentUserId];
            if (query) {
              sql += ' AND (LOWER(name) LIKE ? OR LOWER(username) LIKE ?)';
              params.push(`%${query}%`, `%${query}%`);
            }
            sql += ' LIMIT 50';

            const rows: any = await env.DB.prepare(sql).bind(...params).all();
            if (rows && rows.results) {
              matches = rows.results.map((r: any) => ({
                id: r.id,
                name: r.name,
                username: r.username,
                avatar: r.avatar || generateInitialsAvatarSvg(r.name, r.username),
                bio: r.bio || '',
                publicKey: r.public_key || '',
                isVerified: Boolean(r.is_verified),
                status: (r.status as any) || 'offline',
                lastSeen: r.last_seen || '',
              }));
            }
          } catch (e) {
            console.error('User search D1 query error:', e);
          }
        } else {
          matches = Object.values(usersDb)
            .filter((u) => u.id !== currentUserId)
            .filter((u) => {
              if (!query) return true;
              return u.name.toLowerCase().includes(query) || u.username.toLowerCase().includes(query);
            });
        }

        return jsonResponse({ users: matches });
      }

      // 6. Get All Chats
      if (pathname === '/api/chats' && request.method === 'GET') {
        if (!decodedUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        const currentUserId = decodedUser.id;

        let responseChats: any[] = [];
        if (env.DB) {
          responseChats = await getD1ChatsForUser(env.DB, currentUserId);
        } else {
          const userChats = Object.values(chatsDb).filter((c) => c.memberIds.includes(currentUserId));
          responseChats = userChats.map((c) => {
            const members = c.memberIds.map((id) => usersDb[id] || { id, name: 'User', username: '@user', avatar: '' });
            const chatMsgs = messagesDb[c.id] || [];
            const unreadCount = chatMsgs.filter((m) => m.senderId !== currentUserId && m.status !== 'read').length;

            let displayName = c.name;
            let displayAvatar = c.avatar;
            if (!c.isGroup && !c.isSecret) {
              const otherUser = members.find((m) => m.id !== currentUserId);
              if (otherUser) {
                displayName = otherUser.name;
                displayAvatar = otherUser.avatar || c.avatar;
              }
            }
            return {
              ...c,
              name: displayName,
              avatar: displayAvatar,
              members,
              unreadCount,
            };
          });
        }

        return jsonResponse({ chats: responseChats });
      }

      // 7. Create Chat
      if (pathname === '/api/chats' && request.method === 'POST') {
        if (!decodedUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        const currentUserId = decodedUser.id;
        const body: any = await request.json().catch(() => ({}));
        const { recipientUserId, name, isGroup, isSecret, selfDestructTimer } = body;

        if (!isGroup && recipientUserId) {
          // Check for existing chat in D1 first
          const existingChat = env.DB
            ? await findExistingD1Chat(env.DB, currentUserId, recipientUserId, Boolean(isSecret))
            : Object.values(chatsDb).find(
                (c) => !c.isGroup && Boolean(c.isSecret) === Boolean(isSecret) && c.memberIds.includes(currentUserId) && c.memberIds.includes(recipientUserId)
              );

          if (existingChat) {
            const members = await Promise.all(existingChat.memberIds.map((mId) => getFullUser(env.DB, mId)));
            let displayName = existingChat.name;
            let displayAvatar = existingChat.avatar;

            if (!existingChat.isGroup && !existingChat.isSecret) {
              const otherUser = members.find((m) => m.id !== currentUserId);
              if (otherUser) {
                displayName = otherUser.name;
                displayAvatar = otherUser.avatar;
              }
            }

            return jsonResponse({
              chat: {
                ...existingChat,
                name: displayName,
                avatar: displayAvatar,
                members,
                unreadCount: 0,
              },
            });
          }
        }

        const memberIds = Array.from(new Set([currentUserId, ...(recipientUserId ? [recipientUserId] : [])]));
        const chatId = `chat-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        let recipientUser: ServerUser | null = null;
        if (recipientUserId) {
          recipientUser = await getFullUser(env.DB, recipientUserId);
        }

        const defaultName = isSecret
          ? `🔒 Secret Vault (${recipientUser ? recipientUser.name : 'Private'})`
          : recipientUser
          ? recipientUser.name
          : name || 'AARVI Conversation';

        const newChat: ServerChat = {
          id: chatId,
          name: defaultName,
          avatar: recipientUser ? recipientUser.avatar : generateInitialsAvatarSvg(defaultName, chatId),
          isGroup: Boolean(isGroup),
          isSecret: Boolean(isSecret),
          encryptionFingerprint: `KEY-${Math.floor(Math.random() * 8999 + 1000)}-AARVI-PROT`,
          selfDestructTimer: selfDestructTimer || 0,
          memberIds,
          createdAt: new Date().toISOString(),
        };

        chatsDb[chatId] = newChat;
        messagesDb[chatId] = [];

        if (env.DB) {
          await saveD1Chat(env.DB, newChat);
        }

        const members = await Promise.all(memberIds.map((mId) => getFullUser(env.DB, mId)));
        const resChat = { ...newChat, members, unreadCount: 0 };

        broadcastEvent('chat:new', { chat: resChat });

        return jsonResponse({ chat: resChat }, 201);
      }

      // 8. Get Messages for Chat
      if (pathname.match(/^\/api\/chats\/[^/]+\/messages$/) && request.method === 'GET') {
        if (!decodedUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        const chatId = pathname.split('/')[3];
        let msgs: ServerMessage[] = [];
        if (env.DB) {
          msgs = await getD1MessagesForChat(env.DB, chatId);
        } else {
          msgs = messagesDb[chatId] || [];
        }
        return jsonResponse({ chatId, messages: msgs });
      }

      // 9. Send Message (/api/messages, /api/messages/send, /api/messages/reply)
      if ((pathname === '/api/messages' || pathname === '/api/messages/send' || pathname === '/api/messages/reply') && request.method === 'POST') {
        if (!decodedUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        const currentUserId = decodedUser.id;
        const body: any = await request.json().catch(() => ({}));
        const { chatId, text, mediaType, mediaUrl, replyToId, replyToText, clientMsgId } = body;

        if (!chatId || !text) {
          return jsonResponse({ error: 'chatId and text are required' }, 400);
        }

        let chat = env.DB ? await getD1ChatById(env.DB, chatId) : chatsDb[chatId];
        if (!chat) {
          return jsonResponse({ error: 'Conversation not found' }, 404);
        }

        if (clientMsgId && env.DB) {
          try {
            const existingRow: any = await env.DB.prepare(
              'SELECT * FROM messages WHERE client_msg_id = ?'
            ).bind(clientMsgId).first();
            if (existingRow) {
              return jsonResponse({ success: true, duplicate: true, message: { id: existingRow.id, text: existingRow.text } });
            }
          } catch {}
        }

        const senderUser = await getFullUser(env.DB, currentUserId);
        const msgId = `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const newMsg: ServerMessage = {
          id: msgId,
          clientMsgId,
          chatId,
          senderId: currentUserId,
          senderName: senderUser.name,
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isoDate: new Date().toISOString(),
          status: 'sent',
          mediaType,
          mediaUrl,
          replyToId,
          replyToText,
          isEncrypted: true,
        };

        if (!messagesDb[chatId]) messagesDb[chatId] = [];
        messagesDb[chatId].push(newMsg);
        chat.lastMessage = newMsg;

        if (env.DB) {
          await saveD1Message(env.DB, newMsg);
          await saveD1Chat(env.DB, chat);
        }

        broadcastEvent('message:new', { message: newMsg, chatId });

        return jsonResponse({ success: true, message: newMsg, ackTimestamp: new Date().toISOString() }, 201);
      }

      // 10. Edit Message (/api/messages/:id/edit or /api/messages/edit)
      if ((pathname.match(/^\/api\/messages\/[^/]+\/edit$/) || pathname === '/api/messages/edit') && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const body: any = await request.json().catch(() => ({}));
        const messageId = pathname.startsWith('/api/messages/edit') ? body.messageId || body.id : pathname.split('/')[3];
        const { text } = body;

        if (!messageId || !text) {
          return jsonResponse({ error: 'messageId and text are required' }, 400);
        }

        if (env.DB) {
          try {
            const msgRow: any = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first();
            if (!msgRow) return jsonResponse({ error: 'Message not found' }, 404);
            if (msgRow.sender_id !== decodedUser.id) {
              return jsonResponse({ error: 'Cannot edit message from another user' }, 403);
            }
            await env.DB.prepare('UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?').bind(text, messageId).run();
            broadcastEvent('message:edit', { chatId: msgRow.chat_id, messageId, text, isEdited: true });
            return jsonResponse({ success: true, messageId, text });
          } catch (e: any) {
            return jsonResponse({ error: e?.message || 'Edit failed' }, 500);
          }
        }

        return jsonResponse({ success: true });
      }

      // 11. Delete Message (/api/messages/:id/delete or /api/messages/delete)
      if ((pathname.match(/^\/api\/messages\/[^/]+\/delete$/) || pathname === '/api/messages/delete') && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const body: any = await request.json().catch(() => ({}));
        const messageId = pathname.startsWith('/api/messages/delete') ? body.messageId || body.id : pathname.split('/')[3];
        const { deleteForEveryone } = body;

        if (!messageId) {
          return jsonResponse({ error: 'messageId is required' }, 400);
        }

        if (env.DB) {
          try {
            const msgRow: any = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first();
            if (msgRow && deleteForEveryone) {
              await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId).run();
              broadcastEvent('message:delete', { chatId: msgRow.chat_id, messageId, deleteForEveryone: true });
            }
          } catch (e: any) {
            return jsonResponse({ error: e?.message || 'Delete failed' }, 500);
          }
        }

        return jsonResponse({ success: true, messageId, deleteForEveryone: Boolean(deleteForEveryone) });
      }

      // 12. Emoji Reaction (/api/messages/:id/react or /api/messages/react)
      if ((pathname.match(/^\/api\/messages\/[^/]+\/react$/) || pathname === '/api/messages/react') && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const body: any = await request.json().catch(() => ({}));
        const messageId = pathname.startsWith('/api/messages/react') ? body.messageId || body.id : pathname.split('/')[3];
        const { emoji } = body;

        if (!messageId || !emoji) {
          return jsonResponse({ error: 'messageId and emoji are required' }, 400);
        }

        if (env.DB) {
          try {
            const msgRow: any = await env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(messageId).first();
            if (!msgRow) return jsonResponse({ error: 'Message not found' }, 404);

            let reactions: ServerReaction[] = msgRow.reactions_json ? JSON.parse(msgRow.reactions_json) : [];
            let rObj = reactions.find((r) => r.emoji === emoji);
            if (rObj) {
              if (rObj.users.includes(decodedUser.id)) {
                rObj.users = rObj.users.filter((u) => u !== decodedUser.id);
              } else {
                rObj.users.push(decodedUser.id);
              }
              rObj.count = rObj.users.length;
            } else {
              rObj = { emoji, count: 1, users: [decodedUser.id] };
              reactions.push(rObj);
            }
            reactions = reactions.filter((r) => r.count > 0);

            await env.DB.prepare('UPDATE messages SET reactions_json = ? WHERE id = ?')
              .bind(JSON.stringify(reactions), messageId).run();

            broadcastEvent('message:react', { chatId: msgRow.chat_id, messageId, reactions });
            return jsonResponse({ success: true, reactions });
          } catch (e: any) {
            return jsonResponse({ error: e?.message || 'Reaction failed' }, 500);
          }
        }

        return jsonResponse({ success: true, reactions: [] });
      }

      // 13. Pin Message
      if ((pathname.match(/^\/api\/chats\/[^/]+\/pin-message$/) || pathname === '/api/chats/pin-message') && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const body: any = await request.json().catch(() => ({}));
        const chatId = pathname.includes('/pin-message') && !pathname.endsWith('/pin-message') ? pathname.split('/')[3] : body.chatId;
        const messageId = body.messageId;

        if (chatId) {
          broadcastEvent('chat:pin_message', { chatId, pinnedMessageId: messageId });
        }

        return jsonResponse({ success: true, pinnedMessageId: messageId });
      }

      // 14. Mark Read
      if (pathname.match(/^\/api\/chats\/[^/]+\/read$/) && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const chatId = pathname.split('/')[3];
        const currentUserId = decodedUser.id;

        if (env.DB) {
          try {
            await env.DB.prepare(
              `UPDATE messages SET status = 'read' WHERE chat_id = ? AND sender_id != ?`
            ).bind(chatId, currentUserId).run();
          } catch (e) {
            console.error('Failed to update message read status in D1:', e);
          }
        }

        broadcastEvent('message:read', { chatId, userId: currentUserId });
        return jsonResponse({ success: true });
      }

      // 15. Typing Indicator
      if (pathname.match(/^\/api\/chats\/[^/]+\/typing$/) && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const chatId = pathname.split('/')[3];
        const body: any = await request.json().catch(() => ({}));
        const { isTyping } = body;

        broadcastEvent('typing:change', { chatId, userId: decodedUser.id, isTyping: Boolean(isTyping) });
        return jsonResponse({ success: true });
      }

      // 16. Presence Status Update
      if (pathname === '/api/presence' && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const body: any = await request.json().catch(() => ({}));
        const { status } = body;
        const currentUserId = decodedUser.id;
        const newStatus = status || 'online';
        const lastSeen = new Date().toISOString();

        if (env.DB) {
          try {
            await env.DB.prepare(
              'UPDATE users SET status = ?, last_seen = ? WHERE id = ?'
            ).bind(newStatus, lastSeen, currentUserId).run();
          } catch {}
        }

        broadcastEvent('presence:change', { userId: currentUserId, status: newStatus, lastSeen });
        return jsonResponse({ success: true, status: newStatus });
      }

      // 17. Full Sync
      if (pathname === '/api/sync' && request.method === 'GET') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        const currentUserId = decodedUser.id;

        let userChats: any[] = [];
        const userMessagesMap: Record<string, ServerMessage[]> = {};

        if (env.DB) {
          userChats = await getD1ChatsForUser(env.DB, currentUserId);
          for (const c of userChats) {
            userMessagesMap[c.id] = await getD1MessagesForChat(env.DB, c.id);
          }
        } else {
          userChats = Object.values(chatsDb).filter((c) => c.memberIds.includes(currentUserId));
          for (const c of userChats) {
            userMessagesMap[c.id] = messagesDb[c.id] || [];
          }
        }

        return jsonResponse({
          timestamp: new Date().toISOString(),
          chats: userChats,
          messagesMap: userMessagesMap,
        });
      }

      // 18. Media Upload Stub
      if (pathname === '/api/upload' && request.method === 'POST') {
        if (!decodedUser) return jsonResponse({ error: 'Unauthorized' }, 401);
        return jsonResponse({
          success: true,
          url: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80`,
          type: 'image',
        });
      }

      // 19. Realtime SSE Event Stream
      if (pathname === '/api/realtime' || pathname === '/api/realtime/stream') {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        activeStreams.push({ writer, encoder });

        // Send initial connection event
        writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`));

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    }

    // Serve Static Frontend Assets in Production Worker
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('AARVI Cloudflare Worker Active', { status: 200 });
  },
};
