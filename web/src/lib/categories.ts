import { supabase } from './supabase'

// The only values the database accepts (CHECK constraints in 0001).
// Colors are KEYS, never CSS: the browser maps a key to a hex value below,
// so a crafted "color" can't inject styles (threat #8).
export const CATEGORY_COLORS = ['rose', 'peach', 'butter', 'sage', 'teal', 'sky', 'lavender', 'slate'] as const
export type CategoryColor = (typeof CATEGORY_COLORS)[number]

export const COLOR_HEX: Record<CategoryColor, string> = {
  rose: '#e8a0b4',
  peach: '#f2b896',
  butter: '#ecd68a',
  sage: '#a9c8a0',
  teal: '#8cc7c0',
  sky: '#9cc3e8',
  lavender: '#bfaee6',
  slate: '#a3a9b5',
}

// Icon keys must match the database pattern ^[a-z0-9-]{1,32}$.
// Shown as emoji for now; real SVG icons arrive with the Dusk design (Slice 6).
export const ICONS = {
  circle: '⚪',
  home: '🏠',
  clean: '🧽',
  laundry: '🧺',
  kitchen: '🍳',
  plant: '🪴',
  pet: '🐾',
  car: '🚗',
  tools: '🔧',
  health: '💊',
  fitness: '💪',
  money: '💵',
  phone: '📱',
  calendar: '📅',
  heart: '❤️',
  book: '📚',
} as const
export type IconKey = keyof typeof ICONS
export const ICON_KEYS = Object.keys(ICONS) as IconKey[]

export function iconFor(key: string): string {
  return key in ICONS ? ICONS[key as IconKey] : ICONS.circle
}

export function hexFor(color: string): string {
  return color in COLOR_HEX ? COLOR_HEX[color as CategoryColor] : COLOR_HEX.slate
}

export type Category = {
  id: string
  name: string
  color: CategoryColor
  icon: IconKey
}

export type CategoryInput = Omit<Category, 'id'>

const COLUMNS = 'id, name, color, icon'

export async function listCategories(): Promise<Category[]> {
  // No user_id filter needed for safety: RLS only ever returns your rows.
  const { data, error } = await supabase.from('categories').select(COLUMNS).order('name')
  if (error) throw error
  return data as Category[]
}

// Only name, color and icon are sent. The database fills id, user_id and
// created_at itself, and 0004 refuses them if the browser tries.
export async function createCategory(input: CategoryInput): Promise<Category> {
  const { data, error } = await supabase.from('categories').insert(input).select(COLUMNS).single()
  if (error) throw error
  return data as Category
}

export async function updateCategory(id: string, input: CategoryInput): Promise<Category> {
  const { data, error } = await supabase.from('categories').update(input).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return data as Category
}

// Tasks in this category are kept; the database sets their category to none.
export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

export function validCategoryName(name: string): boolean {
  const n = name.trim()
  return n.length >= 1 && n.length <= 30
}
