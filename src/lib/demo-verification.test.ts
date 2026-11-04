import { describe, expect, it } from 'vitest'
import { pb } from './pb'
import { loadWorkerContexts, buildPreview } from './payout-service'
import type { Attendance, UpadEntry } from './types'

describe('Demo Database Re-Seed Verification', () => {
  it('verifies all 14 workers and edge cases on live pocketbase without mutating data', async ({ skip }) => {
    let hasBackend = false
    try {
      const res = await fetch('http://127.0.0.1:8091/api/health')
      hasBackend = res.ok
    } catch {
      hasBackend = false
    }
    if (!hasBackend) skip()

    const contexts = await loadWorkerContexts()
    expect(contexts).toHaveLength(14)

    const attendance = await pb.collection('attendance').getFullList<Attendance>({ sort: 'date' })
    const upads = await pb.collection('upad_entries').getFullList<UpadEntry>({ sort: 'date' })
    const preview = buildPreview(contexts, '2026-11-02', {}, attendance)
    expect(preview).toHaveLength(14)

    const byName = new Map(preview.map((p) => [p.context.employee.name, p]))

    // 1. Ramesh Patel: Settle tool tested (Chalu return logged), gross due
    const ramesh = byName.get('Ramesh Patel')
    expect(ramesh).toBeDefined()
    expect(ramesh?.computation?.chalu_balance_paise).toBeGreaterThanOrEqual(0)
    expect(ramesh?.computation?.total_due_paise).toBeGreaterThan(0)

    // 2. Suresh Desai: Settle tool ready (Merged Upad ₹7,000), gross due ₹1,350
    const suresh = byName.get('Suresh Desai')
    expect(suresh).toBeDefined()
    expect(suresh?.computation?.chalu_balance_paise).toBe(700000)
    expect(suresh?.computation?.total_due_paise).toBe(135000)

    // 3. Mahesh Joshi: Partial payment carry ₹1,350 from Week 4, gross due ₹2,725
    const mahesh = byName.get('Mahesh Joshi')
    expect(mahesh).toBeDefined()
    expect(mahesh?.computation?.carry_paise).toBe(135000)
    expect(mahesh?.computation?.total_due_paise).toBe(272500)

    // 4. Kiran Shah: Mid-cycle rate revision to ₹480/day, gross due ₹1,440
    const kiran = byName.get('Kiran Shah')
    expect(kiran).toBeDefined()
    expect(kiran?.context.employee.daily_rate_paise).toBe(48000)
    expect(kiran?.computation?.total_due_paise).toBe(144000)

    // 5. Prakash Solanki: Inactive, unpaid salary carry ₹1,500, upad returned, 0 open attendance
    const prakash = byName.get('Prakash Solanki')
    expect(prakash).toBeDefined()
    expect(prakash?.context.employee.active).toBe(false)
    expect(prakash?.computation?.carry_paise).toBe(150000)
    expect(prakash?.computation?.total_due_paise).toBe(150000)
    expect(prakash?.computation?.chalu_balance_paise).toBeGreaterThanOrEqual(0)

    // 6. Rekhaben Patel: Rejoined worker, Period 1 upad settled, gross due ₹1,200
    const rekha = byName.get('Rekhaben Patel')
    expect(rekha).toBeDefined()
    expect(rekha?.computation?.chalu_balance_paise).toBeGreaterThanOrEqual(0)
    expect(rekha?.computation?.total_due_paise).toBe(120000)

    // 7. Alpesh Chauhan: Hours-based days, gross due ₹1,020
    const alpesh = byName.get('Alpesh Chauhan')
    expect(alpesh).toBeDefined()
    expect(alpesh?.computation?.total_due_paise).toBe(102000)

    // 8. Dinesh Rawal: Off-schedule payout worker, gross due ₹1,912.50
    const dinesh = byName.get('Dinesh Rawal')
    expect(dinesh).toBeDefined()
    expect(dinesh?.computation?.total_due_paise).toBe(191250)

    // 9. Bharat Prajapati: Mid-week cash returned, Chalu balance ₹0, gross due ₹1,260
    const bharat = byName.get('Bharat Prajapati')
    expect(bharat).toBeDefined()
    expect(bharat?.computation?.chalu_balance_paise).toBe(0)
    expect(bharat?.computation?.total_due_paise).toBe(126000)

    // 10. Vijay Mehta: Upad cut larger than due (Single Upad ₹6,000 balance vs gross due ₹1,050)
    const vijay = byName.get('Vijay Mehta')
    expect(vijay).toBeDefined()
    expect(vijay?.computation?.chalu_balance_paise).toBe(600000)
    expect(vijay?.computation?.total_due_paise).toBe(105000)

    // 11. Nilesh Trivedi: Late attendance entry 21 Oct carried forward, gross due ₹2,080 (4 days)
    const nilesh = byName.get('Nilesh Trivedi')
    expect(nilesh).toBeDefined()
    expect(nilesh?.computation?.total_due_paise).toBe(208000)

    // 12. Kunal Bhatt: Unmarked days in open cycle (activity present, included)
    const kunal = byName.get('Kunal Bhatt')
    expect(kunal).toBeDefined()
    expect(kunal?.included).toBe(true)
    expect(kunal?.computation?.total_due_paise).toBe(46000)

    // 13. Hasmukh Vora: Single upad ₹7,000 after write-off of ₹3,000, gross due ₹1,950
    const hasmukh = byName.get('Hasmukh Vora')
    expect(hasmukh).toBeDefined()
    expect(hasmukh?.computation?.chalu_balance_paise).toBe(700000)
    expect(hasmukh?.computation?.total_due_paise).toBe(195000)

    // 14. Gopal Parmar: Clean benchmark worker (0 upad, 0 carry, gross due ₹1,500)
    const gopal = byName.get('Gopal Parmar')
    expect(gopal).toBeDefined()
    expect(gopal?.computation?.chalu_balance_paise).toBe(0)
    expect(gopal?.computation?.carry_paise).toBe(0)
    expect(gopal?.computation?.total_due_paise).toBe(150000)

    // Chronological upad balance non-negativity across all history
    const empIds = new Set(upads.map((u) => u.employee))
    for (const empId of empIds) {
      const empUpads = upads
        .filter((u) => u.employee === empId && !u.voided)
        .sort((a, b) => a.date.localeCompare(b.date))
      let balance = 0
      for (const u of empUpads) {
        const delta = u.kind === 'given' ? u.amount_paise : -u.amount_paise
        balance += delta
        expect(balance).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
