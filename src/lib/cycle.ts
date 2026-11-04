import { useMemo } from 'react'
import { addDays, dateKey } from './dates'
import { formatMoney } from './money'
import type { Employee, PayoutRun, SettingsMap, Statement } from './types'

export const DEFAULT_SETTINGS: SettingsMap = {
  first_cycle_start: '2026-10-01',
  ot_divisor: '8',
  business_name: 'હાજરી પગાર',
  expected_payout_weekday: '4',
  hours_attendance_enabled: 'true',
  hour_step_minutes: '30',
}

export function computeNextCycleStartFromPaidDates(
  paidDates: string[],
  fallbackCycleStart: string
): string {
  const validDates = paidDates.map((d) => d.slice(0, 10)).filter(Boolean)
  if (!validDates.length) return fallbackCycleStart
  const latestPaid = validDates.reduce((max, cur) => (cur > max ? cur : max))
  return addDays(latestPaid, 1)
}

export function settingValue(settings: SettingsMap, key: string): string {
  const val = settings[key] ?? DEFAULT_SETTINGS[key] ?? ''
  if (typeof val === 'object' && val !== null && 'value' in (val as unknown as Record<string, unknown>)) {
    return String((val as unknown as Record<string, unknown>).value ?? '')
  }
  return typeof val === 'string' ? val : String(val ?? '')
}

