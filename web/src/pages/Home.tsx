import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/profile'
import { hexFor, iconFor, listCategories, type Category } from '../lib/categories'
import { describeSchedule, listTasks, type Task } from '../lib/tasks'
import {
  NOTE_LIMIT,
  UNDO_MINUTES,
  canStillUndo,
  completionError,
  listRecentCompletions,
  logCompletion,
  undoCompletion,
  type Completion,
} from '../lib/completions'
import { backdateLimit, daysBetween, statusFor, type Status } from '../lib/status'
import TaskForm from './TaskForm'
import Categories from './Categories'

// Which screen is showing. Kept as plain state: no router until the app
// has enough screens to need one.
type View = { kind: 'list' } | { kind: 'task'; task: Task | null } | { kind: 'categories' }

// The "Earlier…" panel: which routine, how many days back, optional note.
type Earlier = { taskId: string; daysBack: number; note: string }
type RowMessage = { taskId: string; text: string; isError: boolean }

const DAY_MS = 86_400_000

function dayOption(n: number, now: Date): string {
  if (n === 0) return 'Today'
  if (n === 1) return 'Yesterday'
  const d = new Date(now.getTime() - n * DAY_MS)
  return `${n} days ago (${d.toLocaleDateString(undefined, { weekday: 'long' })})`
}

