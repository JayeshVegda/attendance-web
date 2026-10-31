import PocketBase from 'pocketbase'

const baseUrl =
  import.meta.env.VITE_PB_URL ||
  (import.meta.env.DEV ? 'http://127.0.0.1:8091' : window.location.origin)

export const pb = new PocketBase(baseUrl)
pb.autoCancellation(false)

export const COLLECTIONS = {
  employees: 'employees',
  rates: 'rate_history',
  periods: 'employment_periods',
  attendance: 'attendance',
  adjustments: 'adjustments',
  upad: 'upad_entries',
  runs: 'payout_runs',
  statements: 'statements',
  payments: 'salary_payments',
  settings: 'settings',
  audit: 'audit_log',
} as const