export function otDivisor(settings?: SettingsMap): number {
  if (!settings) return 8
  const parsed = Number.parseFloat(settingValue(settings, 'ot_divisor'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8
}

export function isChaluUpadEnabled(settings?: SettingsMap): boolean {
  if (!settings) return true
  return settingValue(settings, 'chalu_upad_enabled') !== 'false'
}

export function isMotoUpadEnabled(settings?: SettingsMap): boolean {
  if (!settings) return true
  return settingValue(settings, 'moto_upad_enabled') !== 'false'
}

export type UpadBucketId = 'chalu' | 'moto'

export type UpadBucket = {
  id: UpadBucketId
  key: UpadBucketId
  label: string            // Renamable label from settings, e.g. "Chalu Upad" / "Main Upad"
  shortLabel: string       // "Chalu" / "Main" (when both on) or "" (when 1 on)
  cutLabel: string         // "Chalu cut" / "Main cut" (both on) or "<Label> cut" (one on)
  newLabel: string         // "New Chalu Upad" / "New Main Upad" (both on) or "New <Label>" (one on)
  balLabel: string         // "<Label> Bal" (both on) or "Upad Bal" (one on)
  chipSymbol: string       // "C" or "M" when both on; "" (empty) when only one on
  color: 'amber' | 'purple'
}

export type UpadBucketsConfig = {
  enabled: UpadBucket[]    // length 2 (both), length 1 (one), length 0 (none)
  count: number            // 0, 1, or 2
  hasAny: boolean          // count > 0
  isBothOn: boolean        // count === 2
  isOnlyOneOn: boolean     // count === 1
  isBothOff: boolean       // count === 0
  isChaluOn: boolean
  isMotoOn: boolean
  chaluLabel: string
  motoLabel: string
  singleBucket?: UpadBucket
  chaluBucket?: UpadBucket
  motoBucket?: UpadBucket
  sectionTitle: string     // "Upad Deductions" (Never "Loan")
  activeBalance: (chaluPaise: number, motoPaise: number) => number
  formatRemainingFooter: (chaluLeftPaise: number, motoLeftPaise: number) => {
    totalPaise: number
    text: string
  } | null
}

export function getUpadBuckets(settings?: SettingsMap): UpadBucketsConfig {
  const singleBucket: UpadBucket = {
    id: 'chalu' as UpadBucketId,
    key: 'chalu' as UpadBucketId,
    label: 'Upad',
    shortLabel: '',
    cutLabel: 'Deduct Upad',
    newLabel: 'Give Upad',
    balLabel: 'Upad Bal',
    chipSymbol: '',
    color: 'amber',
  }

  return {
    enabled: [singleBucket],
    count: 1,
    hasAny: true,
    isBothOn: false,
    isOnlyOneOn: true,
    isBothOff: false,
    isChaluOn: true,
    isMotoOn: false,
    chaluLabel: 'Upad',
    motoLabel: 'Upad',
    singleBucket,
    chaluBucket: singleBucket,
    motoBucket: undefined,
    sectionTitle: 'Upad Deductions',
    activeBalance: (chaluPaise: number, motoPaise: number) => (chaluPaise || 0) + (motoPaise || 0),
    formatRemainingFooter: (chaluLeftPaise: number, motoLeftPaise: number) => {
      const total = (chaluLeftPaise || 0) + (motoLeftPaise || 0)
      return {
        totalPaise: total,
        text: `Total Upad Remaining: ${formatMoney(total)}`,
      }
    },
  }
}

export function useUpadBuckets(settings?: SettingsMap): UpadBucketsConfig {
  return useMemo(() => getUpadBuckets(settings), [settings])
}

export function isHoursAttendanceEnabled(settings?: SettingsMap): boolean {
  if (!settings) return true
  return settingValue(settings, 'hours_attendance_enabled') !== 'false'
}

export function hourStepMinutes(settings?: SettingsMap): number {
  if (!settings) return 30
  const parsed = Number.parseInt(settingValue(settings, 'hour_step_minutes'), 10)
  return parsed === 60 ? 60 : 30
}

export function isRealPayoutRun(run?: Partial<PayoutRun> | null): boolean {
  if (!run || run.voided) return false
  return run.status === 'completed' || run.status === 'closed'
}

export function realPayoutRuns(runs: PayoutRun[]): PayoutRun[] {
  return runs.filter((r) => isRealPayoutRun(r))
}

export function lastClosedRun(runs: PayoutRun[]): PayoutRun | undefined {
  return realPayoutRuns(runs)
    .sort((a, b) => dateKey(b.payout_date).localeCompare(dateKey(a.payout_date)))[0]
}

export function lastPayoutDate(runs: PayoutRun[]): string | undefined {
  const run = lastClosedRun(runs)
  return run ? dateKey(run.payout_date) : undefined
}

export function cycleStartFor(runs: PayoutRun[], settings: SettingsMap): string {
  const last = lastPayoutDate(runs)
  if (last) return addDays(last, 1)
  return settingValue(settings, 'first_cycle_start') || '2026-10-01'
}

/**
 * For a specific worker, finds their paid-up-to date based on their latest
 * non-voided completed statement. Returns dateKey string or undefined.
 */
export function getWorkerPaidUpToDate(
  employeeId: string,
  statements: Statement[],
): string | undefined {
  const workerStmts = statements
    .filter((s) => s.employee === employeeId && !s.voided && s.payout_date)
    .sort((a, b) => {
      const dCmp = dateKey(b.payout_date).localeCompare(dateKey(a.payout_date))
      if (dCmp !== 0) return dCmp
      return (b.created || '').localeCompare(a.created || '')
    })
  return workerStmts[0] ? dateKey(workerStmts[0].payout_date) : undefined
}

/**
 * Computes the open cycle grid start date:
 * The earliest paid-up-to day + 1 among ACTIVE workers
 * (each worker's own last non-voided completed statement date),
 * or first_cycle_start setting if nobody has been paid yet.
 * Inactive workers (e.g. Prakash) never pull the grid start back.
 */
export function computeGridStart(args: {
  activeEmployees: Employee[]
  statements: Statement[]
  settings?: SettingsMap
  firstCycleStart?: string
}): string {
  const { activeEmployees, statements, settings } = args
  const fallback =
    args.firstCycleStart ||
    (settings ? settingValue(settings, 'first_cycle_start') : '') ||
    '2026-10-01'

  if (!activeEmployees.length) return fallback

  const latestByEmp = new Map<string, Statement>()
  for (const s of statements) {
    if (s.voided || !s.payout_date) continue
    const curr = latestByEmp.get(s.employee)
    if (!curr) {
      latestByEmp.set(s.employee, s)
      continue
    }
    const currDate = dateKey(curr.payout_date)
    const nextDate = dateKey(s.payout_date)
    if (nextDate > currDate || (nextDate === currDate && (s.created || '') > (curr.created || ''))) {
      latestByEmp.set(s.employee, s)
    }
  }

  const nextUnpaidDates: string[] = []
  let hasAnyPaidWorker = false

  for (const emp of activeEmployees) {
    const stmt = latestByEmp.get(emp.id)
    if (stmt && stmt.payout_date) {
      hasAnyPaidWorker = true
      nextUnpaidDates.push(addDays(dateKey(stmt.payout_date), 1))
    }
  }

  if (!hasAnyPaidWorker || !nextUnpaidDates.length) return fallback

  nextUnpaidDates.sort()
  return nextUnpaidDates[0]
}

export function suggestedPayoutDate(start: string, today: string): string {
  return today < start ? start : today
}

export function cycleLength(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1)
}
