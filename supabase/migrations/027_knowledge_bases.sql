-- ============================================================
-- 027_knowledge_bases.sql — Knowledge bases for AI auto-reply
--
-- Backs the `ai_reply` automation step. A knowledge base is a named
-- blob of text/markdown (prices, product details, FAQ…) that the AI
-- model is given as context when drafting a reply to an inbound
-- WhatsApp message. The step references one by id; the engine loads
-- `content` and stuffs it into the model prompt (no embeddings/RAG —
-- the whole file fits in the context window).
--
-- Design notes
--   - Account-scoped, never user-scoped (mirrors automations / tags /
--     api_keys post-017). `user_id` only records the author for audit.
--   - `content` is plain text — the manager UI reads uploaded .md/.txt
--     files into this column, or the user pastes directly.
--
-- RLS
--   Settings-class table, same shape as `api_keys` (026): any member
--   may read the roster; only admin+ may create / edit / delete. The
--   automation engine reads rows with the service-role client (it has
--   no auth.uid()), so a separate read path is unnecessary.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name        text NOT NULL,
  content     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Every "list this account's knowledge bases" query filters on account_id.
CREATE INDEX IF NOT EXISTS knowledge_bases_account_id_idx ON knowledge_bases (account_id);

ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
DROP POLICY IF EXISTS knowledge_bases_select ON knowledge_bases;
CREATE POLICY knowledge_bases_select ON knowledge_bases FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS knowledge_bases_insert ON knowledge_bases;
CREATE POLICY knowledge_bases_insert ON knowledge_bases FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS knowledge_bases_update ON knowledge_bases;
CREATE POLICY knowledge_bases_update ON knowledge_bases FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS knowledge_bases_delete ON knowledge_bases;
CREATE POLICY knowledge_bases_delete ON knowledge_bases FOR DELETE
  USING (is_account_member(account_id, 'admin'));
