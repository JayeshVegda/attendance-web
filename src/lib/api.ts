import { COLLECTIONS, pb } from './pb'
import { dateKey, todayKey } from './dates'
import type {
  Adjustment,
  AppSetting,
  Attendance,
  AttendanceStatus,
  Employee,
  EmploymentPeriod,
  PayoutRun,
  RateHistory,
  SalaryPayment,
  SettingsMap,
  Statement,
  UpadCategory,
  UpadEntry,
  UpadKind,
  CycleRow,
} from './types'
import { computeCycleRows } from './payroll'
import { DEFAULT_SETTINGS, otDivisor, settingValue } from './cycle'

export function pbDateFilter(date: string): string {
  return `${dateKey(date)} 00:00:00.000Z`
}

export async function listEmployees(includeInactive = true): Promise<Employee[]> {
  return pb.collection(COLLECTIONS.employees).getFullList<Employee>({
    sort: 'sort_order,employee_no',
    filter: includeInactive ? '' : 'active = true',
  })
}

export async function listRates(): Promise<RateHistory[]> {
  return pb.collection(COLLECTIONS.rates).getFullList<RateHistory>({ sort: 'effective_from' })
}

export async function listPeriods(): Promise<EmploymentPeriod[]> {
  return pb.collection(COLLECTIONS.periods).getFullList<EmploymentPeriod>({
    sort: '-start_date',
  })
}

export async function listAttendance(start: string, end: string): Promise<Attendance[]> {
  return pb.collection(COLLECTIONS.attendance).getFullList<Attendance>({
    filter: `date >= "${pbDateFilter(start)}" && date <= "${pbDateFilter(end)}"`,
    sort: 'date,employee',
  })
}

export async function listAdjustments(start: string, end: string): Promise<Adjustment[]> {
  return pb.collection(COLLECTIONS.adjustments).getFullList<Adjustment>({
    filter: `date >= "${pbDateFilter(start)}" && date <= "${pbDateFilter(end)}"`,
    sort: 'date',
  })
}

export async function listUpadEntries(throughDate?: string): Promise<UpadEntry[]> {
  return pb.collection(COLLECTIONS.upad).getFullList<UpadEntry>({
    filter: throughDate ? `date <= "${pbDateFilter(throughDate)}"` : '',
    sort: 'date',
  })
}

export async function listStatements(): Promise<Statement[]> {
  return pb.collection(COLLECTIONS.statements).getFullList<Statement>({
    sort: '-payout_date',
  })
}

export async function listRuns(): Promise<PayoutRun[]> {
  return pb.collection(COLLECTIONS.runs).getFullList<PayoutRun>({
    sort: '-payout_date',
  })
}

export async function listPayments(): Promise<SalaryPayment[]> {
  return pb.collection(COLLECTIONS.payments).getFullList<SalaryPayment>({
    sort: '-paid_on',
  })
}

export async function getSettings(): Promise<SettingsMap> {
  const records = await pb.collection(COLLECTIONS.settings).getFullList<AppSetting>({ sort: 'key' })
  const map: SettingsMap = { ...DEFAULT_SETTINGS }
  for (const record of records) map[record.key] = record.value
  return map
}

export async function saveSetting(key: string, value: string): Promise<void> {
  try {
    const existing = await pb
      .collection(COLLECTIONS.settings)
      .getFirstListItem<AppSetting>(`key = "${key.replaceAll('"', '\\"')}"`)
    await pb.collection(COLLECTIONS.settings).update(existing.id, { value })
  } catch {
    await pb.collection(COLLECTIONS.settings).create({ key, value })
  }
  await audit('setting.update', 'settings', key, value)
}

export async function audit(
  action: string,
  entity: string,
  entityId: string,
  details = '',
): Promise<void> {
  try {
    await pb.collection(COLLECTIONS.audit).create({ action, entity, entity_id: entityId, details })
  } catch {
    // Audit logging must never block payroll work.
  }
}

export async function nextEmployeeNo(): Promise<string> {
  const employees = await listEmployees(true)
  const numbers = employees
    .map((employee) => Number.parseInt(employee.employee_no, 10))
    .filter((value) => Number.isFinite(value))
  return String(numbers.length ? Math.max(...numbers) + 1 : 1)
}