export default function Home({ profile }: { profile: Profile }) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [completions, setCompletions] = useState<Completion[]>([])
  const [now, setNow] = useState(() => new Date())
  const [saving, setSaving] = useState<string | null>(null)
  const [justDone, setJustDone] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<Earlier | null>(null)
  const [message, setMessage] = useState<RowMessage | null>(null)

  // Ticks so "Undo" disappears at 10 minutes and "done today" rolls over
  // at midnight without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const reload = useCallback(async () => {
    setLoadError(false)
    try {
      const [t, c, done] = await Promise.all([listTasks(), listCategories(), listRecentCompletions()])
      setTasks(t)
      setCategories(c)
      setCompletions(done)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks) if (t.category_id) counts[t.category_id] = (counts[t.category_id] ?? 0) + 1
    return counts
  }, [tasks])

  // Per routine: the latest DONE time (drives status) and the latest LOGGED
  // completion (the only one Undo applies to). A backdated entry can be
  // the newest logged without being the newest done, so they're separate.
  const { latestDone, latestLogged } = useMemo(() => {
    const done = new Map<string, string>()
    const logged = new Map<string, Completion>()
    for (const c of completions) {
      const d = done.get(c.task_id)
      if (!d || c.done_at > d) done.set(c.task_id, c.done_at)
      const l = logged.get(c.task_id)
      if (!l || c.logged_at > l.logged_at) logged.set(c.task_id, c)
    }
    return { latestDone: done, latestLogged: logged }
  }, [completions])

  // Per routine: which recent days (0 = today, 1 = yesterday, ...) already
  // have a completion. Product rule (Jonah, 23 Oct): one log per routine per
  // day, so a day that's already logged isn't offered again. This is a UI
  // rule only; the streak math in Slice 5 must count days, not rows.
  const loggedDays = useMemo(() => {
    const m = new Map<string, Set<number>>()
    for (const c of completions) {
      const n = daysBetween(new Date(c.done_at), now)
      if (n < 0 || n > 5) continue
      if (!m.has(c.task_id)) m.set(c.task_id, new Set())
      m.get(c.task_id)!.add(n)
    }
    return m
  }, [completions, now])

  const statusById = useMemo(() => {
    const m = new Map<string, Status>()
    for (const t of tasks) m.set(t.id, statusFor(t, latestDone.get(t.id) ?? null, now))
    return m
  }, [tasks, latestDone, now])

  // Most overdue first; ties by name.
  const active = tasks
    .filter((t) => !t.archived)
    .sort((a, b) => statusById.get(a.id)!.dueIn - statusById.get(b.id)!.dueIn || a.name.localeCompare(b.name))
  const archived = tasks.filter((t) => t.archived)

  async function didIt(t: Task, daysBack: number, note: string | null) {
    setSaving(t.id)
    setMessage(null)
    try {
      const c = await logCompletion(t.id, new Date(Date.now() - daysBack * DAY_MS), note)
      setCompletions((prev) => [c, ...prev])
      setEarlier(null)
      setJustDone(t.id)
      // Haptic tap where the browser supports it (Android). iPhone Safari ignores it.
      navigator.vibrate?.(30)
      setTimeout(() => setJustDone((id) => (id === t.id ? null : id)), 1200)
    } catch (err) {
      setMessage({ taskId: t.id, text: completionError(err), isError: true })
    } finally {
      setSaving(null)
    }
  }

  async function undo(t: Task, c: Completion) {
    setSaving(t.id)
    setMessage(null)
    try {
      const removed = await undoCompletion(c.id)
      if (removed) {
        setCompletions((prev) => prev.filter((x) => x.id !== c.id))
        setMessage({ taskId: t.id, text: 'Undone.', isError: false })
      } else {
        setMessage({
          taskId: t.id,
          text: `Too late to undo: it's been more than ${UNDO_MINUTES} minutes, so it stays in your history.`,
          isError: true,
        })
      }
    } catch (err) {
      setMessage({ taskId: t.id, text: completionError(err), isError: true })
    } finally {
      setSaving(null)
    }
  }

  // supabase-js signs out EVERYWHERE by default (scope 'global').
  // Both scopes are spelled out on purpose so neither is an accident.
  async function signOut(scope: 'local' | 'global') {
    setBusy(true)
    await supabase.auth.signOut({ scope })
    setBusy(false)
  }

  function backToList() {
    setView({ kind: 'list' })
    void reload()
  }

  if (view.kind === 'task') {
    return (
      <TaskForm
        key={view.task?.id ?? 'new'}
        task={view.task}
        categories={categories}
        onSaved={backToList}
        onCancel={() => setView({ kind: 'list' })}
      />
    )
  }

  if (view.kind === 'categories') {
    return (
      <Categories
        categories={categories}
        taskCounts={taskCounts}
        onChanged={() => void reload()}
        onBack={() => setView({ kind: 'list' })}
      />
    )
  }

  function activeRow(t: Task) {
    const cat = t.category_id ? categoryById.get(t.category_id) : undefined
    const st = statusById.get(t.id)!
    const last = latestLogged.get(t.id)
    const undoable = last !== undefined && canStillUndo(last, now)
    const open = earlier?.taskId === t.id ? earlier : null
    // Days the database will accept: up to the routine's limit, and never
    // before the routine existed.
    const maxBack = Math.min(backdateLimit(t), daysBetween(new Date(t.created_at), now))
    const taken = loggedDays.get(t.id) ?? new Set<number>()
    const dayChoices = Array.from({ length: maxBack + 1 }, (_, n) => n).filter((n) => !taken.has(n))
    const doneToday = taken.has(0)
    const msg = message?.taskId === t.id ? message : null

    return (
      <li key={t.id}>
        <div className="row-line">
          <button className="row-main row-button grow" onClick={() => setView({ kind: 'task', task: t })}>
            <span className="dot" style={{ background: cat ? hexFor(cat.color) : 'transparent' }}>
              {cat ? iconFor(cat.icon) : ''}
            </span>
            {/* Task names and category names are rendered as text, never HTML. */}
            <span className="grow">
              {t.name}
              <span className="small block">
                <span className={`status status-${st.kind}`}>{st.label}</span>
                <span className="muted"> · {st.lastDone}</span>
              </span>
              <span className="muted small block">
                {describeSchedule(t)}
                {cat ? ` · ${cat.name}` : ''}
              </span>
            </span>
          </button>
          <button
            className={justDone === t.id ? 'did-it popped' : 'did-it'}
            disabled={saving === t.id || doneToday}
            onClick={() => void didIt(t, 0, null)}
            aria-label={doneToday ? `Done today: ${t.name}` : `Did it: ${t.name}`}
          >
            {justDone === t.id ? '✓' : doneToday ? 'Done ✓' : 'Did it'}
          </button>
        </div>

        <div className="row-actions">
          {(open || dayChoices.length > 0) && (
            <button
              className="link small"
              onClick={() =>
                setEarlier(
                  open ? null : { taskId: t.id, daysBack: dayChoices.find((n) => n >= 1) ?? dayChoices[0], note: '' },
                )
              }
            >
              {open ? 'Close' : 'Earlier or with a note…'}
            </button>
          )}
          {undoable && (
            <button className="link small" disabled={saving === t.id} onClick={() => void undo(t, last)}>
              Undo
            </button>
          )}
        </div>

        {open && (
          <div className="earlier">
            <label>
              When
              <select
                value={open.daysBack}
                onChange={(e) => setEarlier({ ...open, daysBack: Number(e.target.value) })}
              >
                {dayChoices.map((n) => (
                  <option key={n} value={n}>
                    {dayOption(n, now)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note (optional)
              <textarea
                rows={2}
                maxLength={NOTE_LIMIT}
                value={open.note}
                onChange={(e) => setEarlier({ ...open, note: e.target.value })}
              />
            </label>
            <div className="row">
              <button
                disabled={saving === t.id}
                onClick={() => void didIt(t, open.daysBack, open.note.trim() || null)}
              >
                Log it
              </button>
              <button className="secondary" onClick={() => setEarlier(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {msg && (
          <p className={msg.isError ? 'small error' : 'small muted'} role="status">
            {msg.text}
          </p>
        )}
      </li>
    )
  }

  function taskRow(t: Task) {
    const cat = t.category_id ? categoryById.get(t.category_id) : undefined
    return (
      <li key={t.id}>
        <button className="row-main row-button" onClick={() => setView({ kind: 'task', task: t })}>
          <span className="dot" style={{ background: cat ? hexFor(cat.color) : 'transparent' }}>
            {cat ? iconFor(cat.icon) : ''}
          </span>
          {/* Task names and category names are rendered as text, never HTML. */}
          <span className="grow">
            {t.name}
            <span className="muted small block">
              {describeSchedule(t)}
              {cat ? ` · ${cat.name}` : ''}
            </span>
          </span>
          <span className="muted">›</span>
        </button>
      </li>
    )
  }

  return (
    <main className="card">
      <h1>Hi, {profile.display_name}</h1>

      {loading && <p className="muted">Loading your routines…</p>}
      {loadError && (
        <p className="error" role="alert">
          Couldn't load your routines.{' '}
          <button className="link" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      )}

      {!loading && !loadError && (
        <>
          {active.length === 0 ? (
            <p className="muted">No routines yet. Add the first thing you want to keep track of.</p>
          ) : (
            <ul className="rows">{active.map(activeRow)}</ul>
          )}

          <div className="row">
            <button onClick={() => setView({ kind: 'task', task: null })}>New routine</button>
            <button className="secondary" onClick={() => setView({ kind: 'categories' })}>
              Categories
            </button>
          </div>

          {archived.length > 0 && (
            <>
              <button className="link" onClick={() => setShowArchived((s) => !s)}>
                {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
              </button>
              {showArchived && <ul className="rows archived">{archived.map(taskRow)}</ul>}
            </>
          )}
        </>
      )}

      <p className="muted small">
        Companion: {profile.rewards_enabled ? 'on' : 'off'} · Time zone: {profile.timezone}
      </p>
      <div className="row">
        <button className="secondary" disabled={busy} onClick={() => signOut('local')}>
          Sign out
        </button>
        <button className="secondary" disabled={busy} onClick={() => signOut('global')}>
          Sign out everywhere
        </button>
      </div>
    </main>
  )
}
