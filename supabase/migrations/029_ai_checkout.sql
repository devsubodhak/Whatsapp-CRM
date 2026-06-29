-- ============================================================
-- 029_ai_checkout.sql — AI-driven WhatsApp checkout (PayHere)
--
-- Adds conversational commerce: a Gemini assistant gathers an order,
-- the app prices it from a trusted `products` catalog, creates an
-- `orders` row, and sends a PayHere "Pay Now" button. A toggle on
-- whatsapp_config turns the whole thing on/off per account.
--
-- Design notes
--   - PRICING IS NEVER SET BY THE AI. The model only collects
--     item/quantity/customization; the server looks the item up in
--     `products` and computes the amount. This keeps a customer (or a
--     prompt injection) from talking the bot into a discount.
--   - orders are written by the server (webhook + PayHere notify) using
--     the service-role client, so RLS here is read-only for dashboard
--     visibility. Customers are not logged-in users — there's no member
--     write path to protect.
--   - conversations.checkout_state is a tiny state machine: IDLE →
--     WAITING_FOR_PAYMENT (bot sent a Pay button) → COMPLETED (paid).
--     The webhook clears a stale WAITING_FOR_PAYMENT lazily when the
--     pending order has expired, so a customer is never locked out.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ----- products: the trusted price catalog -----------------
CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  unit_price  numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  currency    text NOT NULL DEFAULT 'LKR',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_account_idx ON products (account_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- Members read; admins manage (settings-class, like tags/api_keys).
DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ----- orders ----------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  phone           text NOT NULL,
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency        text NOT NULL DEFAULT 'LKR',
  status          text NOT NULL DEFAULT 'PENDING_PAYMENT'
                    CHECK (status IN ('PENDING_PAYMENT', 'SUCCESS', 'FAILED', 'EXPIRED')),
  items           jsonb,
  payhere_ref     text,                 -- PayHere payment_id from the callback
  expires_at      timestamptz,          -- after this, an unpaid order is dead
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_account_idx ON orders (account_id);
CREATE INDEX IF NOT EXISTS orders_conversation_idx ON orders (conversation_id);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON orders (phone);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- Dashboard read-only. All writes go through the service-role client
-- (webhook creates, PayHere notify settles), which bypasses RLS.
DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT
  USING (is_account_member(account_id));

-- ----- conversation checkout state -------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS checkout_state text NOT NULL DEFAULT 'IDLE'
    CHECK (checkout_state IN ('IDLE', 'WAITING_FOR_PAYMENT', 'COMPLETED'));

-- ----- per-account on/off switch ---------------------------
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS ai_checkout_enabled boolean NOT NULL DEFAULT false;
