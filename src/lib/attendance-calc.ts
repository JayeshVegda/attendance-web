import type { Attendance, AttendanceStatus, UpadEntry } from './types'

export type DayAttendance = Pick<Attendance, 'status' | 'worked_minutes' | 'ot_minutes'>

export type DayEarnings = {
  base_paise: number
  ot_paise: number
  earned_paise: number
  day_fraction: number
}

export type PayoutSettlement = {
  paid_paise: number
  /** Signed carry forward into the next cycle: positive = unpaid salary; negative = overpaid. */
  carry_out_paise: number
  next_carry_paise: number
  /** Legacy field, now always 0 since overpayment flows to negative carry. */
  excess_upad_paise: number
}

export type SettlementWarnings = {
  deductExceedsEarnings: boolean
  deductExceedsUpad: boolean
  overpaid: boolean
  overpaidAmountPaise: number
  owesMoney: boolean
  warnings: string[]
}

const round = (value: number) => Math.round(value)

/**
 * 5.1 Day Earnings:
 * Given attendance, rate, shift hours, and OT multiplier:
 * - Full: rate + OT
 * - Half: round(rate / 2) + OT
 * - Hours: round(rate / shiftHours * (worked_minutes / 60)) + OT
 * - Absent: 0 base, 0 OT (OT is blocked and cleared)
 * - Round once per component (base, OT).
 */
export function calcDayEarnings(
  att: DayAttendance | null | undefined,
  dailyRatePaise: number,
  shiftHours: number,
  otMultiplier: number,
): DayEarnings {
  if (!att || shiftHours <= 0) {
    return { base_paise: 0, ot_paise: 0, earned_paise: 0, day_fraction: 0 }
  }

  const rate = Math.max(0, Math.round(dailyRatePaise))
  const shiftMinutes = shiftHours * 60
  let base = 0
  let fraction = 0

  switch (att.status as AttendanceStatus) {
    case 'full':
      base = rate
      fraction = 1
      break
    case 'half':
      base = round(rate / 2)
      fraction = 0.5
      break
    case 'hours': {
      const workedMinutes = Math.max(0, att.worked_minutes ?? 0)
      fraction = workedMinutes / shiftMinutes
      base = round(rate * (workedMinutes / shiftMinutes))
      break
    }
    case 'absent':
    default:
      base = 0
      fraction = 0
      break
  }

  // Absent day blocks all OT
  const otMinutes = att.status === 'absent' ? 0 : Math.max(0, att.ot_minutes ?? 0)
  const otPaise = otMinutes > 0
    ? round((rate / shiftMinutes) * Math.max(0, otMultiplier) * otMinutes)
    : 0

  return {
    base_paise: base,
    ot_paise: otPaise,
    earned_paise: base + otPaise,
    day_fraction: fraction,
  }
}

/**
 * 5.4 Upad Balance:
 * Upad balance = opening_upad + sum(give) - sum(deduct) - sum(repay), ignoring voided entries.
 */
export function calcUpadBalance(openingPaise: number, entries: UpadEntry[]): number {
  return entries.reduce((balance, entry) => {
    if (entry.voided) return balance
    const amount = Math.max(0, Math.round(entry.amount_paise))
    return balance + (entry.kind === 'give' ? amount : -amount)
  }, Math.round(openingPaise))
}

/**
 * Preview Upad after cycle adjustments:
 * Upad after = Upad before - Deduct + Give Upad. (Adj is not an input).
 */
export function calcUpadAfter(beforePaise: number, deductPaise: number, givePaise: number): number {
  return Math.round(beforePaise) - Math.max(0, Math.round(deductPaise)) + Math.max(0, Math.round(givePaise))
}

/**
 * 5.5 To Pay (calculated):
 * To Pay = Carry + Earned + Adj - Deduct + Give Upad. May be negative.
 */
export function calcToPay(
  carryPaise: number,
  earnedPaise: number,
  adjPaise: number,
  deductPaise: number,
  giveUpadPaise: number,
): number {
  return Math.round(carryPaise) + Math.round(earnedPaise) + Math.round(adjPaise)
    - Math.max(0, Math.round(deductPaise)) + Math.max(0, Math.round(giveUpadPaise))
}

/**
 * 5.6 Settlement:
 * - typed = calculated => carry_out = 0
 * - typed < calculated => calculated - typed (positive, unpaid salary owed to worker)
 * - typed > calculated => calculated - typed (negative, overpaid salary deducted next cycle)
 * Overpay does NOT create an Upad entry; it carries forward as negative carry.
 */
export function calcPayoutSettlement(calculatedPaise: number, typedPaise: number): PayoutSettlement {
  const calculated = Math.round(calculatedPaise)
  const paid = Math.max(0, Math.round(typedPaise))
  const carryOut = calculated - paid

  return {
    paid_paise: paid,
    carry_out_paise: carryOut,
    next_carry_paise: carryOut,
    excess_upad_paise: 0,
  }
}

/**
 * 5.8 Warnings (warn only, never block):
 */
export function calcWarnings(
  earnedPaise: number,
  carryPaise: number,
  upadBalancePaise: number,
  deductPaise: number,
  calculatedPaise: number,
  typedPaise: number | null | undefined,
): SettlementWarnings {
  const deduct = Math.max(0, Math.round(deductPaise))
  const deductExceedsEarnings = deduct > (Math.round(earnedPaise) + Math.round(carryPaise))
  const deductExceedsUpad = deduct > Math.round(upadBalancePaise)
  const owesMoney = calculatedPaise < 0

  let overpaid = false
  let overpaidAmountPaise = 0
  if (typedPaise !== null && typedPaise !== undefined) {
    const typed = Math.max(0, Math.round(typedPaise))
    const calculated = Math.round(calculatedPaise)
    if (typed > calculated) {
      overpaid = true
      overpaidAmountPaise = typed - calculated
    }
  }

  const warnings: string[] = []
  if (deductExceedsEarnings) warnings.push('Deduct exceeds earnings')
  if (deductExceedsUpad) warnings.push('Deduct exceeds upad balance')
  if (overpaid) {
    const rupees = (overpaidAmountPaise / 100).toFixed(0)
    warnings.push(`Extra Rs ${rupees} will be added to Upad`)
  }
  if (owesMoney) warnings.push('Worker owes money this cycle')

  return {
    deductExceedsEarnings,
    deductExceedsUpad,
    overpaid,
    overpaidAmountPaise,
    owesMoney,
    warnings,
  }
}

export function parseMoneyInput(value: string | number | null | undefined): number {
  return rupeesToPaise(value)
}

export function paiseToInput(paise: number): string {
  if (paise === 0) return ''
  const value = paise / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

// Money and format helpers
export function rupeesToPaise(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const amount = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/,/g, ''))
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100)
}

export function paiseToRupees(value: number): number {
  return Math.round(value) / 100
}

export function formatMoney(paise: number, options?: { showZero?: boolean; signed?: boolean }): string {
  if (!options?.showZero && paise === 0) return '₹0'
  const isNegative = paise < 0
  const absPaise = Math.abs(paise)
  const value = absPaise / 100
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)

  if (isNegative) {
    return options?.signed ? `-${formatted}` : formatted
  }
  return options?.signed && paise > 0 ? `+${formatted}` : formatted
}

export function formatHours(minutes: number): string {
  if (!minutes) return '0h'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!rest) return `${hours}h`
  return `${hours}h ${rest}m`
}
