import { describe, expect, it } from 'vitest'
import { getUpadBuckets } from './cycle'
import type { SettingsMap } from './types'

describe('getUpadBuckets - 4 Settings Combinations & Dynamic Labels', () => {
  it('Combination 1: Both ON with default labels', () => {
    const settings: SettingsMap = {
      chalu_upad_enabled: 'true',
      moto_upad_enabled: 'true',
    }
    const config = getUpadBuckets(settings)

    expect(config.count).toBe(2)
    expect(config.hasAny).toBe(true)
    expect(config.isBothOn).toBe(true)
    expect(config.isOnlyOneOn).toBe(false)
    expect(config.isBothOff).toBe(false)
    expect(config.enabled).toHaveLength(2)

    expect(config.chaluLabel).toBe('Chalu Upad')
    expect(config.motoLabel).toBe('Main Upad')
    expect(config.chaluBucket?.chipSymbol).toBe('C')
    expect(config.motoBucket?.chipSymbol).toBe('M')

    expect(config.activeBalance(50000, 20000)).toBe(70000)

    const footer = config.formatRemainingFooter(50000, 20000)
    expect(footer).not.toBeNull()
    expect(footer?.totalPaise).toBe(70000)
    expect(footer?.text).toContain('Total Upad Remaining: ₹700')
    expect(footer?.text).toContain('Chalu Upad: ₹500')
    expect(footer?.text).toContain('Main Upad: ₹200')
    expect(footer?.text.toLowerCase()).not.toContain('loan')
  })

  it('Combination 1: Both ON with custom renamable labels', () => {
    const settings: SettingsMap = {
      chalu_upad_enabled: 'true',
      moto_upad_enabled: 'true',
      chalu_upad_label: 'Weekly Kharchi',
      moto_upad_label: 'Long Term Advance',
    }
    const config = getUpadBuckets(settings)

    expect(config.chaluLabel).toBe('Weekly Kharchi')
    expect(config.motoLabel).toBe('Long Term Advance')
    expect(config.chaluBucket?.cutLabel).toBe('Weekly Kharchi cut')
    expect(config.motoBucket?.cutLabel).toBe('Long Term Advance cut')
    expect(config.chaluBucket?.newLabel).toBe('New Weekly Kharchi')
    expect(config.motoBucket?.newLabel).toBe('New Long Term Advance')

    const footer = config.formatRemainingFooter(30000, 15000)
    expect(footer?.text).toContain('Weekly Kharchi: ₹300')
    expect(footer?.text).toContain('Long Term Advance: ₹150')
    expect(footer?.text.toLowerCase()).not.toContain('loan')
  })

  it('Combination 2: Only Chalu ON', () => {
    const settings: SettingsMap = {
      chalu_upad_enabled: 'true',
      moto_upad_enabled: 'false',
    }
    const config = getUpadBuckets(settings)

    expect(config.count).toBe(1)
    expect(config.hasAny).toBe(true)
    expect(config.isBothOn).toBe(false)
    expect(config.isOnlyOneOn).toBe(true)
    expect(config.isBothOff).toBe(false)
    expect(config.enabled).toHaveLength(1)

    expect(config.singleBucket?.id).toBe('chalu')
    expect(config.singleBucket?.chipSymbol).toBe('') // No letter marks when only 1 is on
    expect(config.singleBucket?.newLabel).toBe('New Chalu Upad')

    expect(config.activeBalance(50000, 20000)).toBe(50000)

    const footer = config.formatRemainingFooter(50000, 20000)
    expect(footer).not.toBeNull()
    expect(footer?.totalPaise).toBe(50000)
    expect(footer?.text).toBe('Upad Remaining: ₹500')
    expect(footer?.text.toLowerCase()).not.toContain('loan')
    expect(footer?.text).not.toContain('Main')
  })

  it('Combination 3: Only Main ON', () => {
    const settings: SettingsMap = {
      chalu_upad_enabled: 'false',
      moto_upad_enabled: 'true',
      moto_upad_label: 'Special Advance',
    }
    const config = getUpadBuckets(settings)

    expect(config.count).toBe(1)
    expect(config.hasAny).toBe(true)
    expect(config.isBothOn).toBe(false)
    expect(config.isOnlyOneOn).toBe(true)
    expect(config.isBothOff).toBe(false)
    expect(config.enabled).toHaveLength(1)

    expect(config.singleBucket?.id).toBe('moto')
    expect(config.singleBucket?.label).toBe('Special Advance')
    expect(config.singleBucket?.chipSymbol).toBe('') // No letter marks
    expect(config.singleBucket?.newLabel).toBe('New Special Advance')

    expect(config.activeBalance(50000, 20000)).toBe(20000)

    const footer = config.formatRemainingFooter(50000, 20000)
    expect(footer).not.toBeNull()
    expect(footer?.totalPaise).toBe(20000)
    expect(footer?.text).toBe('Upad Remaining: ₹200')
    expect(footer?.text.toLowerCase()).not.toContain('loan')
    expect(footer?.text).not.toContain('Chalu')
  })

  it('Combination 4: Both OFF', () => {
    const settings: SettingsMap = {
      chalu_upad_enabled: 'false',
      moto_upad_enabled: 'false',
    }
    const config = getUpadBuckets(settings)

    expect(config.count).toBe(0)
    expect(config.hasAny).toBe(false)
    expect(config.isBothOn).toBe(false)
    expect(config.isOnlyOneOn).toBe(false)
    expect(config.isBothOff).toBe(true)
    expect(config.enabled).toHaveLength(0)
    expect(config.singleBucket).toBeUndefined()

    expect(config.activeBalance(50000, 20000)).toBe(0)
    expect(config.formatRemainingFooter(50000, 20000)).toBeNull()
  })

  it('No traces of the word "Loan" anywhere in generated configs across combinations', () => {
    const combinations: SettingsMap[] = [
      { chalu_upad_enabled: 'true', moto_upad_enabled: 'true' },
      { chalu_upad_enabled: 'true', moto_upad_enabled: 'false' },
      { chalu_upad_enabled: 'false', moto_upad_enabled: 'true' },
      { chalu_upad_enabled: 'false', moto_upad_enabled: 'false' },
    ]

    for (const settings of combinations) {
      const config = getUpadBuckets(settings)
      expect(config.sectionTitle.toLowerCase()).not.toContain('loan')
      expect(config.chaluLabel.toLowerCase()).not.toContain('loan')
      expect(config.motoLabel.toLowerCase()).not.toContain('loan')
      for (const bucket of config.enabled) {
        expect(bucket.label.toLowerCase()).not.toContain('loan')
        expect(bucket.cutLabel.toLowerCase()).not.toContain('loan')
        expect(bucket.newLabel.toLowerCase()).not.toContain('loan')
        expect(bucket.balLabel.toLowerCase()).not.toContain('loan')
      }
      const footer = config.formatRemainingFooter(100, 200)
      if (footer) {
        expect(footer.text.toLowerCase()).not.toContain('loan')
      }
    }
  })
})
