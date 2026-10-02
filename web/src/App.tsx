import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { fetchProfile, type Profile } from './lib/profile'
import SignIn from './pages/SignIn'
import Setup from './pages/Setup'
import Home from './pages/Home'

// Routing is a simple decision, in this order:
//   no session              -> SignIn
//   session, not onboarded  -> Setup
//   session, onboarded      -> Home
export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  // Tagged with the user it belongs to, so a previous user's profile is
  // never shown after switching accounts on the same device.
  const [loaded, setLoaded] = useState<{ userId: string; profile: Profile | null; error: boolean } | null>(null)

  useEffect(() => {
    // Only store the session here. supabase-js warns against calling other
    // Supabase methods inside this callback, so profile loading happens in
    // the effect below instead.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setAuthReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchProfile(userId)
      .then((profile) => {
        if (!cancelled) setLoaded({ userId, profile, error: false })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ userId, profile: null, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const current = loaded && loaded.userId === userId ? loaded : null

  if (!authReady) return <main className="card muted">Loading…</main>
  if (!session || !userId) return <SignIn />
  if (current?.error) {
    return (
      <main className="card">
        <p className="error">Couldn't load your profile.</p>
        <button onClick={() => supabase.auth.signOut({ scope: 'local' })}>Sign out</button>
      </main>
    )
  }
  const profile = current?.profile
  if (!profile) return <main className="card muted">Loading…</main>
  if (!profile.onboarded_at) {
    return <Setup userId={userId} onDone={(p) => setLoaded({ userId, profile: p, error: false })} />
  }
  return <Home profile={profile} />
}
