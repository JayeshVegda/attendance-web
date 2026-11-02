import { describe, expect, it } from 'vitest'
import {
  isRealPayoutRun,
  realPayoutRuns,
  lastClosedRun,
  computeGridStart,
  getWorkerPaidUpToDate,
} from './cycle'
import type { Employee, PayoutRun, Statement } from './types'

describe('Payout Run Status Helper - isRealPayoutRun', () => {
  it('counts runs with status completed as real payout', () => {
    const run: Partial<PayoutRun> = {
      id: 'r1',
      status: 'completed',
      payout_date: '2026-10-29',
      voided: false,
    }
    expect(isRealPayoutRun(run)).toBe(true)
  })

  it('counts legacy runs with status closed as real payout', () => {
    const run: Partial<PayoutRun> = {
      id: 'r2',
      status: 'closed',
      payout_date: '2026-10-22',
      voided: false,
    }
    expect(isRealPayoutRun(run)).toBe(true)
  })

  it('never counts runs with status pending', () => {
    const run: Partial<PayoutRun> = {
      id: 'r3',
      status: 'pending',
      payout_date: '2026-11-02',
      voided: false,
    }
    expect(isRealPayoutRun(run)).toBe(false)
  })

  it('never counts voided runs even if status is completed or closed', () => {
    const runCompletedVoided: Partial<PayoutRun> = {
      id: 'r4',
      status: 'completed',
      payout_date: '2026-10-26',
      voided: true,
    }
    const runClosedVoided: Partial<PayoutRun> = {
      id: 'r5',
      status: 'closed',
      payout_date: '2026-10-26',
      voided: true,
    }
    expect(isRealPayoutRun(runCompletedVoided)).toBe(false)
    expect(isRealPayoutRun(runClosedVoided)).toBe(false)
  })

  it('handles null, undefined, or empty run safely', () => {
    expect(isRealPayoutRun(null)).toBe(false)
    expect(isRealPayoutRun(undefined)).toBe(false)
    expect(isRealPayoutRun({})).toBe(false)
  })

  it('filters real payout runs and selects the latest closed run correctly', () => {
    const runs: PayoutRun[] = [
      { id: '1', cycle_start: '2026-10-01', payout_date: '2026-10-08', status: 'completed', voided: false, note: '', total_due_paise: 0, total_paid_paise: 0, total_upad_recovery_paise: 0, employee_count: 10, created: '2026-10-08' },
      { id: '2', cycle_start: '2026-10-09', payout_date: '2026-10-15', status: 'completed', voided: false, note: '', total_due_paise: 0, total_paid_paise: 0, total_upad_recovery_paise: 0, employee_count: 10, created: '2026-10-15' },
      { id: '3', cycle_start: '2026-10-16', payout_date: '2026-10-22', status: 'closed', voided: false, note: '', total_due_paise: 0, total_paid_paise: 0, total_upad_recovery_paise: 0, employee_count: 10, created: '2026-10-22' },
      { id: '4', cycle_start: '2026-10-23', payout_date: '2026-10-26', status: 'completed', voided: true, note: 'voided run', total_due_paise: 0, total_paid_paise: 0, total_upad_recovery_paise: 0, employee_count: 1, created: '2026-10-26' },
      { id: '5', cycle_start: '2026-10-23', payout_date: '2026-10-29', status: 'completed', voided: false, note: '', total_due_paise: 0, total_paid_paise: 0, total_upad_recovery_paise: 0, employee_count: 10, created: '2026-10-29' },
      { id: '6', cycle_start: '2026-10-30', payout_date: '2026-11-02', status: 'pending', voided: false, note: 'in progress draft', total_due_paise: 0, total_paid_paise: 0, total_upad_recovery_paise: 0, employee_count: 10, created: '2026-11-02' },
    ]

    const real = realPayoutRuns(runs)
    expect(real).toHaveLength(4)
    expect(real.map((r) => r.id)).toEqual(['1', '2', '3', '5'])

    const latest = lastClosedRun(runs)
    expect(latest).toBeDefined()
    expect(latest?.id).toBe('5')
    expect(latest?.payout_date).toBe('2026-10-29')
  })
})

