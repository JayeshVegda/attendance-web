import { addDays, dateKey, todayKey } from './dates'
import { calcDayEarnings, calcPayoutSettlement, calcToPay, calcUpadBalance } from './attendance-calc'
import { COLLECTIONS, pb } from './pb'
import type {
  AppData,
  Attendance,
  AttendanceStatus,
  CycleDraft,
  Employee,
  Holiday,
  PayoutRun,
  SalaryPayment,
  Settings,
  Statement,
  UpadEntry,
  UpadKind,
} from './types'

export const DEFAULT_SETTINGS: Omit<Settings, 'id'> = {
  shift_hours: 8,
  ot_multiplier: 1,
  company_name: 'Kapil Products',
  language: 'en',
}

const dayStart = (date: string) => `${dateKey(date)} 00:00:00.000Z`
const dayEnd = (date: string) => `${dateKey(date)} 23:59:59.999Z`
const businessDateTime = (date: string) => {
  const now = new Date()
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  return `${dateKey(date)} ${time}.${String(now.getMilliseconds()).padStart(3, '0')}Z`
}

export async function getSettings(): Promise<Settings> {
  const rows = await pb.collection(COLLECTIONS.settings).getFullList<Settings>()
  if (rows[0]) return rows[0]
  return pb.collection(COLLECTIONS.settings).create<Settings>(DEFAULT_SETTINGS)
}

export async function saveSettings(values: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const rows = await pb.collection(COLLECTIONS.settings).getFullList<Settings>()
  if (rows[0]) {
    return pb.collection(COLLECTIONS.settings).update<Settings>(rows[0].id, values)
  }
  return pb.collection(COLLECTIONS.settings).create<Settings>({ ...DEFAULT_SETTINGS, ...values })
}

export async function loadAppData(): Promise<AppData> {
  const [employees, attendance, upad, drafts, runs, statements, payments, holidays, settings] = await Promise.all([
    pb.collection(COLLECTIONS.employees).getFullList<Employee>({ sort: 'id' }),
    pb.collection(COLLECTIONS.attendance).getFullList<Attendance>({ sort: 'date,employee' }),
    pb.collection(COLLECTIONS.upad).getFullList<UpadEntry>({ filter: 'voided = false', sort: '-date' }),
    pb.collection(COLLECTIONS.drafts).getFullList<CycleDraft>(),
    pb.collection(COLLECTIONS.runs).getFullList<PayoutRun>({ filter: 'voided = false', sort: '-run_date' }),
    pb.collection(COLLECTIONS.statements).getFullList<Statement>({ filter: 'voided = false', sort: '-end_date' }),
    pb.collection(COLLECTIONS.payments).getFullList<SalaryPayment>({ filter: 'voided = false' }),
    pb.collection(COLLECTIONS.holidays).getFullList<Holiday>({ sort: 'date' }),
    getSettings(),
  ])
  const pending = new Set(runs.filter((r) => r.status === 'pending').map((r) => r.id))
  return {
    employees,
    attendance,
    upad,
    drafts: drafts.filter((d) => employees.some((e) => e.id === d.employee)),
    runs: runs.filter((r) => r.status === 'completed'),
    statements: statements.filter((s) => !pending.has(s.payout_run)),
    payments,
    holidays,
    settings,
  }
}

export async function saveAttendance(input: {
  employee: string
  date: string
  status: AttendanceStatus
  worked_minutes: number
  ot_minutes: number
  notes: string
}): Promise<Attendance> {
  const date = dateKey(input.date)
  if (date > todayKey()) {
    throw new Error('Cannot mark attendance for a future date.')
  }

  // Verify worker boundary - locked if date <= paid_up_to
  const worker = await pb.collection(COLLECTIONS.employees).getOne<Employee>(input.employee).catch(() => null)
  if (worker?.paid_up_to && date <= dateKey(worker.paid_up_to)) {
    throw new Error('Cannot edit locked attendance for a closed cycle. Unlock the payout first.')
  }

  let existing: Attendance | null = null
  try {
    existing = await pb.collection(COLLECTIONS.attendance).getFirstListItem<Attendance>(
      `employee = "${input.employee}" && date >= "${dayStart(date)}" && date <= "${dayEnd(date)}"`,
    )
  } catch {
    // Row does not exist yet
  }

  const safe = {
    ...input,
    date: dayStart(date),
    worked_minutes: input.status === 'hours' ? Math.max(0, Math.round(input.worked_minutes)) : 0,
    ot_minutes: input.status === 'absent' ? 0 : Math.max(0, Math.round(input.ot_minutes)),
  }

  let savedRecord: Attendance
  if (existing) {
    savedRecord = await pb.collection(COLLECTIONS.attendance).update<Attendance>(existing.id, safe)
  } else {
    savedRecord = await pb.collection(COLLECTIONS.attendance).create<Attendance>(safe)
  }

  // Section 7: If a done row's attendance changes, it returns to not done automatically
  await resetDraftDoneStatus(input.employee)

  return savedRecord
}

