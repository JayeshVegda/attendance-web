import type {
  Adjustment,
  Attendance,
  AttendanceStatus,
  CycleRow,
  Employee,
  EmploymentPeriod,
  PayoutInputRow,
  RateHistory,
  SettingsMap,
  Statement,
  UpadCategory,
  UpadEntry,
} from './types'
import { dateKey } from './dates'
import { isChaluUpadEnabled, isMotoUpadEnabled } from './cycle'
import {
  computePayout,
  dayEarnings,
  DEFAULT_FULL_DAY_MINUTES,
  type AdjustmentKind,
  type AdjustmentRow,
  type AttendanceRow,
  type Bucket,
  type UpadRow,
  type WorkerRef,
} from './engine'

export const DEFAULT_OT_DIVISOR = 8

export function getRateForDate(
  employee: Employee,
  rates: RateHistory[],
  date: string,
): number {
  const target = dateKey(date)
  const applicable = rates
    .filter((rate) => rate.employee === employee.id && dateKey(rate.effective_from) <= target)
    .sort((a, b) => dateKey(a.effective_from).localeCompare(dateKey(b.effective_from)))
  if (applicable.length) return applicable[applicable.length - 1].daily_rate_paise
  return employee.daily_rate_paise
}

export function dayPayPaise(
  status: AttendanceStatus | '',
  otMinutes: number,
  dailyRatePaise: number,
  otDivisor = DEFAULT_OT_DIVISOR,
  workedMinutes?: number,
): number {
  return dayEarnings(status, otMinutes, dailyRatePaise, workedMinutes, otDivisor * 60).total_paise
}

export function statusDays(status: AttendanceStatus | '', workedMinutes?: number): number {
  if (status === 'full') return 1
  if (status === 'half') return 0.5
  if (status === 'hours') return (workedMinutes ?? 0) / DEFAULT_FULL_DAY_MINUTES
  return 0
}

export function latestStatementByEmployee(statements: Statement[]): Map<string, Statement> {
  const latest = new Map<string, Statement>()
  for (const statement of statements) {
    const current = latest.get(statement.employee)
    if (!current) {
      latest.set(statement.employee, statement)
      continue
    }
    const currentKey = `${dateKey(current.payout_date)}|${current.created}`
    const nextKey = `${dateKey(statement.payout_date)}|${statement.created}`
    if (nextKey > currentKey) latest.set(statement.employee, statement)
  }
  return latest
}

export function upadCategoryOf(entry: UpadEntry): UpadCategory {
  return entry.category === 'extra' || entry.category === 'moto' ? 'moto' : 'chalu'
}

function adjustmentKind(entry: Adjustment): AdjustmentKind {
  if (entry.kind === 'deduction') return 'deduction'
  if (entry.kind === 'reimbursement') return 'reimbursement'
  return 'bonus'
}

function upadBucket(entry: UpadEntry): Bucket {
  return upadCategoryOf(entry) === 'moto' ? 'moto' : 'chalu'
}

type EngineData = {
  worker: WorkerRef
  paidUpTo: string
  rates: { effective_from: string; daily_rate_paise: number }[]
  periods: { start_date: string; end_date: string | '' }[]
  attendance: AttendanceRow[]
  adjustments: AdjustmentRow[]
  upads: UpadRow[]
}

function engineDataFor(
  employee: Employee,
  rates: RateHistory[],
  attendance: Attendance[],
  adjustments: Adjustment[],
  upadEntries: UpadEntry[],
  latest: Statement | undefined,
  periods: EmploymentPeriod[],
): EngineData {
  const paidUpTo = latest ? dateKey(latest.payout_date) : ''
  const carryPaise = latest ? latest.closing_paise : employee.opening_salary_paise ?? 0
  return {
    worker: {
      id: employee.id,
      opening_carry_paise: carryPaise,
      opening_chalu_paise: employee.opening_chalu_paise ?? employee.opening_upad_paise ?? 0,
      opening_moto_paise: employee.opening_moto_paise ?? 0,
      opening_date: employee.opening_date
        ? dateKey(employee.opening_date)
        : employee.joined_on
          ? dateKey(employee.joined_on)
          : '1970-01-01',
      daily_rate_paise: employee.daily_rate_paise,
    },
    paidUpTo,
    rates: rates
      .filter((r) => r.employee === employee.id)
      .map((r) => ({ effective_from: r.effective_from, daily_rate_paise: r.daily_rate_paise })),
    periods: periods
      .filter((p) => p.employee === employee.id)
      .map((p) => ({ start_date: dateKey(p.start_date), end_date: p.end_date ? dateKey(p.end_date) : '' })),
    attendance: attendance
      .filter((a) => a.employee === employee.id)
      .map((a) => ({
        id: a.id,
        employee: a.employee,
        date: dateKey(a.date),
        status: a.status,
        worked_minutes: a.worked_minutes,
        ot_minutes: a.ot_minutes ?? 0,
        settled: !!a.settled_payout,
      })),
    adjustments: adjustments
      .filter((a) => a.employee === employee.id)
      .map((a) => ({
        id: a.id,
        employee: a.employee,
        date: dateKey(a.date),
        kind: adjustmentKind(a),
        amount_paise: Math.abs(a.amount_paise || 0),
        settled: !!a.settled_payout,
      })),
    upads: upadEntries
      .filter((u) => u.employee === employee.id)
      .map((u) => ({
        id: u.id,
        employee: u.employee,
        date: dateKey(u.date),
        bucket: upadBucket(u),
        kind: u.kind,
        amount_paise: Math.abs(u.amount_paise || 0),
        voided: u.voided ?? false,
      })),
  }
}

