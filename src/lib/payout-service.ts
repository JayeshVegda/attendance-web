import { pb, COLLECTIONS } from './pb'
import {
  type AdjustmentKind,
  type AttendanceRow,
  type Bucket,
  type DayStatus,
  type EngineError,
  type EngineWarning,
  type PayoutComputation,
  type PayoutInputs,
  type PeriodRow,
  type RateRow,
  type UpadRow,
  type WorkerRef,
  computePayout,
  type AdjustmentRow,
  unmarkedDaysFor,
  upadBalance,
} from './engine'
import { addDays } from './dates'
import type {
  Adjustment,
  Attendance,
  Employee,
  EmploymentPeriod,
  RateHistory,
  Statement,
  UpadEntry,
} from './types'

export type { EngineError, EngineWarning, PayoutInputs, PayoutComputation }

export type WorkerContext = {
  employee: Employee
  worker: WorkerRef
  paidUpToDate: string
  carryPaise: number
  rates: RateRow[]
  periods: PeriodRow[]
  attendance: AttendanceRow[]
  adjustments: AdjustmentRow[]
  upads: UpadRow[]
}

export type PreviewRow = {
  context: WorkerContext
  included: boolean
  computation: PayoutComputation | null
  errors: EngineError[]
  warnings: EngineWarning[]
  unmarkedDates: string[]
}

export type SavePayoutInput = {
  payoutDate: string
  cutoff: string
  note: string
  rows: { context: WorkerContext; inputs: PayoutInputs }[]
}

export function formatEngineError(err: EngineError): string {
  switch (err.code) {
    case 'chalu_recovery_exceeds_balance':
      return `Chalu Upad recovery is more than the balance (${(err.amount / 100).toFixed(2)} too much)`
    case 'moto_recovery_exceeds_balance':
      return `Main Upad recovery is more than the balance (${(err.amount / 100).toFixed(2)} too much)`
    case 'recovery_exceeds_due':
      return `Total recovery is more than what is owed (${(err.amount / 100).toFixed(2)} too much)`
    case 'salary_paid_out_of_range':
      return `Salary cannot be paid — not enough owed to cover it (${(err.amount / 100).toFixed(2)} short)`
  }
}

export const EMPTY_INPUTS: PayoutInputs = {
  chalu_recovery_paise: 0,
  moto_recovery_paise: 0,
  salary_paid_paise: 0,
  new_upad_bucket: 'chalu',
  new_upad_given_paise: 0,
}

function kindOf(a: Adjustment): AdjustmentKind {
  if (a.kind && ['bonus', 'reimbursement', 'deduction'].includes(a.kind)) return a.kind
  return a.amount_paise < 0 ? 'deduction' : 'bonus'
}

function bucketOf(u: UpadEntry): Bucket {
  return u.category === 'moto' || u.category === 'extra' ? 'moto' : 'chalu'
}

export function normDate(d: string | undefined | null): string {
  return (d ?? '').slice(0, 10)
}

function orEquals(field: string, ids: string[]): string {
  return ids.map((id) => `${field} = "${id}"`).join(' || ')
}

