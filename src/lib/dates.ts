import { getLanguage } from './i18n'

const DAY_MS = 86_400_000

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dateKey(input: string | Date): string {
  if (typeof input === 'string') return input.slice(0, 10)
  const year = input.getFullYear()
  const month = String(input.getMonth() + 1).padStart(2, '0')
  const day = String(input.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDate(key: string | undefined | null): Date {
  if (!key || typeof key !== 'string') return new Date(NaN)
  const trimmed = key.trim()
  if (!trimmed) return new Date(NaN)
  const parts = trimmed.slice(0, 10).split('-').map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return new Date(NaN)
  return new Date(parts[0], parts[1] - 1, parts[2])
}

export function addDays(key: string, days: number): string {
  const date = parseDate(key)
  if (isNaN(date.getTime())) return key || ''
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

export function formatDateShort(key: string | undefined | null): string {
  if (!key) return '—'
  const date = parseDate(key)
  if (isNaN(date.getTime())) return typeof key === 'string' ? key.slice(0, 10) || '—' : '—'
  if (getLanguage() === 'gu') return new Intl.DateTimeFormat('gu-IN', { day: 'numeric', month: 'short' }).format(date)
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`
}

export function formatDateLong(key: string | undefined | null): string {
  if (!key) return '—'
  const date = parseDate(key)
  if (isNaN(date.getTime())) return typeof key === 'string' ? key.slice(0, 10) || '—' : '—'
  if (getLanguage() === 'gu') return new Intl.DateTimeFormat('gu-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

export function formatDateRange(start: string, end: string): string {
  const endYear = parseDate(end).getFullYear()
  const yearStr = isNaN(endYear) ? '' : ` ${endYear}`
  return `${formatDateShort(start)} – ${formatDateShort(end)}${yearStr}`
}

export function daysBetweenInclusive(start: string, end: string): number {
  const dStart = parseDate(start).getTime()
  const dEnd = parseDate(end).getTime()
  if (isNaN(dStart) || isNaN(dEnd)) return 0
  return Math.round((dEnd - dStart) / DAY_MS) + 1
}

export function todayKey(): string {
  return dateKey(new Date())
}

export function weekdayShort(key: string): string {
  const date = parseDate(key)
  if (getLanguage() === 'gu') return new Intl.DateTimeFormat('gu-IN', { weekday: 'short' }).format(date)
  return WEEKDAY_SHORT[date.getDay()]
}
