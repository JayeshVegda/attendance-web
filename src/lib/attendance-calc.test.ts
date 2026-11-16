import { describe, expect, it } from 'vitest'
import {
  calcDayEarnings,
  calcPayoutSettlement,
  calcToPay,
  calcUpadAfter,
  calcUpadBalance,
  calcWarnings,
  formatMoney,
  paiseToRupees,
  rupeesToPaise,
} from './attendance-calc'
import type { UpadEntry } from './types'

const entry = (kind: UpadEntry['kind'], amount_paise: number, voided = false): UpadEntry => ({
  id: kind,
  employee: 'worker',
  date: '2026-11-01',
  kind,
  amount_paise,
  note: '',
  payout_id: '',
  voided,
})

describe('attendance & payroll calculations (Source of Truth spec)', () => {
  it('Example 1: Ramesh, shortfall gives positive carry and reduces upad by deduct', () => {
    // Earned 2000, upad 4000, Deduct 1000, drawer allows 800
    const calculated = calcToPay(0, 200_000, 0, 100_000, 0)
    expect(calculated).toBe(100_000)

    const settlement = calcPayoutSettlement(calculated, 80_000)
    expect(settlement.paid_paise).toBe(80_000)
    expect(settlement.carry_out_paise).toBe(20_000) // +200 Rs positive carry

    const upadAfter = calcUpadAfter(400_000, 100_000, 0)
    expect(upadAfter).toBe(300_000) // 3000 Rs
  })

  it('Paid above calculated salary creates negative Carry, not Upad', () => {
    // Calculated 1000, typed 1200
    const calculated = 100_000
    const settlement = calcPayoutSettlement(calculated, 120_000)
    expect(settlement.paid_paise).toBe(120_000)
    expect(settlement.carry_out_paise).toBe(-20_000) // negative carry (-200 Rs)
    expect(settlement.excess_upad_paise).toBe(0)
  })

  it('A typed zero above a negative calculated amount sets carryOut to negative calculated', () => {
    const settlement = calcPayoutSettlement(-20_000, 0)
    expect(settlement.paid_paise).toBe(0)
    expect(settlement.carry_out_paise).toBe(-20_000)
    expect(settlement.excess_upad_paise).toBe(0)

    const warning = calcWarnings(0, 0, 0, 0, -20_000, 0)
    expect(warning.overpaid).toBe(true)
    expect(warning.overpaidAmountPaise).toBe(20_000)
  })

  it('Example 3: Suresh with carry in, earnings, upad and new give upad', () => {
    // Carry 300, Earned 3000, upad 7000, Give 500
    const calculated = calcToPay(30_000, 300_000, 0, 0, 50_000)
    expect(calculated).toBe(380_000) // 3800 Rs

    const upadAfter = calcUpadAfter(700_000, 0, 50_000)
    expect(upadAfter).toBe(750_000) // 7500 Rs
  })

  it('Example 4: Adj isolation - salary adjustment does not alter upad', () => {
    // Earned 2500, upad 5000, Adj +300, Deduct 500
    const calculated = calcToPay(0, 250_000, 30_000, 50_000, 0)
    expect(calculated).toBe(230_000) // 2300 Rs

    const upadAfter = calcUpadAfter(500_000, 50_000, 0)
    expect(upadAfter).toBe(450_000) // 4500 Rs
  })

  it('Example 5: 3h custom day on rate 600 and 8h shift', () => {
    // rate 600, shift 8 => hourly 75 => 3h = 225
    const earnings = calcDayEarnings(
      { status: 'hours', worked_minutes: 180, ot_minutes: 0 },
      60_000,
      8,
      1.0,
    )
    expect(earnings.base_paise).toBe(22_500)
    expect(earnings.ot_paise).toBe(0)
    expect(earnings.earned_paise).toBe(22_500)
  })

  it('Example 6: Setting change - rate 800, shift 10, multiplier 1.5, 10h + 2h OT', () => {
    // Hourly 80, OT/h 120. Day = 800 + 240 = 1040
    const earnings = calcDayEarnings(
      { status: 'full', worked_minutes: 0, ot_minutes: 120 },
      80_000,
      10,
      1.5,
    )
    expect(earnings.base_paise).toBe(80_000)
    expect(earnings.ot_paise).toBe(24_000)
    expect(earnings.earned_paise).toBe(104_000)
  })

  it('Example 7: Holiday pays 0 if unrecorded, pays normally if marked present', () => {
    const unrecorded = calcDayEarnings(null, 50_000, 8, 1)
    expect(unrecorded.earned_paise).toBe(0)

    const present = calcDayEarnings({ status: 'full', worked_minutes: 0, ot_minutes: 0 }, 50_000, 8, 1)
    expect(present.earned_paise).toBe(50_000)
  })

  it('Example 8: Absent day blocks and clears overtime to 0', () => {
    const absent = calcDayEarnings(
      { status: 'absent', worked_minutes: 0, ot_minutes: 180 },
      50_000,
      8,
      1.5,
    )
    expect(absent.base_paise).toBe(0)
    expect(absent.ot_paise).toBe(0)
    expect(absent.earned_paise).toBe(0)
  })

  it('Upad ledger balance ignores voided entries', () => {
    const entries = [
      entry('give', 50_000),
      entry('give', 20_000, true), // voided
      entry('deduct', 10_000),
      entry('repay', 5_000),
    ]
    expect(calcUpadBalance(100_000, entries)).toBe(135_000)
  })

  it('Warns on deduct exceeding earnings or upad, and on overpay', () => {
    const warnings1 = calcWarnings(10_000, 0, 50_000, 20_000, -10_000, null)
    expect(warnings1.deductExceedsEarnings).toBe(true)
    expect(warnings1.owesMoney).toBe(true)

    const warnings2 = calcWarnings(50_000, 0, 10_000, 20_000, 30_000, 40_000)
    expect(warnings2.deductExceedsUpad).toBe(true)
    expect(warnings2.overpaid).toBe(true)
    expect(warnings2.overpaidAmountPaise).toBe(10_000)
  })

  it('Converts currency accurately between paise and rupees', () => {
    expect(rupeesToPaise(125.5)).toBe(12550)
    expect(rupeesToPaise('1,250')).toBe(125000)
    expect(paiseToRupees(12550)).toBe(125.5)
    expect(formatMoney(12550)).toBe('₹125.50')
    expect(formatMoney(-20000, { signed: true })).toBe('-₹200')
    expect(formatMoney(20000, { signed: true })).toBe('+₹200')
  })
})
