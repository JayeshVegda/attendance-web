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

export function parseDate(key: string): Date {
  const [year, month, day] = key.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(key: string, days: number): string {
  const date = parseDate(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

export function startOfWeekSaturday(key: string): string {
  const date = parseDate(key)
  const back = (date.getDay() + 1) % 7
  return addDays(key, -back)
}

export function weekDates(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startKey, index))
}

export function isFriday(key: string): boolean {
  return parseDate(key).getDay() === 5
}

export function isSaturday(key: string): boolean {
  return parseDate(key).getDay() === 6
}

export function formatDateShort(key: string): string {
  const date = parseDate(key)
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`
}

export function formatDateLong(key: string): string {
  const date = parseDate(key)
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

export function formatDateRange(start: string, end: string): string {
  return `${formatDateShort(start)} – ${formatDateShort(end)} ${parseDate(end).getFullYear()}`
}

export function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS) + 1
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
