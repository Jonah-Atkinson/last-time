import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/profile'
import { hexFor, iconFor, listCategories, type Category } from '../lib/categories'
import { describeSchedule, listTasks, type Task } from '../lib/tasks'
import TaskForm from './TaskForm'
import Categories from './Categories'

// Which screen is showing. Kept as plain state: no router until the app
// has enough screens to need one.
type View = { kind: 'list' } | { kind: 'task'; task: Task | null } | { kind: 'categories' }

export default function Home({ profile }: { profile: Profile }) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [tasks, setTasks] = useState<Task[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoadError(false)
    try {
      const [t, c] = await Promise.all([listTasks(), listCategories()])
      setTasks(t)
      setCategories(c)
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

  const active = tasks.filter((t) => !t.archived)
  const archived = tasks.filter((t) => t.archived)

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
            <ul className="rows">{active.map(taskRow)}</ul>
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
