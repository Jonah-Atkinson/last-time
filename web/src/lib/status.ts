import type { Task } from './tasks'

// The same numbers the database enforces in completions_guard (0005).
// The database is the real rule. This copy only decides what the screen
// offers, so if the two ever disagree the result is a refused save, never
// a hole.
export function windowDays(t: Pick<Task, 'schedule_type' | 'interval_days'>): number {
  if (t.schedule_type === 'weekly') return 7
  if (t.schedule_type === 'monthly') return 30
  return t.interval_days ?? 1
}

// Grace = 15% of the interval, rounded down, capped at 5 (0 under 7 days).
export function graceDays(t: Pick<Task, 'schedule_type' | 'interval_days'>): number {
  return Math.min(Math.floor(windowDays(t) * 0.15), 5)
}

// How far back a completion can be logged: the grace window, never less than 1.
export function backdateLimit(t: Pick<Task, 'schedule_type' | 'interval_days'>): number {
  return Math.max(1, graceDays(t))
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Calendar days between two moments in this device's time zone.
// Rounded because daylight-saving days are 23 or 25 hours long.
export function daysBetween(earlier: Date, later: Date): number {
  return Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / 86_400_000)
}

export type StatusKind = 'new' | 'ok' | 'soon' | 'late'

export type Status = {
  kind: StatusKind
  dueIn: number // days until due; negative = past due. Used for sorting.
  lastDone: string // "Last done 3 days ago"
  label: string // "Due tomorrow", "Overdue by 2 days"
}

function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`
}

// on track: due in 2+ days, or already done today
// due soon: due tomorrow or today, or past due but still inside the grace window
// overdue:  past the grace window (it would no longer count as on time)
export function statusFor(
  t: Pick<Task, 'schedule_type' | 'interval_days'>,
  lastDoneAt: string | null,
  now: Date = new Date(),
): Status {
  if (!lastDoneAt) return { kind: 'new', dueIn: 0, lastDone: 'Not done yet', label: 'Start any time' }

  const since = daysBetween(new Date(lastDoneAt), now)
  const lastDone = since <= 0 ? 'Done today' : since === 1 ? 'Last done yesterday' : `Last done ${since} days ago`
  const dueIn = windowDays(t) - since
  const grace = graceDays(t)

  if (since <= 0) return { kind: 'ok', dueIn, lastDone, label: dueIn === 1 ? 'Due tomorrow' : `Due in ${days(dueIn)}` }
  if (dueIn >= 2) return { kind: 'ok', dueIn, lastDone, label: `Due in ${days(dueIn)}` }
  if (dueIn === 1) return { kind: 'soon', dueIn, lastDone, label: 'Due tomorrow' }
  if (dueIn === 0) return { kind: 'soon', dueIn, lastDone, label: 'Due today' }
  if (-dueIn <= grace) {
    const left = grace + dueIn // 0 = today is the last on-time day
    return {
      kind: 'soon',
      dueIn,
      lastDone,
      label: left === 0 ? 'Past due · today still counts' : `Past due · still counts for ${days(left + 1)}`,
    }
  }
  return { kind: 'late', dueIn, lastDone, label: `Overdue by ${days(-dueIn)}` }
}