describe('computeGridStart - Earliest Paid-Up-To Among Active Workers', () => {
  const activeWorkerA = {
    id: 'empA',
    employee_no: '1',
    name: 'Worker A',
    active: true,
    daily_rate_paise: 50000,
    opening_salary_paise: 0,
    opening_upad_paise: 0,
    phone: '',
    joined_on: '2026-10-01',
    notes: '',
    sort_order: 1,
    created: '2026-10-01',
    updated: '2026-10-01',
  } as Employee

  const activeWorkerB = {
    id: 'empB',
    employee_no: '2',
    name: 'Worker B',
    active: true,
    daily_rate_paise: 45000,
    opening_salary_paise: 0,
    opening_upad_paise: 0,
    phone: '',
    joined_on: '2026-10-01',
    notes: '',
    sort_order: 2,
    created: '2026-10-01',
    updated: '2026-10-01',
  } as Employee

  const inactiveWorkerPrakash = {
    id: 'empPrakash',
    employee_no: '5',
    name: 'Prakash (Inactive)',
    active: false,
    daily_rate_paise: 42000,
    opening_salary_paise: 0,
    opening_upad_paise: 0,
    phone: '',
    joined_on: '2026-10-01',
    notes: '',
    sort_order: 5,
    created: '2026-10-01',
    updated: '2026-10-01',
  } as Employee

  it('calculates grid start after normal payouts (all active paid up to 29 Oct -> grid start 30 Oct)', () => {
    const stmts: Statement[] = [
      { id: 's1', employee: 'empA', payout_run: 'r1', cycle_start: '2026-10-23', payout_date: '2026-10-29', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 5, ot_minutes: 0, note: '', voided: false, created: '2026-10-29' },
      { id: 's2', employee: 'empB', payout_run: 'r1', cycle_start: '2026-10-23', payout_date: '2026-10-29', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 5, ot_minutes: 0, note: '', voided: false, created: '2026-10-29' },
    ]

    const start = computeGridStart({
      activeEmployees: [activeWorkerA, activeWorkerB],
      statements: stmts,
    })
    expect(start).toBe('2026-10-30')
  })

  it('keeps other workers unpaid days visible when one worker had an off-schedule payout later than others', () => {
    // Worker A was paid on 29 Oct. Worker B had a single-worker off-schedule payout on 31 Oct.
    const stmts: Statement[] = [
      { id: 's1', employee: 'empA', payout_run: 'r1', cycle_start: '2026-10-23', payout_date: '2026-10-29', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 5, ot_minutes: 0, note: '', voided: false, created: '2026-10-29' },
      { id: 's2', employee: 'empB', payout_run: 'r2', cycle_start: '2026-10-23', payout_date: '2026-10-31', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 6, ot_minutes: 0, note: '', voided: false, created: '2026-10-31' },
    ]

    // Earliest paid-up-to is Worker A (29 Oct) -> grid start is 30 Oct!
    // Worker A's days on 30 and 31 Oct are NOT hidden by Worker B's 31 Oct payout!
    const start = computeGridStart({
      activeEmployees: [activeWorkerA, activeWorkerB],
      statements: stmts,
    })
    expect(start).toBe('2026-10-30')

    // And Worker B's own paid-up-to date is correctly identified as 31 Oct
    expect(getWorkerPaidUpToDate('empB', stmts)).toBe('2026-10-31')
    expect(getWorkerPaidUpToDate('empA', stmts)).toBe('2026-10-29')
  })

  it('does NOT let an inactive worker with older payout pull the grid start back', () => {
    // Inactive worker Prakash was paid on 22 Oct. Active workers were paid on 29 Oct.
    const stmts: Statement[] = [
      { id: 's1', employee: 'empA', payout_run: 'r1', cycle_start: '2026-10-23', payout_date: '2026-10-29', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 5, ot_minutes: 0, note: '', voided: false, created: '2026-10-29' },
      { id: 's2', employee: 'empPrakash', payout_run: 'r3', cycle_start: '2026-10-16', payout_date: '2026-10-22', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 1, ot_minutes: 0, note: '', voided: false, created: '2026-10-22' },
    ]

    // Passing only active employees ensures Prakash does not pull start to 23 Oct
    const start = computeGridStart({
      activeEmployees: [activeWorkerA],
      statements: stmts,
    })
    expect(start).toBe('2026-10-30')
  })

  it('falls back to first_cycle_start when nobody has been paid yet', () => {
    const start = computeGridStart({
      activeEmployees: [activeWorkerA, activeWorkerB],
      statements: [],
      settings: { first_cycle_start: '2026-10-01' },
    })
    expect(start).toBe('2026-10-01')
  })

  it('ignores voided statements when computing grid start', () => {
    const stmts: Statement[] = [
      { id: 's1', employee: 'empA', payout_run: 'r1', cycle_start: '2026-10-23', payout_date: '2026-10-29', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 5, ot_minutes: 0, note: '', voided: false, created: '2026-10-29' },
      // Newer statement on 2 Nov was voided (undone payout)
      { id: 's2', employee: 'empA', payout_run: 'r2', cycle_start: '2026-10-30', payout_date: '2026-11-02', opening_paise: 0, earned_paise: 0, adjustment_paise: 0, upad_outstanding_paise: 0, upad_recovery_paise: 0, total_due_paise: 0, paid_paise: 0, closing_paise: 0, days_worked: 2, ot_minutes: 0, note: '', voided: true, created: '2026-11-02' },
    ]

    const start = computeGridStart({
      activeEmployees: [activeWorkerA],
      statements: stmts,
    })
    expect(start).toBe('2026-10-30')
  })
})
