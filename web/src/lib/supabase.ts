import { createClient } from '@supabase/supabase-js'

// Both values come from web/.env.local (never committed). Anything named
// VITE_* is bundled into the JavaScript every visitor downloads, so only
// the PUBLISHABLE key may go here. That's safe by design: Row Level
// Security in the database decides what each user can touch.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy web/.env.example to web/.env.local and fill both in.',
  )
}

// Tripwire for threat #6: the secret / service_role key bypasses RLS.
// If it ever ends up here, refuse to start instead of shipping it to browsers.
function looksLikeSecretKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true
  const parts = k.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      return payload?.role === 'service_role'
    } catch {
      return false
    }
  }
  return false
}

if (looksLikeSecretKey(key)) {
  throw new Error(
    'STOP: web/.env.local contains the SECRET (service_role) key. Use the publishable key, then rotate the secret key in Supabase.',
  )
}

// Sessions persist per device until sign-out (spec decision). supabase-js
// keeps them in localStorage, which any injected script could read. That's
// one reason the XSS rules (React escaping, no raw HTML) matter.
export const supabase = createClient(url, key)