export async function loadWorkerContexts(): Promise<WorkerContext[]> {
  const [employees, ratesAll, periodsAll, attAll, adjAll, upadAll, stmts] = await Promise.all([
    pb.collection(COLLECTIONS.employees).getFullList<Employee>({ sort: 'sort_order' }),
    pb.collection(COLLECTIONS.rates).getFullList<RateHistory>({ sort: 'effective_from' }),
    pb.collection(COLLECTIONS.periods).getFullList<EmploymentPeriod>({ sort: 'start_date' }),
    pb.collection(COLLECTIONS.attendance).getFullList<Attendance>({ sort: 'date' }),
    pb.collection(COLLECTIONS.adjustments).getFullList<Adjustment>({ sort: 'date' }),
    pb.collection(COLLECTIONS.upad).getFullList<UpadEntry>({ sort: 'date' }),
    pb.collection(COLLECTIONS.statements).getFullList<Statement>({ filter: 'voided != true', sort: 'payout_date' }),
  ])

  const latestByEmployee = new Map<string, Statement>()
  for (const s of stmts) latestByEmployee.set(s.employee, s)

  return employees.map((e) => {
    const latest = latestByEmployee.get(e.id)
    const paidUpToDate = normDate(latest?.payout_date)
    const carryPaise = latest ? latest.closing_paise : e.opening_salary_paise ?? 0
    const worker: WorkerRef = {
      id: e.id,
      opening_carry_paise: carryPaise,
      opening_chalu_paise: e.opening_chalu_paise ?? 0,
      opening_moto_paise: e.opening_moto_paise ?? 0,
      opening_date: normDate(e.opening_date) || normDate(e.joined_on),
    }
    const rawAtt = attAll.filter((a) => a.employee === e.id)
    const attendance: AttendanceRow[] = rawAtt.map((a) => ({
      id: a.id,
      employee: a.employee,
      date: normDate(a.date),
      status: a.status as DayStatus,
      ot_minutes: a.ot_minutes ?? 0,
      settled: !!a.settled_payout,
    }))
    const adjustments: AdjustmentRow[] = adjAll
      .filter((a) => a.employee === e.id)
      .map((a) => ({
        id: a.id,
        employee: a.employee,
        date: normDate(a.date),
        kind: kindOf(a),
        amount_paise: Math.abs(a.amount_paise),
        settled: !!a.settled_payout,
      }))
    const upads: UpadRow[] = upadAll
      .filter((u) => u.employee === e.id)
      .map((u) => ({
        id: u.id,
        employee: u.employee,
        date: normDate(u.date),
        bucket: bucketOf(u),
        kind: u.kind,
        amount_paise: u.amount_paise,
        voided: u.voided ?? false,
      }))
    return {
      employee: e,
      worker,
      paidUpToDate,
      carryPaise,
      rates: ratesAll
        .filter((r) => r.employee === e.id)
        .map((r) => ({ effective_from: r.effective_from, daily_rate_paise: r.daily_rate_paise })),
      periods: periodsAll
        .filter((p) => p.employee === e.id)
        .map((p) => ({ start_date: normDate(p.start_date), end_date: normDate(p.end_date) ?? "" })),
      attendance,
      adjustments,
      upads,
    }
  })
}

export function buildPreview(
  contexts: WorkerContext[],
  cutoff: string,
  inputsByEmployee: Record<string, Partial<PayoutInputs>>,
  allRawAttendance: Attendance[]
): PreviewRow[] {
  const allEngineAtt: AttendanceRow[] = allRawAttendance.map((a) => ({
    id: a.id,
    employee: a.employee,
    date: normDate(a.date),
    status: a.status as DayStatus,
    ot_minutes: a.ot_minutes ?? 0,
    settled: !!a.settled_payout,
  }))
  return contexts.map((ctx) => {
    const merged: PayoutInputs = { ...EMPTY_INPUTS, ...(inputsByEmployee[ctx.employee.id] ?? {}) }
    const hasActivity =
      ctx.attendance.some((a) => !a.settled && a.date <= cutoff) ||
      ctx.adjustments.some((a) => !a.settled && a.date <= cutoff)
    const carryDiffers = ctx.worker.opening_carry_paise !== 0
    const chaluBalance = upadBalance(ctx.upads, 'chalu', ctx.worker.opening_chalu_paise, cutoff)
    const motoBalance = upadBalance(ctx.upads, 'moto', ctx.worker.opening_moto_paise, cutoff)
    const included = hasActivity || carryDiffers || chaluBalance !== 0 || motoBalance !== 0
    if (!included) {
      return { context: ctx, included: false, computation: null, errors: [], warnings: [], unmarkedDates: [] }
    }
    const out = computePayout(
      ctx.worker,
      ctx.paidUpToDate,
      cutoff,
      ctx.rates,
      ctx.periods,
      ctx.attendance,
      ctx.adjustments,
      ctx.upads,
      merged
    )
    if (!out.ok) {
      return { context: ctx, included: true, computation: null, errors: out.errors, warnings: [], unmarkedDates: [] }
    }
    const unmarked = unmarkedDaysFor(
      ctx.worker,
      ctx.paidUpToDate,
      cutoff,
      ctx.periods,
      ctx.attendance,
      allEngineAtt
    )
    return {
      context: ctx,
      included: true,
      computation: out.result,
      errors: [],
      warnings: out.result.warnings,
      unmarkedDates: unmarked,
    }
  })
}

