import { COLLECTIONS, pb } from './pb'
import { dateKey, todayKey } from './dates'
import type {
  Adjustment,
  AppSetting,
  Attendance,
  AttendanceStatus,
  CycleDraft,
  Employee,
  EmploymentPeriod,
  PayoutRun,
  RateHistory,
  SalaryPayment,
  SalaryWriteoff,
  SettingsMap,
  Statement,
  UpadCategory,
  UpadEntry,
  UpadKind,
  CycleRow,
} from './types'
import { computeCycleRows } from './payroll'
import { DEFAULT_SETTINGS, isChaluUpadEnabled, isMotoUpadEnabled, otDivisor, settingValue } from './cycle'
import {
  normalizeAttendance,
  upadBalance,
  validateLedgerChronology,
  type Bucket,
} from './engine'

export type WorkerBalanceDetail = {
  id: string
  employee_no: string
  name: string
  active: boolean
  balance_paise: number
}

export class BucketOutstandingBalanceError extends Error {
  bucket: 'chalu' | 'moto'
  totalPaise: number
  workers: WorkerBalanceDetail[]

  constructor(bucket: 'chalu' | 'moto', totalPaise: number, workers: WorkerBalanceDetail[]) {
    const bucketLabel = bucket === 'chalu' ? 'Chalu Upad' : 'Main Upad'
    super(
      `Cannot disable ${bucketLabel}: ${workers.length} worker(s) have an outstanding balance totaling ₹${(totalPaise / 100).toFixed(2)}. Settle all balances before disabling.`
    )
    this.name = 'BucketOutstandingBalanceError'
    this.bucket = bucket
    this.totalPaise = totalPaise
    this.workers = workers
  }
}

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
    filter: `date >= "${dateKey(start)} 00:00:00.000Z" && date <= "${dateKey(end)} 23:59:59.999Z"`,
    sort: 'date,employee',
  })
}

export async function listAttendanceAll(): Promise<Attendance[]> {
  return pb.collection(COLLECTIONS.attendance).getFullList<Attendance>({ sort: 'date,employee' })
}

export async function listAdjustments(start: string, end: string): Promise<Adjustment[]> {
  return pb.collection(COLLECTIONS.adjustments).getFullList<Adjustment>({
    filter: `date >= "${dateKey(start)} 00:00:00.000Z" && date <= "${dateKey(end)} 23:59:59.999Z"`,
    sort: 'date',
  })
}

export async function listAdjustmentsAll(): Promise<Adjustment[]> {
  return pb.collection(COLLECTIONS.adjustments).getFullList<Adjustment>({ sort: 'date' })
}

export async function listUpadEntries(throughDate?: string): Promise<UpadEntry[]> {
  const parts: string[] = ['voided != true']
  if (throughDate) parts.push(`date <= "${dateKey(throughDate)} 23:59:59.999Z"`)
  return pb.collection(COLLECTIONS.upad).getFullList<UpadEntry>({
    filter: parts.join(' && '),
    sort: 'date',
  })
}

export async function listStatements(): Promise<Statement[]> {
  const [stmts, runs] = await Promise.all([
    pb.collection(COLLECTIONS.statements).getFullList<Statement>({
      filter: 'voided != true',
      sort: '-payout_date',
    }),
    pb.collection(COLLECTIONS.runs).getFullList<{ id: string; status: string }>({
      filter: 'voided != true',
    }),
  ])
  const pending = new Set(runs.filter((r) => r.status === 'pending').map((r) => r.id))
  return pending.size > 0 ? stmts.filter((s) => !pending.has(s.payout_run)) : stmts
}

export async function listRuns(): Promise<PayoutRun[]> {
  return pb.collection(COLLECTIONS.runs).getFullList<PayoutRun>({
    filter: 'voided != true',
    sort: '-payout_date',
  })
}

