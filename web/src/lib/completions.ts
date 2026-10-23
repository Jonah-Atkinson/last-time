import { supabase } from './supabase'
import { friendlyError } from './errors'

export type Completion = {
  id: string
  task_id: string
  done_at: string
  logged_at: string
  note: string | null
}

const COLUMNS = 'id, task_id, done_at, logged_at, note'

export const NOTE_LIMIT = 500 // CHECK on completions.note (0001)
export const UNDO_MINUTES = 10 // delete policy (0005)

// Newest first. Enough for the home list (latest per routine). The history
// screen in Slice 5 will need its own per-routine query.
export async function listRecentCompletions(): Promise<Completion[]> {
  const { data, error } = await supabase
    .from('completions')
    .select(COLUMNS)
    .order('done_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return data as Completion[]
}

// Sent: only the columns 0005 grants for insert. Not logged_at (server
// clock), not user_id (default auth.uid(); RLS WITH CHECK backs it up).
export async function logCompletion(taskId: string, doneAt: Date, note: string | null): Promise<Completion> {
  const { data, error } = await supabase
    .from('completions')
    .insert({ task_id: taskId, done_at: doneAt.toISOString(), note })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as Completion
}

// Undo. Past the 10-minute window, RLS hides the row from DELETE: the
// database deletes nothing and returns NO error. So ask for the deleted
// row back and count it. No row = too late.
export async function undoCompletion(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('completions').delete().eq('id', id).select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export function canStillUndo(c: Pick<Completion, 'logged_at'>, now: Date = new Date()): boolean {
  return now.getTime() - new Date(c.logged_at).getTime() < UNDO_MINUTES * 60_000
}

export function completionError(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === '23514') return "That day is further back than this routine allows, or before you created it."
  return friendlyError(err, "Couldn't save that. Check your connection and try again.")
}
