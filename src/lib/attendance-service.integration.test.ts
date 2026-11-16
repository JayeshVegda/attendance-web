import { afterEach, describe, expect, it } from 'vitest'
import { addDays, dateKey, todayKey } from './dates'
import {
  addUpadEntry,
  loadAppData,
  saveAttendance,
  saveDraft,
  savePayoutBatch,
  unlockPayout,
} from './attendance-service'
import { calcDayEarnings, calcToPay } from './attendance-calc'
import { COLLECTIONS, pb } from './pb'
import type { CycleDraft } from './types'

const enabled = Boolean(
  (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.PB_TEST_URL,
)
const activeRunIds: string[] = []

afterEach(async () => {
  if (!enabled || !activeRunIds.length) return
  while (activeRunIds.length) {
    const id = activeRunIds.pop()!
    const run = await pb.collection(COLLECTIONS.runs).getOne(id).catch(() => null)
    if (run && !run.voided) {
      await unlockPayout(id, 'Integration test cleanup', 'Test runner').catch(() => {})
    }
  }
})

describe('local payout batch integration', () => {
  it.skipIf(!enabled)('rejects future attendance outside the current worker cycle window', async () => {
    const worker = (await loadAppData()).employees.find((item) => item.status === 'active')!
    await expect(saveAttendance({
      employee: worker.id,
      date: addDays(todayKey(), 1),
      status: 'full',
      worked_minutes: 0,
      ot_minutes: 0,
      notes: '',
    })).rejects.toThrow('Cannot mark attendance for a future date.')
  })

  it.skipIf(!enabled)('pays only the done worker and restores their window on audited unlock', async () => {
    const before = await loadAppData()
    const worker = before.employees.find((item) => item.name === 'Ramesh Patel') ?? before.employees[0]
    const untouched = before.employees.find((item) => item.id !== worker.id)!
    const untouchedBoundary = untouched.paid_up_to
    const untouchedDays = before.attendance
      .filter((item) => item.employee === untouched.id && !item.settled_payout)
      .map((item) => item.id)
      .sort()

    expect(worker).toBeDefined()
    const priorPaidUpTo = worker.paid_up_to
    const draftValues = {
      adj_paise: 5_000,
      adj_note: 'Integration test salary adjustment',
      deduct_paise: 10_000,
      give_upad_paise: 10_000,
      typed_paise: 120_000,
      is_done: true,
    }
    await saveDraft(worker.id, draftValues)
    const saved = (await loadAppData()).drafts.find((item) => item.employee === worker.id) as CycleDraft
    const result = await savePayoutBatch([saved], todayKey())
    activeRunIds.push(result.runId)

    const paid = await loadAppData()
    expect(paid.runs.some((run) => run.id === result.runId)).toBe(true)
    expect(paid.statements.filter((statement) => statement.payout_run === result.runId)).toHaveLength(1)
    expect(paid.payments.filter((payment) => payment.payout_run === result.runId)).toHaveLength(1)
    expect(paid.employees.find((item) => item.id === worker.id)?.paid_up_to.slice(0, 10)).toBe(todayKey())
    expect(paid.employees.find((item) => item.id === untouched.id)?.paid_up_to).toBe(untouchedBoundary)
    expect(
      paid.attendance.filter((item) => item.employee === untouched.id && !item.settled_payout).map((item) => item.id).sort(),
    ).toEqual(untouchedDays)
    expect(paid.drafts.find((item) => item.employee === worker.id)).toMatchObject({
      adj_paise: 0,
      adj_note: '',
      deduct_paise: 0,
      give_upad_paise: 0,
      typed_paise: 0,
      is_done: false,
    })

    // Verify locked attendance cannot be edited
    await expect(
      saveAttendance({
        employee: worker.id,
        date: todayKey(),
        status: 'full',
        worked_minutes: 0,
        ot_minutes: 0,
        notes: '',
      }),
    ).rejects.toThrow('Cannot edit locked attendance for a closed cycle. Unlock the payout first.')

    await unlockPayout(result.runId, 'Verify restore and audit', 'Integration test')
    activeRunIds.pop()

    const reopened = await loadAppData()
    const rawRun = await pb.collection(COLLECTIONS.runs).getOne(result.runId)
    const audit = await pb.collection(COLLECTIONS.audits).getFirstListItem(
      `payout_run = "${result.runId}" && action = "unlock"`,
    )
    expect(rawRun.voided).toBe(true)
    expect(dateKey(rawRun.run_date)).toBe(todayKey())
    expect(audit.reason).toBe('Verify restore and audit')
    expect(audit.snapshot).toBeTruthy()
    expect(reopened.runs.some((run) => run.id === result.runId)).toBe(false)
    const reopenedBoundary = reopened.employees.find((item) => item.id === worker.id)?.paid_up_to || ''
    expect(reopenedBoundary ? reopenedBoundary.slice(0, 10) : '').toBe(priorPaidUpTo ? priorPaidUpTo.slice(0, 10) : '')
    expect(
      reopened.attendance.filter((item) => item.employee === worker.id && item.settled_payout === result.runId),
    ).toHaveLength(0)
    const restoredDraft = reopened.drafts.find((item) => item.employee === worker.id)
    expect(restoredDraft).toMatchObject(draftValues)
  })

  it.skipIf(!enabled)('Excess payout is written as Upad and does not become negative salary carry', async () => {
    const data = await loadAppData()
    const worker = data.employees.find((item) => item.name === 'Suresh Desai') ?? data.employees[1]
    const start = worker.paid_up_to ? addDays(dateKey(worker.paid_up_to), 1) : dateKey(worker.joined_on)
    const earned = data.attendance
      .filter((item) => item.employee === worker.id && !item.settled_payout && dateKey(item.date) >= start && dateKey(item.date) <= todayKey())
      .reduce((sum, item) => sum + calcDayEarnings(item, worker.daily_rate_paise, data.settings.shift_hours, data.settings.ot_multiplier).earned_paise, 0)
    const priorStatement = data.statements
      .filter((item) => item.employee === worker.id)
      .sort((a, b) => dateKey(b.end_date).localeCompare(dateKey(a.end_date)))[0]
    const calculated = calcToPay(priorStatement?.closing_paise ?? worker.opening_carry_paise, earned, 0, 0, 0)
    const typed = Math.max(0, calculated) + 50_000

    const draftValues = {
      adj_paise: 0,
      adj_note: '',
      deduct_paise: 0,
      give_upad_paise: 0,
      typed_paise: typed,
      is_done: true,
    }
    await saveDraft(worker.id, draftValues)
    const saved = (await loadAppData()).drafts.find((item) => item.employee === worker.id) as CycleDraft

    const initialUpadCount = (await pb.collection(COLLECTIONS.upad).getFullList({
      filter: `employee = "${worker.id}" && voided = false`,
    })).length

    const result = await savePayoutBatch([saved], todayKey())
    activeRunIds.push(result.runId)

    const paidData = await loadAppData()
    const statement = paidData.statements.find((s) => s.payout_run === result.runId && s.employee === worker.id)
    expect(statement).toBeDefined()
    expect(statement!.closing_paise).toBe(0)
    expect(statement!.paid_paise).toBe(typed)
    expect(statement!.upad_give_paise).toBe(50_000)

    const excessEntries = await pb.collection(COLLECTIONS.upad).getFullList({
      filter: `employee = "${worker.id}" && voided = false`,
    })
    expect(excessEntries).toHaveLength(initialUpadCount + 1)
    expect(excessEntries.find((entry) => entry.payout_id === result.runId)).toMatchObject({
      kind: 'give',
      amount_paise: 50_000,
      note: 'Excess payout advance',
    })

    await unlockPayout(result.runId, 'Cleanup overpay test', 'Test runner')
    activeRunIds.pop()
  })

  it.skipIf(!enabled)('rolls back a partially processed batch when a later worker draft is missing', async () => {
    const data = await loadAppData()
    const [firstWorker, worker] = data.employees.filter((item) => item.status === 'active')
    const firstOriginalDraft = data.drafts.find((draft) => draft.employee === firstWorker.id)!
    const originalDraft = data.drafts.find((draft) => draft.employee === worker.id)!
    const firstDraftValues = {
      adj_paise: 0,
      adj_note: '',
      deduct_paise: 0,
      give_upad_paise: 0,
      typed_paise: 0,
      is_done: true,
    }
    await saveDraft(firstWorker.id, firstDraftValues)
    const savedFirstDraft = (await loadAppData()).drafts.find((draft) => draft.employee === firstWorker.id)!
    await pb.collection(COLLECTIONS.drafts).delete(originalDraft.id)
    const before = await Promise.all([
      pb.collection(COLLECTIONS.runs).getFullList(),
      pb.collection(COLLECTIONS.statements).getFullList(),
      pb.collection(COLLECTIONS.payments).getFullList(),
      pb.collection(COLLECTIONS.upad).getFullList(),
    ])

    try {
      await expect(savePayoutBatch([savedFirstDraft, {
        id: '', employee: worker.id, adj_paise: 0, adj_note: '', deduct_paise: 0,
        give_upad_paise: 0, typed_paise: 0, is_done: true,
      }], todayKey())).rejects.toThrow('the payout draft was not saved')

      const after = await Promise.all([
        pb.collection(COLLECTIONS.runs).getFullList(),
        pb.collection(COLLECTIONS.statements).getFullList(),
        pb.collection(COLLECTIONS.payments).getFullList(),
        pb.collection(COLLECTIONS.upad).getFullList(),
      ])
      expect(after.map((rows) => rows.length)).toEqual(before.map((rows) => rows.length))
      const refreshed = await loadAppData()
      expect(refreshed.drafts.find((item) => item.employee === firstWorker.id)).toMatchObject(firstDraftValues)
      expect(refreshed.drafts.some((item) => item.employee === worker.id)).toBe(false)
    } finally {
      await saveDraft(firstWorker.id, {
        adj_paise: firstOriginalDraft.adj_paise,
        adj_note: firstOriginalDraft.adj_note,
        deduct_paise: firstOriginalDraft.deduct_paise,
        give_upad_paise: firstOriginalDraft.give_upad_paise,
        typed_paise: firstOriginalDraft.typed_paise,
        is_done: firstOriginalDraft.is_done,
      })
      await pb.collection(COLLECTIONS.drafts).create({
        employee: originalDraft.employee,
        adj_paise: originalDraft.adj_paise,
        adj_note: originalDraft.adj_note,
        deduct_paise: originalDraft.deduct_paise,
        give_upad_paise: originalDraft.give_upad_paise,
        typed_paise: originalDraft.typed_paise,
        is_done: originalDraft.is_done,
      })
    }
  })

  it.skipIf(!enabled)('Section 9: Prevents unlocking an older run when a newer run exists for that worker', async () => {
    const data = await loadAppData()
    const worker = data.employees.find((item) => item.name === 'Mahesh Joshi') ?? data.employees[2]

    // Run 1
    await saveDraft(worker.id, {
      adj_paise: 0,
      adj_note: '',
      deduct_paise: 0,
      give_upad_paise: 0,
      typed_paise: 50_000,
      is_done: true,
    })
    const draft1 = (await loadAppData()).drafts.find((item) => item.employee === worker.id) as CycleDraft
    const run1 = await savePayoutBatch([draft1], todayKey())
    activeRunIds.push(run1.runId)

    // Run 2 closes on the next business day; no future attendance is needed.
    const nextDay = addDays(todayKey(), 1)

    // Run 2
    await saveDraft(worker.id, {
      adj_paise: 0,
      adj_note: '',
      deduct_paise: 0,
      give_upad_paise: 0,
      typed_paise: 55_000,
      is_done: true,
    })
    const draft2 = (await loadAppData()).drafts.find((item) => item.employee === worker.id) as CycleDraft
    const run2 = await savePayoutBatch([draft2], nextDay)
    activeRunIds.push(run2.runId)

    // Attempt to unlock Run 1 while Run 2 exists
    await expect(unlockPayout(run1.runId, 'Illegal early unlock', 'Test')).rejects.toThrow(
      /has a newer payout/,
    )

    // Clean up in reverse order: unlock Run 2 first, then Run 1
    await unlockPayout(run2.runId, 'Valid unlock Run 2', 'Test')
    activeRunIds.pop()
    await unlockPayout(run1.runId, 'Valid unlock Run 1', 'Test')
    activeRunIds.pop()
  })
})