export async function createEmployee(input: {
  name: string
  employeeNo?: string
  phone?: string
  ratePaise: number
  openingSalaryPaise?: number
  openingUpadPaise?: number
  joinedOn?: string
  notes?: string
}): Promise<Employee> {
  const employeeNo = input.employeeNo?.trim() || (await nextEmployeeNo())
  const employees = await listEmployees(true)
  const employee = await pb.collection(COLLECTIONS.employees).create<Employee>({
    employee_no: employeeNo,
    name: input.name.trim(),
    phone: input.phone?.trim() || '',
    active: true,
    daily_rate_paise: input.ratePaise,
    opening_salary_paise: input.openingSalaryPaise ?? 0,
    opening_upad_paise: input.openingUpadPaise ?? 0,
    joined_on: input.joinedOn || todayKey(),
    notes: input.notes?.trim() || '',
    sort_order: employees.length + 1,
  })
  await pb.collection(COLLECTIONS.rates).create({
    employee: employee.id,
    effective_from: input.joinedOn || todayKey(),
    daily_rate_paise: input.ratePaise,
    note: 'Opening rate',
  })
  await pb.collection(COLLECTIONS.periods).create({
    employee: employee.id,
    start_date: input.joinedOn || todayKey(),
    note: 'Opening period',
  })
  await audit('employee.create', 'employees', employee.id, input.name)
  return employee
}

export async function updateEmployee(
  id: string,
  patch: Partial<Pick<Employee, 'name' | 'phone' | 'employee_no' | 'notes' | 'opening_salary_paise' | 'opening_upad_paise'>>,
): Promise<Employee> {
  const employee = await pb.collection(COLLECTIONS.employees).update<Employee>(id, patch)
  await audit('employee.update', 'employees', id, JSON.stringify(patch))
  return employee
}

export async function setEmployeeActive(id: string, active: boolean): Promise<void> {
  const today = todayKey()
  await pb.collection(COLLECTIONS.employees).update(id, { active })
  const periods = await pb
    .collection(COLLECTIONS.periods)
    .getFullList<EmploymentPeriod>({ filter: `employee = "${id}"`, sort: '-start_date' })
  const openPeriod = periods.find((period) => !period.end_date)
  if (!active && openPeriod) {
    await pb.collection(COLLECTIONS.periods).update(openPeriod.id, { end_date: today })
  }
  if (active && !openPeriod) {
    await pb.collection(COLLECTIONS.periods).create({
      employee: id,
      start_date: today,
      note: 'Rejoined',
    })
  }
  await audit(active ? 'employee.reactivate' : 'employee.deactivate', 'employees', id)
}

export async function addRate(input: {
  employeeId: string
  effectiveFrom: string
  ratePaise: number
  note?: string
}): Promise<RateHistory> {
  await pb.collection(COLLECTIONS.employees).update(input.employeeId, {
    daily_rate_paise: input.ratePaise,
  })
  try {
    const existing = await pb.collection(COLLECTIONS.rates).getFirstListItem<RateHistory>(
      `employee = "${input.employeeId}" && effective_from = "${pbDateFilter(input.effectiveFrom)}"`,
    )
    return await pb.collection(COLLECTIONS.rates).update<RateHistory>(existing.id, {
      daily_rate_paise: input.ratePaise,
      note: input.note || '',
    })
  } catch {
    const rate = await pb.collection(COLLECTIONS.rates).create<RateHistory>({
      employee: input.employeeId,
      effective_from: input.effectiveFrom,
      daily_rate_paise: input.ratePaise,
      note: input.note || '',
    })
    await audit('rate.create', 'rate_history', rate.id, `${input.effectiveFrom}: ${input.ratePaise}`)
    return rate
  }
}

export async function saveAttendance(input: {
  employeeId: string
  date: string
  status: AttendanceStatus
  otMinutes?: number
  existingId?: string
  note?: string
}): Promise<Attendance> {
  const formattedDate = input.date.includes(' ') ? input.date : `${dateKey(input.date)} 00:00:00.000Z`
  const body = {
    employee: input.employeeId,
    date: formattedDate,
    status: input.status,
    ot_minutes: Math.max(0, Math.min(300, input.otMinutes ?? 0)),
    note: input.note || '',
  }

  // 1. If valid existingId is passed, try direct update
  if (input.existingId && !input.existingId.startsWith('temp-')) {
    try {
      return await pb.collection(COLLECTIONS.attendance).update<Attendance>(input.existingId, body)
    } catch {
      // Fall through to lookup by employee and date
    }
  }

  // 2. Lookup existing record by employee & date to prevent UNIQUE index violation
  try {
    const existing = await pb
      .collection(COLLECTIONS.attendance)
      .getFirstListItem<Attendance>(
        `employee = "${input.employeeId}" && date = "${pbDateFilter(input.date)}"`,
      )
    return await pb.collection(COLLECTIONS.attendance).update<Attendance>(existing.id, body)
  } catch {
    // 3. Otherwise create new record
    return await pb.collection(COLLECTIONS.attendance).create<Attendance>(body)
  }
}

