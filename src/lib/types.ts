export type AttendanceStatus = 'full' | 'half' | 'absent' | 'hours'
export type EmployeeStatus = 'active' | 'inactive'
export type UpadKind = 'give' | 'deduct' | 'repay'

export type Employee = {
  id: string
  name: string
  phone: string
  role: string
  daily_rate_paise: number
  status: EmployeeStatus
  opening_upad_paise: number
  opening_carry_paise: number
  paid_up_to: string
  joined_on: string
}

export type Attendance = {
  id: string
  employee: string
  date: string
  status: AttendanceStatus
  worked_minutes: number
  ot_minutes: number
  notes: string
  settled_payout: string
}

export type UpadEntry = {
  id: string
  employee: string
  date: string
  kind: UpadKind
  amount_paise: number
  note: string
  payout_id: string
  voided: boolean
}

export type CycleDraft = {
  id: string
  employee: string
  adj_paise: number
  adj_note: string
  deduct_paise: number
  give_upad_paise: number
  typed_paise: number | null
  is_done: boolean
}

export type PayoutRun = {
  id: string
  run_date: string
  total_paid_paise: number
  status: 'pending' | 'completed'
  voided: boolean
}

export type Statement = {
  id: string
  payout_run: string
  employee: string
  start_date: string
  end_date: string
  opening_paise: number
  earned_paise: number
  adjustment_paise: number
  upad_deduct_paise: number
  upad_give_paise: number
  calculated_paise: number
  paid_paise: number
  closing_paise: number
  voided: boolean
}

export type SalaryPayment = {
  id: string
  payout_run: string
  employee: string
  amount_paise: number
  voided: boolean
}

export type Holiday = { id: string; date: string; note: string }

export type CycleAudit = {
  id: string
  payout_run: string
  action: string
  unlocked_by: string
  unlocked_at: string
  reason: string
  snapshot: Record<string, unknown>
}

export type Settings = {
  id: string
  shift_hours: number
  ot_multiplier: number
  company_name: string
  language: 'en' | 'gu'
}

export type AppData = {
  employees: Employee[]
  attendance: Attendance[]
  upad: UpadEntry[]
  drafts: CycleDraft[]
  runs: PayoutRun[]
  statements: Statement[]
  payments: SalaryPayment[]
  holidays: Holiday[]
  settings: Settings
}
