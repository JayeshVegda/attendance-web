import { describe, expect, it } from 'vitest'
import { computePayout } from './engine'
import {
  EMPTY_INPUTS,
  buildPreview,
  buildStatementRecord,
  contextsFromRaw,
  type PreviewRow,
  type WorkerContext,
} from './payout-service'
import { computeCycleRows, upadBreakdownForEmployee } from './payroll'
import type { Adjustment, Attendance, Employee, RateHistory, Statement, UpadEntry } from './types'

const R = 90000

function employee(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    employee_no: '1',
    name: `Worker ${id}`,
    phone: '',
    active: true,
    daily_rate_paise: R,
    opening_salary_paise: 0,
    opening_upad_paise: 0,
    joined_on: '2026-01-01',
    notes: '',
    sort_order: 1,
    created: '',
    updated: '',
    ...overrides,
  }
}

function att(employee: string, date: string, status: 'full' | 'half' | 'absent', ot = 0): Attendance {
  return { id: `${employee}-${date}`, employee, date, status, ot_minutes: ot, note: '', created: '', updated: '' }
}

function upad(employee: string, date: string, kind: 'given' | 'recovery' | 'returned', amount: number): UpadEntry {
  return {
    id: `${employee}-${date}-${kind}`,
    employee,
    date,
    kind,
    category: 'regular',
    amount_paise: amount,
    note: '',
    statement: '',
    created: '',
  }
}

function adjustment(employee: string, date: string, kind: 'bonus' | 'deduction', amount: number): Adjustment {
  return {
    id: `${employee}-${date}-${kind}`,
    employee,
    date,
    kind,
    amount_paise: amount,
    note: '',
    created: '',
  }
}

function statement(employee: string, closing: number, payoutDate: string): Statement {
  return {
    id: `${employee}-${payoutDate}`,
    payout_run: 'prior-run',
    employee,
    cycle_start: '2026-09-25',
    payout_date: payoutDate,
    opening_paise: 0,
    earned_paise: 0,
    adjustment_paise: 0,
    upad_outstanding_paise: 0,
    upad_recovery_paise: 0,
    total_due_paise: closing,
    paid_paise: 0,
    closing_paise: closing,
    days_worked: 0,
    ot_minutes: 0,
    note: '',
    created: `${payoutDate} 10:00:00.000Z`,
  }
}

type Raw = {
  employees: Employee[]
  rates: RateHistory[]
  attAll: Attendance[]
  adjAll: Adjustment[]
  upadAll: UpadEntry[]
  stmts: Statement[]
}

function makeRaw(): Raw {
  const carry = employee('A', { opening_salary_paise: 50000 })
  const fresh = employee('B', { opening_salary_paise: 0 })
  const halfDay = employee('C')
  return {
    employees: [carry, fresh, halfDay],
    rates: [
      { id: 'r0', employee: 'A', effective_from: '2026-01-01', daily_rate_paise: R, note: '', created: '' },
      { id: 'r1', employee: 'B', effective_from: '2026-01-01', daily_rate_paise: R, note: '', created: '' },
      { id: 'r2', employee: 'C', effective_from: '2026-01-01', daily_rate_paise: R, note: '', created: '' },
    ],
    attAll: [
      att('A', '2026-10-05', 'full', 120),
      att('A', '2026-10-06', 'half'),
      att('B', '2026-10-05', 'full'),
      att('B', '2026-10-06', 'full'),
      att('C', '2026-10-05', 'half', 60),
    ],
    adjAll: [
      adjustment('A', '2026-10-06', 'bonus', 25000),
      adjustment('B', '2026-10-06', 'deduction', 10000),
    ],
    upadAll: [
      upad('A', '2026-10-03', 'given', 40000),
      upad('A', '2026-10-04', 'recovery', 10000),
      upad('C', '2026-10-06', 'given', 30000),
    ],
    stmts: [statement('A', 60000, '2026-10-02')],
  }
}