export async function deleteAttendance(employee: string, date: string): Promise<void> {
  const day = dateKey(date)
  const worker = await pb.collection(COLLECTIONS.employees).getOne<Employee>(employee).catch(() => null)
  if (worker?.paid_up_to && day <= dateKey(worker.paid_up_to)) {
    throw new Error('Cannot delete locked attendance for a closed cycle. Unlock the payout first.')
  }

  const rows = await pb.collection(COLLECTIONS.attendance).getFullList<Attendance>({
    filter: `employee = "${employee}" && date >= "${dayStart(day)}" && date <= "${dayEnd(day)}" && settled_payout = ""`,
  })
  await Promise.all(rows.map((row) => pb.collection(COLLECTIONS.attendance).delete(row.id)))

  await resetDraftDoneStatus(employee)
}

const draftQueues = new Map<string, Promise<void>>()
export function saveDraft(employee: string, values: Omit<CycleDraft, 'id' | 'employee'>): Promise<void> {
  const prior = draftQueues.get(employee) ?? Promise.resolve()
  const task = prior.catch(() => {}).then(async () => {
    let row: CycleDraft | null = null
    try {
      row = await pb.collection(COLLECTIONS.drafts).getFirstListItem<CycleDraft>(`employee = "${employee}"`)
    } catch {
      // New worker draft
    }
    if (row) {
      await pb.collection(COLLECTIONS.drafts).update(row.id, values)
    } else {
      await pb.collection(COLLECTIONS.drafts).create({ employee, ...values })
    }
  })

  draftQueues.set(employee, task)
  void task.then(
    () => {
      if (draftQueues.get(employee) === task) draftQueues.delete(employee)
    },
    () => {
      if (draftQueues.get(employee) === task) draftQueues.delete(employee)
    },
  )
  return task
}

async function resetDraftDoneStatus(employeeId: string): Promise<void> {
  try {
    const draft = await pb.collection(COLLECTIONS.drafts).getFirstListItem<CycleDraft>(`employee = "${employeeId}"`)
    if (draft && draft.is_done) {
      await pb.collection(COLLECTIONS.drafts).update(draft.id, {
        is_done: false,
        typed_paise: null,
      })
    }
  } catch {
    // Draft may not exist yet
  }
}

export async function addUpadEntry(input: {
  employee: string
  date: string
  kind: UpadKind
  amount_paise: number
  note?: string
}): Promise<UpadEntry> {
  const amount = Math.round(input.amount_paise)
  if (amount <= 0) throw new Error('Enter an amount greater than zero.')
  return pb.collection(COLLECTIONS.upad).create<UpadEntry>({
    employee: input.employee,
    date: dayStart(input.date),
    kind: input.kind,
    amount_paise: amount,
    note: input.note?.trim() ?? '',
    payout_id: '',
    voided: false,
  })
}

export async function toggleHoliday(date: string, note = ''): Promise<void> {
  const day = dateKey(date)
  let row: Holiday | null = null
  try {
    row = await pb.collection(COLLECTIONS.holidays).getFirstListItem<Holiday>(
      `date >= "${dayStart(day)}" && date <= "${dayEnd(day)}"`,
    )
  } catch {
    // Holiday not found
  }
  if (row) {
    await pb.collection(COLLECTIONS.holidays).delete(row.id)
  } else {
    await pb.collection(COLLECTIONS.holidays).create({ date: dayStart(day), note })
  }
}

export type PayoutBatchResult = { runId: string; paidPaise: number; workerCount: number }