export async function listPayments(): Promise<SalaryPayment[]> {
  return pb.collection(COLLECTIONS.payments).getFullList<SalaryPayment>({
    filter: 'voided != true',
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
  if ((key === 'chalu_upad_enabled' || key === 'moto_upad_enabled') && value === 'false') {
    const bucket: Bucket = key === 'chalu_upad_enabled' ? 'chalu' : 'moto'
    const [allEmployees, allUpad] = await Promise.all([
      listEmployees(true),
      listUpadEntries(),
    ])
    const workersWithBalance: WorkerBalanceDetail[] = []
    let totalOutstanding = 0

    for (const emp of allEmployees) {
      const opening = bucket === 'chalu'
        ? (emp.opening_chalu_paise ?? emp.opening_upad_paise ?? 0)
        : (emp.opening_moto_paise ?? 0)
      const empEntries = allUpad
        .filter((u) => u.employee === emp.id && !u.voided)
        .map((u) => ({
          id: u.id,
          employee: u.employee,
          date: dateKey(u.date),
          bucket: (u.bucket ?? (u.category === 'extra' || u.category === 'moto' ? 'moto' : 'chalu')) as Bucket,
          kind: u.kind,
          amount_paise: u.amount_paise,
          voided: u.voided,
        }))
      const bal = upadBalance(empEntries, bucket, opening)
      if (bal > 0) {
        workersWithBalance.push({
          id: emp.id,
          employee_no: emp.employee_no,
          name: emp.name,
          active: emp.active,
          balance_paise: bal,
        })
        totalOutstanding += bal
      }
    }

    if (workersWithBalance.length > 0) {
      throw new BucketOutstandingBalanceError(bucket, totalOutstanding, workersWithBalance)
    }
  }

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
  openingChaluPaise?: number
  openingMotoPaise?: number
  openingDate?: string
  joinedOn?: string
  notes?: string
}): Promise<Employee> {
  const employeeNo = input.employeeNo?.trim() || (await nextEmployeeNo())
  const employees = await listEmployees(true)
  const chalu = input.openingChaluPaise ?? input.openingUpadPaise ?? 0
  const moto = input.openingMotoPaise ?? 0
  const employee = await pb.collection(COLLECTIONS.employees).create<Employee>({
    employee_no: employeeNo,
    name: input.name.trim(),
    phone: input.phone?.trim() || '',
    active: true,
    daily_rate_paise: input.ratePaise,
    opening_salary_paise: input.openingSalaryPaise ?? 0,
    opening_upad_paise: chalu + moto,
    opening_chalu_paise: chalu,
    opening_moto_paise: moto,
    opening_date: input.openingDate || input.joinedOn || todayKey(),
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
  workedMinutes?: number
  existingId?: string
  note?: string
}): Promise<Attendance> {
  const norm = normalizeAttendance(input.status, input.workedMinutes, input.otMinutes)
  const formattedDate = input.date.includes(' ') ? input.date : `${dateKey(input.date)} 00:00:00.000Z`
  const body = {
    employee: input.employeeId,
    date: formattedDate,
    status: norm.status,
    worked_minutes: norm.worked_minutes,
    ot_minutes: Math.max(0, Math.min(300, norm.ot_minutes)),
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
  kind?: 'bonus' | 'reimbursement' | 'deduction'
  note?: string
}): Promise<Adjustment> {
  const kind = input.kind || (input.amountPaise < 0 ? 'deduction' : 'bonus')
  const record = await pb.collection(COLLECTIONS.adjustments).create<Adjustment>({
    employee: input.employeeId,
    date: input.date.includes(' ') ? input.date : `${dateKey(input.date)} 00:00:00.000Z`,
    amount_paise: input.amountPaise,
    kind,
    note: input.note || '',
  })
  await audit('adjustment.create', 'adjustments', record.id, `${input.amountPaise}`)
  return record
}

export const PAYOUT_EDIT_LOCK_ERROR = 'Issued by a payout. Undo that payout to change this.'

export async function deleteAdjustment(id: string): Promise<void> {
  const existing = await pb.collection(COLLECTIONS.adjustments).getOne<Adjustment>(id).catch(() => null)
  if (existing?.payout_id) {
    throw new Error(PAYOUT_EDIT_LOCK_ERROR)
  }
  await pb.collection(COLLECTIONS.adjustments).delete(id)
  await audit('adjustment.delete', 'adjustments', id)
}

export async function updateAdjustment(id: string, data: Partial<Adjustment>): Promise<Adjustment> {
  const existing = await pb.collection(COLLECTIONS.adjustments).getOne<Adjustment>(id).catch(() => null)
  if (existing?.payout_id) {
    throw new Error(PAYOUT_EDIT_LOCK_ERROR)
  }
  const record = await pb.collection(COLLECTIONS.adjustments).update<Adjustment>(id, data)
  await audit('adjustment.update', 'adjustments', id)
  return record
}

export async function deleteUpadEntry(id: string): Promise<void> {
  const existing = await pb.collection(COLLECTIONS.upad).getOne<UpadEntry>(id).catch(() => null)
  if (existing?.payout_id) {
    throw new Error(PAYOUT_EDIT_LOCK_ERROR)
  }
  await pb.collection(COLLECTIONS.upad).delete(id)
  await audit('upad.delete', 'upad_entries', id)
}

export async function updateUpadEntry(id: string, data: Partial<UpadEntry>): Promise<UpadEntry> {
  const existing = await pb.collection(COLLECTIONS.upad).getOne<UpadEntry>(id).catch(() => null)
  if (existing?.payout_id) {
    throw new Error(PAYOUT_EDIT_LOCK_ERROR)
  }
  const record = await pb.collection(COLLECTIONS.upad).update<UpadEntry>(id, data)
  await audit('upad.update', 'upad_entries', id)
  return record
}

const inFlightSettleKeys = new Set<string>()

export async function createUpadEntry(input: {
  employeeId: string
  date: string
  kind: UpadKind
  amountPaise: number
  category?: UpadCategory
  bucket?: 'chalu' | 'moto'
  note?: string
  statementId?: string
}): Promise<UpadEntry> {
  const resolvedBucket: Bucket =
    input.bucket ??
    (input.category === 'moto' || input.category === 'extra' ? 'moto' : 'chalu')

  const settings = await getSettings()
  if (resolvedBucket === 'chalu' && !isChaluUpadEnabled(settings)) {
    throw new Error('Cannot create entry: Chalu Upad is disabled in Settings.')
  }
  if (resolvedBucket === 'moto' && !isMotoUpadEnabled(settings)) {
    throw new Error('Cannot create entry: Main Upad is disabled in Settings.')
  }

  if (input.kind === 'returned' || input.kind === 'writeoff') {
    const [employee, empUpads] = await Promise.all([
      pb.collection(COLLECTIONS.employees).getOne<Employee>(input.employeeId),
      listUpadEntries(),
    ])
    const opening = resolvedBucket === 'chalu'
      ? (employee.opening_chalu_paise ?? employee.opening_upad_paise ?? 0)
      : (employee.opening_moto_paise ?? 0)
    const existingRows = empUpads
      .filter((u) => u.employee === input.employeeId && !u.voided)
      .map((u) => ({
        id: u.id,
        employee: u.employee,
        date: dateKey(u.date),
        bucket: (u.bucket ?? (u.category === 'extra' || u.category === 'moto' ? 'moto' : 'chalu')) as Bucket,
        kind: u.kind,
        amount_paise: u.amount_paise,
        voided: u.voided,
      }))
    const check = validateLedgerChronology(existingRows, opening, resolvedBucket, {
      date: dateKey(input.date),
      kind: input.kind,
      amount_paise: Math.abs(input.amountPaise),
    })
    if (!check.ok) {
      throw new Error(check.error)
    }
  }

  const record = await pb.collection(COLLECTIONS.upad).create<UpadEntry>({
    employee: input.employeeId,
    date: input.date.includes(' ') ? input.date : `${dateKey(input.date)} 00:00:00.000Z`,
    kind: input.kind,
    category: resolvedBucket,
    bucket: resolvedBucket,
    amount_paise: Math.abs(input.amountPaise),
    note: input.note || '',
    statement: input.statementId || '',
    voided: false,
  })
  await audit(`upad.${input.kind}`, 'upad_entries', record.id, `${input.amountPaise}`)
  return record
}

export async function settleUpadBalance(input: {
  employeeId: string
  bucket: 'chalu' | 'moto'
  kind: 'returned' | 'writeoff'
  amountPaise: number
  date?: string
  note?: string
  idempotencyKey?: string
}): Promise<UpadEntry> {
  if (input.idempotencyKey) {
    if (inFlightSettleKeys.has(input.idempotencyKey)) {
      throw new Error('Settlement is already saving. Please wait.')
    }
    inFlightSettleKeys.add(input.idempotencyKey)
  }
  try {
    const defaultNote = input.kind === 'writeoff' ? 'Balance written off' : 'Paid back in cash'
    return await createUpadEntry({
      employeeId: input.employeeId,
      date: input.date ?? todayKey(),
      kind: input.kind,
      amountPaise: input.amountPaise,
      bucket: input.bucket,
      category: input.bucket,
      note: input.note || defaultNote,
    })
  } finally {
    if (input.idempotencyKey) {
      const key = input.idempotencyKey
      setTimeout(() => inFlightSettleKeys.delete(key), 3000)
    }
  }
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
  const [employees, rates, periods, attendance, adjustments, upadEntries, statements, settings] =
    await Promise.all([
      listEmployees(true),
      listRates(),
      listPeriods(),
      listAttendanceAll(),
      listAdjustmentsAll(),
      listUpadEntries(end),
      listStatements(),
      getSettings(),
    ])
  return { employees, rates, periods, attendance, adjustments, upadEntries, statements, settings }
}

export function buildCycleRows(data: Awaited<ReturnType<typeof getPayrollData>>, start: string, end: string) {
  return computeCycleRows({
    ...data,
    cycleStart: start,
    payoutDate: end,
    otDivisor: otDivisor(data.settings),
  })
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

export async function listCycleDrafts(cycleStart: string): Promise<CycleDraft[]> {
  try {
    return await pb.collection(COLLECTIONS.drafts).getFullList<CycleDraft>({
      filter: `cycle_start = "${cycleStart}"`,
    })
  } catch {
    return []
  }
}

export async function saveCycleDraft(input: {
  employee: string
  cycle_start: string
  deduct_paise?: number
  give_upad_paise?: number
  paid_paise?: number | null
  paid_date?: string
  work_counted_up_to?: string
  is_done?: boolean
  created_upad_ids?: string
  note?: string
}): Promise<CycleDraft> {
  const existing = await pb
    .collection(COLLECTIONS.drafts)
    .getFirstListItem<CycleDraft>(`employee = "${input.employee}" && cycle_start = "${input.cycle_start}"`)
    .catch(() => null)

  if (existing) {
    return await pb.collection(COLLECTIONS.drafts).update<CycleDraft>(existing.id, input)
  }
  return await pb.collection(COLLECTIONS.drafts).create<CycleDraft>(input)
}

export async function deleteCycleDraft(id: string): Promise<void> {
  await pb.collection(COLLECTIONS.drafts).delete(id).catch(() => {})
}

export async function createSalaryWriteoff(input: {
  worker: string
  payout?: string
  date: string
  amount_paise: number
  note: string
}): Promise<SalaryWriteoff> {
  return await pb.collection(COLLECTIONS.writeoffs).create<SalaryWriteoff>({
    ...input,
    voided: false,
  })
}
