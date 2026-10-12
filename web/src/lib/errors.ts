// Turn a database error into a sentence a person can act on.
// Codes are Postgres SQLSTATEs passed through by Supabase.
export function friendlyError(err: unknown, fallback: string): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === '23505') return 'You already have one with that name.'
  if (code === '23514') return 'Something in that form is outside the allowed values.'
  if (code === '42501') return "You don't have permission to do that."
  return fallback
}
