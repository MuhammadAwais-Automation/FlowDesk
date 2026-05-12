import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase env variables. Check .env file.')
}

// Singleton client — created once at app start
const client: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY)

export function getSupabase(): SupabaseClient {
  return client
}

// Keep for compatibility (no-op now)
export function resetSupabaseClient() {}