export function upadBreakdownForEmployee(
  employee: Employee,
  entries: UpadEntry[],
  throughDate?: string,
): { regularPaise: number; extraPaise: number; chaluPaise: number; motoPaise: number } {
  let chalu = employee.opening_chalu_paise ?? employee.opening_upad_paise ?? 0
  let moto = employee.opening_moto_paise ?? 0

  for (const entry of entries) {
    if (entry.employee !== employee.id) continue
    if (entry.voided) continue
    if (throughDate && dateKey(entry.date) > dateKey(throughDate)) continue
    const amount = entry.amount_paise || 0
    const delta =
      entry.kind === 'given'
        ? amount
        : entry.kind === 'recovery' || entry.kind === 'returned' || entry.kind === 'writeoff'
          ? -amount
          : 0
    if (upadBucket(entry) === 'moto') moto += delta
    else chalu += delta
  }

  return {
    chaluPaise: chalu,
    motoPaise: moto,
    regularPaise: chalu,
    extraPaise: moto,
  }
}

export function upadBalanceForEmployee(
  employee: Employee,
  entries: UpadEntry[],
  throughDate?: string,
): number {
  const breakdown = upadBreakdownForEmployee(employee, entries, throughDate)
  return breakdown.regularPaise + breakdown.extraPaise
}

const EMPTY_INPUTS_FOR_CYCLE = {
  chalu_recovery_paise: 0,
  moto_recovery_paise: 0,
  new_chalu_given_paise: 0,
  new_moto_given_paise: 0,
  new_upad_given_paise: 0,
  new_upad_bucket: 'chalu' as const,
  payout_adjustment_paise: 0,
  salary_paid_paise: 0,
}

