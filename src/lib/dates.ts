const DAY_MS = 86_400_000

export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_GU = ['રવિ', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ']
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

export function startOfWeekSaturday(key: string): string {
  const date = parseDate(key)
  if (isNaN(date.getTime())) return key || ''
  const back = (date.getDay() + 1) % 7
  return addDays(key, -back)
}

export function weekDates(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startKey, index))
}

export function isFriday(key: string): boolean {
  const date = parseDate(key)
  return isNaN(date.getTime()) ? false : date.getDay() === 5
}

export function isSaturday(key: string): boolean {
  const date = parseDate(key)
  return isNaN(date.getTime()) ? false : date.getDay() === 6
}

export function formatDateShort(key: string | undefined | null): string {
  if (!key) return '—'
  const date = parseDate(key)
  if (isNaN(date.getTime())) return typeof key === 'string' ? key.slice(0, 10) || '—' : '—'
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`
}

export function formatDateLong(key: string | undefined | null): string {
  if (!key) return '—'
  const date = parseDate(key)
  if (isNaN(date.getTime())) return typeof key === 'string' ? key.slice(0, 10) || '—' : '—'
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

export function weekdayName(key: string): string {
  return WEEKDAY_LONG[parseDate(key).getDay()]
}

export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[parseDate(key).getDay()]
}

export function weekdayGu(key: string): string {
  return WEEKDAY_GU[parseDate(key).getDay()]
}

export function monthKey(key: string): string {
  return key.slice(0, 7)
}

export function monthLabel(key: string): string {
  const date = parseDate(`${key}-01`)
  return `${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`
}

export function endOfMonth(key: string): string {
  const date = parseDate(`${key.slice(0, 7)}-01`)
  date.setMonth(date.getMonth() + 1)
  date.setDate(0)
  return dateKey(date)
}

export function unixSortKey(key: string): number {
  return parseDate(key).getTime()
}
