import { describe, expect, it } from 'vitest'
import { getUpadBuckets } from './cycle'
import type { SettingsMap } from './types'

describe('getUpadBuckets - Single Upad Architecture', () => {
  it('Returns a single Upad bucket configuration', () => {
    const settings: SettingsMap = {}
    const config = getUpadBuckets(settings)

    expect(config.count).toBe(1)
    expect(config.hasAny).toBe(true)
    expect(config.isBothOn).toBe(false)
    expect(config.isOnlyOneOn).toBe(true)
    expect(config.isBothOff).toBe(false)
    expect(config.enabled).toHaveLength(1)

    expect(config.singleBucket?.label).toBe('Upad')
    expect(config.singleBucket?.cutLabel).toBe('Deduct Upad')
    expect(config.singleBucket?.newLabel).toBe('Give Upad')
    expect(config.activeBalance(50000, 20000)).toBe(70000)

    const footer = config.formatRemainingFooter(50000, 20000)
    expect(footer).not.toBeNull()
    expect(footer?.totalPaise).toBe(70000)
    expect(footer?.text).toContain('Total Upad Remaining: ₹700')
    expect(footer?.text.toLowerCase()).not.toContain('loan')
  })

  it('No traces of the word "Loan" anywhere in generated configs across any settings', () => {
    const combinations: SettingsMap[] = [
      {},
      { upad_label: 'Advance' },
      { some_other_key: 'value' },
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
