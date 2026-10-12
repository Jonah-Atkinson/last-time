import { supabase } from './supabase'

// Slice 3 builds "every N days" only. Weekly and monthly schedules are
// already in the schema and arrive as their own slice (8).
export type Task = {
  id: string
  name: string
  category_id: string | null
  schedule_type: 'interval' | 'weekly' | 'monthly'
  interval_days: number | null
  notes: string | null
  archived: boolean
  created_at: string
}

export type TaskInput = {
  name: string
  category_id: string | null
  interval_days: number
  notes: string | null
}

const COLUMNS = 'id, name, category_id, schedule_type, interval_days, notes, archived, created_at'

export const LIMITS = { name: 80, notes: 1000, minDays: 1, maxDays: 3650 } as const

export async function listTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('tasks').select(COLUMNS).order('name')
  if (error) throw error
  return data as Task[]
}

// Sent: only the columns 0004 grants for insert. Not created_at (server
// clock), not user_id (default auth.uid(), and RLS WITH CHECK backs it up).
export async function createTask(input: TaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...input, schedule_type: 'interval' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as Task
}

export async function updateTask(id: string, input: TaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ ...input, schedule_type: 'interval' })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as Task
}

export async function setArchived(id: string, archived: boolean): Promise<Task> {
  const { data, error } = await supabase.from('tasks').update({ archived }).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return data as Task
}

// Permanent. The database also deletes the task's completions (cascade).
export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

export function describeSchedule(t: Pick<Task, 'schedule_type' | 'interval_days'>): string {
  if (t.schedule_type === 'interval' && t.interval_days) {
    return t.interval_days === 1 ? 'Every day' : `Every ${t.interval_days} days`
  }
  return 'Custom schedule'
}
