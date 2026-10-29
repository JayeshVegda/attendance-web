export type AttendanceStatus = 'full' | 'half' | 'absent'

export type Employee = {
  id: string
  employee_no: string
  name: string
  phone: string
  active: boolean
  daily_rate_paise: number
  opening_salary_paise: number
  opening_upad_paise: number
  joined_on: string
  notes: string
  sort_order: number
  created: string
  updated: string
}

export type RateHistory = {
  id: string
  employee: string
  effective_from: string
  daily_rate_paise: number
  note: string
  created: string
}

export type EmploymentPeriod = {
  id: string
  employee: string
  start_date: string
  end_date: string
  note: string
  created: string
}

export type Attendance = {
  id: string
  employee: string
  date: string
  status: AttendanceStatus
  ot_minutes: number
  note: string
  created: string
  updated: string
}

export type Adjustment = {
  id: string
  employee: string
  date: string
  amount_paise: number
  note: string
  created: string
}

export type UpadKind = 'given' | 'recovery' | 'returned' | 'writeoff'

export type UpadCategory = 'regular' | 'extra'

export type UpadEntry = {
  id: string
  employee: string
  date: string
  kind: UpadKind
  category: UpadCategory | ''
  amount_paise: number
  note: string
  statement: string
  created: string
}

export type PayoutRun = {
  id: string
  cycle_start: string
  payout_date: string
  status: string
  note: string
  total_due_paise: number
  total_paid_paise: number
  total_upad_recovery_paise: number
  employee_count: number
  created: string
}

export type Statement = {
  id: string
  payout_run: string
  employee: string
  cycle_start: string
  payout_date: string
  opening_paise: number
  earned_paise: number
  adjustment_paise: number
  upad_outstanding_paise: number
  upad_recovery_paise: number
  total_due_paise: number
  paid_paise: number
  closing_paise: number
  days_worked: number
  ot_minutes: number
  note: string
  created: string
}

export type SalaryPayment = {
  id: string
  employee: string
  statement: string
  paid_on: string
  amount_paise: number
  note: string
  created: string
}

export type AppSetting = {
  id: string
  key: string
  value: string
  created: string
  updated: string
}

export type SettingsMap = Record<string, string>

export type CycleRow = {
  employee: Employee
  openingPaise: number
  earnedPaise: number
  adjustmentPaise: number
  regularUpadPaise: number
  extraUpadPaise: number
  returnedUpadPaise: number
  upadOutstandingPaise: number
  upadRecoveryPaise: number
  totalDuePaise: number
  paidPaise: number
  closingPaise: number
  daysWorked: number
  otMinutes: number
  attendanceCount: number
  included: boolean
}

export type PayoutInputRow = {
  employeeId: string
  recoveryPaise: number
  paidPaise: number
  note: string
}
