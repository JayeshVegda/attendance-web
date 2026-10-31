import type {
  Adjustment,
  Attendance,
  AttendanceStatus,
  CycleRow,
  Employee,
  PayoutInputRow,
  RateHistory,
  Statement,
  UpadCategory,
  UpadEntry,
} from './types'
import { dateKey } from './dates'

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
): number {
  if (!status) return 0
  const base =
    status === 'full'
      ? dailyRatePaise
      : status === 'half'
        ? dailyRatePaise * 0.5
        : 0
  const ot = Math.round((dailyRatePaise * Math.max(0, otMinutes)) / (60 * Math.max(1, otDivisor)))
  return Math.round(base) + ot
}

export function statusDays(status: AttendanceStatus | ''): number {
  if (status === 'full') return 1
  if (status === 'half') return 0.5
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

export function upadBreakdownForEmployee(
  employee: Employee,
  entries: UpadEntry[],
  throughDate?: string,
): { regularPaise: number; extraPaise: number; chaluPaise: number; motoPaise: number } {
  let chalu = Math.max(0, employee.opening_chalu_paise ?? employee.opening_upad_paise ?? 0)
  let moto = Math.max(0, employee.opening_moto_paise ?? 0)

  for (const entry of entries) {
    if (entry.employee !== employee.id) continue
    if (throughDate && dateKey(entry.date) > dateKey(throughDate)) continue
    const amount = Math.abs(entry.amount_paise || 0)
    const delta =
      entry.kind === 'given'
        ? amount
        : entry.kind === 'recovery' || entry.kind === 'returned' || entry.kind === 'writeoff'
          ? -amount
          : 0
    if (entry.category === 'extra' || entry.category === 'moto') moto += delta
    else chalu += delta
  }

  // Strictly no auto-shifting between buckets per spec Gap 2
  chalu = Math.max(0, Math.round(chalu))
  moto = Math.max(0, Math.round(moto))

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

export function computeCycleRows(args: {
  employees: Employee[]
  rates: RateHistory[]
  attendance: Attendance[]
  adjustments: Adjustment[]
  upadEntries: UpadEntry[]
  statements: Statement[]
  cycleStart: string
  payoutDate: string
  otDivisor?: number
  inputs?: Map<string, Partial<PayoutInputRow>>
}): CycleRow[] {
  const {
    employees,
    rates,
    attendance,
    adjustments,
    upadEntries,
    statements,
    cycleStart,
    payoutDate,
    otDivisor = DEFAULT_OT_DIVISOR,
    inputs,
  } = args

  const start = dateKey(cycleStart)
  const end = dateKey(payoutDate)
  const latestStatements = latestStatementByEmployee(statements)

  const attendanceByEmployee = new Map<string, Attendance[]>()
  for (const entry of attendance) {
    const key = dateKey(entry.date)
    if (key < start || key > end) continue
    const list = attendanceByEmployee.get(entry.employee) ?? []
    list.push(entry)
    attendanceByEmployee.set(entry.employee, list)
  }

  const adjustmentsByEmployee = new Map<string, number>()
  for (const entry of adjustments) {
    const key = dateKey(entry.date)
    if (key < start || key > end) continue
    adjustmentsByEmployee.set(
      entry.employee,
      (adjustmentsByEmployee.get(entry.employee) ?? 0) + (entry.amount_paise || 0),
    )
  }

  const upadByEmployee = new Map<string, UpadEntry[]>()
  for (const entry of upadEntries) {
    if (dateKey(entry.date) > end) continue
    const list = upadByEmployee.get(entry.employee) ?? []
    list.push(entry)
    upadByEmployee.set(entry.employee, list)
  }

  return employees
    .map((employee) => {
      const employeeAttendance = attendanceByEmployee.get(employee.id) ?? []
      let earnedPaise = 0
      let daysWorked = 0
      let otMinutes = 0
      for (const entry of employeeAttendance) {
        const rate = getRateForDate(employee, rates, entry.date)
        earnedPaise += dayPayPaise(entry.status, entry.ot_minutes || 0, rate, otDivisor)
        daysWorked += statusDays(entry.status)
        otMinutes += entry.ot_minutes || 0
      }

      const openingPaise =
        latestStatements.get(employee.id)?.closing_paise ?? employee.opening_salary_paise ?? 0
      const adjustmentPaise = adjustmentsByEmployee.get(employee.id) ?? 0
      const employeeUpad = upadByEmployee.get(employee.id) ?? []
      const breakdown = upadBreakdownForEmployee(employee, employeeUpad, end)
      const upadOutstandingPaise = breakdown.regularPaise + breakdown.extraPaise
      const returnedUpadPaise = employeeUpad.reduce((total, entry) => {
        const key = dateKey(entry.date)
        if (key < start || key > end || entry.kind !== 'returned') return total
        return total + Math.abs(entry.amount_paise || 0)
      }, 0)
      const beforeRecovery = openingPaise + earnedPaise + adjustmentPaise
      const input = inputs?.get(employee.id)
      const requestedRecovery = Math.max(0, input?.recoveryPaise ?? 0)
      const recoveryCeiling = Math.max(
        0,
        Math.min(upadOutstandingPaise, Math.max(0, beforeRecovery)),
      )
      const upadRecoveryPaise = Math.min(requestedRecovery, recoveryCeiling)
      const totalDuePaise = Math.max(0, beforeRecovery - upadRecoveryPaise)
      const paidPaise = Math.max(0, Math.min(input?.paidPaise ?? totalDuePaise, totalDuePaise))
      const closingPaise = totalDuePaise - paidPaise

      const joinedAfterPayout =
        Boolean(employee.joined_on) && dateKey(employee.joined_on) > end
      const hasActivity =
        employeeAttendance.length > 0 ||
        adjustmentPaise !== 0 ||
        openingPaise !== 0 ||
        upadOutstandingPaise !== 0

      return {
        employee,
        openingPaise: Math.round(openingPaise),
        earnedPaise: Math.round(earnedPaise),
        adjustmentPaise: Math.round(adjustmentPaise),
        regularUpadPaise: breakdown.regularPaise,
        extraUpadPaise: breakdown.extraPaise,
        returnedUpadPaise: Math.round(returnedUpadPaise),
        upadOutstandingPaise: Math.round(upadOutstandingPaise),
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
): { full: number; half: number; absent: number; otMinutes: number } {
  let full = 0
  let half = 0
  let absent = 0
  let otMinutes = 0
  for (const entry of attendance) {
    const key = dateKey(entry.date)
    if (key < dateKey(cycleStart) || key > dateKey(cycleEnd)) continue
    if (entry.status === 'full') full += 1
    if (entry.status === 'half') half += 1
    if (entry.status === 'absent') absent += 1
    otMinutes += entry.ot_minutes || 0
  }
  return { full, half, absent, otMinutes }
}
