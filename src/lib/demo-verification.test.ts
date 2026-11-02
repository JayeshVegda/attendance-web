import { describe, expect, it } from 'vitest'
import { pb } from './pb'
import { loadWorkerContexts, buildPreview } from './payout-service'

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

    const attendance = await pb.collection('attendance').getFullList({ sort: 'date' })
    const upads = await pb.collection('upad_entries').getFullList({ sort: 'date' })
    const preview = buildPreview(contexts, '2026-11-02', {}, attendance)
    expect(preview).toHaveLength(14)

    const byName = new Map(preview.map((p) => [p.context.employee.name, p]))

    // 1. Ramesh Patel: Settle tool ready (Chalu ₹1,000), gross due ₹1,062.50
    const ramesh = byName.get('Ramesh Patel')
    expect(ramesh).toBeDefined()
    expect(ramesh?.computation?.chalu_balance_paise).toBe(100000)
    expect(ramesh?.computation?.total_due_paise).toBe(106250)

    // 2. Suresh Desai: Settle tool ready (Chalu ₹500, Main ₹7,000), gross due ₹900
    const suresh = byName.get('Suresh Desai')
    expect(suresh).toBeDefined()
    expect(suresh?.computation?.chalu_balance_paise).toBe(50000)
    expect(suresh?.computation?.moto_balance_paise).toBe(700000)
    expect(suresh?.computation?.total_due_paise).toBe(90000)

    // 3. Mahesh Joshi: Partial payment carry ₹1,350 from Week 4, gross due ₹2,175
    const mahesh = byName.get('Mahesh Joshi')
    expect(mahesh).toBeDefined()
    expect(mahesh?.computation?.carry_paise).toBe(135000)
    expect(mahesh?.computation?.total_due_paise).toBe(217500)

    // 4. Kiran Shah: Mid-cycle rate revision to ₹480/day, gross due ₹960
    const kiran = byName.get('Kiran Shah')
    expect(kiran).toBeDefined()
    expect(kiran?.context.employee.daily_rate_paise).toBe(48000)
    expect(kiran?.computation?.total_due_paise).toBe(96000)

    // 5. Prakash Solanki: Inactive, unpaid salary carry ₹1,500, open upad ₹600, 0 open attendance
    const prakash = byName.get('Prakash Solanki')
    expect(prakash).toBeDefined()
    expect(prakash?.context.employee.active).toBe(false)
    expect(prakash?.computation?.carry_paise).toBe(150000)
    expect(prakash?.computation?.total_due_paise).toBe(150000)
    expect(prakash?.computation?.chalu_balance_paise).toBe(60000)

    // 6. Rekhaben Patel: Rejoined worker, Period 1 upad ₹600 open, gross due ₹800
    const rekha = byName.get('Rekhaben Patel')
    expect(rekha).toBeDefined()
    expect(rekha?.computation?.chalu_balance_paise).toBe(60000)
    expect(rekha?.computation?.total_due_paise).toBe(80000)

    // 7. Alpesh Chauhan: Hours-based days (31 Oct 5h+1h OT, 2 Nov 3h), gross due ₹540
    const alpesh = byName.get('Alpesh Chauhan')
    expect(alpesh).toBeDefined()
    expect(alpesh?.computation?.total_due_paise).toBe(54000)

    // 8. Dinesh Rawal: Off-schedule payout worker, gross due ₹1,312.50
    const dinesh = byName.get('Dinesh Rawal')
    expect(dinesh).toBeDefined()
    expect(dinesh?.computation?.total_due_paise).toBe(131250)

    // 9. Bharat Prajapati: Mid-week cash returned, Chalu balance ₹0, gross due ₹780
    const bharat = byName.get('Bharat Prajapati')
    expect(bharat).toBeDefined()
    expect(bharat?.computation?.chalu_balance_paise).toBe(0)
    expect(bharat?.computation?.total_due_paise).toBe(78000)

    // 10. Vijay Mehta: Upad cut larger than due (Main ₹6,000 balance vs gross due ₹700)
    const vijay = byName.get('Vijay Mehta')
    expect(vijay).toBeDefined()
    expect(vijay?.computation?.moto_balance_paise).toBe(600000)
    expect(vijay?.computation?.total_due_paise).toBe(70000)

    // 11. Nilesh Trivedi: Late attendance entry 21 Oct carried forward, gross due ₹1,560 (3 days)
    const nilesh = byName.get('Nilesh Trivedi')
    expect(nilesh).toBeDefined()
    expect(nilesh?.computation?.total_due_paise).toBe(156000)

    // 12. Kunal Bhatt: Unmarked days in open cycle (no activity, excluded from payout computation)
    const kunal = byName.get('Kunal Bhatt')
    expect(kunal).toBeDefined()
    expect(kunal?.included).toBe(false)
    expect(kunal?.computation).toBeNull()

    // 13. Hasmukh Vora: Main upad ₹7,000 after write-off of ₹3,000, gross due ₹1,300
    const hasmukh = byName.get('Hasmukh Vora')
    expect(hasmukh).toBeDefined()
    expect(hasmukh?.computation?.moto_balance_paise).toBe(700000)
    expect(hasmukh?.computation?.total_due_paise).toBe(130000)

    // 14. Gopal Parmar: Clean benchmark worker (0 upad, 0 carry, gross due ₹1,000)
    const gopal = byName.get('Gopal Parmar')
    expect(gopal).toBeDefined()
    expect(gopal?.computation?.chalu_balance_paise).toBe(0)
    expect(gopal?.computation?.moto_balance_paise).toBe(0)
    expect(gopal?.computation?.carry_paise).toBe(0)
    expect(gopal?.computation?.total_due_paise).toBe(100000)

    // Chronological upad balance non-negativity across all history
    const empIds = new Set(upads.map((u) => u.employee))
    for (const empId of empIds) {
      const empUpads = upads
        .filter((u) => u.employee === empId && !u.voided)
        .sort((a, b) => a.date.localeCompare(b.date))
      let chalu = 0
      let moto = 0
      for (const u of empUpads) {
        const delta = u.kind === 'given' ? u.amount_paise : -u.amount_paise
        if (u.bucket === 'moto' || u.category === 'moto') moto += delta
        else chalu += delta
        expect(chalu).toBeGreaterThanOrEqual(0)
        expect(moto).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
