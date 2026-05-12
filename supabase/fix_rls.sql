-- =====================================================
-- FIX: Disable Row Level Security on all tables
-- =====================================================
-- Supabase enables RLS by default on all tables.
-- Since this is a single-user desktop app (no public exposure),
-- we simply disable RLS so the anon key can read/write freely.
--
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- =====================================================

ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE folders DISABLE ROW LEVEL SECURITY;
ALTER TABLE prompts DISABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE sops DISABLE ROW LEVEL SECURITY;
ALTER TABLE sop_steps DISABLE ROW LEVEL SECURITY;
ALTER TABLE sop_runs DISABLE ROW LEVEL SECURITY;
