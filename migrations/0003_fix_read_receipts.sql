-- Migration: Fix read-receipts (double-tick) not updating for the sender.
--
-- Root cause: /api/sync's incremental fetch only looked for messages whose
-- iso_date > since (i.e. brand-new messages). A read-receipt or reaction
-- is an UPDATE on an EXISTING row, so it was invisible to incremental
-- sync and only ever reached the sender via the live SSE push. If that
-- push was missed (e.g. during "Realtime Connection Re-establishing"),
-- the double-tick / reaction update was lost until a full page reload.
--
-- This adds an `updated_at` column that gets stamped on every status
-- change (read, edit, reaction), and the sync query now also matches
-- `updated_at > since` as a fallback — so even if the live push is
-- missed, the next 30s background sync will pick it up.
--
-- Apply with: npx wrangler d1 migrations apply aarvi-db --remote

ALTER TABLE messages ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_chat_updated
  ON messages(chat_id, updated_at);