export function computeCycleRows(args: {
  employees: Employee[]
  rates: RateHistory[]
  attendance: Attendance[]
  adjustments: Adjustment[]
  upadEntries: UpadEntry[]
  statements: Statement[]
  periods?: EmploymentPeriod[]
  cycleStart: string
  payoutDate: string
  otDivisor?: number
  settings?: SettingsMap
  inputs?: Map<string, Partial<PayoutInputRow>>
}): CycleRow[] {
  const {
    employees,
    rates,
    attendance,
    adjustments,
    upadEntries,
    statements,
    periods = [],
    cycleStart,
    payoutDate,
    otDivisor,
    settings,
    inputs,
  } = args

  const end = dateKey(payoutDate)
  const start = dateKey(cycleStart)
  const latestStatements = latestStatementByEmployee(statements)
  const isChaluOn = isChaluUpadEnabled(settings)
  const isMotoOn = isMotoUpadEnabled(settings)

  const upadByEmployee = new Map<string, UpadEntry[]>()
  for (const entry of upadEntries) {
    if (dateKey(entry.date) > end) continue
    const list = upadByEmployee.get(entry.employee) ?? []
    list.push(entry)
    upadByEmployee.set(entry.employee, list)
  }

  return employees
    .map((employee) => {
      const latest = latestStatements.get(employee.id)
      const data = engineDataFor(
        employee,
        rates,
        attendance,
        adjustments,
        upadEntries,
        latest,
        periods,
      )

      const comp = computePayout(
        data.worker,
        data.paidUpTo,
        end,
        data.rates,
        data.periods,
        data.attendance,
        data.adjustments,
        data.upads,
        EMPTY_INPUTS_FOR_CYCLE,
        {
          chalu_enabled: isChaluOn,
          moto_enabled: isMotoOn,
          full_day_minutes: (otDivisor ?? 8) * 60,
        },
      )
      const res = comp.ok ? comp.result : null
      const earnedPaise = res ? res.earned_paise : 0
      const adjustmentPaise = res ? res.adjustments_paise : 0
      const openingPaise = res ? res.carry_paise : (latest?.closing_paise ?? employee.opening_salary_paise ?? 0)
      const beforeRecovery = openingPaise + earnedPaise + adjustmentPaise

      const employeeUpad = upadByEmployee.get(employee.id) ?? []
      const breakdown = upadBreakdownForEmployee(employee, employeeUpad, end)
      const regularUpad = isChaluOn ? breakdown.regularPaise : 0
      const extraUpad = isMotoOn ? breakdown.extraPaise : 0
      const upadOutstanding = regularUpad + extraUpad

      const returnedUpadPaise = employeeUpad.reduce((total, entry) => {
        const key = dateKey(entry.date)
        if (key < start || key > end || entry.kind !== 'returned') return total
        if (entry.voided) return total
        const bucket = upadCategoryOf(entry)
        if (bucket === 'chalu' && !isChaluOn) return total
        if (bucket === 'moto' && !isMotoOn) return total
        return total + Math.abs(entry.amount_paise || 0)
      }, 0)

      const input = inputs?.get(employee.id)
      const requestedRecovery = Math.max(0, input?.recoveryPaise ?? 0)
      const recoveryCeiling = Math.max(
        0,
        Math.min(upadOutstanding, Math.max(0, beforeRecovery)),
      )
      const upadRecoveryPaise = Math.min(requestedRecovery, recoveryCeiling)
      const totalDuePaise = Math.max(0, beforeRecovery - upadRecoveryPaise)
      const paidPaise = Math.max(0, Math.min(input?.paidPaise ?? totalDuePaise, totalDuePaise))
      const closingPaise = totalDuePaise - paidPaise

      const employeeAttendance = data.attendance.filter((a) => a.date >= start && a.date <= end)
      let daysWorked = 0
      let otMinutes = 0
      for (const entry of employeeAttendance) {
        daysWorked += statusDays(entry.status, entry.worked_minutes)
        otMinutes += entry.ot_minutes ?? 0
      }

      const joinedAfterPayout =
        Boolean(employee.joined_on) && dateKey(employee.joined_on) > end
      const hasActivity =
        employeeAttendance.length > 0 ||
        adjustmentPaise !== 0 ||
        beforeRecovery !== 0 ||
        upadOutstanding !== 0

      return {
        employee,
        openingPaise: Math.round(openingPaise),
        earnedPaise: Math.round(earnedPaise),
        adjustmentPaise: Math.round(adjustmentPaise),
        regularUpadPaise: Math.round(regularUpad),
        extraUpadPaise: Math.round(extraUpad),
        returnedUpadPaise: Math.round(returnedUpadPaise),
        upadOutstandingPaise: Math.round(upadOutstanding),
        upadRecoveryPaise: Math.round(upadRecoveryPaise),
        totalDuePaise: Math.round(totalDuePaise),
        paidPaise: Math.round(paidPaise),
        closingPaise: Math.round(closingPaise),
        daysWorked,
        otMinutes,
        attendanceCount: employeeAttendance.length,
        included: !joinedAfterPayout && (employee.active || hasActivity),
      }
    })
    .filter((row) => row.included)
    .sort((a, b) => {
      const order = (a.employee.sort_order || 0) - (b.employee.sort_order || 0)
      if (order) return order
      return a.employee.employee_no.localeCompare(b.employee.employee_no, undefined, { numeric: true })
    })
}

export function payoutTotals(rows: CycleRow[]) {
  return rows.reduce(
    (totals, row) => {
      totals.due += row.totalDuePaise
      totals.paid += row.paidPaise
      totals.closing += row.closingPaise
      totals.recovery += row.upadRecoveryPaise
      totals.earned += row.earnedPaise
      totals.opening += row.openingPaise
      totals.adjustments += row.adjustmentPaise
      totals.regularUpad += row.regularUpadPaise
      totals.extraUpad += row.extraUpadPaise
      totals.returnedUpad += row.returnedUpadPaise
      totals.employees += 1
      return totals
    },
    {
      due: 0,
      paid: 0,
      closing: 0,
      recovery: 0,
      earned: 0,
      opening: 0,
      adjustments: 0,
      regularUpad: 0,
      extraUpad: 0,
      returnedUpad: 0,
      employees: 0,
    },
  )
}

export function attendanceSummary(
  attendance: Attendance[],
  cycleStart: string,
  cycleEnd: string,
): { full: number; half: number; absent: number; hours: number; otMinutes: number } {
  let full = 0
  let half = 0
  let absent = 0
  let hours = 0
  let otMinutes = 0
  for (const entry of attendance) {
    const key = dateKey(entry.date)
    if (key < dateKey(cycleStart) || key > dateKey(cycleEnd)) continue
    if (entry.status === 'full') full += 1
    if (entry.status === 'half') half += 1
    if (entry.status === 'absent') absent += 1
    if (entry.status === 'hours') hours += 1
    otMinutes += entry.ot_minutes || 0
  }
  return { full, half, absent, hours, otMinutes }
}
