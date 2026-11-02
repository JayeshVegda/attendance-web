import { addDays, dateKey } from './dates'
import type { PayoutRun, SettingsMap } from './types'

export const DEFAULT_SETTINGS: SettingsMap = {
  first_cycle_start: '2026-10-01',
  ot_divisor: '8',
  business_name: 'હાજરી પગાર',
  expected_payout_weekday: '4',
  chalu_upad_enabled: 'true',
  moto_upad_enabled: 'true',
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
