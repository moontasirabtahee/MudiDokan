-- ═══════════════════════════════════════════════════════════════════════════
-- MudiDokan · 000100 · Extensions and the private `app` schema
-- ═══════════════════════════════════════════════════════════════════════════

-- Supabase keeps extensions out of `public`; create the schema so this file
-- also applies cleanly to a plain Postgres instance.
create schema if not exists extensions;

-- pg_trgm powers search-as-you-type on product names. A shopkeeper types "চাল"
-- or "chal" mid-word, and LIKE '%…%' cannot use a btree index.
create extension if not exists pg_trgm with schema extensions;

-- gen_random_uuid() is core since PG13, but pgcrypto is kept for digest() used
-- when hashing invite tokens.
create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────────────────────────────────────────────────────
-- Private schema for row-level-security helpers.
-- Kept out of `public` so PostgREST never exposes them as RPC endpoints:
-- these functions are SECURITY DEFINER and must not be callable directly.
-- ───────────────────────────────────────────────────────────────────────────
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

comment on schema app is
  'Private helpers for RLS policies and triggers. Not exposed through the API.';
