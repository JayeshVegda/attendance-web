import { useMemo } from 'react'
import { addDays, dateKey } from './dates'
import { formatMoney } from './money'
import type { PayoutRun, SettingsMap } from './types'

export const DEFAULT_SETTINGS: SettingsMap = {
  first_cycle_start: '2026-10-01',
  ot_divisor: '8',
  business_name: 'હાજરી પગાર',
  expected_payout_weekday: '4',
  chalu_upad_enabled: 'true',
  moto_upad_enabled: 'true',
  chalu_upad_label: 'Chalu Upad',
  moto_upad_label: 'Main Upad',
  hours_attendance_enabled: 'true',
  hour_step_minutes: '30',
}

export function settingValue(settings: SettingsMap, key: string): string {
  return settings[key] ?? DEFAULT_SETTINGS[key] ?? ''
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
  const isChaluOn = isChaluUpadEnabled(settings)
  const isMotoOn = isMotoUpadEnabled(settings)
  const chaluLabel = (settingValue(settings ?? {}, 'chalu_upad_label') || 'Chalu Upad').trim()
  const motoLabel = (settingValue(settings ?? {}, 'moto_upad_label') || 'Main Upad').trim()

  const count = (isChaluOn ? 1 : 0) + (isMotoOn ? 1 : 0)
  const isBothOn = count === 2
  const isOnlyOneOn = count === 1
  const isBothOff = count === 0

  const buckets: UpadBucket[] = []

  let chaluBucket: UpadBucket | undefined
  let motoBucket: UpadBucket | undefined

  if (isChaluOn) {
    chaluBucket = {
      id: 'chalu',
      key: 'chalu',
      label: chaluLabel,
      shortLabel: isBothOn ? 'Chalu' : '',
      cutLabel: isBothOn ? `${chaluLabel} cut` : `${chaluLabel} cut`,
      newLabel: isBothOn ? `New ${chaluLabel}` : `New ${chaluLabel}`,
      balLabel: isBothOn ? `${chaluLabel} Bal` : 'Upad Bal',
      chipSymbol: isBothOn ? 'C' : '',
      color: 'amber',
    }
    buckets.push(chaluBucket)
  }

  if (isMotoOn) {
    motoBucket = {
      id: 'moto',
      key: 'moto',
      label: motoLabel,
      shortLabel: isBothOn ? 'Main' : '',
      cutLabel: isBothOn ? `${motoLabel} cut` : `${motoLabel} cut`,
      newLabel: isBothOn ? `New ${motoLabel}` : `New ${motoLabel}`,
      balLabel: isBothOn ? `${motoLabel} Bal` : 'Upad Bal',
      chipSymbol: isBothOn ? 'M' : '',
      color: 'purple',
    }
    buckets.push(motoBucket)
  }

  const singleBucket = isOnlyOneOn ? buckets[0] : undefined

  return {
    enabled: buckets,
    count,
    hasAny: count > 0,
    isBothOn,
    isOnlyOneOn,
    isBothOff,
    isChaluOn,
    isMotoOn,
    chaluLabel,
    motoLabel,
    singleBucket,
    chaluBucket,
    motoBucket,
    sectionTitle: 'Upad Deductions',
    activeBalance: (chaluPaise: number, motoPaise: number) => {
      if (isBothOff) return 0
      if (isBothOn) return chaluPaise + motoPaise
      return isChaluOn ? chaluPaise : motoPaise
    },
    formatRemainingFooter: (chaluLeftPaise: number, motoLeftPaise: number) => {
      if (isBothOff) return null
      if (isBothOn) {
        const total = chaluLeftPaise + motoLeftPaise
        return {
          totalPaise: total,
          text: `Total Upad Remaining: ${formatMoney(total)} (${chaluLabel}: ${formatMoney(chaluLeftPaise)}, ${motoLabel}: ${formatMoney(motoLeftPaise)})`,
        }
      }
      const activeLeft = isChaluOn ? chaluLeftPaise : motoLeftPaise
      return {
        totalPaise: activeLeft,
        text: `Upad Remaining: ${formatMoney(activeLeft)}`,
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

export function lastClosedRun(runs: PayoutRun[]): PayoutRun | undefined {
  return [...runs]
    .filter((run) => run.status === 'closed' && !run.voided)
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

export function suggestedPayoutDate(start: string, today: string): string {
  return today < start ? start : today
}

export function cycleLength(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1)
}
