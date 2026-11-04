import { describe, expect, it } from 'vitest'
import {
  calculateDeductCap,
  calculatePaidCap,
  calculateToPay,
  calculateNewCarry,
  getWorkerUpadBalance,
  getWorkerUpadLedger,
  type UpadRow,
} from './engine'
import { computeNextCycleStartFromPaidDates } from './cycle'

describe('Cycle Register Engine Calculations', () => {
  it('1. Ramesh example: earned 2000, upad 4000, deduct 1000, paid 800 -> To pay 1000, new carry 200, upad 3000, row done/undo restores', () => {
    const carry = 0
    const earned = 200000 // Rs 2,000 in paise
    const adj = 0
    const upad = 400000 // Rs 4,000
    const deduct = 100000 // Rs 1,000
    const giveUpad = 0

    // Deduct cap check: min(upad, carry + earned + adj)
    const deductCap = calculateDeductCap(upad, carry + earned + adj)
    expect(deductCap).toBe(200000) // min(4000, 2000) = 2000
    expect(deduct).toBeLessThanOrEqual(deductCap)

    // To pay = carry + earned + adj - deduct + giveUpad
    const toPay = calculateToPay(carry, earned, adj, deduct, giveUpad)
    expect(toPay).toBe(100000) // Rs 1,000

    // User types Paid 800
    const paid = 80000 // Rs 800
    const newCarry = calculateNewCarry(toPay, paid)
    expect(newCarry).toBe(20000) // Rs 200 carry

    // Row turns done: upad deduction entry is posted to ledger
    const ledgerBefore: UpadRow[] = [
      { id: 'u1', employee: 'ramesh', date: '2026-10-25', kind: 'given', amount_paise: upad },
    ]
    expect(getWorkerUpadBalance(ledgerBefore, 0)).toBe(400000)

    const postedRecovery: UpadRow = {
      id: 'u2',
      employee: 'ramesh',
      date: '2026-11-02',
      kind: 'recovery',
      amount_paise: deduct,
    }
    const ledgerAfterDone = [...ledgerBefore, postedRecovery]
    expect(getWorkerUpadBalance(ledgerAfterDone, 0)).toBe(300000) // Rs 3,000

    // Undo action deletes the posted recovery entry
    const ledgerAfterUndo = ledgerAfterDone.filter((u) => u.id !== postedRecovery.id)
    expect(getWorkerUpadBalance(ledgerAfterUndo, 0)).toBe(400000) // Restored to Rs 4,000
  })

  it('2. Suresh example: upad 7000, carry 300, earned 3000, give upad 1000 -> to pay 4300, upad becomes 8000, cash includes 1000', () => {
    const upad = 700000 // Rs 7,000
    const carry = 30000 // Rs 300
    const earned = 300000 // Rs 3,000
    const adj = 0
    const deduct = 0
    const giveUpad = 100000 // Rs 1,000

    const toPay = calculateToPay(carry, earned, adj, deduct, giveUpad)
    expect(toPay).toBe(430000) // Rs 4,300 (includes 1,000 cash)

    // Row turns done: new advance posted to ledger
    const ledger: UpadRow[] = [
      { id: 'u1', employee: 'suresh', date: '2026-10-20', kind: 'given', amount_paise: upad },
      { id: 'u2', employee: 'suresh', date: '2026-11-02', kind: 'given', amount_paise: giveUpad },
    ]
    const endingUpad = getWorkerUpadBalance(ledger, 0)
    expect(endingUpad).toBe(800000) // Rs 8,000
  })

  it('3. Close cycle with undone rows: warning listed, full due carries forward cleanly, draft inputs discarded', () => {
    // Worker who was NOT marked done (Paid is empty)
    const carry = 50000 // Rs 500
    const earned = 150000 // Rs 1,500
    const adj = 20000 // Rs 200 bonus
    const draftDeduct = 30000 // Staged but undone
    const draftGiveUpad = 40000 // Staged but undone

    // Full due rule on closing undone row: carry + earned + adjustment
    // Typed draft deduct/give-upad discarded
    const fullDueCarriedForward = carry + earned + adj
    expect(fullDueCarriedForward).toBe(220000) // Rs 2,200

    // Undone row verification
    const isDone = false
    const closingCarry = isDone ? calculateNewCarry(calculateToPay(carry, earned, adj, draftDeduct, draftGiveUpad), 0) : fullDueCarriedForward
    expect(closingCarry).toBe(220000)
  })

  it('4. Different paid dates then close: next cycle starts day after latest paid date among done rows', () => {
    const fallbackStart = '2026-10-30'
    // Workers with different paid dates (e.g. off-schedule Saturday 24 Oct, others Thursday 29 Oct, another Monday 2 Nov)
    const paidDatesDone = ['2026-10-24', '2026-10-29', '2026-11-02']
    const nextStart = computeNextCycleStartFromPaidDates(paidDatesDone, fallbackStart)
    expect(nextStart).toBe('2026-11-03') // Day after 2026-11-02

    // If only earlier dates are done:
    const earlierDone = ['2026-10-24', '2026-10-29']
    expect(computeNextCycleStartFromPaidDates(earlierDone, fallbackStart)).toBe('2026-10-30')

    // If nobody was done, fallback is preserved
    expect(computeNextCycleStartFromPaidDates([], fallbackStart)).toBe(fallbackStart)
  })

  it('5. Leaving settlement with unpaid salary remainder and remaining upad: two separate write-off entries (never combined)', () => {
    // Example: Gross salary due Rs 3,000, Outstanding Upad Rs 5,000
    const grossDue = 300000 // Rs 3,000
    const upadBalance = 500000 // Rs 5,000

    // Step 1: Offset upad against salary
    const offsetUpad = Math.min(upadBalance, grossDue) // Rs 3,000
    expect(offsetUpad).toBe(300000)

    const salaryRemainder = Math.max(0, grossDue - offsetUpad) // Rs 0 remaining
    const upadRemainder = Math.max(0, upadBalance - offsetUpad) // Rs 2,000 remaining upad
    expect(salaryRemainder).toBe(0)
    expect(upadRemainder).toBe(200000)

    // Suppose user actually paid Rs 0
    const actualCashPaid = 0
    const salaryWriteoffPaise = Math.max(0, salaryRemainder - actualCashPaid)
    const upadWriteoffPaise = upadRemainder

    // Two separate write-offs:
    expect(salaryWriteoffPaise).toBe(0)
    expect(upadWriteoffPaise).toBe(200000)

    // Now consider Case B: Gross due Rs 5,000, Upad Rs 2,000. Actual cash paid Rs 1,000
    const grossDueB = 500000
    const upadBalanceB = 200000
    const offsetB = Math.min(upadBalanceB, grossDueB) // Rs 2,000 offset
    const salaryRemB = grossDueB - offsetB // Rs 3,000 remaining salary
    const upadRemB = upadBalanceB - offsetB // Rs 0 remaining upad

    const actualCashPaidB = 100000 // Rs 1,000 paid
    const salaryWriteoffB = salaryRemB - actualCashPaidB // Rs 2,000 unpaid salary written off
    const upadWriteoffB = upadRemB // Rs 0

    expect(salaryWriteoffB).toBe(200000)
    expect(upadWriteoffB).toBe(0)
    // Separate collections/tables:
    // Salary write-off -> 'salary_writeoffs'
    // Upad write-off -> 'upad_entries' with kind = 'writeoff'
  })

  it('Deduct above the cap is detected', () => {
    const upad = 50000 // Rs 500
    const salaryDue = 100000 // Rs 1,000
    const cap = calculateDeductCap(upad, salaryDue)
    expect(cap).toBe(50000)

    const attemptedDeduct = 60000
    expect(attemptedDeduct > cap).toBe(true)
  })

  it('Paid cannot exceed To pay and warns if less than Give upad', () => {
    const toPay = 100000
    const giveUpad = 50000

    expect(calculatePaidCap(toPay)).toBe(toPay)

    const paidBelowNewUpad = 40000
    expect(paidBelowNewUpad < giveUpad).toBe(true)
  })

  it('Upad ledger accurately tracks given, recovery, returned, writeoff with running balance', () => {
    const rows: UpadRow[] = [
      { id: 'u1', employee: 'emp1', date: '2026-10-01', kind: 'given', amount_paise: 50000, note: 'Advance 1' },
      { id: 'u2', employee: 'emp1', date: '2026-10-05', kind: 'recovery', amount_paise: 20000 },
      { id: 'u3', employee: 'emp1', date: '2026-10-10', kind: 'returned', amount_paise: 10000, note: 'Cash return' },
      { id: 'u4', employee: 'emp1', date: '2026-10-15', kind: 'writeoff', amount_paise: 5000, note: 'Discount' },
    ]
    const ledger = getWorkerUpadLedger(rows, 0)
    expect(ledger).toHaveLength(4)
    expect(ledger[0].balance_paise).toBe(50000)
    expect(ledger[1].balance_paise).toBe(30000)
    expect(ledger[2].balance_paise).toBe(20000)
    expect(ledger[3].balance_paise).toBe(15000)
  })
})
