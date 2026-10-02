import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

const RESEND_SECONDS = 60 // Supabase allows one code request per email per 60 s

export default function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode() {
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // New and returning users get the same response, so this screen
      // doesn't reveal whether an email already has an account.
      options: { shouldCreateUser: true },
    })
    setBusy(false)
    if (error) {
      setMessage(
        error.status === 429
          ? 'Too many code requests. Wait a minute and try again.'
          : "Couldn't send a code. Check the email address and try again.",
      )
      return
    }
    setStep('code')
    setCooldown(RESEND_SECONDS)
  }

  async function onEmailSubmit(e: FormEvent) {
    e.preventDefault()
    await sendCode()
  }

  async function onCodeSubmit(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setMessage('Enter the 6-digit code from the email.')
      return
    }
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' })
    setBusy(false)
    if (error) {
      // One message for wrong, expired, or already-used codes.
      setMessage('That code is wrong or expired. Request a new one.')
      setCode('')
    }
    // On success, App hears the SIGNED_IN event and moves on.
  }

  if (step === 'email') {
    return (
      <main className="card">
        <h1>Last Time</h1>
        <p className="muted">Sign in with a one-time code sent to your email.</p>
        <form onSubmit={onEmailSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
        {message && <p className="error" role="alert">{message}</p>}
      </main>
    )
  }

  return (
    <main className="card">
      <h1>Check your email</h1>
      <p className="muted">
        We sent a 6-digit code to <strong>{email.trim()}</strong>. It expires in 10 minutes.
      </p>
      <form onSubmit={onCodeSubmit}>
        <label htmlFor="code">Code</label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
      {message && <p className="error" role="alert">{message}</p>}
      <div className="row">
        <button className="link" disabled={busy || cooldown > 0} onClick={sendCode}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>
        <button
          className="link"
          onClick={() => {
            setStep('email')
            setCode('')
            setMessage(null)
          }}
        >
          Use a different email
        </button>
      </div>
    </main>
  )
}
