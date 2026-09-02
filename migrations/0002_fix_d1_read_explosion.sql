-- Migration: Fix D1 free-tier daily read-limit exhaustion
-- Root cause: messages/chat_members had ZERO indexes, so every
-- "SELECT * FROM messages WHERE chat_id = ? ORDER BY iso_date" query
-- did a full table scan. Combined with frequent SSE reconnects
-- triggering full /api/sync calls, this burned 200M+ row-reads/day.
--
-- Apply with: npx wrangler d1 migrations apply aarvi-db --remote

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_iso
  ON messages(chat_id, iso_date);

CREATE INDEX IF NOT EXISTS idx_messages_chat_status
  ON messages(chat_id, status);

CREATE INDEX IF NOT EXISTS idx_chat_members_user
  ON chat_members(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_members_chat
  ON chat_members(chat_id);
