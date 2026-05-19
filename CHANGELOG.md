# Changelog

User-visible changes in `wacrm`. Self-hosters: when pulling an update,
check this file for any **migration required** notes and apply the
matching SQL files from `supabase/migrations/` against your Supabase
project before restarting the app.

Versions follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Chat actions in the inbox: emoji reactions, reply-with-quote, and
  copy-text on individual messages. Hover on desktop, long-press on
  touch. Outbound reactions and replies forward to WhatsApp via the
  Cloud API; inbound reactions and swipe-replies from customers arrive
  through the webhook and appear in real time.

### Migration required

- Apply `supabase/migrations/009_message_actions.sql` to your Supabase
  project. It adds `messages.reply_to_message_id` and the new
  `message_reactions` table (with RLS and realtime). The migration is
  idempotent — safe to re-run.

### Changed

- The webhook no longer stores inbound customer reactions as fake text
  messages. They are written to `message_reactions` instead, so any
  custom queries that counted reactions as messages will need updating.
