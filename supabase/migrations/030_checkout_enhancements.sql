-- ============================================================
-- 030_checkout_enhancements.sql — richer AI checkout
--
-- Builds on 029:
--   - products gain image_url + video_url so the assistant can share a
--     photo / YouTube link when a customer asks.
--   - orders gain the contact + delivery details the assistant now
--     collects BEFORE payment, a human-friendly order_number, and an
--     admin confirmation flag (the new Orders dashboard checkbox).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ----- product media -----------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url text;

-- ----- order contact + delivery + admin confirmation ---------
-- Human-friendly incrementing order number (e.g. #1001) shown to the
-- customer and in the dashboard. Distinct from the uuid primary key.
CREATE SEQUENCE IF NOT EXISTS orders_order_number_seq START 1001;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number bigint;
-- Backfill + default for new rows. Done after the column exists so the
-- DEFAULT applies going forward; existing rows get a number too.
ALTER TABLE orders ALTER COLUMN order_number SET DEFAULT nextval('orders_order_number_seq');
UPDATE orders SET order_number = nextval('orders_order_number_seq') WHERE order_number IS NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone text;
-- Admin "confirmed" checkbox on the Orders dashboard. NULL = not yet
-- confirmed; timestamp = who/when can be added later if needed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