/**
 * Section 8: Payout algorithm
 * 1. Confirm dialog totals.
 * 2. Create payout_runs with status = pending.
 * 3. For each done row:
 *    - statements row
 *    - salary_payments row
 *    - if Deduct > 0: upad_entries kind deduct
 *    - if Give > 0: upad_entries kind give
 *    - paid_up_to = today
 *    - settled_payout = run on attendance
 *    - clear worker draft for the next cycle
 * 4. Update run to completed.
 * 5. Rollback on failure.
 */
export async function savePayoutBatch(
  selectedDrafts: CycleDraft[],
  today = todayKey(),
  _actor = 'Local user',
): Promise<PayoutBatchResult> {
  const done = selectedDrafts.filter((d) => d.is_done)
  if (!done.length) throw new Error('Mark at least one worker as done before paying out.')

  const data = await loadAppData()
  const settings = data.settings
  const run = await pb.collection(COLLECTIONS.runs).create<PayoutRun>({
    run_date: businessDateTime(today),
    total_paid_paise: 0,
    status: 'pending',
    voided: false,
  })

  const created: Array<{ collection: string; id: string }> = []
  const attendanceBefore: Attendance[] = []
  const employeesBefore: Employee[] = []
  const draftsBeforePayout: CycleDraft[] = []
  let payoutSnapshotId: string | null = null
  let totalPaid = 0

  try {
    for (const draft of done) {
      const employee = data.employees.find((e) => e.id === draft.employee)
      if (!employee) throw new Error('A worker in this payout no longer exists.')

      const start = employee.paid_up_to ? addDays(dateKey(employee.paid_up_to), 1) : dateKey(employee.joined_on)
      const workerDays = data.attendance.filter(
        (a) => a.employee === employee.id && !a.settled_payout && dateKey(a.date) >= start && dateKey(a.date) <= dateKey(today),
      )
      const earned = workerDays.reduce(
        (sum, att) => sum + calcDayEarnings(att, employee.daily_rate_paise, settings.shift_hours, settings.ot_multiplier).earned_paise,
        0,
      )

      const opening = latestStatement(data.statements, employee.id, data.runs)?.closing_paise ?? employee.opening_carry_paise ?? 0
      const typed = Math.max(0, Math.round(draft.typed_paise ?? 0))
      const calculated = calcToPay(opening, earned, draft.adj_paise, draft.deduct_paise, draft.give_upad_paise)
      const settlement = calcPayoutSettlement(calculated, typed)
      const requestedGive = Math.max(0, Math.round(draft.give_upad_paise))
      const requestedDeduct = Math.max(0, Math.round(draft.deduct_paise))
      const excessUpad = settlement.excess_upad_paise

      const statement = await pb.collection(COLLECTIONS.statements).create<Statement>({
        payout_run: run.id,
        employee: employee.id,
        start_date: dayStart(start),
        end_date: dayStart(today),
        opening_paise: opening,
        earned_paise: earned,
        adjustment_paise: Math.round(draft.adj_paise),
        upad_deduct_paise: requestedDeduct,
        upad_give_paise: requestedGive,
        calculated_paise: calculated,
        paid_paise: settlement.paid_paise,
        closing_paise: settlement.carry_out_paise,
        voided: false,
      })
      created.push({ collection: COLLECTIONS.statements, id: statement.id })

      const payment = await pb.collection(COLLECTIONS.payments).create<SalaryPayment>({
        payout_run: run.id,
        employee: employee.id,
        amount_paise: settlement.paid_paise,
        voided: false,
      })
      created.push({ collection: COLLECTIONS.payments, id: payment.id })

      if (requestedDeduct > 0) {
        const entry = await pb.collection(COLLECTIONS.upad).create<UpadEntry>({
          employee: employee.id,
          date: dayStart(today),
          kind: 'deduct',
          amount_paise: requestedDeduct,
          note: 'Upad Deduct at payout',
          payout_id: run.id,
          voided: false,
        })
        created.push({ collection: COLLECTIONS.upad, id: entry.id })
      }

      if (requestedGive > 0) {
        const entry = await pb.collection(COLLECTIONS.upad).create<UpadEntry>({
          employee: employee.id,
          date: dayStart(today),
          kind: 'give',
          amount_paise: requestedGive,
          note: 'Give Upad at payout',
          payout_id: run.id,
          voided: false,
        })
        created.push({ collection: COLLECTIONS.upad, id: entry.id })
      }

      employeesBefore.push(employee)
      await pb.collection(COLLECTIONS.employees).update(employee.id, { paid_up_to: dayStart(today) })

      for (const attendance of workerDays) {
        attendanceBefore.push(attendance)
        await pb.collection(COLLECTIONS.attendance).update(attendance.id, { settled_payout: run.id })
      }

      const savedDraft = data.drafts.find((item) => item.employee === employee.id)
      if (!savedDraft) throw new Error(`${employee.name}: the payout draft was not saved. Try again.`)
      draftsBeforePayout.push(savedDraft)
      totalPaid += settlement.paid_paise
    }

    const payoutSnapshot = await pb.collection(COLLECTIONS.audits).create({
      payout_run: run.id,
      action: 'payout_snapshot',
      unlocked_by: _actor,
      unlocked_at: new Date().toISOString(),
      reason: 'State captured for payout unlock',
      snapshot: { drafts: draftsBeforePayout, employees: employeesBefore, attendance: attendanceBefore },
    })
    payoutSnapshotId = payoutSnapshot.id

    for (const draft of draftsBeforePayout) {
      await pb.collection(COLLECTIONS.drafts).update(draft.id, {
        adj_paise: 0,
        adj_note: '',
        deduct_paise: 0,
        give_upad_paise: 0,
        typed_paise: null,
        is_done: false,
      })
    }

    await pb.collection(COLLECTIONS.runs).update(run.id, { status: 'completed', total_paid_paise: totalPaid })
    return { runId: run.id, paidPaise: totalPaid, workerCount: done.length }
  } catch (error) {
    for (const employee of employeesBefore) {
      await pb.collection(COLLECTIONS.employees).update(employee.id, { paid_up_to: employee.paid_up_to || '' }).catch(() => {})
    }
    for (const attendance of attendanceBefore) {
      await pb.collection(COLLECTIONS.attendance).update(attendance.id, { settled_payout: attendance.settled_payout || '' }).catch(() => {})
    }
    for (const draft of draftsBeforePayout) {
      await saveDraft(draft.employee, {
        adj_paise: draft.adj_paise,
        adj_note: draft.adj_note,
        deduct_paise: draft.deduct_paise,
        give_upad_paise: draft.give_upad_paise,
        typed_paise: draft.typed_paise,
        is_done: draft.is_done,
      }).catch(() => {})
    }
    for (const item of created.reverse()) {
      await pb.collection(item.collection).delete(item.id).catch(() => {})
    }
    if (payoutSnapshotId) {
      await pb.collection(COLLECTIONS.audits).delete(payoutSnapshotId).catch(() => {})
    }
    await pb.collection(COLLECTIONS.runs).delete(run.id).catch(() => {})
    throw error
  }
}

