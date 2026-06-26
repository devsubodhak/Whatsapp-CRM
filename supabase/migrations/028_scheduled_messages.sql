-- ============================================================
-- 028_scheduled_messages.sql — Schedule 1:1 WhatsApp messages
--
-- Lets an agent compose a message (free text or an approved template)
-- in a conversation and have it sent at a future time. A cron endpoint
-- (/api/whatsapp/schedule/cron) drains due rows, sends via Meta, and
-- records the outcome — the same drain pattern as
-- automation_pending_executions (migration 006).
--
-- Design notes
--   - Account-scoped tenancy (account_id), like every table post-017.
--     `user_id` records who scheduled it (audit + sender-of-record) and
--     is ON DELETE SET NULL so removing a teammate doesn't wipe pending
--     sends the rest of the team is relying on.
--   - conversation_id / contact_id are the send target. ON DELETE
--     CASCADE: if the conversation or contact is deleted, drop the
--     pending send too — there's nothing left to send to.
--   - message_type 'text' uses content_text; 'template' uses
--     template_name + language + variables (positional params as JSONB).
--   - status lifecycle: scheduled → sending (claimed by cron) →
--     sent | failed. 'failed' keeps error_message so the UI can explain
--     why (e.g. the 24-hour window closed and free text was rejected).
--
-- RLS
--   Sending is a normal agent action (the /api/whatsapp/send route only
--   requires an authenticated account member), so any member may
--   schedule, view, and cancel their account's rows. The cron drains
--   with the service-role client (RLS-bypassing) since it has no user
--   session.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id         uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  message_type       text NOT NULL CHECK (message_type IN ('text', 'template')),
  content_text       text,
  template_name      text,
  template_language  text,
  template_variables jsonb,

  scheduled_at       timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled', 'sending', 'sent', 'failed')),
  error_message      text,
  sent_message_id    text,                 -- Meta wamid once sent

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The cron drain hits (status, scheduled_at); the per-conversation bar
-- filters by conversation_id. Both get an index.
CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON scheduled_messages (status, scheduled_at);
CREATE INDEX IF NOT EXISTS scheduled_messages_conversation_idx
  ON scheduled_messages (conversation_id);
CREATE INDEX IF NOT EXISTS scheduled_messages_account_idx
  ON scheduled_messages (account_id);

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

-- Any account member can see / schedule / reschedule / cancel.
DROP POLICY IF EXISTS scheduled_messages_select ON scheduled_messages;
CREATE POLICY scheduled_messages_select ON scheduled_messages FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_insert ON scheduled_messages;
CREATE POLICY scheduled_messages_insert ON scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_update ON scheduled_messages;
CREATE POLICY scheduled_messages_update ON scheduled_messages FOR UPDATE
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS scheduled_messages_delete ON scheduled_messages;
CREATE POLICY scheduled_messages_delete ON scheduled_messages FOR DELETE
  USING (is_account_member(account_id));
