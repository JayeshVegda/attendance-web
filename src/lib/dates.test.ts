import { describe, it, expect } from 'vitest'
import {
  parseDate,
  formatDateShort,
  formatDateLong,
  formatDateRange,
  daysBetweenInclusive,
  addDays,
  startOfWeekSaturday,
  isFriday,
  isSaturday,
} from './dates'

describe('dates defensive utilities', () => {
  it('handles null, undefined, empty string gracefully in parseDate', () => {
    expect(isNaN(parseDate(undefined).getTime())).toBe(true)
    expect(isNaN(parseDate(null).getTime())).toBe(true)
    expect(isNaN(parseDate('').getTime())).toBe(true)
    expect(isNaN(parseDate('   ').getTime())).toBe(true)
    expect(isNaN(parseDate('invalid-date').getTime())).toBe(true)
  })

  it('correctly parses valid ISO date strings', () => {
    const d = parseDate('2026-10-31')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9) // 0-indexed October
    expect(d.getDate()).toBe(31)
  })

  it('formatDateShort does not crash on empty, null, or undefined', () => {
    expect(formatDateShort(undefined)).toBe('—')
    expect(formatDateShort(null)).toBe('—')
    expect(formatDateShort('')).toBe('—')
    expect(formatDateShort('2026-10-31')).toBe('31 Oct')
  })

  it('formatDateLong does not crash on empty, null, or undefined', () => {
    expect(formatDateLong(undefined)).toBe('—')
    expect(formatDateLong(null)).toBe('—')
    expect(formatDateLong('')).toBe('—')
    expect(formatDateLong('2026-10-31')).toBe('31 Oct 2026')
  })

  it('formatDateRange handles dates safely', () => {
    expect(formatDateRange('2026-10-01', '2026-10-07')).toBe('1 Oct – 7 Oct 2026')
  })

  it('daysBetweenInclusive returns 0 on missing or invalid dates', () => {
    expect(daysBetweenInclusive('', '')).toBe(0)
    expect(daysBetweenInclusive('2026-10-01', '')).toBe(0)
    expect(daysBetweenInclusive('2026-10-01', '2026-10-07')).toBe(7)
  })

  it('addDays and startOfWeekSaturday safely handle invalid input', () => {
    expect(addDays('', 5)).toBe('')
    expect(addDays('2026-10-01', 1)).toBe('2026-10-02')
    expect(startOfWeekSaturday('')).toBe('')
    expect(isFriday('')).toBe(false)
    expect(isSaturday('')).toBe(false)
  })
})