/**
 * Section 9: Unlock algorithm
 * 1. Reason is required.
 * 2. Only latest non-voided run of each affected worker can be unlocked.
 * 3. Write cycle_audits (run, reason, user, time, full snapshot JSON).
 * 4. Void, never delete: run, statements, payments, upad entries (voided = true).
 * 5. Clear settled_payout on affected attendance.
 * 6. Move each worker's paid_up_to back to day before statement's start_date.
 */
export async function unlockPayout(runId: string, reason: string, user: string): Promise<void> {
  const cleanReason = reason.trim()
  if (!cleanReason) throw new Error('Enter a reason to unlock this payout.')

  const [runs, statements, allStatements, payments, upad, attendance, employees, audits, allDrafts] = await Promise.all([
    pb.collection(COLLECTIONS.runs).getFullList<PayoutRun>({ filter: 'voided = false && status = "completed"', sort: '-run_date' }),
    pb.collection(COLLECTIONS.statements).getFullList<Statement>({ filter: `payout_run = "${runId}" && voided = false` }),
    pb.collection(COLLECTIONS.statements).getFullList<Statement>({ filter: 'voided = false', sort: '-end_date' }),
    pb.collection(COLLECTIONS.payments).getFullList<SalaryPayment>({ filter: `payout_run = "${runId}" && voided = false` }),
    pb.collection(COLLECTIONS.upad).getFullList<UpadEntry>({ filter: `payout_id = "${runId}" && voided = false` }),
    pb.collection(COLLECTIONS.attendance).getFullList<Attendance>({ filter: `settled_payout = "${runId}"` }),
    pb.collection(COLLECTIONS.employees).getFullList<Employee>(),
    pb.collection(COLLECTIONS.audits).getFullList<{ id: string; action: string; snapshot: { drafts?: CycleDraft[] } }>({
      filter: `payout_run = "${runId}" && action = "payout_snapshot"`,
    }),
    pb.collection(COLLECTIONS.drafts).getFullList<CycleDraft>(),
  ])

  if (!statements.length) throw new Error('This payout has no active worker statements.')

  const touched = new Set(statements.map((s) => s.employee))
  for (const employeeId of touched) {
    const latest = allStatements
      .filter((s) => s.employee === employeeId)
      .sort((a, b) => dateKey(b.end_date).localeCompare(dateKey(a.end_date)) || (runs.find((run) => run.id === b.payout_run)?.run_date ?? '').localeCompare(runs.find((run) => run.id === a.payout_run)?.run_date ?? ''))[0]

    if (latest && latest.payout_run !== runId) {
      const employee = employees.find((e) => e.id === employeeId)
      const newerRun = runs.find((run) => run.id === latest.payout_run)
      throw new Error(
        `Cannot unlock: ${employee?.name ?? employeeId} has a newer payout run ${latest.payout_run} on ${dateKey(newerRun?.run_date ?? latest.end_date)}. Unlock that first.`,
      )
    }
  }

  const affectedEmployees = employees.filter((e) => touched.has(e.id))
  const payoutSnapshot = audits.at(-1)?.snapshot
  const draftsBeforeUnlock = allDrafts.filter((draft) => touched.has(draft.employee))
  const snapshot = {
    run: runs.find((r) => r.id === runId),
    statements,
    payments,
    upad,
    attendance,
    employees: affectedEmployees,
    drafts_before_unlock: draftsBeforeUnlock,
    payout_drafts: payoutSnapshot?.drafts ?? [],
  }

  const audit = await pb.collection(COLLECTIONS.audits).create({
    payout_run: runId,
    action: 'unlock',
    unlocked_by: user.trim() || 'Local user',
    unlocked_at: new Date().toISOString(),
    reason: cleanReason,
    snapshot,
  })

  try {
    await pb.collection(COLLECTIONS.runs).update(runId, { voided: true })
    for (const statement of statements) await pb.collection(COLLECTIONS.statements).update(statement.id, { voided: true })
    for (const payment of payments) await pb.collection(COLLECTIONS.payments).update(payment.id, { voided: true })
    for (const entry of upad) await pb.collection(COLLECTIONS.upad).update(entry.id, { voided: true })
    for (const entry of attendance) await pb.collection(COLLECTIONS.attendance).update(entry.id, { settled_payout: '' })

    for (const statement of statements) {
      const employee = employees.find((e) => e.id === statement.employee)
      if (!employee) continue
      const priorBoundary = addDays(dateKey(statement.start_date), -1)
      const restoreBoundary = priorBoundary < dateKey(employee.joined_on) ? '' : priorBoundary
      await pb.collection(COLLECTIONS.employees).update(employee.id, { paid_up_to: restoreBoundary })
    }

    for (const draft of payoutSnapshot?.drafts ?? []) {
      await saveDraft(draft.employee, {
        adj_paise: draft.adj_paise,
        adj_note: draft.adj_note,
        deduct_paise: draft.deduct_paise,
        give_upad_paise: draft.give_upad_paise,
        typed_paise: draft.typed_paise,
        is_done: draft.is_done,
      })
    }
  } catch (error) {
    await pb.collection(COLLECTIONS.runs).update(runId, { voided: false }).catch(() => {})
    for (const statement of statements) await pb.collection(COLLECTIONS.statements).update(statement.id, { voided: false }).catch(() => {})
    for (const payment of payments) await pb.collection(COLLECTIONS.payments).update(payment.id, { voided: false }).catch(() => {})
    for (const entry of upad) await pb.collection(COLLECTIONS.upad).update(entry.id, { voided: false }).catch(() => {})
    for (const entry of attendance) await pb.collection(COLLECTIONS.attendance).update(entry.id, { settled_payout: entry.settled_payout }).catch(() => {})
    for (const employee of affectedEmployees) await pb.collection(COLLECTIONS.employees).update(employee.id, { paid_up_to: employee.paid_up_to }).catch(() => {})
    for (const draft of draftsBeforeUnlock) {
      await saveDraft(draft.employee, {
        adj_paise: draft.adj_paise,
        adj_note: draft.adj_note,
        deduct_paise: draft.deduct_paise,
        give_upad_paise: draft.give_upad_paise,
        typed_paise: draft.typed_paise,
        is_done: draft.is_done,
      }).catch(() => {})
    }
    await pb.collection(COLLECTIONS.audits).update(audit.id, { action: 'unlock_failed' }).catch(() => {})
    throw error
  }
}

