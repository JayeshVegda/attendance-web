import PocketBase from 'pocketbase'

const baseUrl =
  (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.PB_TEST_URL ||
  import.meta.env.VITE_PB_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8091' : window.location.origin)

export const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)

export const COLLECTIONS = {
  employees: 'employees',
  attendance: 'attendance',
  upad: 'upad_entries',
  drafts: 'cycle_drafts',
  runs: 'payout_runs',
  statements: 'statements',
  payments: 'salary_payments',
  holidays: 'holidays',
  audits: 'cycle_audits',
  settings: 'settings',
} as const