export async function deleteAttendance(
  id?: string,
  employeeId?: string,
  date?: string,
): Promise<void> {
  if (id && !id.startsWith('temp-')) {
    try {
      await pb.collection(COLLECTIONS.attendance).delete(id)
      return
    } catch {
      // Fall through to lookup
    }
  }
  if (employeeId && date) {
    try {
      const existing = await pb
        .collection(COLLECTIONS.attendance)
        .getFirstListItem<Attendance>(
          `employee = "${employeeId}" && date = "${pbDateFilter(date)}"`,
        )
      await pb.collection(COLLECTIONS.attendance).delete(existing.id)
    } catch {
      // Record already removed or does not exist
    }
  }
}

export async function createAdjustment(input: {
  employeeId: string
  date: string
  amountPaise: number
  note?: string
}): Promise<Adjustment> {
  const record = await pb.collection(COLLECTIONS.adjustments).create<Adjustment>({
    employee: input.employeeId,
    date: input.date.includes(' ') ? input.date : `${dateKey(input.date)} 00:00:00.000Z`,
    amount_paise: input.amountPaise,
    note: input.note || '',
  })
  await audit('adjustment.create', 'adjustments', record.id, `${input.amountPaise}`)
  return record
}

export async function deleteAdjustment(id: string): Promise<void> {
  await pb.collection(COLLECTIONS.adjustments).delete(id)
  await audit('adjustment.delete', 'adjustments', id)
}

export async function createUpadEntry(input: {
  employeeId: string
  date: string
  kind: UpadKind
  amountPaise: number
  category?: UpadCategory
  note?: string
  statementId?: string
}): Promise<UpadEntry> {
  const record = await pb.collection(COLLECTIONS.upad).create<UpadEntry>({
    employee: input.employeeId,
    date: input.date,
    kind: input.kind,
    category: input.category || 'regular',
    amount_paise: Math.abs(input.amountPaise),
    note: input.note || '',
    statement: input.statementId || '',
  })
  await audit(`upad.${input.kind}`, 'upad_entries', record.id, `${input.amountPaise}`)
  return record
}

export async function createCashReturn(input: {
  employeeId: string
  date: string
  amountPaise: number
  category: UpadCategory
  note?: string
}): Promise<UpadEntry> {
  return createUpadEntry({
    ...input,
    kind: 'returned',
    note: input.note || 'Cash returned against upad',
  })
}

export async function getPayrollData(start: string, end: string) {
  const [employees, rates, attendance, adjustments, upadEntries, statements, settings] =
    await Promise.all([
      listEmployees(true),
      listRates(),
      listAttendance(start, end),
      listAdjustments(start, end),
      listUpadEntries(end),
      listStatements(),
      getSettings(),
    ])
  return { employees, rates, attendance, adjustments, upadEntries, statements, settings }
}

export function buildCycleRows(data: Awaited<ReturnType<typeof getPayrollData>>, start: string, end: string) {
  return computeCycleRows({
    ...data,
    cycleStart: start,
    payoutDate: end,
    otDivisor: otDivisor(data.settings),
  })
}