export function latestStatement(statements: Statement[], employee: string, runs: PayoutRun[]): Statement | undefined {
  return statements
    .filter((s) => s.employee === employee && !s.voided)
    .sort(
      (a, b) =>
        dateKey(b.end_date).localeCompare(dateKey(a.end_date)) ||
        (runs.find((run) => run.id === b.payout_run)?.run_date ?? '').localeCompare(runs.find((run) => run.id === a.payout_run)?.run_date ?? ''),
    )[0]
}

export async function createEmployee(data: {
  name: string
  phone: string
  role: string
  daily_rate_paise: number
  opening_upad_paise: number
  opening_carry_paise: number
  joined_on: string
}): Promise<Employee> {
  const employee = await pb.collection(COLLECTIONS.employees).create<Employee>({
    ...data,
    status: 'active',
    paid_up_to: '',
  })
  try {
    await saveDraft(employee.id, {
      adj_paise: 0,
      adj_note: '',
      deduct_paise: 0,
      give_upad_paise: 0,
      typed_paise: null,
      is_done: false,
    })
    return employee
  } catch (error) {
    await pb.collection(COLLECTIONS.employees).delete(employee.id).catch(() => {})
    throw error
  }
}

export async function updateEmployee(
  id: string,
  data: Partial<Pick<Employee, 'name' | 'phone' | 'role' | 'daily_rate_paise' | 'opening_upad_paise' | 'opening_carry_paise' | 'joined_on' | 'status'>>,
): Promise<Employee> {
  return pb.collection(COLLECTIONS.employees).update<Employee>(id, data)
}

