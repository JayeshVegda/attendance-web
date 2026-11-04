import { WorkerCycleModal } from '../components/WorkerCycleModal'
import { CycleRegisterTable } from '../components/CycleRegisterTable'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  HandCoins,
  History,
  Layers,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {
  buildCycleRows,
  createAdjustment,
  createCashReturn,
  createUpadEntry,
  deleteAdjustment,
  deleteAttendance,
  getPayrollData,
  getSettings,
  listEmployees,
  listRuns,
  listStatements,
  saveAttendance,
} from '../lib/api'
import { saveCycleRows } from '../lib/payout-service'
import {
  computeGridStart,
  getWorkerPaidUpToDate,
  isRealPayoutRun,
  realPayoutRuns,
  cycleStartFor,
  isChaluUpadEnabled,
  isMotoUpadEnabled,
  isHoursAttendanceEnabled,
  hourStepMinutes,
  lastPayoutDate,
  otDivisor,
  useUpadBuckets,
} from '../lib/cycle'
import {
  addDays,
  dateKey,
  daysBetweenInclusive,
  formatDateLong,
  formatDateRange,
  formatDateShort,
  isFriday,
  todayKey,
  weekdayShort,
} from '../lib/dates'
import { formatHours, formatMoney, paiseToInput, parseMoneyInput } from '../lib/money'
import { dayPayPaise, getRateForDate } from '../lib/payroll'
import type { Adjustment, Attendance, AttendanceStatus, CycleRow, Employee, SettingsMap, UpadCategory, UpadEntry } from '../lib/types'
import { UpadModal } from '../components/UpadModal'
import { useToast } from '../components/Toast'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Spinner,
  Stat,
  Tabs,
  Textarea,
} from '../components/ui'

type CycleStatus = AttendanceStatus | null
type PayrollData = Awaited<ReturnType<typeof getPayrollData>>
type ViewMode = 'cycle' | 'today'

type RowInput = {
  recovery: string
  paid: string | null
}

type CashTarget = {
  employeeId: string
  category: UpadCategory
}

const NEXT_STATUS: Record<string, CycleStatus> = {
  none: 'full',
  full: 'half',
  half: 'absent',
  absent: null,
  hours: null,
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  full: 'P',
  half: 'H',
  absent: 'A',
  hours: 'Hrs',
}

const STATUS_NAME: Record<AttendanceStatus, string> = {
  full: 'Full day (P)',
  half: 'Half day (H)',
  absent: 'Absent (A)',
  hours: 'Hours worked (1–7h)',
}

function formatAttendanceLabel(record?: Attendance): string {
  if (!record || !record.status) return '—'
  if (record.status === 'hours') {
    const hrs = (record.worked_minutes ?? 0) / 60
    return `${Number(hrs.toFixed(1))}h`
  }
  return STATUS_LABEL[record.status] || '—'
}

function blankInput(): RowInput {
  return { recovery: '', paid: null }
}

function cellStyle(status?: AttendanceStatus) {
  if (status === 'full')
    return 'border-emerald-300 bg-emerald-50 text-emerald-900 font-bold hover:bg-emerald-100 hover:border-emerald-400'
  if (status === 'half')
    return 'border-amber-300 bg-amber-50 text-amber-900 font-bold hover:bg-amber-100 hover:border-amber-400'
  if (status === 'absent')
    return 'border-rose-300 bg-rose-50 text-rose-900 font-bold hover:bg-rose-100 hover:border-rose-400'
  if (status === 'hours')
    return 'border-sky-300 bg-sky-50 text-sky-900 font-bold hover:bg-sky-100 hover:border-sky-400'
  return 'border-stone-200 bg-stone-50/60 text-stone-300 hover:border-emerald-400 hover:bg-white hover:text-stone-400'
}

function keyFor(employeeId: string, date: string) {
  return `${employeeId}|${dateKey(date)}`
}

function adjustRows(baseRows: CycleRow[], entries: Record<string, RowInput>): CycleRow[] {
  return baseRows.map((row) => {
    const entry = entries[row.employee.id] ?? blankInput()
    const beforeRecovery = row.openingPaise + row.earnedPaise + row.adjustmentPaise
    const requestedRecovery = Math.max(0, parseMoneyInput(entry.recovery))
    const recovery = Math.min(
      requestedRecovery,
      row.upadOutstandingPaise,
      Math.max(0, beforeRecovery),
    )
    const due = Math.max(0, beforeRecovery - recovery)
    const paidInput = entry.paid === null ? paiseToInput(due) : entry.paid
    const paid = Math.min(Math.max(0, parseMoneyInput(paidInput)), due)
    return {
      ...row,
      upadRecoveryPaise: recovery,
      totalDuePaise: due,
      paidPaise: paid,
      closingPaise: due - paid,
    }
  })
}

function signedMoney(paise: number) {
  if (!paise) return '—'
  return `${paise > 0 ? '+' : '-'}${formatMoney(Math.abs(paise))}`
}