export async function createPayout(input: {
  cycleStart: string
  payoutDate: string
  rows: CycleRow[]
  note?: string
}): Promise<PayoutRun> {
  const included = input.rows.filter((row) => row.included)
  const totals = included.reduce(
    (sum, row) => {
      sum.due += row.totalDuePaise
      sum.paid += row.paidPaise
      sum.recovery += row.upadRecoveryPaise
      return sum
    },
    { due: 0, paid: 0, recovery: 0 },
  )

  const createdStatementIds: string[] = []
  const createdPaymentIds: string[] = []
  const createdUpadIds: string[] = []
  let run: PayoutRun | undefined

  try {
    run = await pb.collection(COLLECTIONS.runs).create<PayoutRun>({
      cycle_start: input.cycleStart,
      payout_date: input.payoutDate,
      status: 'closed',
      note: input.note || '',
      total_due_paise: totals.due,
      total_paid_paise: totals.paid,
      total_upad_recovery_paise: totals.recovery,
      employee_count: included.length,
    })

    for (const row of included) {
      const statement = await pb.collection(COLLECTIONS.statements).create<Statement>({
        payout_run: run.id,
        employee: row.employee.id,
        cycle_start: input.cycleStart,
        payout_date: input.payoutDate,
        opening_paise: row.openingPaise,
        earned_paise: row.earnedPaise,
        adjustment_paise: row.adjustmentPaise,
        upad_outstanding_paise: row.upadOutstandingPaise,
        upad_recovery_paise: row.upadRecoveryPaise,
        total_due_paise: row.totalDuePaise,
        paid_paise: row.paidPaise,
        closing_paise: row.closingPaise,
        days_worked: row.daysWorked,
        ot_minutes: row.otMinutes,
        note: '',
      })
      createdStatementIds.push(statement.id)

      if (row.paidPaise > 0) {
        const payment = await pb.collection(COLLECTIONS.payments).create<SalaryPayment>({
          employee: row.employee.id,
          statement: statement.id,
          paid_on: input.payoutDate,
          amount_paise: row.paidPaise,
          note: 'Payout',
        })
        createdPaymentIds.push(payment.id)
      }

      if (row.upadRecoveryPaise > 0) {
        const regularRecovery = Math.min(row.upadRecoveryPaise, row.regularUpadPaise)
        const extraRecovery = Math.max(0, row.upadRecoveryPaise - regularRecovery)
        const recoveryParts: Array<{ category: UpadCategory; amountPaise: number }> = [
          { category: 'regular', amountPaise: regularRecovery },
          { category: 'extra', amountPaise: extraRecovery },
        ]
        for (const part of recoveryParts) {
          if (part.amountPaise <= 0) continue
          const upad = await pb.collection(COLLECTIONS.upad).create<UpadEntry>({
            employee: row.employee.id,
            date: input.payoutDate,
            kind: 'recovery',
            category: part.category,
            amount_paise: part.amountPaise,
            note: 'Recovered in payout',
            statement: statement.id,
          })
          createdUpadIds.push(upad.id)
        }
      }
    }

    await audit(
      'payout.create',
      'payout_runs',
      run.id,
      `${input.cycleStart} → ${input.payoutDate}; due=${totals.due}; paid=${totals.paid}`,
    )
    return run
  } catch (error) {
    // Best-effort rollback so a failed payout does not leave half-written statements.
    for (const id of createdUpadIds) await pb.collection(COLLECTIONS.upad).delete(id).catch(() => {})
    for (const id of createdPaymentIds) await pb.collection(COLLECTIONS.payments).delete(id).catch(() => {})
    for (const id of createdStatementIds) await pb.collection(COLLECTIONS.statements).delete(id).catch(() => {})
    if (run) await pb.collection(COLLECTIONS.runs).delete(run.id).catch(() => {})
    throw error
  }
}

export async function deletePayout(runId: string): Promise<void> {
  const statements = await pb
    .collection(COLLECTIONS.statements)
    .getFullList<Statement>({ filter: `payout_run = "${runId}"` })
  if (!statements.length) {
    await pb.collection(COLLECTIONS.runs).delete(runId)
    return
  }
  const ids = statements.map((statement) => statement.id)
  const relationFilter = ids.map((id) => `statement = "${id}"`).join(' || ')
  const [payments, upad] = await Promise.all([
    pb.collection(COLLECTIONS.payments).getFullList<SalaryPayment>({ filter: relationFilter }),
    pb.collection(COLLECTIONS.upad).getFullList<UpadEntry>({ filter: relationFilter }),
  ])
  for (const entry of upad) await pb.collection(COLLECTIONS.upad).delete(entry.id)
  for (const entry of payments) await pb.collection(COLLECTIONS.payments).delete(entry.id)
  for (const statement of statements) await pb.collection(COLLECTIONS.statements).delete(statement.id)
  await pb.collection(COLLECTIONS.runs).delete(runId)
  await audit('payout.delete', 'payout_runs', runId, `${statements.length} statements removed`)
}

export function settingsNumber(settings: SettingsMap, key: string, fallback: number): number {
  const value = Number.parseFloat(settingValue(settings, key))
  return Number.isFinite(value) ? value : fallback
}