export async function deleteEmployee(id: string): Promise<void> {
  const [attCount, upadCount] = await Promise.all([
    pb.collection(COLLECTIONS.attendance).getList(1, 1, { filter: `employee = "${id}"` }).then((r) => r.totalItems),
    pb.collection(COLLECTIONS.upad).getList(1, 1, { filter: `employee = "${id}"` }).then((r) => r.totalItems),
  ])
  if (attCount > 0 || upadCount > 0) {
    throw new Error('Cannot delete a worker who has attendance or upad records. Set them to inactive instead.')
  }
  await pb.collection(COLLECTIONS.employees).delete(id)
}

export async function setOpenCycleStartDate(
  newStartDate: string,
  applyToWorkers: boolean = true,
): Promise<{ updatedCount: number; startDate: string }> {
  const cleanDate = dateKey(newStartDate)
  const today = todayKey()

  if (!cleanDate || isNaN(new Date(`${cleanDate}T12:00:00`).getTime())) {
    throw new Error('Please enter a valid start date.')
  }

  if (cleanDate > today) {
    throw new Error('Cycle start date cannot be in the future.')
  }

  // Verify against the latest completed payout run
  const runs = await pb.collection(COLLECTIONS.runs).getFullList<PayoutRun>({
    filter: 'voided = false && status = "completed"',
    sort: '-run_date',
  })
  const latestRun = runs[0]
  if (latestRun) {
    const latestPayoutDate = dateKey(latestRun.run_date)
    if (cleanDate <= latestPayoutDate) {
      throw new Error(
        `Cannot start cycle on or before the last completed payout (${latestPayoutDate}). Unlock that payout run first.`,
      )
    }
  }

  let updatedCount = 0
  if (applyToWorkers) {
    const activeWorkers = await pb.collection(COLLECTIONS.employees).getFullList<Employee>({
      filter: 'status = "active"',
    })
    for (const worker of activeWorkers) {
      // If the worker has never had a payout (paid_up_to is empty or null)
      if (!worker.paid_up_to) {
        await pb.collection(COLLECTIONS.employees).update(worker.id, {
          joined_on: `${cleanDate} 00:00:00.000Z`,
        })
        updatedCount += 1
      }
    }
  }

  return { updatedCount, startDate: cleanDate }
}

