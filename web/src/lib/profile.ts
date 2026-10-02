import { supabase } from './supabase'

export type Profile = {
  user_id: string
  display_name: string | null
  timezone: string
  rewards_enabled: boolean | null
  onboarded_at: string | null
}

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, timezone, rewards_enabled, onboarded_at')
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return data
}

// Same pattern the database enforces (CHECK on profiles.timezone). If the
// browser reports something odd, fall back to UTC instead of failing setup.
const TIMEZONE_PATTERN = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/

export function browserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && TIMEZONE_PATTERN.test(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

export async function completeSetup(
  userId: string,
  displayName: string,
  rewardsEnabled: boolean,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      display_name: displayName,
      rewards_enabled: rewardsEnabled,
      timezone: browserTimezone(),
      // Any non-null value means "setup finished". The database replaces it
      // with its own clock (0003 trigger), so the browser can't backdate it.
      onboarded_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select('user_id, display_name, timezone, rewards_enabled, onboarded_at')
    .single()
  if (error) throw error
  return data
}
