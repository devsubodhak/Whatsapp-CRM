-- ============================================================
-- 031_bank_transfer_slips.sql — manual bank-transfer payments
--
-- Lets a customer pay by bank transfer and upload a payment slip photo
-- on WhatsApp instead of (or as well as) the PayHere card link. The slip
-- is attached to the order, which moves to AWAITING_VERIFICATION until an
-- admin ticks "Confirmed" on the Orders dashboard (→ SUCCESS).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- How the order is being paid, and the uploaded slip (a
-- /api/whatsapp/media/<id> proxy URL the dashboard can render).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'payhere';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS slip_url text;

-- Allow the new status + constrain payment_method. Drop-then-add because
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('PENDING_PAYMENT', 'AWAITING_VERIFICATION', 'SUCCESS', 'FAILED', 'EXPIRED'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('payhere', 'bank_transfer'));

-- Bank account details the assistant shares for transfers (account name,
-- number, bank, branch…). Plain text, edited in Settings → AI Assistant.
ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS bank_transfer_details text;