export async function savePayout(input: SavePayoutInput): Promise<{ runId: string; statementIds: string[] }> {
  if (input.rows.length === 0) throw new Error('no workers selected')

  const computations = input.rows.map((row) => {
    const comp = computePayout(
      row.context.worker,
      row.context.paidUpToDate,
      input.cutoff,
      row.context.rates,
      row.context.periods,
      row.context.attendance,
      row.context.adjustments,
      row.context.upads,
      row.inputs
    )
    if (!comp.ok) {
      throw new Error(`payout invalid for worker ${row.context.employee.name}: ${JSON.stringify(comp.errors)}`)
    }
    return { row, res: comp.result }
  })

  const fromDates = computations.map(({ row }) =>
    row.context.paidUpToDate ? addDays(row.context.paidUpToDate, 1) : row.context.worker.opening_date
  )
  const cycleStart = fromDates.reduce((a, b) => (b < a ? b : a))

  let runId = ''
  const statementIds: string[] = []
  const paymentIds: string[] = []
  const upadIds: string[] = []
  try {
    const run = await pb.collection(COLLECTIONS.runs).create({
      cycle_start: cycleStart,
      payout_date: input.payoutDate,
      cutoff_date: input.cutoff,
      status: 'closed',
      voided: false,
      note: input.note,
      employee_count: computations.length,
      total_due_paise: 0,
      total_paid_paise: 0,
      total_upad_recovery_paise: 0,
    })
    runId = run.id

    let totalDue = 0
    let totalPaid = 0
    let totalRecovery = 0

    for (const { row, res } of computations) {
      const stmt = await pb.collection(COLLECTIONS.statements).create({
        payout_run: runId,
        employee: row.context.employee.id,
        cycle_start: res.from_date,
        payout_date: input.payoutDate,
        opening_paise: res.carry_paise,
        earned_paise: res.earned_paise,
        adjustment_paise: res.adjustments_paise,
        upad_outstanding_paise: res.chalu_balance_paise + res.moto_balance_paise,
        upad_recovery_paise: res.chalu_recovery_paise + res.moto_recovery_paise,
        total_due_paise: res.total_due_paise,
        paid_paise: res.salary_paid_paise,
        closing_paise: res.closing_carry_paise,
        days_worked: res.day_breakdown.filter((b) => b.status === 'full' || b.status === 'half').length,
        ot_minutes: res.day_breakdown.reduce((s, b) => s + b.ot_minutes, 0),
        note: '',
        voided: false,
      })
      statementIds.push(stmt.id)

      const formattedPayoutDate = input.payoutDate.includes(' ')
        ? input.payoutDate
        : `${input.payoutDate.slice(0, 10)} 00:00:00.000Z`

      if (res.salary_paid_paise > 0) {
        const pay = await pb.collection(COLLECTIONS.payments).create({
          employee: row.context.employee.id,
          statement: stmt.id,
          paid_on: formattedPayoutDate,
          amount_paise: res.salary_paid_paise,
          note: '',
          voided: false,
        })
        paymentIds.push(pay.id)
      }
      if (res.chalu_recovery_paise > 0) upadIds.push((await pb.collection(COLLECTIONS.upad).create({
        employee: row.context.employee.id,
        date: formattedPayoutDate,
        kind: 'recovery',
        category: 'chalu',
        bucket: 'chalu',
        amount_paise: res.chalu_recovery_paise,
        note: '',
        payout: runId,
        voided: false,
      })).id)
      if (res.moto_recovery_paise > 0) upadIds.push((await pb.collection(COLLECTIONS.upad).create({
        employee: row.context.employee.id,
        date: formattedPayoutDate,
        kind: 'recovery',
        category: 'moto',
        bucket: 'moto',
        amount_paise: res.moto_recovery_paise,
        note: '',
        payout: runId,
        voided: false,
      })).id)
      if (res.new_upad_given_paise > 0) upadIds.push((await pb.collection(COLLECTIONS.upad).create({
        employee: row.context.employee.id,
        date: formattedPayoutDate,
        kind: 'given',
        category: res.new_upad_bucket,
        bucket: res.new_upad_bucket,
        amount_paise: res.new_upad_given_paise,
        note: '',
        payout: runId,
        voided: false,
      })).id)

      for (const att of row.context.attendance) {
        if (!att.settled && att.date <= input.cutoff) {
          await pb.collection(COLLECTIONS.attendance).update(att.id, { settled_payout: runId })
        }
      }
      for (const adj of row.context.adjustments) {
        if (!adj.settled && adj.date <= input.cutoff) {
          await pb.collection(COLLECTIONS.adjustments).update(adj.id, { settled_payout: runId })
        }
      }

      totalDue += res.total_due_paise
      totalPaid += res.salary_paid_paise
      totalRecovery += res.chalu_recovery_paise + res.moto_recovery_paise
    }

    await pb.collection(COLLECTIONS.runs).update(runId, {
      total_due_paise: totalDue,
      total_paid_paise: totalPaid,
      total_upad_recovery_paise: totalRecovery,
    })
  } catch (err) {
    for (const id of upadIds) await pb.collection(COLLECTIONS.upad).delete(id).catch(() => {})
    for (const id of paymentIds) await pb.collection(COLLECTIONS.payments).delete(id).catch(() => {})
    for (const id of statementIds) await pb.collection(COLLECTIONS.statements).delete(id).catch(() => {})
    if (runId) {
      await pb.collection(COLLECTIONS.runs).delete(runId).catch(() => {})
    }
    throw err
  }
  return { runId, statementIds }
}

