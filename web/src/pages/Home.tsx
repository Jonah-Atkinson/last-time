import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/profile'

export default function Home({ profile }: { profile: Profile }) {
  const [busy, setBusy] = useState(false)

  // supabase-js signs out EVERYWHERE by default (scope 'global').
  // Both scopes are spelled out on purpose so neither is an accident.
  async function signOut(scope: 'local' | 'global') {
    setBusy(true)
    await supabase.auth.signOut({ scope })
    setBusy(false)
  }

  return (
    <main className="card">
      {/* Rendered as text: React escapes it, so a name like <script> is harmless. */}
      <h1>Hi, {profile.display_name}</h1>
      <p className="muted">Your routines will live here (Slice 3).</p>
      <p className="muted small">
        Companion: {profile.rewards_enabled ? 'on' : 'off'} · Time zone: {profile.timezone}
      </p>
      <div className="row">
        <button disabled={busy} onClick={() => signOut('local')}>
          Sign out
        </button>
        <button className="secondary" disabled={busy} onClick={() => signOut('global')}>
          Sign out everywhere
        </button>
      </div>
    </main>
  )
}