export default function AttendancePage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [payoutDate, setPayoutDate] = useState(() => todayKey())
  const [entries, setEntries] = useState<Record<string, RowInput>>({})
  const [editor, setEditor] = useState<{ employeeId: string; date: string } | null>(null)
  const [upadOpen, setUpadOpen] = useState(false)
  const [upadEmployee, setUpadEmployee] = useState<string | undefined>()
  const [cashTarget, setCashTarget] = useState<CashTarget | null>(null)
  const [workerModalRow, setWorkerModalRow] = useState<CycleRow | null>(null)
  const [activeHoursPicker, setActiveHoursPicker] = useState<string | null>(null)
  const [workerUpadTarget, setWorkerUpadTarget] = useState<CycleRow | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [note, setNote] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('attendance_view_mode') as ViewMode) || 'cycle'
  })

  const handleViewModeChange = (mode: ViewMode) => {
    localStorage.setItem('attendance_view_mode', mode)
    setViewMode(mode)
  }
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'active' | 'unmarkedToday'>('all')
  const [bulkMenuDate, setBulkMenuDate] = useState<string | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [selectedCycleId, setSelectedCycleId] = useState<string>('open')
  const [lateEntriesTarget, setLateEntriesTarget] = useState<{ employee: Employee; entries: Attendance[] } | null>(null)
  const bulkMenuRef = useRef<HTMLDivElement>(null)

  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  const toast = useToast()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const statementsQuery = useQuery({ queryKey: ['statements'], queryFn: listStatements })

  const completedRuns = useMemo(
    () => realPayoutRuns(runsQuery.data ?? []).sort((a, b) => dateKey(b.payout_date).localeCompare(dateKey(a.payout_date))),
    [runsQuery.data],
  )

  const activeEmployees = useMemo(
    () => (employeesQuery.data ?? []).filter((e) => e.active),
    [employeesQuery.data],
  )

  const openCycleStart = useMemo(() => {
    if (!settingsQuery.data) return ''
    return computeGridStart({
      activeEmployees,
      statements: statementsQuery.data ?? [],
      settings: settingsQuery.data,
    })
  }, [activeEmployees, statementsQuery.data, settingsQuery.data])

  const selectedRun = useMemo(
    () => (selectedCycleId === 'open' ? null : completedRuns.find((r) => r.id === selectedCycleId)),
    [selectedCycleId, completedRuns],
  )

  const isPastCycle = Boolean(selectedRun)
  const cycleStart = selectedRun ? dateKey(selectedRun.cycle_start) : openCycleStart
  const gridEndDate = selectedRun ? dateKey(selectedRun.payout_date) : payoutDate

  const validRange = Boolean(cycleStart && gridEndDate && cycleStart <= gridEndDate)
  const payrollKey = ['payroll', cycleStart, gridEndDate] as const
  const payrollQuery = useQuery({
    queryKey: payrollKey,
    queryFn: () => getPayrollData(cycleStart, gridEndDate),
    enabled: validRange,
  })

  useEffect(() => {
    setEntries({})
    setPreviewOpen(false)
    setCashTarget(null)
    setNote('')
  }, [cycleStart, gridEndDate])

  // Close bulk menu when clicking outside
  useEffect(() => {
    if (!bulkMenuDate) return
    const handleClick = (e: MouseEvent) => {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(e.target as Node)) {
        setBulkMenuDate(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [bulkMenuDate])

  const payrollData = payrollQuery.data
  const employees = employeesQuery.data ?? payrollData?.employees ?? []
  const payrollSettings = payrollData?.settings ?? settingsQuery.data ?? {}
  const divisor = otDivisor(payrollSettings)
  const upadConfig = useUpadBuckets(payrollSettings)
  const isChaluOn = upadConfig.isChaluOn
  const isMotoOn = upadConfig.isMotoOn
  const isHoursOn = isHoursAttendanceEnabled(payrollSettings)
  const stepMins = hourStepMinutes(payrollSettings)
  const rates = payrollData?.rates ?? []
  const attendance = payrollData?.attendance ?? []

  const days = useMemo(() => {
    if (!validRange) return []
    const length = Math.max(1, daysBetweenInclusive(cycleStart, gridEndDate))
    return Array.from({ length }, (_, index) => addDays(cycleStart, index))
  }, [validRange, cycleStart, gridEndDate])

  const attendanceMap = useMemo(() => {
    const map = new Map<string, Attendance>()
    for (const entry of attendance) map.set(keyFor(entry.employee, entry.date), entry)
    return map
  }, [attendance])

  const baseRows = useMemo(() => {
    if (!payrollData) return []
    return buildCycleRows(payrollData, cycleStart, gridEndDate)
  }, [payrollData, cycleStart, gridEndDate])

  const rows = useMemo(() => adjustRows(baseRows, entries), [baseRows, entries])
  const today = todayKey()

  const workerPaidUpToMap = useMemo(() => {
    const map = new Map<string, string>()
    const stmts = statementsQuery.data ?? payrollData?.statements ?? []
    for (const emp of employees) {
      const paidDate = getWorkerPaidUpToDate(emp.id, stmts)
      if (paidDate) map.set(emp.id, paidDate)
    }
    return map
  }, [employees, statementsQuery.data, payrollData?.statements])

  const workerLateEntriesMap = useMemo(() => {
    const map = new Map<string, Attendance[]>()
    if (isPastCycle || !cycleStart) return map
    for (const entry of attendance) {
      if (entry.settled_payout) continue
      const d = dateKey(entry.date)
      if (d < cycleStart && (entry.status || (entry.ot_minutes ?? 0) > 0)) {
        const list = map.get(entry.employee) ?? []
        list.push(entry)
        map.set(entry.employee, list)
      }
    }
    return map
  }, [attendance, cycleStart, isPastCycle])

  // Filtered rows for search & status filter
  const displayRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      const e = row.employee
      const hasJoined = !e.joined_on || e.joined_on <= today
      if (filterType === 'active' && (!e.active || !hasJoined)) return false
      if (filterType === 'unmarkedToday') {
        if (!e.active || !hasJoined) return false
        const rec = attendanceMap.get(keyFor(e.id, today))
        if (rec && rec.status) return false
      }
      if (!term) return true
      return (
        e.name.toLowerCase().includes(term) ||
        e.employee_no.toLowerCase().includes(term) ||
        e.phone.toLowerCase().includes(term)
      )
    })
  }, [rows, search, filterType, attendanceMap, today])

  // Overall totals across the cycle
  const totals = useMemo(() => {
    return rows.reduce(
      (sum, row) => {
        sum.opening += row.openingPaise
        sum.earned += row.earnedPaise
        sum.adjustment += row.adjustmentPaise
        sum.regular += row.regularUpadPaise
        sum.extra += row.extraUpadPaise
        sum.returned += row.returnedUpadPaise
        sum.outstanding += row.upadOutstandingPaise
        sum.recovery += row.upadRecoveryPaise
        sum.due += row.totalDuePaise
        sum.paid += row.paidPaise
        sum.closing += row.closingPaise
        return sum
      },
      {
        opening: 0,
        earned: 0,
        adjustment: 0,
        regular: 0,
        extra: 0,
        returned: 0,
        outstanding: 0,
        recovery: 0,
        due: 0,
        paid: 0,
        closing: 0,
      },
    )
  }, [rows])

  // Daily totals
  const dailyTotals = useMemo(() => {
    return days.map((day) => {
      let present = 0
      let half = 0
      let absent = 0
      let hours = 0
      let ot = 0
      for (const row of rows) {
        if (!isPastCycle) {
          const workerPaidUpTo = workerPaidUpToMap.get(row.employee.id)
          if (workerPaidUpTo && day <= workerPaidUpTo) continue
        }
        const record = attendanceMap.get(keyFor(row.employee.id, day))
        if (!record) continue
        if (record.status === 'full') present += 1
        else if (record.status === 'half') half += 1
        else if (record.status === 'absent') absent += 1
        else if (record.status === 'hours') hours += 1
        ot += record.ot_minutes || 0
      }
      return { present, half, absent, hours, ot }
    })
  }, [days, rows, attendanceMap, workerPaidUpToMap, isPastCycle])

  // Today's attendance quick stats
  const todayStats = useMemo(() => {
    let present = 0
    let half = 0
    let absent = 0
    let activeTotal = 0
    for (const row of rows) {
      const e = row.employee
      const hasJoined = !e.joined_on || e.joined_on <= today
      if (e.active && hasJoined) {
        activeTotal += 1
        const record = attendanceMap.get(keyFor(e.id, today))
        if (record?.status === 'full') present += 1
        else if (record?.status === 'half') half += 1
        else if (record?.status === 'absent') absent += 1
      }
    }
    const marked = present + half + absent
    const percent = activeTotal > 0 ? Math.round(((present + half * 0.5) / activeTotal) * 100) : 0
    return { present, half, absent, marked, activeTotal, percent }
  }, [rows, attendanceMap, today])

  const saveMutation = useMutation({
    mutationFn: async (input: {
      employeeId: string
      date: string
      status: CycleStatus
      workedMinutes?: number
      otMinutes: number
      existingId?: string
      note?: string
    }) => {
      if (!input.status) {
        await deleteAttendance(input.existingId, input.employeeId, input.date)
        return null
      }
      return saveAttendance({
        employeeId: input.employeeId,
        date: input.date,
        status: input.status,
        workedMinutes: input.workedMinutes,
        otMinutes: input.otMinutes,
        existingId: input.existingId,
        note: input.note,
      })
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: payrollKey })
      const previous = queryClient.getQueryData<PayrollData>(payrollKey)
      queryClient.setQueryData<PayrollData>(payrollKey, (current) => {
        if (!current) return current
        if (!input.status) {
          return {
            ...current,
            attendance: current.attendance.filter((entry) => entry.id !== input.existingId),
          }
        }
        if (input.existingId) {
          return {
            ...current,
            attendance: current.attendance.map((entry) =>
              entry.id === input.existingId
                ? { ...entry, status: input.status!, worked_minutes: input.workedMinutes, ot_minutes: input.otMinutes }
                : entry,
            ),
          }
        }
        const optimistic: Attendance = {
          id: `temp-${input.employeeId}-${input.date}`,
          employee: input.employeeId,
          date: input.date,
          status: input.status!,
          worked_minutes: input.workedMinutes,
          ot_minutes: input.otMinutes,
          note: input.note || '',
          created: '',
          updated: '',
        }
        return { ...current, attendance: [...current.attendance, optimistic] }
      })
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(payrollKey, context.previous)
      toast(error instanceof Error ? error.message : 'Could not save attendance', 'error')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
    },
  })

  // Bulk marking mutation
  const bulkMutation = useMutation({
    mutationFn: async ({ date, status }: { date: string; status: AttendanceStatus | null }) => {
      const activeRows = rows.filter((r) => {
        const e = r.employee
        return e.active && (!e.joined_on || e.joined_on <= date)
      })
      for (const r of activeRows) {
        const record = attendanceMap.get(keyFor(r.employee.id, date))
        if (record?.settled_payout) continue
        if (!status) {
          await deleteAttendance(record?.id, r.employee.id, date)
        } else {
          await saveAttendance({
            employeeId: r.employee.id,
            date,
            status,
            otMinutes: record?.ot_minutes || 0,
            existingId: record && !record.id.startsWith('temp-') ? record.id : undefined,
            note: record?.note || '',
          })
        }
      }
    },
    onSuccess: (_data, { status, date }) => {
      queryClient.invalidateQueries({ queryKey: payrollKey })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast(
        status === 'full'
          ? `Marked all active as Present for ${formatDateShort(date)}`
          : status === 'absent'
            ? `Marked all active as Absent for ${formatDateShort(date)}`
            : `Cleared records for ${formatDateShort(date)}`,
      )
      setBulkMenuDate(null)
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Bulk update failed', 'error'),
  })

  const createMutation = useMutation({
    mutationFn: () => {
      if (!payrollData) throw new Error('Payroll data not loaded')
      return saveCycleRows({
        employees: payrollData.employees,
        ratesAll: payrollData.rates,
        periodsAll: payrollData.periods,
        attendanceAll: payrollData.attendance,
        adjustmentsAll: payrollData.adjustments,
        upadAll: payrollData.upadEntries,
        statements: payrollData.statements,
        cutoff: payoutDate,
        payoutDate,
        note: note.trim(),
        rows: rows.map((row) => ({
          employeeId: row.employee.id,
          recoveryPaise: row.upadRecoveryPaise,
          paidPaise: row.paidPaise,
        })),
      })
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      queryClient.invalidateQueries({ queryKey: ['statements'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast('Payout saved and cycle closed successfully')
      setPreviewOpen(false)
      onNavigate(`reports/${result.runId}`)
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Could not close payout', 'error'),
  })

  function cycleCell(employee: Employee, day: string) {
    if (saveMutation.isPending) return
    const record = attendanceMap.get(keyFor(employee.id, day))
    if (coarsePointer) {
      setEditor({ employeeId: employee.id, date: day })
      return
    }
    const current = record?.status ?? 'none'
    saveMutation.mutate({
      employeeId: employee.id,
      date: day,
      status: NEXT_STATUS[current],
      otMinutes: record?.ot_minutes ?? 0,
      existingId: record?.id,
      note: record?.note,
    })
  }

  function setRowInput(employeeId: string, patch: Partial<RowInput>) {
    setEntries((current) => ({
      ...current,
      [employeeId]: { ...(current[employeeId] ?? blankInput()), ...patch },
    }))
  }

  function openCashReturn(employeeId: string, category: UpadCategory = 'regular') {
    setCashTarget({ employeeId, category })
  }

  const editorEmployee = employees.find((employee) => employee.id === editor?.employeeId)
  const editorRecord = editor ? attendanceMap.get(keyFor(editor.employeeId, editor.date)) : undefined
  const editorRate =
    editorEmployee && editor ? getRateForDate(editorEmployee, rates, editor.date) : 0

  const cashRow = cashTarget ? rows.find((row) => row.employee.id === cashTarget.employeeId) : undefined

  const loading =
    settingsQuery.isLoading ||
    runsQuery.isLoading ||
    (validRange && payrollQuery.isLoading) ||
    employeesQuery.isLoading
  const errored = settingsQuery.isError || runsQuery.isError || payrollQuery.isError
  const lastPayout = runsQuery.data ? lastPayoutDate(runsQuery.data) : undefined
  const unpaidCount = rows.filter((row) => row.closingPaise > 0).length

  return (
    <div>
      {/* Main Table Register Card */}
      <Card className="overflow-hidden">
        {errored ? (
          <div className="p-8">
            <EmptyState
              icon={<AlertCircle className="h-6 w-6 text-rose-600" />}
              title="Could not load register"
              description="Check the local PocketBase server connection."
              action={
                <Button
                  onClick={() => {
                    settingsQuery.refetch()
                    runsQuery.refetch()
                    payrollQuery.refetch()
                    employeesQuery.refetch()
                  }}
                >
                  Retry
                </Button>
              }
            />
          </div>
        ) : !validRange && !loading ? (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6 text-emerald-700" />}
            title={cycleStart ? `Next cycle opens ${formatDateLong(cycleStart)}` : 'No cycle dates'}
            description="The previous payout cycle is settled. The next cycle begins the day after that payout."
          />
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-xs font-bold text-stone-500">
            <Spinner className="h-5 w-5" />
            <span>Loading attendance register…</span>
          </div>
        ) : !displayRows.length ? (
          <EmptyState
            icon={<Users className="h-6 w-6 text-stone-400" />}
            title={search ? 'No matching workers' : 'No employees in cycle'}
            description={search ? 'Try clearing search or filter.' : 'Add active workers to mark attendance.'}
            action={
              search ? (
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear Search
                </Button>
              ) : (
                <Button onClick={() => onNavigate('employees')}>Add Employee</Button>
              )
            }
          />
        ) : viewMode === 'today' ? (
          /* TODAY'S FAST ROLL CALL MODE (ZERO HORIZONTAL SCROLL) */
          <div className="divide-y divide-stone-100">
            {/* Unified Single Header Bar for Today's Roll Call */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 bg-white px-3.5 py-2">
              <div className="flex flex-wrap items-center gap-2.5">
                {/* View Mode Tabs */}
                <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-bold text-stone-600">
                  <button
                    type="button"
                    onClick={() => handleViewModeChange('today')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-emerald-800 shadow-2xs font-extrabold cursor-pointer"
                  >
                    <CalendarCheck className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Today's Roll Call</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleViewModeChange('cycle')}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-stone-600 transition-all hover:text-stone-900 cursor-pointer"
                  >
                    <CalendarDays className="h-3.5 w-3.5 text-stone-400" />
                    <span>Cycle Register</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-stone-900">
                  <span>{formatDateLong(today)}</span>
                  <Badge tone="green" dot>
                    {todayStats.marked} / {todayStats.activeTotal} Marked
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-36 sm:w-48">
                  <SearchInput
                    placeholder="Search worker…"
                    value={search}
                    onChange={setSearch}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => bulkMutation.mutate({ date: today, status: 'full' })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                  <span>Mark All Present</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-stone-400" />
                  <span>Clear Today</span>
                </Button>
              </div>
            </div>

            {/* Dense List of Workers */}
            {displayRows.map((row) => {
              const { employee } = row
              const record = attendanceMap.get(keyFor(employee.id, today))
              const status = record?.status
              const otMinutes = record?.ot_minutes ?? 0
              const isCustomOt = otMinutes > 0 && ![60, 120, 180, 240].includes(otMinutes)
              const hasUpad = isChaluOn || isMotoOn

              return (
                <div
                  key={employee.id}
                  className={clsx(
                    'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-1.5 px-3 sm:px-4 transition-colors hover:bg-stone-50/80',
                    !employee.active && 'bg-stone-50/40 opacity-75',
                  )}
                >
                  {/* Worker Info - Dense */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={employee.name} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setWorkerModalRow(row)}
                          className="truncate text-xs font-bold text-stone-900 hover:text-emerald-700 text-left cursor-pointer"
                        >
                          {employee.name}
                        </button>
                        <span className="text-[10px] font-semibold text-stone-400">
                          #{employee.employee_no}
                        </span>
                        {!employee.active && (
                          <Badge tone="neutral">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-stone-500">
                        <span className="font-bold text-stone-700">
                          {formatMoney(employee.daily_rate_paise)}/d
                        </span>
                        <span className="text-stone-300">·</span>
                        <span>{Number(row.daysWorked.toFixed(2))}d worked ({formatMoney(row.earnedPaise)})</span>
                        {upadConfig.hasAny && row.upadOutstandingPaise > 0 && (
                          <>
                            <span className="text-stone-300">·</span>
                            <span className="font-semibold text-amber-700">
                              {formatMoney(row.upadOutstandingPaise)} {upadConfig.isOnlyOneOn ? upadConfig.singleBucket!.label.toLowerCase() : 'upad'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions: Attendance (P, H, A, Hrs) + OT + Edit */}
                  <div className="flex flex-wrap items-center gap-1 shrink-0 self-end sm:self-auto">
                    {/* P button */}
                    <button
                      type="button"
                      onClick={() =>
                        saveMutation.mutate({
                          employeeId: employee.id,
                          date: today,
                          status: status === 'full' ? null : 'full',
                          otMinutes: record?.ot_minutes ?? 0,
                          existingId: record?.id,
                          note: record?.note,
                        })
                      }
                      className={clsx(
                        'h-7 px-2.5 rounded-lg text-xs font-bold transition-all border select-none cursor-pointer flex items-center gap-1',
                        status === 'full'
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-300 hover:bg-emerald-50/60',
                      )}
                    >
                      <span>P</span>
                      <span className="hidden md:inline font-medium text-[11px]">Present</span>
                    </button>

                    {/* H button */}
                    <button
                      type="button"
                      onClick={() =>
                        saveMutation.mutate({
                          employeeId: employee.id,
                          date: today,
                          status: status === 'half' ? null : 'half',
                          otMinutes: record?.ot_minutes ?? 0,
                          existingId: record?.id,
                          note: record?.note,
                        })
                      }
                      className={clsx(
                        'h-7 px-2.5 rounded-lg text-xs font-bold transition-all border select-none cursor-pointer flex items-center gap-1',
                        status === 'half'
                          ? 'border-amber-600 bg-amber-600 text-white shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-amber-300 hover:bg-amber-50/60',
                      )}
                    >
                      <span>H</span>
                      <span className="hidden md:inline font-medium text-[11px]">Half</span>
                    </button>

                    {/* A button */}
                    <button
                      type="button"
                      onClick={() =>
                        saveMutation.mutate({
                          employeeId: employee.id,
                          date: today,
                          status: status === 'absent' ? null : 'absent',
                          otMinutes: record?.ot_minutes ?? 0,
                          existingId: record?.id,
                          note: record?.note,
                        })
                      }
                      className={clsx(
                        'h-7 px-2.5 rounded-lg text-xs font-bold transition-all border select-none cursor-pointer flex items-center gap-1',
                        status === 'absent'
                          ? 'border-rose-600 bg-rose-600 text-white shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-rose-300 hover:bg-rose-50/60',
                      )}
                    >
                      <span>A</span>
                      <span className="hidden md:inline font-medium text-[11px]">Absent</span>
                    </button>

                    {/* Hrs button & Popover */}
                    {isHoursOn && (
                      <div className="relative inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveHoursPicker(activeHoursPicker === employee.id ? null : employee.id)
                          }}
                          className={clsx(
                            'h-7 px-2.5 rounded-lg text-xs font-bold transition-all border select-none cursor-pointer flex items-center gap-1',
                            status === 'hours'
                              ? 'border-sky-600 bg-sky-600 text-white shadow-2xs'
                              : 'border-stone-200 bg-white text-stone-700 hover:border-sky-300 hover:bg-sky-50/60',
                          )}
                          title="Hours worked (1–7h)"
                        >
                          {status === 'hours' ? `${Number(((record?.worked_minutes || 0) / 60).toFixed(1))}h` : 'Hrs'}
                        </button>

                        {activeHoursPicker === employee.id && (
                          <div className="absolute right-0 top-8 z-30 flex items-center gap-1 p-1.5 rounded-xl border border-stone-200 bg-white shadow-lg animate-in fade-in zoom-in-95">
                            <span className="px-1 text-[10px] font-extrabold uppercase text-stone-400">Hours:</span>
                            {[1, 2, 3, 4, 5, 6, 7].map((h) => {
                              const mins = h * 60
                              const isSelected = status === 'hours' && record?.worked_minutes === mins
                              return (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => {
                                    saveMutation.mutate({
                                      employeeId: employee.id,
                                      date: today,
                                      status: 'hours',
                                      workedMinutes: mins,
                                      otMinutes: record?.ot_minutes ?? 0,
                                      existingId: record?.id,
                                      note: record?.note,
                                    })
                                    setActiveHoursPicker(null)
                                  }}
                                  className={clsx(
                                    'h-6 w-6 rounded-md text-xs font-black transition cursor-pointer flex items-center justify-center',
                                    isSelected
                                      ? 'bg-sky-600 text-white'
                                      : 'bg-stone-100 text-stone-700 hover:bg-sky-100 hover:text-sky-800'
                                  )}
                                >
                                  {h}
                                </button>
                              )
                            })}
                            <div className="border-l border-stone-200 pl-1 flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="7"
                                step={stepMins === 60 ? '1' : '0.5'}
                                placeholder="h"
                                autoFocus
                                className="h-6 w-10 rounded border border-stone-300 px-1 text-center text-xs font-bold text-stone-800 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const val = Number.parseFloat((e.target as HTMLInputElement).value)
                                    if (val > 0 && val < 8) {
                                      saveMutation.mutate({
                                        employeeId: employee.id,
                                        date: today,
                                        status: 'hours',
                                        workedMinutes: Math.round(val * 60),
                                        otMinutes: record?.ot_minutes ?? 0,
                                        existingId: record?.id,
                                        note: record?.note,
                                      })
                                      setActiveHoursPicker(null)
                                    }
                                  }
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* OT Options: 1, 2, 3, 4, +OT */}
                    <div className="inline-flex items-center rounded-lg border border-stone-200 bg-stone-50/80 p-0.5 shrink-0">
                      <span className="px-1 text-[9px] font-extrabold uppercase text-stone-400 select-none hidden lg:inline">
                        OT
                      </span>
                      {[1, 2, 3, 4].map((hours) => {
                        const minutes = hours * 60
                        const isSelected = otMinutes === minutes
                        return (
                          <button
                            key={hours}
                            type="button"
                            onClick={() => {
                              const nextOt = isSelected ? 0 : minutes
                              saveMutation.mutate({
                                employeeId: employee.id,
                                date: today,
                                status: record?.status === 'absent' || !record?.status ? 'full' : record.status,
                                workedMinutes: record?.worked_minutes,
                                otMinutes: nextOt,
                                existingId: record?.id,
                                note: record?.note,
                              })
                            }}
                            className={clsx(
                              'h-6 min-w-[1.5rem] px-1 rounded text-[11px] font-bold transition-all flex items-center justify-center select-none cursor-pointer',
                              isSelected
                                ? 'bg-stone-900 text-white shadow-2xs'
                                : 'text-stone-700 hover:bg-stone-200/80 hover:text-stone-950',
                            )}
                            title={`${hours} hr OT (${minutes}m)`}
                          >
                            {hours}
                          </button>
                        )
                      })}

                      <button
                        type="button"
                        onClick={() => setEditor({ employeeId: employee.id, date: today })}
                        className={clsx(
                          'h-6 rounded px-1.5 text-[11px] font-bold transition-all flex items-center justify-center gap-1 border-l border-stone-200/80 select-none cursor-pointer',
                          isCustomOt
                            ? 'bg-stone-900 text-white shadow-2xs'
                            : 'text-stone-600 hover:bg-stone-200/80 hover:text-stone-900',
                        )}
                        title={record?.note ? `Note: ${record.note}` : 'Custom OT & note'}
                      >
                        <span>{isCustomOt ? `+${formatHours(otMinutes)}` : '+OT'}</span>
                        {record?.note && (
                          <span
                            className={clsx(
                              'h-1.5 w-1.5 rounded-full',
                              isCustomOt ? 'bg-amber-300' : 'bg-emerald-600',
                            )}
                          />
                        )}
                      </button>
                    </div>

                    {/* Quick Give Upad */}
                    {hasUpad && (
                      <button
                        type="button"
                        onClick={() => setWorkerUpadTarget(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100/80 transition shrink-0"
                        title="Manage Upad"
                      >
                        <HandCoins className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold hidden sm:inline">+ Upad</span>
                      </button>
                    )}

                    {/* Full Cell / Day Editor */}
                    <button
                      type="button"
                      onClick={() => setEditor({ employeeId: employee.id, date: today })}
                      className="h-7 w-7 rounded-lg border border-stone-200 bg-white text-stone-400 hover:text-stone-700 hover:border-stone-300 flex items-center justify-center transition"
                      title="Edit attendance details"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <CycleRegisterTable
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            cycleStart={cycleStart}
            gridEndDate={gridEndDate}
            activeEmployees={activeEmployees}
            allEmployees={employees}
            statements={statementsQuery.data ?? []}
            attendance={attendance}
            upadEntries={payrollData?.upadEntries ?? []}
            adjustments={payrollData?.adjustments ?? []}
            rates={rates}
            periods={payrollData?.periods ?? []}
            settings={payrollSettings}
            isPastCycle={isPastCycle}
            selectedCycleId={selectedCycleId}
            completedRuns={completedRuns}
            onSelectCycleId={setSelectedCycleId}
            onOpenAttendanceEditor={(empId, d) => setEditor({ employeeId: empId, date: d })}
          />
        )}
      </Card>

      {/* Attendance Editor Modal */}
      {editor && editorEmployee && (
        <AttendanceEditor
          key={`${editor.employeeId}-${editor.date}`}
          open
          onClose={() => setEditor(null)}
          employee={editorEmployee}
          date={editor.date}
          record={editorRecord}
          ratePaise={editorRate}
          divisor={divisor}
        />
      )}

      {/* Upad Modal */}
      <UpadModal
        open={upadOpen}
        onClose={() => setUpadOpen(false)}
        employees={employees}
        defaultEmployeeId={upadEmployee}
      />

      {/* Cash Return Modal */}
      {cashTarget && cashRow && (
        <CashReturnModal
          open
          onClose={() => setCashTarget(null)}
          employee={cashRow.employee}
          row={cashRow}
          initialCategory={cashTarget.category}
          payoutDate={payoutDate}
          settings={payrollSettings}
        />
      )}

      {/* Close Payout Preview Modal */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Close & Settle Payout Cycle"
        description={`${formatDateRange(cycleStart, payoutDate)} · ${rows.length} worker${rows.length === 1 ? '' : 's'}`}
        size="xl"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPreviewOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="emerald"
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={!rows.length}
            >
              <Wallet className="h-4 w-4" />
              <span>Confirm & Settle Payout</span>
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                Total To Pay
              </div>
              <div className="mt-1 text-xl font-bold text-stone-900 tabular-nums">
                {formatMoney(totals.due, { showZero: true })}
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50/80 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                Paying Now
              </div>
              <div className="mt-1 text-xl font-bold text-emerald-800 tabular-nums">
                {formatMoney(totals.paid, { showZero: true })}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                Carried Forward
              </div>
              <div className="mt-1 text-xl font-bold text-amber-800 tabular-nums">
                {formatMoney(totals.closing, { showZero: true })}
              </div>
            </div>
          </div>

          <div
            className={clsx(
              'flex gap-2.5 rounded-2xl border px-3.5 py-2.5 text-xs leading-5 font-semibold',
              unpaidCount
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900',
            )}
          >
            {unpaidCount ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            )}
            <span>
              {unpaidCount
                ? `${unpaidCount} worker${unpaidCount === 1 ? '' : 's'} will carry unpaid balance forward into the next cycle.`
                : 'All workers are fully paid for this cycle.'}
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-stone-200">
            <table className="w-full min-w-[46rem] text-xs">
              <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500 font-bold border-b border-stone-200">
                <tr>
                  <th className="px-3 py-2 text-left">Worker</th>
                  <th className="px-3 py-2 text-right">Baki</th>
                  <th className="px-3 py-2 text-right">Salary</th>
                  <th className="px-3 py-2 text-right">Adjust</th>
                  <th className="px-3 py-2 text-right">Upad Rec.</th>
                  <th className="px-3 py-2 text-right">Total Due</th>
                  <th className="px-3 py-2 text-right">Paid Now</th>
                  <th className="px-3 py-2 text-right">Closing Carry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((row) => (
                  <tr key={row.employee.id}>
                    <td className="px-3 py-2">
                      <div className="font-bold text-stone-900">{row.employee.name}</div>
                      <div className="text-[10px] text-stone-400">
                        #{row.employee.employee_no} · {row.daysWorked} d
                        {row.otMinutes > 0 ? ` · ${formatHours(row.otMinutes)} OT` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-stone-600 tabular-nums">
                      {formatMoney(row.openingPaise, { showZero: true })}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-stone-800 tabular-nums">
                      {formatMoney(row.earnedPaise, { showZero: true })}
                    </td>
                    <td
                      className={clsx(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        row.adjustmentPaise > 0
                          ? 'text-emerald-700'
                          : row.adjustmentPaise < 0
                            ? 'text-rose-600'
                            : 'text-stone-400',
                      )}
                    >
                      {signedMoney(row.adjustmentPaise)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-rose-700 tabular-nums">
                      {row.upadRecoveryPaise > 0
                        ? `-${formatMoney(row.upadRecoveryPaise)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-stone-900 tabular-nums">
                      {formatMoney(row.totalDuePaise, { showZero: true })}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-700 tabular-nums">
                      {formatMoney(row.paidPaise, { showZero: true })}
                    </td>
                    <td
                      className={clsx(
                        'px-3 py-2 text-right font-bold tabular-nums',
                        row.closingPaise > 0 ? 'text-amber-700' : 'text-stone-400',
                      )}
                    >
                      {formatMoney(row.closingPaise, { showZero: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Field label="Payout Note" hint="Optional internal note.">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Diwali settlement"
            />
          </Field>
        </div>
      </Modal>

      {/* Worker Cycle Details & Adjustments Modal */}
      {workerModalRow && (
        <WorkerCycleModal
          open
          onClose={() => setWorkerModalRow(null)}
          row={rows.find((r) => r.employee.id === workerModalRow.employee.id) ?? workerModalRow}
          cycleStart={cycleStart}
          payoutDate={payoutDate}
          attendance={payrollData?.attendance?.filter((a) => a.employee === workerModalRow.employee.id) ?? []}
          upadEntries={payrollData?.upadEntries?.filter((u) => u.employee === workerModalRow.employee.id) ?? []}
          rates={payrollData?.rates?.filter((r) => r.employee === workerModalRow.employee.id) ?? []}
          periods={payrollData?.periods?.filter((p) => p.employee === workerModalRow.employee.id) ?? []}
          statements={payrollData?.statements ?? []}
          adjustments={payrollData?.adjustments?.filter((a) => a.employee === workerModalRow.employee.id) ?? []}
          settings={payrollSettings}
          onUpdateRowInput={(patch) => setRowInput(workerModalRow.employee.id, patch)}
          currentInput={entries[workerModalRow.employee.id] ?? blankInput()}
          onOpenUpad={() => {
            const target = workerModalRow
            setWorkerModalRow(null)
            setWorkerUpadTarget(target)
          }}
        />
      )}

      {/* Worker Dedicated Upad System Modal */}
      {workerUpadTarget && (
        <WorkerUpadModal
          open
          onClose={() => setWorkerUpadTarget(null)}
          row={rows.find((r) => r.employee.id === workerUpadTarget.employee.id) ?? workerUpadTarget}
          payoutDate={payoutDate}
          upadEntries={payrollData?.upadEntries?.filter((u) => u.employee === workerUpadTarget.employee.id) ?? []}
          onUpdateRecovery={(amount) => setRowInput(workerUpadTarget.employee.id, { recovery: amount })}
          currentRecovery={entries[workerUpadTarget.employee.id]?.recovery ?? ''}
          settings={payrollSettings}
        />
      )}

      {/* Confirmation Modal for Clear Today */}
      {clearConfirmOpen && (
        <Modal
          open={clearConfirmOpen}
          onClose={() => setClearConfirmOpen(false)}
          title="Clear Today's Attendance?"
        >
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              Are you sure you want to clear attendance marks for all active workers for today (
              <strong className="text-stone-900">{formatDateLong(today)}</strong>)? Any overtime and notes recorded for today will also be removed.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setClearConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setClearConfirmOpen(false)
                  bulkMutation.mutate({ date: today, status: null })
                }}
              >
                Clear Today
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {/* Late Entries Modal */}
      {lateEntriesTarget && (
        <Modal
          open={Boolean(lateEntriesTarget)}
          onClose={() => setLateEntriesTarget(null)}
          title={`${lateEntriesTarget.employee.name} — Late Attendance Entries`}
          description={`Unpaid attendance marks recorded prior to this cycle (${formatDateRange(cycleStart, gridEndDate)}). These will automatically be settled in the next payout.`}
          size="md"
          footer={
            <div className="flex justify-end w-full">
              <Button variant="secondary" onClick={() => setLateEntriesTarget(null)}>
                Close
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
              These dates are from before the open cycle grid. They flow into the worker&apos;s gross due at payout as <code className="font-mono font-bold text-amber-950">lateRows</code>. Click <strong>Edit</strong> to modify status, overtime, or clear any entry.
            </div>
            <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white overflow-hidden">
              {lateEntriesTarget.entries.map((entry) => {
                const dayStr = dateKey(entry.date)
                const rate = getRateForDate(lateEntriesTarget.employee, rates, dayStr)
                return (
                  <div key={entry.id} className="flex items-center justify-between p-3 text-xs hover:bg-stone-50 transition">
                    <div>
                      <div className="font-bold text-stone-900 flex items-center gap-1.5">
                        <span>{formatDateLong(dayStr)}</span>
                        <span className="text-stone-400 font-normal">({weekdayShort(dayStr)})</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={clsx(
                          'rounded-md px-1.5 py-0.5 font-bold uppercase text-[10px]',
                          entry.status === 'full' ? 'bg-emerald-100 text-emerald-800' :
                          entry.status === 'half' ? 'bg-amber-100 text-amber-800' :
                          entry.status === 'hours' ? 'bg-sky-100 text-sky-800' : 'bg-rose-100 text-rose-800'
                        )}>
                          {formatAttendanceLabel(entry)}
                        </span>
                        {entry.ot_minutes > 0 && (
                          <span className="rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300 px-1.5 py-0.2 font-semibold">
                            +{formatHours(entry.ot_minutes)} OT
                          </span>
                        )}
                        <span className="text-stone-500 font-medium">Rate: {formatMoney(rate)}/d</span>
                        {entry.note && (
                          <span className="text-stone-400 italic">"{entry.note}"</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const targetEmp = lateEntriesTarget.employee
                        const targetDate = dayStr
                        setLateEntriesTarget(null)
                        setEditor({ employeeId: targetEmp.id, date: targetDate })
                      }}
                      className="font-bold text-xs"
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      <span>Edit</span>
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function WorkerUpadModal({
  open,
  onClose,
  row,
  payoutDate,
  upadEntries,
  onUpdateRecovery,
  currentRecovery,
  settings,
}: {
  open: boolean
  onClose: () => void
  row: CycleRow
  payoutDate: string
  upadEntries: UpadEntry[]
  onUpdateRecovery: (amount: string) => void
  currentRecovery: string
  settings?: SettingsMap
}) {
  const upadConfig = useUpadBuckets(settings)
  const isChaluOn = upadConfig.isChaluOn
  const isMotoOn = upadConfig.isMotoOn
  const [mode, setMode] = useState<'give' | 'recover'>('give')

  // Give Upad Form
  const [giveCategory, setGiveCategory] = useState<UpadCategory>(upadConfig.singleBucket?.id === 'moto' ? 'extra' : 'regular')
  const [giveAmount, setGiveAmount] = useState('')
  const [giveNote, setGiveNote] = useState('')
  const [giveError, setGiveError] = useState('')

  // Recover / Return Form
  const [recMethod, setRecMethod] = useState<'salary' | 'cash'>('salary')
  const [recAmount, setRecAmount] = useState(currentRecovery || '')
  const [recNote, setRecNote] = useState('')
  const [recError, setRecError] = useState('')

  const queryClient = useQueryClient()
  const toast = useToast()

  useEffect(() => {
    setRecAmount(currentRecovery || '')
  }, [currentRecovery])

  const giveMutation = useMutation({
    mutationFn: async () => {
      const paise = parseMoneyInput(giveAmount)
      if (paise <= 0) throw new Error('Enter an advance amount greater than zero.')
      return createUpadEntry({
        employeeId: row.employee.id,
        date: payoutDate,
        kind: 'given',
        category: giveCategory,
        amountPaise: paise,
        note: giveNote.trim() || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      setGiveAmount('')
      setGiveNote('')
      setGiveError('')
      toast('Cash advance given successfully')
    },
    onError: (err) => setGiveError(err instanceof Error ? err.message : 'Could not record advance'),
  })

  const cashReturnMutation = useMutation({
    mutationFn: async (paise: number) => {
      return createCashReturn({
        employeeId: row.employee.id,
        date: payoutDate,
        category: 'regular',
        amountPaise: paise,
        note: recNote.trim() || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      setRecAmount('')
      setRecNote('')
      setRecError('')
      toast('Cash return recorded successfully')
    },
    onError: (err) => setRecError(err instanceof Error ? err.message : 'Could not record return'),
  })

  function handleExecuteRecoveryOrReturn() {
    const paise = parseMoneyInput(recAmount)
    if (paise < 0) return setRecError('Enter a valid amount.')

    if (recMethod === 'salary') {
      onUpdateRecovery(recAmount)
      toast(`₹${recAmount || '0'} set to recover from salary`)
      onClose()
    } else {
      if (paise <= 0) return setRecError('Enter an amount greater than zero.')
      if (paise > row.upadOutstandingPaise) {
        return setRecError(`Worker only owes ${formatMoney(row.upadOutstandingPaise)} total.`)
      }
      cashReturnMutation.mutate(paise)
    }
  }

  // Sorted recent entries (max 6)
  const sortedHistory = useMemo(() => {
    return [...upadEntries].sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 6)
  }, [upadEntries])

  const maxSalaryRecovery = Math.min(
    row.upadOutstandingPaise,
    Math.max(0, row.openingPaise + row.earnedPaise + row.adjustmentPaise),
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row.employee.name}
      description={`#${row.employee.employee_no} · ${formatMoney(row.employee.daily_rate_paise)}/d rate · Upad Management`}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose} className="w-full sm:w-auto">
          Done / Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Big Clear Upad Status Card */}
        <div className="flex items-center justify-between rounded-2xl bg-amber-50/90 border border-amber-200/90 px-4 py-3.5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Current Upad Balance
            </div>
            <div className="text-2xl font-bold text-amber-950 tabular-nums">
              {formatMoney(row.upadOutstandingPaise, { showZero: true })}
            </div>
          </div>
          <div className="text-right text-xs font-medium text-amber-900/80">
            {upadConfig.isBothOn ? (
              <>
                <div>{upadConfig.chaluLabel}: {formatMoney(row.regularUpadPaise)}</div>
                {row.extraUpadPaise > 0 && <div>{upadConfig.motoLabel}: {formatMoney(row.extraUpadPaise)}</div>}
              </>
            ) : upadConfig.isOnlyOneOn ? (
              <div>{upadConfig.singleBucket!.label}: {formatMoney(row.upadOutstandingPaise)}</div>
            ) : null}
          </div>
        </div>

        {/* Action Mode Toggle */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-xl">
          <button
            type="button"
            onClick={() => setMode('give')}
            className={clsx(
              'py-2 px-3 rounded-lg text-xs font-bold transition text-center select-none',
              mode === 'give'
                ? 'bg-white text-emerald-800 shadow-xs ring-1 ring-stone-200'
                : 'text-stone-600 hover:text-stone-900',
            )}
          >
            + Give Advance
          </button>
          <button
            type="button"
            onClick={() => setMode('recover')}
            className={clsx(
              'py-2 px-3 rounded-lg text-xs font-bold transition text-center select-none',
              mode === 'recover'
                ? 'bg-white text-rose-800 shadow-xs ring-1 ring-stone-200'
                : 'text-stone-600 hover:text-stone-900',
            )}
          >
            - Deduct / Return
          </button>
        </div>

        {/* 1. GIVE ADVANCE FORM */}
        {mode === 'give' && (
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wide mb-1.5">
                Amount to Give (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 font-bold text-lg">
                  ₹
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  autoFocus
                  value={giveAmount}
                  onChange={(e) => {
                    setGiveAmount(e.target.value)
                    setGiveError('')
                  }}
                  className="w-full rounded-xl border border-stone-300 bg-white pl-8 pr-4 py-2.5 text-xl font-bold text-stone-900 tabular-nums focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2">
              {[200, 500, 1000, 2000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setGiveAmount(String(preset))
                    setGiveError('')
                  }}
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 transition"
                >
                  +₹{preset}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wide mb-1">
                Note (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Festival advance, urgent cash, medical"
                value={giveNote}
                onChange={(e) => setGiveNote(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            {giveError && (
              <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {giveError}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-amber-50/80 rounded-xl px-3 py-2 border border-amber-200/60 font-medium">
              <CheckCircle2 className="h-4 w-4 text-amber-700 shrink-0" />
              <span>Advances given automatically carry forward across cycles until deducted from salary or returned in cash.</span>
            </div>

            <Button
              variant="emerald"
              size="lg"
              onClick={() => giveMutation.mutate()}
              loading={giveMutation.isPending}
              disabled={!giveAmount || parseMoneyInput(giveAmount) <= 0}
              className="w-full h-11 text-sm font-bold shadow-sm"
            >
              <HandCoins className="h-4 w-4" />
              <span>Give ₹{giveAmount || '0'} Advance</span>
            </Button>
          </div>
        )}

        {/* 2. RECOVER / RETURN FORM */}
        {mode === 'recover' && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRecMethod('salary')}
                className={clsx(
                  'rounded-xl border p-2.5 text-left text-xs transition',
                  recMethod === 'salary'
                    ? 'border-emerald-600 bg-emerald-50/80 font-bold text-emerald-950 ring-1 ring-emerald-600'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
                )}
              >
                <div className="font-bold text-xs">Deduct from Salary</div>
                <div className="text-[11px] text-stone-500 font-normal">Recovers in cycle settlement</div>
              </button>
              <button
                type="button"
                onClick={() => setRecMethod('cash')}
                className={clsx(
                  'rounded-xl border p-2.5 text-left text-xs transition',
                  recMethod === 'cash'
                    ? 'border-sky-600 bg-sky-50/80 font-bold text-sky-950 ring-1 ring-sky-600'
                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
                )}
              >
                <div className="font-bold text-xs">Worker Return Cash</div>
                <div className="text-[11px] text-stone-500 font-normal">Handed cash back at counter</div>
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wide mb-1.5">
                {recMethod === 'salary' ? 'Amount to Deduct from Salary (₹)' : 'Cash Amount Returned (₹)'}
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 font-bold text-lg">
                  ₹
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  autoFocus
                  value={recAmount}
                  onChange={(e) => {
                    setRecAmount(e.target.value)
                    setRecError('')
                  }}
                  className="w-full rounded-xl border border-stone-300 bg-white pl-8 pr-4 py-2.5 text-xl font-bold text-stone-900 tabular-nums focus:border-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-600/20"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2">
              {[
                row.upadOutstandingPaise,
                maxSalaryRecovery,
                50000,
                100000,
              ]
                .filter((v, i, l) => v > 0 && l.indexOf(v) === i)
                .map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setRecAmount(paiseToInput(preset))
                      setRecError('')
                    }}
                    className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 transition"
                  >
                    {preset === row.upadOutstandingPaise
                      ? `Full (${formatMoney(row.upadOutstandingPaise)})`
                      : preset === maxSalaryRecovery
                        ? `Max Wage (${formatMoney(maxSalaryRecovery)})`
                        : formatMoney(preset)}
                  </button>
                ))}
              {recMethod === 'salary' && (
                <button
                  type="button"
                  onClick={() => {
                    setRecAmount('0')
                    setRecError('')
                  }}
                  className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-500 hover:bg-stone-100 transition"
                >
                  Clear (₹0)
                </button>
              )}
            </div>

            {recMethod === 'cash' && (
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wide mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. handed cash at counter"
                  value={recNote}
                  onChange={(e) => setRecNote(e.target.value)}
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-rose-600 focus:outline-none"
                />
              </div>
            )}

            {recError && (
              <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {recError}
              </div>
            )}

            {recMethod === 'salary' && row.upadOutstandingPaise > maxSalaryRecovery && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-900 bg-amber-50/90 rounded-xl px-3 py-2 border border-amber-200/80 font-medium">
                <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
                <span>Worker is over-advanced. Max recoverable from salary is {formatMoney(maxSalaryRecovery)}. Remaining {formatMoney(row.upadOutstandingPaise - maxSalaryRecovery)} carries forward to next cycle.</span>
              </div>
            )}

            <Button
              variant={recMethod === 'salary' ? 'emerald' : 'secondary'}
              size="lg"
              onClick={handleExecuteRecoveryOrReturn}
              loading={cashReturnMutation.isPending}
              disabled={!recAmount}
              className="w-full h-11 text-sm font-bold shadow-sm"
            >
              <span>
                {recMethod === 'salary'
                  ? `Deduct ₹${recAmount || '0'} from Salary`
                  : `Save ₹${recAmount || '0'} Cash Return`}
              </span>
            </Button>
          </div>
        )}

        {/* Worker Upad History */}
        <div className="border-t border-stone-200 pt-3">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">
            <div className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-stone-500" />
              <span>Recent Upad History</span>
            </div>
            <span className="text-[11px] text-stone-400 font-normal">Last {sortedHistory.length}</span>
          </div>

          {sortedHistory.length > 0 ? (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {sortedHistory.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-2 px-3 rounded-xl bg-stone-50 border border-stone-100 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase',
                        item.kind === 'given'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-900',
                      )}
                    >
                      {item.kind === 'given' ? 'Advance' : item.kind === 'returned' ? 'Cash Return' : 'Salary Rec.'}
                    </span>
                    <span className="font-semibold text-stone-800">{item.note || 'Upad'}</span>
                    <span className="text-stone-400 font-medium text-[11px]">{formatDateShort(item.date)}</span>
                  </div>
                  <span
                    className={clsx(
                      'font-bold tabular-nums text-sm',
                      item.kind === 'given' ? 'text-amber-800' : 'text-emerald-700',
                    )}
                  >
                    {item.kind === 'given' ? `+${formatMoney(item.amount_paise)}` : `-${formatMoney(item.amount_paise)}`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-stone-400 py-1.5 text-center">No recent transactions.</div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function AttendanceEditor({
  open,
  onClose,
  employee,
  date,
  record,
  ratePaise,
  divisor,
}: {
  open: boolean
  onClose: () => void
  employee: Employee
  date: string
  record?: Attendance
  ratePaise: number
  divisor: number
}) {
  const [status, setStatus] = useState<AttendanceStatus | null>(record?.status ?? 'full')
  const [workedHours, setWorkedHours] = useState(
    record?.status === 'hours' && record.worked_minutes ? String(record.worked_minutes / 60) : '3'
  )
  const [ot, setOt] = useState(String(record?.ot_minutes ?? 0))
  const [note, setNote] = useState(record?.note ?? '')
  const toast = useToast()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (mode: 'save' | 'clear') => {
      if (mode === 'clear' || !status) {
        if (record) await deleteAttendance(record.id)
        return
      }
      const parsedHours = Number.parseFloat(workedHours) || 3
      const wm = status === 'hours' ? Math.round(parsedHours * 60) : undefined
      await saveAttendance({
        employeeId: employee.id,
        date,
        status,
        workedMinutes: wm,
        otMinutes: Math.max(0, Number.parseInt(ot, 10) || 0),
        existingId: record && !record.id.startsWith('temp-') ? record.id : undefined,
        note,
      })
    },
    onSuccess: (_data, mode) => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast(mode === 'clear' ? 'Attendance cleared' : 'Attendance updated')
      onClose()
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Could not save attendance', 'error'),
  })

  const otMinutes = Math.max(0, Number.parseInt(ot, 10) || 0)
  const parsedHours = Number.parseFloat(workedHours) || 3
  const wm = status === 'hours' ? Math.round(parsedHours * 60) : undefined
  const pay = dayPayPaise(status || '', otMinutes, ratePaise, divisor, wm)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${employee.name} · ${formatDateShort(date)}`}
      description={`${weekdayShort(date)} · ${formatMoney(ratePaise)} daily rate`}
      footer={
        <>
          {record && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600 hover:bg-rose-50"
              onClick={() => {
                if (record.id.startsWith('temp-')) return
                mutation.mutate('clear')
              }}
              loading={mutation.isPending}
            >
              <Trash2 className="h-4 w-4" /> Clear
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate('save')} loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {(['full', 'half', 'absent', 'hours'] as AttendanceStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={clsx(
                'rounded-2xl border p-2.5 text-center transition-all',
                status === value
                  ? value === 'full'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                    : value === 'half'
                      ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-500/20'
                      : value === 'absent'
                        ? 'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-500/20'
                        : 'border-sky-500 bg-sky-50 text-sky-900 ring-2 ring-sky-500/20'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300',
              )}
            >
              <div className="text-lg font-black">{STATUS_LABEL[value]}</div>
              <div className="mt-0.5 text-[11px] font-bold">
                {value === 'hours' ? 'Hours' : STATUS_NAME[value].split(' ')[0]}
              </div>
            </button>
          ))}
        </div>

        {status === 'hours' && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-950">Worked Hours (1 to 7)</span>
              <span className="text-xs font-bold text-sky-700">{parsedHours} hrs ({Math.round(parsedHours * 60)} min)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setWorkedHours(String(h))}
                  className={clsx(
                    'h-7 min-w-[2rem] px-2 rounded-lg text-xs font-bold transition border cursor-pointer',
                    Number.parseFloat(workedHours) === h
                      ? 'border-sky-600 bg-sky-600 text-white shadow-2xs'
                      : 'border-sky-200 bg-white text-sky-900 hover:bg-sky-100',
                  )}
                >
                  {h}h
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] text-stone-500 font-medium">Or type exact hours:</span>
              <Input
                type="number"
                min={0.5}
                max={7.5}
                step={0.5}
                value={workedHours}
                onChange={(e) => setWorkedHours(e.target.value)}
                className="w-24 text-center text-xs font-bold"
              />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Overtime Minutes" hint={`Based on ${divisor}h shift.`}>
            <Input
              type="number"
              min={0}
              max={360}
              step={15}
              value={ot}
              onChange={(event) => setOt(event.target.value)}
            />
          </Field>
          <Field label="Quick OT Presets">
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[0, 60, 120, 180, 240].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setOt(String(minutes))}
                  className={clsx(
                    'rounded-xl border px-2.5 py-1 text-xs font-bold transition',
                    otMinutes === minutes
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300',
                  )}
                >
                  {minutes === 0 ? '0 OT' : formatHours(minutes)}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Day Note" hint="Optional note">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. late arrival, half day"
          />
        </Field>

        <div className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5">
          <span className="text-xs font-bold uppercase text-stone-500">Day Wage Pay</span>
          <span className="text-base font-black text-stone-900 tabular-nums">{formatMoney(pay)}</span>
        </div>

        <Field label="Select Status">
          <Select
            value={status ?? ''}
            onChange={(event) => setStatus((event.target.value || null) as CycleStatus)}
          >
            <option value="">No record / Blank (no pay)</option>
            <option value="full">Full day (P)</option>
            <option value="half">Half day (H)</option>
            <option value="absent">Absent (A)</option>
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function CashReturnModal({
  open,
  onClose,
  employee,
  row,
  initialCategory,
  payoutDate,
  settings,
}: {
  open: boolean
  onClose: () => void
  employee: Employee
  row: CycleRow
  initialCategory: UpadCategory
  payoutDate: string
  settings?: SettingsMap
}) {
  const upadConfig = useUpadBuckets(settings)
  const isChaluOn = upadConfig.isChaluOn
  const isMotoOn = upadConfig.isMotoOn
  const effectiveInitial = !isChaluOn ? 'extra' : !isMotoOn ? 'regular' : initialCategory
  const [category, setCategory] = useState<UpadCategory>(effectiveInitial)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const toast = useToast()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!open) return
    setCategory(initialCategory)
    setAmount('')
    setNote('')
    setError('')
  }, [open, initialCategory, employee.id])

  const balance = category === 'regular' ? row.regularUpadPaise : row.extraUpadPaise

  const mutation = useMutation({
    mutationFn: () =>
      createCashReturn({
        employeeId: employee.id,
        date: payoutDate,
        amountPaise: parseMoneyInput(amount),
        category,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast('Cash return recorded successfully')
      onClose()
    },
    onError: (errorValue) =>
      setError(errorValue instanceof Error ? errorValue.message : 'Could not save cash return'),
  })

  function submit() {
    const paise = parseMoneyInput(amount)
    if (paise <= 0) return setError('Enter an amount greater than zero.')
    if (paise > balance) {
      return setError(`Only ${formatMoney(balance, { showZero: true })} is outstanding in this category.`)
    }
    setError('')
    mutation.mutate()
  }

  const presets = [50000, 100000, balance].filter(
    (value, index, list) => value > 0 && list.indexOf(value) === index,
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Cash Return"
      description={`${employee.name} · Lowers worker's upad advance directly.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Save Cash Return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isChaluOn && isMotoOn && (
          <div className="grid grid-cols-2 gap-2.5">
            {(['regular', 'extra'] as UpadCategory[]).map((value) => {
              const valueBalance = value === 'regular' ? row.regularUpadPaise : row.extraUpadPaise
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setCategory(value)
                    setAmount('')
                    setError('')
                  }}
                  className={clsx(
                    'rounded-2xl border p-3 text-left transition',
                    category === value
                      ? 'border-sky-600 bg-sky-50 ring-2 ring-sky-600/20'
                      : 'border-stone-200 bg-white hover:border-stone-300',
                  )}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    {value === 'regular' || value === 'chalu' ? upadConfig.chaluLabel : upadConfig.motoLabel}
                  </div>
                  <div className="mt-0.5 text-base font-black text-stone-900 tabular-nums">
                    {formatMoney(valueBalance, { showZero: true })}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <Field
          label="Amount Returned (₹)"
          hint={`Date: ${formatDateShort(payoutDate)} · Upad balance only`}
        >
          <Input
            inputMode="decimal"
            autoFocus
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              setError('')
            }}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setAmount(paiseToInput(preset))
                setError('')
              }}
              className="rounded-xl border border-stone-200 bg-white px-3 py-1 text-xs font-bold text-stone-700 hover:border-sky-300 hover:bg-sky-50"
            >
              {preset === balance ? `Full ${formatMoney(balance)}` : formatMoney(preset)}
            </button>
          ))}
        </div>

        <Field label="Note" hint="Optional">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. handed cash at the counter"
          />
        </Field>

        {row.returnedUpadPaise > 0 && (
          <div className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
            Already returned this cycle: {formatMoney(row.returnedUpadPaise)}.
          </div>
        )}

        {error && <div className="text-xs font-bold text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}
