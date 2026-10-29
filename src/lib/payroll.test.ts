import { describe, expect, it } from 'vitest'
import { computeCycleRows, dayPayPaise } from './payroll'
import type { Attendance, Employee, RateHistory, Statement, UpadEntry } from './types'

const employee: Employee = {
  id: 'emp1',
  employee_no: '1',
  name: 'Test',
  phone: '',
  active: true,
  daily_rate_paise: 90000,
  opening_salary_paise: 0,
  opening_upad_paise: 0,
  joined_on: '2026-10-01',
  notes: '',
  sort_order: 1,
  created: '',
  updated: '',
}

function attendance(date: string, status: 'full' | 'half' | 'absent', ot = 0): Attendance {
  return {
    id: `att-${date}`,
    employee: employee.id,
    date,
    status,
    ot_minutes: ot,
    note: '',
    created: '',
    updated: '',
  }
}

function base(overrides: Partial<Parameters<typeof computeCycleRows>[0]> = {}) {
  return {
    employees: [employee],
    rates: [] as RateHistory[],
    attendance: [] as Attendance[],
    adjustments: [],
    upadEntries: [] as UpadEntry[],
    statements: [] as Statement[],
    cycleStart: '2026-10-03',
    payoutDate: '2026-10-09',
    ...overrides,
  }
}

describe('payroll engine', () => {
  it('applies a rate change day by day', () => {
    const rates: RateHistory[] = [
      {
        id: 'r1',
        employee: employee.id,
        effective_from: '2026-10-03',
        daily_rate_paise: 90000,
        note: '',
        created: '',
      },
      {
        id: 'r2',
        employee: employee.id,
        effective_from: '2026-10-06',
        daily_rate_paise: 100000,
        note: '',
        created: '',
      },
    ]

    const rows = computeCycleRows(
      base({
        rates,
        attendance: [
          attendance('2026-10-03', 'full'),
          attendance('2026-10-04', 'full'),
          attendance('2026-10-05', 'full'),
          attendance('2026-10-06', 'full'),
          attendance('2026-10-07', 'full'),
          attendance('2026-10-08', 'full'),
        ],
      }),
    )

    expect(rows[0].earnedPaise).toBe(570000)
    expect(rows[0].daysWorked).toBe(6)
  })

  it('adds overtime based on the day rate and divisor', () => {
    expect(dayPayPaise('full', 240, 40000, 8)).toBe(60000)
    expect(dayPayPaise('half', 60, 40000, 8)).toBe(25000)
    expect(dayPayPaise('absent', 240, 40000, 8)).toBe(20000)
    expect(dayPayPaise('', 240, 40000, 8)).toBe(0)
  })

  it('carries a partial payment into the next cycle', () => {
    const prior: Statement = {
      id: 's1',
      payout_run: 'run1',
      employee: employee.id,
      cycle_start: '2026-09-25',
      payout_date: '2026-10-02',
      opening_paise: 0,
      earned_paise: 100000,
      adjustment_paise: 0,
      upad_outstanding_paise: 0,
      upad_recovery_paise: 0,
      total_due_paise: 100000,
      paid_paise: 40000,
      closing_paise: 60000,
      days_worked: 2,
      ot_minutes: 0,
      note: '',
      created: '2026-10-02 10:00:00.000Z',
    }

    const rows = computeCycleRows(
      base({
        statements: [prior],
        cycleStart: '2026-10-03',
        payoutDate: '2026-10-09',
        attendance: [attendance('2026-10-03', 'full')],
      }),
    )

    expect(rows[0].openingPaise).toBe(60000)
    expect(rows[0].earnedPaise).toBe(90000)
    expect(rows[0].totalDuePaise).toBe(150000)
  })

  it('caps upad recovery at the outstanding balance', () => {
    const upad: UpadEntry = {
      id: 'u1',
      employee: employee.id,
      date: '2026-10-04',
      kind: 'given',
      category: 'regular',
      amount_paise: 50000,
      note: '',
      statement: '',
      created: '',
    }
    const rows = computeCycleRows(
      base({
        upadEntries: [upad],
        attendance: [attendance('2026-10-03', 'full')],
        inputs: new Map([
          [employee.id, { recoveryPaise: 999999, paidPaise: -1 }],
        ]),
      }),
    )

    expect(rows[0].upadOutstandingPaise).toBe(50000)
    expect(rows[0].upadRecoveryPaise).toBe(50000)
    expect(rows[0].totalDuePaise).toBe(40000)
    expect(rows[0].paidPaise).toBe(0)
  })

  it('includes a Friday only when it is marked', () => {
    const rows = computeCycleRows(
      base({
        attendance: [attendance('2026-10-09', 'full')],
      }),
    )

    expect(rows[0].earnedPaise).toBe(90000)
    expect(rows[0].attendanceCount).toBe(1)
  })
})