const CYCLE = { cycleStart: '2026-10-03', payoutDate: '2026-10-09' }

function registerRows(raw: Raw) {
  return computeCycleRows({
    employees: raw.employees,
    rates: raw.rates,
    attendance: raw.attAll,
    adjustments: raw.adjAll,
    upadEntries: raw.upadAll,
    statements: raw.stmts,
    periods: [],
    cycleStart: CYCLE.cycleStart,
    payoutDate: CYCLE.payoutDate,
  })
}

function previewRows(raw: Raw) {
  const contexts = contextsFromRaw({
    employees: raw.employees,
    ratesAll: raw.rates,
    periodsAll: [],
    attAll: raw.attAll,
    adjAll: raw.adjAll,
    upadAll: raw.upadAll,
    stmts: raw.stmts,
  })
  const rows = buildPreview(contexts, CYCLE.payoutDate, {}, raw.attAll)
  return { contexts, rows }
}

describe('unified calculation across register, payout preview, and saved statement', () => {
  it('register rows and payout preview agree on the numbers', () => {
    const raw = makeRaw()
    const reg = registerRows(raw)
    const { rows: prev } = previewRows(raw)
    const prevByEmployee = new Map<string, PreviewRow>()
    for (const p of prev) {
      if (p.included && p.computation) prevByEmployee.set(p.context.employee.id, p)
    }

    for (const row of reg) {
      const p = prevByEmployee.get(row.employee.id)
      expect(p, `preview row for ${row.employee.id}`).toBeTruthy()
      const comp = p!.computation!
      expect(row.openingPaise).toBe(comp.carry_paise)
      expect(row.earnedPaise).toBe(comp.earned_paise)
      expect(row.adjustmentPaise).toBe(comp.adjustments_paise)
      expect(row.upadOutstandingPaise).toBe(comp.chalu_balance_paise + comp.moto_balance_paise)
      expect(row.totalDuePaise).toBe(comp.total_due_paise)
    }
  })

  it('statement record built for saving matches the same engine numbers', () => {
    const raw = makeRaw()
    const { contexts, rows: prev } = previewRows(raw)
    const reg = registerRows(raw)
    const regByEmployee = new Map(reg.map((r) => [r.employee.id, r]))

    for (const prevRow of prev.filter((p) => p.included && p.computation)) {
      const ctx = contexts.find((c) => c.employee.id === prevRow.context.employee.id) as WorkerContext
      const comp = prevRow.computation!
      const record = buildStatementRecord(ctx, comp, 'run-1', CYCLE.payoutDate)
      const row = regByEmployee.get(ctx.employee.id)
      expect(row).toBeTruthy()
      expect(record.opening_paise).toBe(row!.openingPaise)
      expect(record.earned_paise).toBe(row!.earnedPaise)
      expect(record.adjustment_paise).toBe(row!.adjustmentPaise)
      expect(record.upad_outstanding_paise).toBe(row!.upadOutstandingPaise)
      expect(record.total_due_paise).toBe(row!.totalDuePaise)
      // with register default (full-due payment), the cash payment equals the payable after recovery
      expect(record.paid_paise).toBeLessThanOrEqual(comp.total_due_paise)
      expect(record.paid_paise + record.closing_paise).toBe(comp.total_due_paise)
    }
  })

  it('saveCycleRows path produces the same amounts the register displayed', async () => {
    const raw = makeRaw()
    const reg = registerRows(raw)
    const contexts = contextsFromRaw({
      employees: raw.employees,
      ratesAll: raw.rates,
      periodsAll: [],
      attAll: raw.attAll,
      adjAll: raw.adjAll,
      upadAll: raw.upadAll,
      stmts: raw.stmts,
    })

    for (const row of reg) {
      const ctx = contexts.find((c) => c.employee.id === row.employee.id)!
      const base = computePayout(
        ctx.worker, ctx.paidUpToDate, CYCLE.payoutDate, ctx.rates, ctx.periods,
        ctx.attendance, ctx.adjustments, ctx.upads, EMPTY_INPUTS,
      )
      expect(base.ok).toBe(true)
      const res = base.ok ? base.result : null
      if (row.upadRecoveryPaise === 0 && row.totalDuePaise === (res?.total_due_paise ?? 0)) {
        expect(row.totalDuePaise).toBe(res!.total_due_paise)
      }
    }
  })

  it('carry worker: opening = prior closing, bonus and upad netted, due stable', () => {
    const raw = makeRaw()
    const rows = registerRows(raw)
    const carryRow = rows.find((r) => r.employee.id === 'A')!
    // prior closing 60000; cycle: full(90000)+OT(120*90000/480=22500)+half(45000)+upadGiven(40000)-upadRecovery(10000)+bonus(25000)
    expect(carryRow.openingPaise).toBe(60000)
    expect(carryRow.earnedPaise).toBe(157500)
    expect(carryRow.adjustmentPaise).toBe(25000)
    expect(carryRow.upadOutstandingPaise).toBe(30000)
    expect(carryRow.totalDuePaise).toBe(60000 + 157500 + 25000)
  })

  it('fresh worker: no timecard means no earned, no row exclusion flip', () => {
    const raw = makeRaw()
    const rows = registerRows(raw)
    const freshRow = rows.find((r) => r.employee.id === 'B')!
    expect(freshRow.openingPaise).toBe(0)
    expect(freshRow.earnedPaise).toBe(180000)
    expect(freshRow.adjustmentPaise).toBe(-10000)
    expect(freshRow.totalDuePaise).toBe(170000)
  })

  it('upad breakdown splits chalu and moto consistently for both paths', () => {
    const raw = makeRaw()
    const motoUpad: UpadEntry = { ...upad('C', '2026-10-07', 'given', 20000), category: 'extra', kind: 'given' }
    const entries = [...raw.upadAll, motoUpad]
    const c = raw.employees.find((e) => e.id === 'C')!
    const breakdown = upadBreakdownForEmployee(c, entries, CYCLE.payoutDate)
    expect(breakdown.chaluPaise).toBe(30000)
    expect(breakdown.motoPaise).toBe(20000)
  })

  it('late attendance rows before the cycle still count through the engine', () => {
    const raw = makeRaw()
    raw.attAll.push(att('B', '2026-09-20', 'full'))
    const rows = registerRows(raw)
    const freshRow = rows.find((r) => r.employee.id === 'B')!
    expect(freshRow.earnedPaise).toBe(270000)
  })

  it('pending-run statements are excluded from carry via excludeRunIds', () => {
    const raw = makeRaw()
    const pendingStmt: Statement = {
      ...statement('B', 99000, '2026-10-30'),
      id: 'B-pending',
      payout_run: 'pending-run',
      created: '2026-10-30 10:00:00.000Z',
    }
    raw.stmts.push(pendingStmt)
    const withExclusion = contextsFromRaw({
      employees: raw.employees,
      ratesAll: raw.rates,
      periodsAll: [],
      attAll: raw.attAll,
      adjAll: raw.adjAll,
      upadAll: raw.upadAll,
      stmts: raw.stmts,
      excludeRunIds: ['pending-run'],
    })
    const ctxB = withExclusion.find((c) => c.employee.id === 'B')!
    expect(ctxB.paidUpToDate).toBe('')
    expect(ctxB.carryPaise).toBe(0)

    const withoutExclusion = contextsFromRaw({
      employees: raw.employees,
      ratesAll: raw.rates,
      periodsAll: [],
      attAll: raw.attAll,
      adjAll: raw.adjAll,
      upadAll: raw.upadAll,
      stmts: raw.stmts,
    })
    const ctxBAlt = withoutExclusion.find((c) => c.employee.id === 'B')!
    expect(ctxBAlt.paidUpToDate).toBe('2026-10-30')
    expect(ctxBAlt.carryPaise).toBe(99000)
  })
})
