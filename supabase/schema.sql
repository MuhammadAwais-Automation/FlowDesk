-- AI Manager — Supabase Schema
-- Run this entire file in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- No RLS needed (single-user app)

-- ========================
-- Workspaces (YouTube Channels)
-- ========================
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- Folders inside workspaces
-- ========================
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES folders(id),
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- Prompts
-- ========================
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  tags TEXT[] DEFAULT '{}',
  variables JSONB DEFAULT '[]',
  used_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  is_favorite BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- Prompt version history
-- ========================
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- AI Account Profiles
-- ========================
CREATE TABLE ai_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,         -- 'chatgpt' | 'claude' | 'gemini' | 'grok'
  tool_url TEXT NOT NULL,          -- 'https://chat.openai.com' etc
  model_label TEXT,                -- 'GPT-4o', 'Claude 3.5', etc.
  gmail TEXT NOT NULL,
  label TEXT,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  session_partition TEXT UNIQUE NOT NULL,  -- Electron session key
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- SOPs (Standard Operating Procedures)
-- ========================
CREATE TABLE sops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  estimated_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- SOP Steps
-- ========================
CREATE TABLE sop_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id UUID REFERENCES sops(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
  ai_account_id UUID REFERENCES ai_accounts(id) ON DELETE SET NULL,
  is_manual BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ========================
-- SOP Run History
-- ========================
CREATE TABLE sop_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_id UUID REFERENCES sops(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id),
  variables JSONB DEFAULT '{}',
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',   -- 'running' | 'completed' | 'paused'
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
