import { useState, type FormEvent } from 'react'
import {
  CATEGORY_COLORS,
  COLOR_HEX,
  ICON_KEYS,
  ICONS,
  createCategory,
  deleteCategory,
  hexFor,
  iconFor,
  updateCategory,
  validCategoryName,
  type Category,
  type CategoryColor,
  type IconKey,
} from '../lib/categories'
import { friendlyError } from '../lib/errors'

type Props = {
  categories: Category[]
  taskCounts: Record<string, number>
  onChanged: () => void
  onBack: () => void
}

// One editor for both "new" and "edit". editing = null means new.
function CategoryEditor({
  editing,
  onDone,
  onCancel,
}: {
  editing: Category | null
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState<CategoryColor>(editing?.color ?? 'sage')
  const [icon, setIcon] = useState<IconKey>(editing?.icon ?? 'circle')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const canSave = validCategoryName(name) && !busy

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    setMessage(null)
    const input = { name: name.trim(), color, icon }
    try {
      if (editing) await updateCategory(editing.id, input)
      else await createCategory(input)
      onDone()
    } catch (err) {
      setMessage(friendlyError(err, "Couldn't save the category. Try again."))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="editor">
      <label htmlFor="cat-name">{editing ? 'Rename' : 'New category'}</label>
      <input id="cat-name" maxLength={30} required value={name} onChange={(e) => setName(e.target.value)} />

      <fieldset>
        <legend>Color</legend>
        <div className="swatches">
          {CATEGORY_COLORS.map((c) => (
            <label key={c} className="swatch" title={c}>
              <input type="radio" name="cat-color" checked={color === c} onChange={() => setColor(c)} />
              <span style={{ background: COLOR_HEX[c] }} aria-label={c} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Icon</legend>
        <div className="icons">
          {ICON_KEYS.map((k) => (
            <label key={k} className="icon-pick" title={k}>
              <input type="radio" name="cat-icon" checked={icon === k} onChange={() => setIcon(k)} />
              <span aria-label={k}>{ICONS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="row">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!canSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </form>
  )
}

export default function Categories({ categories, taskCounts, onChanged, onBack }: Props) {
  // 'new', a category id being edited, or null for none open
  const [open, setOpen] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function remove(id: string) {
    setBusy(true)
    setMessage(null)
    try {
      await deleteCategory(id)
      setConfirmId(null)
      onChanged()
    } catch (err) {
      setMessage(friendlyError(err, "Couldn't delete the category. Try again."))
    } finally {
      setBusy(false)
    }
  }

  function done() {
    setOpen(null)
    onChanged()
  }

  return (
    <main className="card">
      <button className="link" onClick={onBack}>
        ← Routines
      </button>
      <h1>Categories</h1>

      {categories.length === 0 && open !== 'new' && <p className="muted">No categories yet.</p>}

      <ul className="rows">
        {categories.map((c) => (
          <li key={c.id}>
            {open === c.id ? (
              <CategoryEditor editing={c} onDone={done} onCancel={() => setOpen(null)} />
            ) : (
              <>
                <div className="row-main">
                  <span className="dot" style={{ background: hexFor(c.color) }}>
                    {iconFor(c.icon)}
                  </span>
                  {/* Rendered as text: React escapes it (stored XSS rule). */}
                  <span className="grow">{c.name}</span>
                  <span className="muted small">{taskCounts[c.id] ?? 0}</span>
                  <button className="link" disabled={busy} onClick={() => setOpen(c.id)}>
                    Edit
                  </button>
                  <button className="link danger" disabled={busy} onClick={() => setConfirmId(c.id)}>
                    Delete
                  </button>
                </div>
                {confirmId === c.id && (
                  <div className="confirm" role="alert">
                    <p>
                      Delete <strong>{c.name}</strong>?{' '}
                      {(taskCounts[c.id] ?? 0) > 0
                        ? `Its ${taskCounts[c.id]} routine(s) stay, with no category.`
                        : 'No routines use it.'}
                    </p>
                    <div className="row">
                      <button className="secondary" disabled={busy} onClick={() => setConfirmId(null)}>
                        Keep it
                      </button>
                      <button className="danger-fill" disabled={busy} onClick={() => void remove(c.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {open === 'new' ? (
        <CategoryEditor editing={null} onDone={done} onCancel={() => setOpen(null)} />
      ) : (
        <button onClick={() => setOpen('new')} disabled={busy}>
          Add category
        </button>
      )}

      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </main>
  )
}
