import { useState, type FormEvent } from 'react'
import type { Category } from '../lib/categories'
import { iconFor } from '../lib/categories'
import { createTask, deleteTask, LIMITS, setArchived, updateTask, type Task } from '../lib/tasks'
import { friendlyError } from '../lib/errors'

type Props = {
  task: Task | null // null = new task
  categories: Category[]
  onSaved: () => void
  onCancel: () => void
}

export default function TaskForm({ task, categories, onSaved, onCancel }: Props) {
  const [name, setName] = useState(task?.name ?? '')
  const [categoryId, setCategoryId] = useState<string>(task?.category_id ?? '')
  const [days, setDays] = useState<string>(String(task?.interval_days ?? 7))
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Mirror the database CHECKs so mistakes are caught before the round trip.
  // The database still enforces them; this is only for a nicer message.
  const trimmed = name.trim()
  const daysNum = Number(days)
  const nameOk = trimmed.length >= 1 && trimmed.length <= LIMITS.name
  const daysOk = Number.isInteger(daysNum) && daysNum >= LIMITS.minDays && daysNum <= LIMITS.maxDays
  const notesOk = notes.length <= LIMITS.notes
  const canSave = nameOk && daysOk && notesOk && !busy

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      onSaved()
    } catch (err) {
      setMessage(friendlyError(err, fallback))
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const input = {
      name: trimmed,
      category_id: categoryId || null,
      interval_days: daysNum,
      notes: notes.trim() ? notes.trim() : null,
    }
    void run(() => (task ? updateTask(task.id, input) : createTask(input)), "Couldn't save the routine. Try again.")
  }

  return (
    <main className="card">
      <h1>{task ? 'Edit routine' : 'New routine'}</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="task-name">Name</label>
        <input
          id="task-name"
          maxLength={LIMITS.name}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Change the furnace filter"
        />

        <label htmlFor="task-category">Category</label>
        <select id="task-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {iconFor(c.icon)} {c.name}
            </option>
          ))}
        </select>

        <label htmlFor="task-days">Every how many days?</label>
        <input
          id="task-days"
          type="number"
          inputMode="numeric"
          min={LIMITS.minDays}
          max={LIMITS.maxDays}
          step={1}
          required
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
        {!daysOk && <p className="error small">Use a whole number from 1 to 3650.</p>}

        <label htmlFor="task-notes">Notes (optional)</label>
        <textarea
          id="task-notes"
          rows={3}
          maxLength={LIMITS.notes}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="row">
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {task && (
        <section className="danger-zone">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(
                () => setArchived(task.id, !task.archived),
                task.archived ? "Couldn't restore it. Try again." : "Couldn't archive it. Try again.",
              )
            }
          >
            {task.archived ? 'Restore from archive' : 'Archive'}
          </button>
          <p className="muted small">
            {task.archived
              ? 'Puts it back on your list.'
              : 'Hides it from your list and keeps its history. You can restore it any time.'}
          </p>

          {!confirmDelete ? (
            <button type="button" className="link danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete permanently…
            </button>
          ) : (
            <div className="confirm" role="alert">
              <p>
                Delete <strong>{task.name}</strong> and all of its history? This can't be undone.
              </p>
              <div className="row">
                <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button
                  type="button"
                  className="danger-fill"
                  disabled={busy}
                  onClick={() => void run(() => deleteTask(task.id), "Couldn't delete it. Try again.")}
                >
                  Delete forever
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </main>
  )
}
