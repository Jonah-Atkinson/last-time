import { useState, type FormEvent } from 'react'
import { completeSetup, type Profile } from '../lib/profile'

type Props = {
  userId: string
  onDone: (profile: Profile) => void
}

export default function Setup({ userId, onDone }: Props) {
  const [name, setName] = useState('')
  // null = not answered. The spec requires an explicit choice, so neither
  // option is pre-selected and the button stays disabled until one is picked.
  const [rewards, setRewards] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const trimmed = name.trim()
  const nameValid = trimmed.length >= 1 && trimmed.length <= 40
  const canSubmit = nameValid && rewards !== null && !busy

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || rewards === null) return
    setBusy(true)
    setMessage(null)
    try {
      onDone(await completeSetup(userId, trimmed, rewards))
    } catch {
      setMessage("Couldn't save your setup. Try again.")
      setBusy(false)
    }
  }

  return (
    <main className="card">
      <h1>Welcome</h1>
      <p className="muted">Two quick things before you start.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="name">What should we call you?</label>
        <input
          id="name"
          maxLength={40}
          autoComplete="nickname"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <fieldset>
          <legend>Grow a companion?</legend>
          <p className="muted small">
            A small plant grows each time you finish a routine on time. Missing one pauses it; it never shrinks.
          </p>
          <label className="choice">
            <input type="radio" name="rewards" checked={rewards === true} onChange={() => setRewards(true)} />
            Yes, grow one
          </label>
          <label className="choice">
            <input type="radio" name="rewards" checked={rewards === false} onChange={() => setRewards(false)} />
            No thanks
          </label>
          <p className="muted small">You can change this later in Settings.</p>
        </fieldset>

        <button type="submit" disabled={!canSubmit}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
      {message && <p className="error" role="alert">{message}</p>}
    </main>
  )
}