export async function undoPayout(runId: string): Promise<{ ok: true } | { ok: false; reason: string; workers: string[] }> {
  const run = await pb.collection(COLLECTIONS.runs).getOne(runId)
  if (run.voided) return { ok: false, reason: 'already_voided', workers: [] }

  const stmts = await pb.collection(COLLECTIONS.statements).getFullList<Statement>({
    filter: `payout_run = "${runId}"`,
  })
  const allStmts = await pb.collection(COLLECTIONS.statements).getFullList<Statement>({
    filter: 'voided != true',
  })

  const blockedEmployeeIds: string[] = []
  for (const s of stmts) {
    const sd = normDate(s.payout_date)
    const newer = allStmts.some(
      (o) =>
        o.employee === s.employee &&
        o.id !== s.id &&
        (normDate(o.payout_date) > sd || (normDate(o.payout_date) === sd && o.created > s.created))
    )
    if (newer && !blockedEmployeeIds.includes(s.employee)) blockedEmployeeIds.push(s.employee)
  }
  if (blockedEmployeeIds.length > 0) {
    const employees = await Promise.all(
      blockedEmployeeIds.map((id) => pb.collection(COLLECTIONS.employees).getOne<Employee>(id))
    )
    return { ok: false, reason: 'not_latest', workers: employees.map((e) => e.name) }
  }

  await Promise.all(stmts.map((s) => pb.collection(COLLECTIONS.statements).update(s.id, { voided: true })))

  const payments = stmts.length
    ? await pb.collection(COLLECTIONS.payments).getFullList({ filter: orEquals('statement', stmts.map((s) => s.id)) })
    : []
  await Promise.all(payments.map((p) => pb.collection(COLLECTIONS.payments).update(p.id, { voided: true })))

  const upads = await pb.collection(COLLECTIONS.upad).getFullList({ filter: `payout = "${runId}"` })
  await Promise.all(upads.map((u) => pb.collection(COLLECTIONS.upad).update(u.id, { voided: true })))

  const atts = await pb.collection(COLLECTIONS.attendance).getFullList({ filter: `settled_payout = "${runId}"` })
  await Promise.all(atts.map((a) => pb.collection(COLLECTIONS.attendance).update(a.id, { settled_payout: null })))
  const adjs = await pb.collection(COLLECTIONS.adjustments).getFullList({ filter: `settled_payout = "${runId}"` })
  await Promise.all(adjs.map((a) => pb.collection(COLLECTIONS.adjustments).update(a.id, { settled_payout: null })))

  await pb.collection(COLLECTIONS.runs).update(runId, { voided: true })
  return { ok: true }
}
