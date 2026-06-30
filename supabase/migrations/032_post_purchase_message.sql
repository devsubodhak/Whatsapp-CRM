-- ============================================================
-- 032_post_purchase_message.sql
--
-- A custom message the assistant sends right after a successful payment
-- (card or verified bank transfer) — e.g. "Thanks for choosing us! Please
-- review us here: <link>". Edited in Settings → AI Assistant.
--
-- Idempotent.
-- ============================================================

ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS post_purchase_message text;
