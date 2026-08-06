-- AARVI D1 SQLite Database Schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  avatar TEXT,
  phone TEXT,
  bio TEXT,
  public_key TEXT,
  is_verified INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  is_group INTEGER DEFAULT 0,
  is_secret INTEGER DEFAULT 0,
  encryption_fingerprint TEXT NOT NULL,
  self_destruct_timer INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  iso_date TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  is_secret INTEGER DEFAULT 0,
  self_destruct_seconds INTEGER DEFAULT 0,
  media_url TEXT,
  media_type TEXT,
  reply_to_id TEXT,
  reply_to_text TEXT,
  is_encrypted INTEGER DEFAULT 1,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
