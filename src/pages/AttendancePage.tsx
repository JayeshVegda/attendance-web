import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
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
  createPayout,
  createUpadEntry,
  deleteAdjustment,
  deleteAttendance,
  getPayrollData,
  getSettings,
  listEmployees,
  listRuns,
  saveAttendance,
} from '../lib/api'
import { cycleStartFor, lastPayoutDate, otDivisor } from '../lib/cycle'
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
import type { Adjustment, Attendance, AttendanceStatus, CycleRow, Employee, UpadCategory, UpadEntry } from '../lib/types'
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
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  full: 'P',
  half: 'H',
  absent: 'A',
}

const STATUS_NAME: Record<AttendanceStatus, string> = {
  full: 'Full day (P)',
  half: 'Half day (H)',
  absent: 'Absent (A)',
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
  const [workerUpadTarget, setWorkerUpadTarget] = useState<CycleRow | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [note, setNote] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('today')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'active' | 'unmarkedToday'>('all')
  const [bulkMenuDate, setBulkMenuDate] = useState<string | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const bulkMenuRef = useRef<HTMLDivElement>(null)

  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  const toast = useToast()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })

  const cycleStart =
    settingsQuery.data && runsQuery.isSuccess
      ? cycleStartFor(runsQuery.data ?? [], settingsQuery.data)
      : ''

  const validRange = Boolean(cycleStart && payoutDate && cycleStart <= payoutDate)
  const payrollKey = ['payroll', cycleStart, payoutDate] as const
  const payrollQuery = useQuery({
    queryKey: payrollKey,
    queryFn: () => getPayrollData(cycleStart, payoutDate),
    enabled: validRange,
  })

  useEffect(() => {
    setEntries({})
    setPreviewOpen(false)
    setCashTarget(null)
    setNote('')
  }, [cycleStart, payoutDate])

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
  const rates = payrollData?.rates ?? []
  const attendance = payrollData?.attendance ?? []

  const days = useMemo(() => {
    if (!validRange) return []
    const length = Math.max(1, daysBetweenInclusive(cycleStart, payoutDate))
    return Array.from({ length }, (_, index) => addDays(cycleStart, index))
  }, [validRange, cycleStart, payoutDate])

  const attendanceMap = useMemo(() => {
    const map = new Map<string, Attendance>()
    for (const entry of attendance) map.set(keyFor(entry.employee, entry.date), entry)
    return map
  }, [attendance])

  const baseRows = useMemo(() => {
    if (!payrollData) return []
    return buildCycleRows(payrollData, cycleStart, payoutDate)
  }, [payrollData, cycleStart, payoutDate])

  const rows = useMemo(() => adjustRows(baseRows, entries), [baseRows, entries])
  const today = todayKey()

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
      let ot = 0
      for (const row of rows) {
        const record = attendanceMap.get(keyFor(row.employee.id, day))
        if (!record) continue
        if (record.status === 'full') present += 1
        else if (record.status === 'half') half += 1
        else if (record.status === 'absent') absent += 1
        ot += record.ot_minutes || 0
      }
      return { present, half, absent, ot }
    })
  }, [days, rows, attendanceMap])

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
                ? { ...entry, status: input.status!, ot_minutes: input.otMinutes }
                : entry,
            ),
          }
        }
        const optimistic: Attendance = {
          id: `temp-${input.employeeId}-${input.date}`,
          employee: input.employeeId,
          date: input.date,
          status: input.status!,
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
    mutationFn: () =>
      createPayout({
        cycleStart,
        payoutDate,
        rows,
        note: note.trim(),
      }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      queryClient.invalidateQueries({ queryKey: ['statements'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast('Payout saved and cycle closed successfully')
      setPreviewOpen(false)
      onNavigate(`reports/${run.id}`)
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
      <PageHeader
        title="Attendance & Payout"
        description="Daily attendance register, upad recovery, overtime tracking, and end-of-cycle salary settlement."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setUpadEmployee(undefined)
                setUpadOpen(true)
              }}
            >
              <HandCoins className="h-4 w-4 text-amber-700" />
              <span>Give Upad</span>
            </Button>
            <Button
              variant="emerald"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              disabled={!rows.length || !validRange}
            >
              <Wallet className="h-4 w-4" />
              <span>Close & Pay Cycle</span>
            </Button>
          </>
        }
      />

      {/* Register Controls Toolbar */}
      <Card className="mb-3 p-2.5">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Tabs */}
            <Tabs
              value={viewMode}
              onChange={(mode) => setViewMode(mode as ViewMode)}
              options={[
                { id: 'today', label: "Today's Roll Call", icon: <CalendarCheck className="h-3.5 w-3.5" /> },
                { id: 'cycle', label: 'Cycle Register', icon: <CalendarDays className="h-3.5 w-3.5" /> },
              ]}
            />

            {/* Quick status filter */}
            <div className="flex items-center gap-0.5 rounded-xl border border-stone-200/90 bg-stone-100/80 p-0.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className={clsx(
                  'rounded-lg px-2.5 py-1 transition-all',
                  filterType === 'all'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900',
                )}
              >
                All ({rows.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType('active')}
                className={clsx(
                  'rounded-lg px-2.5 py-1 transition-all',
                  filterType === 'active'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900',
                )}
              >
                Active ({rows.filter((r) => r.employee.active).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterType('unmarkedToday')}
                className={clsx(
                  'rounded-lg px-2.5 py-1 transition-all',
                  filterType === 'unmarkedToday'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900',
                )}
                title="Workers without an attendance mark today"
              >
                Unmarked Today
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-full sm:w-56">
              <SearchInput
                placeholder="Search worker…"
                value={search}
                onChange={setSearch}
              />
            </div>
            <span className="text-[11px] font-bold text-stone-500 shrink-0 hidden sm:inline">
              OT divisor: <strong className="text-stone-900">{divisor}h</strong>
            </span>
          </div>
        </div>
      </Card>

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
            {/* Quick Bulk Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 bg-stone-50/80 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-stone-900">
                  {formatDateLong(today)}
                </span>
                <Badge tone="green" dot>
                  {todayStats.marked} / {todayStats.activeTotal} Marked
                </Badge>
              </div>
              <div className="flex items-center gap-2">
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

            {/* List of Workers */}
            {displayRows.map((row) => {
              const { employee } = row
              const record = attendanceMap.get(keyFor(employee.id, today))
              const status = record?.status
              const hasOt = record && record.ot_minutes > 0

              return (
                <div
                  key={employee.id}
                  className={clsx(
                    'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:px-4 transition-colors hover:bg-stone-50/80',
                    !employee.active && 'bg-stone-50/40 opacity-75',
                  )}
                >
                  {/* Worker Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={employee.name} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setWorkerModalRow(row)}
                          className="truncate text-xs font-semibold text-stone-900 hover:text-emerald-700 text-left cursor-pointer"
                        >
                          {employee.name}
                        </button>
                        <span className="text-[10px] font-medium text-stone-400">
                          #{employee.employee_no}
                        </span>
                        {!employee.active && (
                          <Badge tone="neutral">Inactive</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] font-medium text-stone-500">
                        <span className="font-semibold text-stone-700">
                          {formatMoney(employee.daily_rate_paise)}/d
                        </span>
                        <span className="text-stone-300">·</span>
                        <span>{row.daysWorked}d worked ({formatMoney(row.earnedPaise)})</span>
                        {row.upadOutstandingPaise > 0 && (
                          <>
                            <span className="text-stone-300">·</span>
                            <span className="font-semibold text-amber-700">
                              {formatMoney(row.upadOutstandingPaise)} upad
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 1-Tap Mark Buttons */}
                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
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
                        'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all active:scale-95 border select-none',
                        status === 'full'
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-300 hover:bg-emerald-50/60',
                      )}
                    >
                      <span className="font-bold">P</span>
                      <span>Present</span>
                    </button>

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
                        'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all active:scale-95 border select-none',
                        status === 'half'
                          ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-amber-300 hover:bg-amber-50/60',
                      )}
                    >
                      <span className="font-bold">H</span>
                      <span>Half</span>
                    </button>

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
                        'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all active:scale-95 border select-none',
                        status === 'absent'
                          ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-rose-300 hover:bg-rose-50/60',
                      )}
                    >
                      <span className="font-bold">A</span>
                      <span>Absent</span>
                    </button>

                    {/* Overtime & Note Button (Fixed Width so P/H/A buttons align across rows) */}
                    <button
                      type="button"
                      onClick={() => setEditor({ employeeId: employee.id, date: today })}
                      className={clsx(
                        'flex items-center justify-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all border w-24 shrink-0',
                        hasOt
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-800',
                      )}
                      title="Add overtime or note"
                    >
                      <span className="truncate">{hasOt ? `+${formatHours(record.ot_minutes)} OT` : '+ OT'}</span>
                    </button>

                    {/* Quick Give Upad */}
                    <button
                      type="button"
                      onClick={() => setWorkerUpadTarget(row)}
                      className="inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100/80 transition shrink-0"
                      title="Manage Upad"
                    >
                      <HandCoins className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-bold hidden sm:inline">+ Upad</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {/* Step 1 Header Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50 to-stone-50 px-4 py-3 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-emerald-700 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                    Step 1: Check Attendance
                  </span>
                  <span className="font-extrabold text-stone-900">
                    Cycle {formatDateRange(cycleStart, payoutDate)}
                  </span>
                  {lastPayout && (
                    <span className="text-[11px] text-stone-500 font-medium hidden sm:inline">
                      · Last payout closed {formatDateShort(lastPayout)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-stone-600">
                  <span>Verify marks below. Unmarked days are highlighted. When attendance is verified, proceed to Step 2.</span>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => onNavigate('payout')}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold shrink-0 shadow-xs"
              >
                <span>Issue Payout (Step 2)</span>
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>

            <div className="table-scroll max-h-[calc(100vh-23rem)] pb-24">
            <table className="w-full min-w-max border-separate border-spacing-0 text-xs attendance-grid">
              <thead>
                <tr>
                  {/* Sticky Employee Header */}
                  <th className="sticky left-0 top-0 z-30 min-w-[14.5rem] border-b border-stone-200 bg-stone-100 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-700">
                    Worker
                  </th>

                  {/* Daily Date Columns */}
                  {days.map((day, dIdx) => {
                      const isToday = day === today
                      const isFri = isFriday(day)
                      const dayTotal = dailyTotals[dIdx]
                      // Only show OFF when 0 workers were marked on Friday (truly closed day)
                      const isClosedDay = isFri && (!dayTotal || (dayTotal.present === 0 && dayTotal.half === 0))
                      const isBulkOpen = bulkMenuDate === day
                      return (
                        <th
                          key={day}
                          className={clsx(
                            'sticky top-0 z-10 min-w-[4.8rem] border-b border-l border-stone-200 px-1 py-1.5 text-center',
                            isToday
                              ? 'bg-emerald-50 text-emerald-950 font-bold'
                              : isClosedDay
                                ? 'bg-amber-50/70 text-amber-950'
                                : 'bg-stone-50 text-stone-800',
                          )}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span
                              className={clsx(
                                'text-[10px] font-semibold uppercase',
                                isToday ? 'text-emerald-700' : isClosedDay ? 'text-amber-700' : 'text-stone-500',
                              )}
                            >
                              {weekdayShort(day)}
                            </span>
                            {isClosedDay && (
                              <span className="rounded bg-amber-200 px-1 text-[8px] font-bold text-amber-900">
                                OFF
                              </span>
                            )}
                          </div>

                          <div
                            className={clsx(
                              'text-xs font-bold tabular-nums',
                              isToday ? 'text-emerald-900' : 'text-stone-900',
                            )}
                          >
                            {Number(day.slice(8, 10))}
                          </div>

                          <div className="relative mt-0.5 flex items-center justify-center">
                            {isToday ? (
                              <span className="rounded-full bg-emerald-700 px-1.5 py-0.2 text-[8px] font-bold text-white">
                                Today
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setBulkMenuDate(isBulkOpen ? null : day)}
                                className="rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
                                title={`Bulk fill for ${formatDateShort(day)}`}
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            )}

                            {/* Bulk Action Popover */}
                            {isBulkOpen && (
                              <div
                                ref={bulkMenuRef}
                                className="absolute left-1/2 top-full z-40 mt-1 w-44 -translate-x-1/2 rounded-xl border border-stone-200 bg-white p-1 text-left shadow-lg"
                              >
                                <div className="px-2 py-0.5 text-[9px] font-bold uppercase text-stone-400">
                                  {formatDateShort(day)}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => bulkMutation.mutate({ date: day, status: 'full' })}
                                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                  Mark all Present (P)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => bulkMutation.mutate({ date: day, status: 'absent' })}
                                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-50"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                                  Mark all Absent (A)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => bulkMutation.mutate({ date: day, status: null })}
                                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  Clear day
                                </button>
                              </div>
                            )}
                          </div>
                        </th>
                      )
                    })}

                  {/* Summary Columns for Step 1 Check Attendance */}
                  <th className="sticky top-0 z-10 min-w-[5.5rem] border-b border-l border-stone-200 bg-stone-100 px-2.5 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-stone-600">
                    Days & OT
                  </th>
                  <th className="sticky top-0 z-10 min-w-[6.5rem] border-b border-l border-stone-200 bg-stone-100 px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-stone-600">
                    Owed Now
                  </th>
                  <th className="sticky top-0 z-10 min-w-[6.5rem] border-b border-l border-stone-200 bg-stone-100 px-2.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-stone-600">
                    Upad Bal
                  </th>
                  <th className="sticky top-0 z-10 min-w-[7.5rem] border-b border-l border-stone-200 bg-stone-100 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-stone-100">
                {displayRows.map((row) => {
                  const { employee } = row
                  const owedNow = row.openingPaise + row.earnedPaise + row.adjustmentPaise

                  return (
                    <tr
                      key={employee.id}
                      className={clsx(
                        'transition-colors hover:bg-stone-50/80',
                        !employee.active && 'bg-stone-50/50 opacity-75',
                      )}
                    >
                      {/* Sticky Worker Name Column */}
                      <td
                        className={clsx(
                          'sticky left-0 z-20 border-b border-stone-200 px-3.5 py-2 shadow-[1px_0_0_0_#e2e8f0]',
                          !employee.active ? 'bg-stone-50' : 'bg-white',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setWorkerModalRow(row)}
                          className="flex w-full items-center gap-2.5 text-left group cursor-pointer"
                          title="Click to view worker cycle details & adjustments"
                        >
                          <Avatar name={employee.name} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-xs font-semibold text-stone-900 group-hover:text-emerald-700">
                                {employee.name}
                              </span>
                              {!employee.active && (
                                <span className="rounded bg-stone-100 px-1 text-[9px] font-medium text-stone-500">
                                  Inactive
                                </span>
                              )}
                            </div>

                            {/* Summary details */}
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                              <span className="font-medium text-stone-400">
                                #{employee.employee_no}
                              </span>
                              <span className="text-stone-300">·</span>
                              <span className="font-semibold text-stone-700">
                                {formatMoney(employee.daily_rate_paise)}/d
                              </span>
                              <span className="text-stone-300">·</span>
                              <span className={clsx(
                                'font-semibold',
                                row.upadOutstandingPaise > 0 ? 'text-amber-700' : 'text-stone-400'
                              )}>
                                Upad: {formatMoney(row.upadOutstandingPaise)}
                              </span>
                            </div>
                          </div>
                        </button>
                      </td>

                      {/* Attendance Grid Cells */}
                      {days.map((day) => {
                          const record = attendanceMap.get(keyFor(employee.id, day))
                          const rate = getRateForDate(employee, rates, day)
                          const hasNote = Boolean(record?.note)
                          const hasOt = record && record.ot_minutes > 0
                          const isFri = isFriday(day)
                          const isSettled = Boolean(record?.settled_payout)
                          const isUnmarked = !record?.status && day <= today && employee.active && (!employee.joined_on || employee.joined_on <= day)

                          return (
                            <td
                              key={day}
                              className={clsx(
                                'border-b border-l border-stone-100 p-1 text-center',
                                isFri && !record && 'bg-amber-50/20',
                              )}
                            >
                              <div className="group relative">
                                {isSettled ? (
                                  <button
                                    type="button"
                                    disabled
                                    title={`Settled in payout on ${formatDateShort(day)}. Locked.`}
                                    className={clsx(
                                      'cell-button relative flex flex-col items-center justify-center h-10 w-full rounded-xl border text-xs font-bold select-none opacity-80 cursor-not-allowed',
                                      cellStyle(record?.status),
                                    )}
                                  >
                                    <span className="text-xs font-bold leading-tight flex items-center gap-0.5">
                                      {record ? STATUS_LABEL[record.status] : '—'}
                                      <Lock className="h-2.5 w-2.5 text-stone-400" />
                                    </span>
                                    {hasOt && (
                                      <span className="mt-0.5 inline-flex items-center rounded px-1 py-0.2 text-[9px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300/80 tabular-nums leading-none">
                                        +{formatHours(record.ot_minutes)}
                                      </span>
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => cycleCell(employee, day)}
                                    onContextMenu={(event) => {
                                      event.preventDefault()
                                      setEditor({ employeeId: employee.id, date: day })
                                    }}
                                    title={`${employee.name} · ${weekdayShort(day)} ${formatDateShort(day)}\nRate: ${formatMoney(rate)}/d\nStatus: ${record ? STATUS_NAME[record.status] : 'Blank (no pay)'}`}
                                    className={clsx(
                                      'cell-button relative flex flex-col items-center justify-center h-10 w-full rounded-xl border text-xs font-bold transition-all select-none',
                                      cellStyle(record?.status),
                                      isUnmarked && 'border-dashed border-amber-400/90 bg-amber-50/30',
                                    )}
                                  >
                                    <span className="text-xs font-bold leading-tight">
                                      {record ? STATUS_LABEL[record.status] : '—'}
                                    </span>

                                    {/* Clean OT Pill */}
                                    {hasOt && (
                                      <span className="mt-0.5 inline-flex items-center rounded px-1 py-0.2 text-[9px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300/80 tabular-nums leading-none">
                                        +{formatHours(record.ot_minutes)}
                                      </span>
                                    )}

                                    {/* Note Indicator Dot */}
                                    {hasNote && (
                                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    )}
                                  </button>
                                )}

                                {/* Hover Pencil Edit Button */}
                                {!isSettled && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setEditor({ employeeId: employee.id, date: day })
                                    }}
                                    className="absolute -right-1 -top-1 hidden rounded-full border border-stone-200 bg-white p-1 text-stone-500 shadow-sm hover:text-emerald-700 group-hover:block transition z-10"
                                    aria-label={`Edit ${employee.name} on ${formatDateShort(day)}`}
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          )
                        })}

                      {/* Summary Days Column */}
                      <td className="border-b border-l border-stone-100 px-2 py-2 text-center">
                        <div className="text-xs font-bold text-stone-900 tabular-nums">
                          {row.daysWorked} d
                        </div>
                        <div className="text-[10px] font-medium text-stone-500 tabular-nums mt-0.5">
                          {row.otMinutes > 0 ? (
                            <span className="text-emerald-700 font-semibold">+{formatHours(row.otMinutes)} OT</span>
                          ) : (
                            <span>0 hr OT</span>
                          )}
                        </div>
                      </td>

                      {/* Owed Now (Salary + Carry + Adjustments) */}
                      <td className="border-b border-l border-stone-100 px-2.5 py-2 text-right">
                        <div className="text-xs font-bold text-stone-900 tabular-nums">
                          {formatMoney(owedNow, { showZero: true })}
                        </div>
                        {row.openingPaise > 0 ? (
                          <div
                            className="text-[10px] font-semibold text-sky-800 tabular-nums"
                            title="Unpaid salary carried forward from last cycle"
                          >
                            +{formatMoney(row.openingPaise)} Baki
                          </div>
                        ) : (
                          <div className="text-[10px] text-stone-400 tabular-nums">
                            {formatMoney(row.earnedPaise)} cycle
                          </div>
                        )}
                      </td>

                      {/* Upad Button Column */}
                      <td className="border-b border-l border-stone-100 px-2.5 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setWorkerUpadTarget(row)}
                          className={clsx(
                            'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition border select-none tabular-nums',
                            row.upadOutstandingPaise > 0
                              ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 shadow-2xs'
                              : 'border-stone-200 bg-stone-50/80 text-stone-500 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800',
                          )}
                          title={`Manage upad for ${employee.name}`}
                        >
                          <HandCoins className="h-3 w-3 text-amber-700" />
                          <span>{row.upadOutstandingPaise > 0 ? formatMoney(row.upadOutstandingPaise) : '+ Upad'}</span>
                        </button>
                      </td>

                      {/* Pay Worker Action (Navigates to Payout Screen for this worker) */}
                      <td className="border-b border-l border-stone-100 px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => onNavigate(`payout?worker=${employee.id}`)}
                          className="inline-flex items-center justify-center gap-1 w-full rounded-xl px-2.5 py-1.5 text-xs font-bold transition border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs"
                          title={`Open payout screen for ${employee.name}`}
                        >
                          <span>Pay Worker</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Table Footer Totals (Opaque background so text never bleeds through) */}
              <tfoot>
                <tr className="bg-stone-100 font-bold text-stone-900 border-t border-stone-300">
                  <td className="sticky bottom-0 left-0 z-30 border-t border-stone-300 bg-stone-100 px-3.5 py-2.5 text-xs uppercase tracking-wider text-stone-800 shadow-[1px_0_0_0_#cbd5e1]">
                    Cycle Total ({rows.length})
                  </td>

                  {dailyTotals.map((total, index) => (
                    <td
                      key={days[index]}
                      className="sticky bottom-0 z-10 border-l border-t border-stone-300 bg-stone-100 px-1 py-1.5 text-center"
                    >
                      <div className="text-[10px] font-bold text-stone-800 tabular-nums">
                        {total.present} P
                      </div>
                      <div className="text-[9px] font-semibold text-stone-500 tabular-nums">
                        {total.ot > 0 ? `+${formatHours(total.ot)}` : '—'}
                      </div>
                    </td>
                  ))}

                  <td className="sticky bottom-0 z-10 border-l border-t border-stone-300 bg-stone-100 px-2 py-2 text-center text-xs font-bold text-stone-800 tabular-nums">
                    <div>{rows.reduce((sum, r) => sum + r.daysWorked, 0)} d</div>
                    {rows.reduce((sum, r) => sum + r.otMinutes, 0) > 0 && (
                      <div className="text-[10px] text-emerald-800 font-semibold">
                        +{formatHours(rows.reduce((sum, r) => sum + r.otMinutes, 0))} OT
                      </div>
                    )}
                  </td>

                  <td className="sticky bottom-0 z-10 border-l border-t border-stone-300 bg-stone-100 px-2.5 py-2 text-right text-xs font-bold text-stone-950 tabular-nums">
                    {formatMoney(totals.opening + totals.earned + totals.adjustment, { showZero: true })}
                  </td>
                  <td className="sticky bottom-0 z-10 border-l border-t border-stone-300 bg-amber-100 px-2.5 py-2 text-right text-xs font-bold text-amber-900 tabular-nums">
                    {totals.outstanding > 0 ? formatMoney(totals.outstanding, { showZero: true }) : '—'}
                  </td>
                  <td className="sticky bottom-0 z-10 border-l border-t border-stone-300 bg-emerald-100 px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onNavigate('payout')}
                      className="inline-flex items-center gap-1 text-xs font-bold text-emerald-900 hover:text-emerald-700"
                    >
                      <span>Pay All</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      </Card>

      {/* Legend & Guide footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <span className="h-3 w-3 rounded-md border border-emerald-400 bg-emerald-100" />
            <strong className="text-stone-800">P</strong> = Full day
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <span className="h-3 w-3 rounded-md border border-amber-400 bg-amber-100" />
            <strong className="text-stone-800">H</strong> = Half day
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <span className="h-3 w-3 rounded-md border border-rose-400 bg-rose-100" />
            <strong className="text-stone-800">A</strong> = Absent
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <span className="h-3 w-3 rounded-md border border-stone-300 bg-stone-50" />
            <strong className="text-stone-800">—</strong> = Blank (no pay)
          </span>
        </div>
        <div className="text-[11px] text-stone-400 font-medium">
          Click cell to cycle · Right-click or pencil for OT & Notes
        </div>
      </div>

      {/* Cycle Summary & Settlement Box */}
      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          {/* Summary Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            {/* 1. Working Days & OT */}
            <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Work Completed
              </div>
              <div className="mt-1 text-lg font-bold text-stone-900 tabular-nums">
                {rows.reduce((sum, r) => sum + r.daysWorked, 0)} <span className="text-sm font-normal text-stone-500">days</span>
              </div>
              <div className="text-xs font-semibold text-teal-700 tabular-nums mt-0.5">
                {rows.reduce((sum, r) => sum + r.otMinutes, 0) > 0
                  ? `+${formatHours(rows.reduce((sum, r) => sum + r.otMinutes, 0))} overtime`
                  : '0 hr overtime'}
              </div>
            </div>

            {/* 2. Salary & Last Baki */}
            <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Gross Salary
              </div>
              <div className="mt-1 text-lg font-bold text-emerald-900 tabular-nums">
                {formatMoney(totals.earned, { showZero: true })}
              </div>
              <div className="text-xs font-medium text-stone-500 tabular-nums mt-0.5">
                {totals.opening > 0 ? `+${formatMoney(totals.opening)} last baki` : 'No opening baki'}
              </div>
            </div>

            {/* 3. Upad Status (Recovered & Remaining) */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Upad Status
              </div>
              <div className="mt-1 text-lg font-bold text-amber-950 tabular-nums">
                {formatMoney(totals.outstanding, { showZero: true })}
              </div>
              <div className="text-xs font-semibold text-rose-700 tabular-nums mt-0.5">
                {totals.recovery > 0 ? (
                  <span>-{formatMoney(totals.recovery)} being recovered</span>
                ) : (
                  <span className="text-stone-500 font-normal">₹0 recovered · {formatMoney(totals.outstanding)} remain</span>
                )}
              </div>
            </div>

            {/* 4. Adjustments / Carried Balance */}
            <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Net Deductions & Carry
              </div>
              <div className="mt-1 text-lg font-bold text-stone-900 tabular-nums">
                {signedMoney(totals.adjustment)}
              </div>
              <div className="text-xs font-medium text-stone-500 tabular-nums mt-0.5">
                {totals.closing > 0 ? (
                  <span className="text-amber-700 font-semibold">{formatMoney(totals.closing)} carry forward</span>
                ) : (
                  <span className="text-emerald-700 font-medium">Fully settled</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Net Payable & Save Payout Action */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 lg:border-l lg:border-stone-200 lg:pl-6 shrink-0">
            <div className="text-left sm:text-right">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Total Payable Amount
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-800 tabular-nums tracking-tight">
                {formatMoney(totals.due, { showZero: true })}
              </div>
              <div className="text-xs font-medium text-stone-600 tabular-nums mt-0.5">
                Paying: <span className="font-bold text-stone-900">{formatMoney(totals.paid)}</span>
                {totals.closing > 0 && (
                  <span className="text-amber-700 font-semibold ml-1.5">
                    ({formatMoney(totals.closing)} remain)
                  </span>
                )}
              </div>
            </div>

            <Button
              variant="emerald"
              size="lg"
              onClick={() => onNavigate('payout')}
              className="h-12 px-6 text-sm font-bold shadow-sm"
            >
              <Wallet className="h-4 w-4" />
              <span>Issue Payout</span>
            </Button>
          </div>
        </div>
      </div>

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
          adjustments={payrollData?.adjustments?.filter((a) => a.employee === workerModalRow.employee.id) ?? []}
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
    </div>
  )
}

function WorkerCycleModal({
  open,
  onClose,
  row,
  cycleStart,
  payoutDate,
  adjustments,
  onUpdateRowInput,
  currentInput,
  onOpenUpad,
}: {
  open: boolean
  onClose: () => void
  row: CycleRow
  cycleStart: string
  payoutDate: string
  adjustments: Adjustment[]
  onUpdateRowInput: (patch: Partial<RowInput>) => void
  currentInput: RowInput
  onOpenUpad: () => void
}) {
  const [recoveryInput, setRecoveryInput] = useState(currentInput.recovery)
  const [paidInput, setPaidInput] = useState(
    currentInput.paid === null ? paiseToInput(row.totalDuePaise) : currentInput.paid,
  )
  const [giveAdvanceInput, setGiveAdvanceInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Adjustment form state
  const [adjType, setAdjType] = useState<'bonus' | 'fine'>('bonus')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [adjError, setAdjError] = useState('')

  const queryClient = useQueryClient()
  const toast = useToast()

  // Sync inputs if prop changes
  useEffect(() => {
    setRecoveryInput(currentInput.recovery)
    setPaidInput(currentInput.paid === null ? paiseToInput(row.totalDuePaise) : currentInput.paid)
  }, [currentInput, row.totalDuePaise])

  // Dynamic calculations based on live inputs
  const beforeRecovery = row.openingPaise + row.earnedPaise + row.adjustmentPaise
  const maxRecoverable = Math.min(row.upadOutstandingPaise, Math.max(0, beforeRecovery))
  const requestedRec = Math.max(0, parseMoneyInput(recoveryInput))
  const currentRecoveryPaise = Math.min(requestedRec, maxRecoverable)
  const liveTotalDuePaise = Math.max(0, beforeRecovery - currentRecoveryPaise)

  const rawPaidPaise = paidInput === '' ? 0 : parseMoneyInput(paidInput)
  const actualSalaryPaidPaise = Math.min(rawPaidPaise, liveTotalDuePaise)
  const overpaidPaise = Math.max(0, rawPaidPaise - liveTotalDuePaise)
  const freshAdvancePaise = Math.max(0, parseMoneyInput(giveAdvanceInput))
  const totalNewAdvancePaise = overpaidPaise + freshAdvancePaise

  const unpaidSalaryPaise = Math.max(0, liveTotalDuePaise - actualSalaryPaidPaise)
  const remainingUpadDebtPaise = Math.max(0, row.upadOutstandingPaise - currentRecoveryPaise)
  const totalCashToHandOver = actualSalaryPaidPaise + totalNewAdvancePaise
  const isOverAdvanced = row.upadOutstandingPaise > Math.max(0, beforeRecovery)

  const createAdjMutation = useMutation({
    mutationFn: async () => {
      const paise = parseMoneyInput(adjAmount)
      if (paise <= 0) throw new Error('Enter an amount greater than zero.')
      const finalAmount = adjType === 'bonus' ? paise : -paise
      return createAdjustment({
        employeeId: row.employee.id,
        date: payoutDate,
        amountPaise: finalAmount,
        note: adjNote.trim() || (adjType === 'bonus' ? 'Bonus / Allowance' : 'Fine / Deduction'),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      setAdjAmount('')
      setAdjNote('')
      setAdjError('')
      toast('Adjustment added')
    },
    onError: (err) => setAdjError(err instanceof Error ? err.message : 'Could not add adjustment'),
  })

  const deleteAdjMutation = useMutation({
    mutationFn: async (id: string) => {
      return deleteAdjustment(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast('Adjustment removed')
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Could not delete adjustment', 'error'),
  })

  async function handleSave() {
    setIsSaving(true)
    try {
      if (totalNewAdvancePaise > 0) {
        await createUpadEntry({
          employeeId: row.employee.id,
          date: payoutDate,
          kind: 'given',
          category: 'regular',
          amountPaise: totalNewAdvancePaise,
          note:
            overpaidPaise > 0 && freshAdvancePaise > 0
              ? `Overpayment (${formatMoney(overpaidPaise)}) + Advance (${formatMoney(freshAdvancePaise)}) on payday`
              : overpaidPaise > 0
                ? 'Overpayment cash recorded as advance (carry forward)'
                : 'Advance given on payday (carry forward)',
        })
        queryClient.invalidateQueries({ queryKey: ['upad'] })
        queryClient.invalidateQueries({ queryKey: ['payroll'] })
        queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
        toast(`Recorded ${formatMoney(totalNewAdvancePaise)} advance (carried forward)`)
      }

      onUpdateRowInput({
        recovery: recoveryInput,
        paid: paiseToInput(actualSalaryPaidPaise),
      })
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save payment', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row.employee.name}
      description={`#${row.employee.employee_no} · Daily Rate: ${formatMoney(row.employee.daily_rate_paise)}/d · ${formatDateRange(cycleStart, payoutDate)}`}
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onOpenUpad}
            className="mr-auto text-amber-800 hover:bg-amber-50"
          >
            <HandCoins className="h-4 w-4" />
            <span>Manage Upad</span>
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="emerald" onClick={handleSave} loading={isSaving}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Worker Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Days Worked
            </div>
            <div className="mt-1 text-base font-bold text-stone-900 tabular-nums">
              {row.daysWorked} d
            </div>
            <div className="text-[10px] font-medium text-stone-500 tabular-nums">
              {row.otMinutes > 0 ? `+${formatHours(row.otMinutes)} OT` : '0 hr OT'}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              Earned Salary
            </div>
            <div className="mt-1 text-base font-bold text-stone-900 tabular-nums">
              {formatMoney(row.earnedPaise, { showZero: true })}
            </div>
            <div className="text-[10px] font-medium text-stone-500 tabular-nums">
              Rate: {formatMoney(row.employee.daily_rate_paise)}/d
            </div>
          </div>

          <div
            className={clsx(
              'rounded-xl border p-2.5',
              row.openingPaise > 0
                ? 'border-sky-300 bg-sky-50/80 text-sky-950'
                : 'border-stone-200 bg-stone-50 text-stone-900',
            )}
          >
            <div className={clsx(
              'text-[10px] font-semibold uppercase tracking-wider',
              row.openingPaise > 0 ? 'text-sky-800' : 'text-stone-500',
            )}>
              Opening Baki
            </div>
            <div className="mt-1 text-base font-bold tabular-nums">
              {formatMoney(row.openingPaise, { showZero: true })}
            </div>
            <div className={clsx(
              'text-[10px] font-medium',
              row.openingPaise > 0 ? 'text-sky-700 font-semibold' : 'text-stone-500',
            )}>
              {row.openingPaise > 0 ? 'Carried forward from last cycle' : 'No opening baki'}
            </div>
          </div>

          <div
            className={clsx(
              'rounded-xl border p-2.5',
              row.upadOutstandingPaise > 0
                ? 'border-amber-300 bg-amber-50/80 text-amber-950'
                : 'border-stone-200 bg-stone-50 text-stone-900',
            )}
          >
            <div className={clsx(
              'text-[10px] font-semibold uppercase tracking-wider',
              row.upadOutstandingPaise > 0 ? 'text-amber-800' : 'text-stone-500',
            )}>
              Upad Debt
            </div>
            <div className="mt-1 text-base font-bold tabular-nums">
              {formatMoney(row.upadOutstandingPaise, { showZero: true })}
            </div>
            <div className={clsx(
              'text-[10px] font-medium',
              row.upadOutstandingPaise > 0 ? 'text-amber-700' : 'text-stone-500',
            )}>
              Chalu: {formatMoney(row.regularUpadPaise)} · Main: {formatMoney(row.extraUpadPaise)}
            </div>
          </div>
        </div>

        {/* Over-Advanced Alert */}
        {isOverAdvanced && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-900">
            <div className="font-bold flex items-center gap-1.5 text-amber-950">
              <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
              <span>Worker is Over-Advanced by {formatMoney(row.upadOutstandingPaise - maxRecoverable)}</span>
            </div>
            <div className="mt-1 text-amber-800 leading-relaxed">
              Worker owes {formatMoney(row.upadOutstandingPaise)} in advances, but only earned {formatMoney(maxRecoverable)} in this cycle.
              {currentRecoveryPaise > 0 ? (
                <>
                  {' '}Deducting {formatMoney(currentRecoveryPaise)} from salary leaves <strong>{formatMoney(row.upadOutstandingPaise - currentRecoveryPaise)} Upad debt</strong>, which will <strong>automatically carry forward</strong> to next week.
                </>
              ) : (
                <>
                  {' '}The full <strong>{formatMoney(row.upadOutstandingPaise)} Upad debt</strong> will <strong>automatically carry forward</strong> to next week.
                </>
              )}
            </div>
          </div>
        )}

        {/* Calculation summary bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 px-3.5 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-medium text-stone-600">
            <span className="font-semibold text-stone-800">Summary:</span>
            <span>Salary ({formatMoney(row.earnedPaise)})</span>
            {row.openingPaise > 0 && (
              <span className="font-bold text-sky-800">+ Last Baki ({formatMoney(row.openingPaise)})</span>
            )}
            {row.adjustmentPaise !== 0 && (
              <span>
                {row.adjustmentPaise > 0
                  ? `+ Bonus (${formatMoney(row.adjustmentPaise)})`
                  : `- Fine (${formatMoney(Math.abs(row.adjustmentPaise))})`}
              </span>
            )}
            {currentRecoveryPaise > 0 && (
              <span className="font-bold text-rose-700">- Upad Rec. ({formatMoney(currentRecoveryPaise)})</span>
            )}
          </div>
          <div className="text-right">
            <span className="text-[10px] font-semibold uppercase text-stone-500 block">Total Payable Due</span>
            <span className="text-base font-bold text-stone-900 tabular-nums">
              {formatMoney(liveTotalDuePaise)}
            </span>
          </div>
        </div>

        {/* Recovery & Payment Inputs */}
        <div className="rounded-2xl border border-stone-200 p-3.5 space-y-3.5 bg-white">
          <div className="text-xs font-bold text-stone-800 uppercase tracking-wide">
            Settlement & Payment Inputs
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Field
                label="Recover Upad From Salary (₹)"
                hint={maxRecoverable > 0 ? `Max recoverable: ${formatMoney(maxRecoverable)}` : 'No upad to recover'}
              >
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                />
              </Field>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setRecoveryInput(paiseToInput(maxRecoverable))}
                  disabled={maxRecoverable <= 0}
                  className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                >
                  Max ({formatMoney(maxRecoverable)})
                </button>
                <button
                  type="button"
                  onClick={() => setRecoveryInput('0')}
                  className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-500 hover:bg-stone-100"
                >
                  Zero
                </button>
              </div>
            </div>

            <div>
              <Field
                label="Paid Now Amount (₹)"
                hint={
                  unpaidSalaryPaise > 0
                    ? `${formatMoney(unpaidSalaryPaise)} carries forward as Last Baki`
                    : overpaidPaise > 0
                      ? `${formatMoney(overpaidPaise)} extra cash recorded as Upad`
                      : 'Full payment settles this cycle'
                }
              >
                <Input
                  inputMode="decimal"
                  placeholder={paiseToInput(liveTotalDuePaise)}
                  value={paidInput}
                  onChange={(e) => setPaidInput(e.target.value)}
                />
              </Field>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPaidInput(paiseToInput(liveTotalDuePaise))}
                  className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-700 hover:bg-stone-100"
                >
                  Pay Full ({formatMoney(liveTotalDuePaise)})
                </button>
                <button
                  type="button"
                  onClick={() => setPaidInput('0')}
                  className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-semibold text-stone-500 hover:bg-stone-100"
                >
                  Zero (Unpaid)
                </button>
              </div>
            </div>
          </div>

          {/* Give Fresh Upad on Payday */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2">
              <span className="text-xs font-bold text-stone-800">
                + Give Fresh Upad / Advance Today (₹)
              </span>
              <span className="text-[11px] text-amber-800 font-semibold">
                Added to Upad & carries forward to next cycle
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[10rem]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400">
                  ₹
                </span>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={giveAdvanceInput}
                  onChange={(e) => setGiveAdvanceInput(e.target.value)}
                  className="pl-7"
                />
              </div>
              <div className="flex items-center gap-1">
                {[200, 500, 1000, 2000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setGiveAdvanceInput(String(preset))}
                    className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50 shadow-2xs"
                  >
                    +{preset}
                  </button>
                ))}
                {giveAdvanceInput && (
                  <button
                    type="button"
                    onClick={() => setGiveAdvanceInput('')}
                    className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-400 hover:text-stone-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Cash Handed Over & Carry Forward Summary */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2 text-xs">
            <div className="flex justify-between items-center font-bold text-emerald-950">
              <span>Total Cash Handed to Worker Today:</span>
              <span className="text-base font-black tabular-nums text-emerald-900">
                {formatMoney(totalCashToHandOver, { showZero: true })}
              </span>
            </div>
            <div className="border-t border-emerald-200/60 pt-1.5 space-y-1 text-[11px]">
              <div className="flex justify-between text-emerald-900 font-medium">
                <span>• Net salary paid out:</span>
                <span className="tabular-nums font-bold">{formatMoney(actualSalaryPaidPaise, { showZero: true })}</span>
              </div>
              {totalNewAdvancePaise > 0 && (
                <div className="flex justify-between text-amber-900 font-medium">
                  <span>• Fresh Upad advance handed:</span>
                  <span className="tabular-nums font-bold">+{formatMoney(totalNewAdvancePaise)} (Carries forward as Upad)</span>
                </div>
              )}
              {unpaidSalaryPaise > 0 && (
                <div className="flex justify-between text-sky-900 font-semibold">
                  <span>• Unpaid salary:</span>
                  <span className="tabular-nums font-bold">+{formatMoney(unpaidSalaryPaise)} (Carries forward as Last Baki)</span>
                </div>
              )}
              {remainingUpadDebtPaise + totalNewAdvancePaise > 0 && (
                <div className="flex justify-between text-stone-700 font-medium">
                  <span>• Total Upad remaining for next cycle:</span>
                  <span className="tabular-nums font-bold text-amber-900">
                    {formatMoney(remainingUpadDebtPaise + totalNewAdvancePaise)} CF
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Adjustments Section (Bonuses & Fines) */}
        <div className="rounded-2xl border border-stone-200 p-3.5 space-y-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-stone-800 uppercase tracking-wide">
              Adjustments (Bonus / Fines)
            </div>
            <span className="text-xs font-semibold tabular-nums text-stone-600">
              Total: {signedMoney(row.adjustmentPaise)}
            </span>
          </div>

          {/* Existing Adjustments list */}
          {adjustments.length > 0 ? (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {adjustments.map((adj) => (
                <div
                  key={adj.id}
                  className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50/80 px-3 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'inline-flex items-center justify-center rounded px-1.5 py-0.2 text-[10px] font-bold uppercase',
                        adj.amount_paise >= 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800',
                      )}
                    >
                      {adj.amount_paise >= 0 ? '+ Bonus' : '- Fine'}
                    </span>
                    <span className="text-stone-700 font-medium">{adj.note || 'Adjustment'}</span>
                    <span className="text-[10px] text-stone-400">{formatDateShort(adj.date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'font-bold tabular-nums',
                        adj.amount_paise >= 0 ? 'text-emerald-700' : 'text-rose-700',
                      )}
                    >
                      {signedMoney(adj.amount_paise)}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteAdjMutation.mutate(adj.id)}
                      disabled={deleteAdjMutation.isPending}
                      className="rounded p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                      title="Remove adjustment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-stone-400 py-1">
              No adjustments added for this worker in this cycle.
            </div>
          )}

          {/* Add New Adjustment Form */}
          <div className="border-t border-stone-100 pt-3 space-y-2">
            <div className="text-[11px] font-semibold text-stone-600">Add New Adjustment:</div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <Select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as 'bonus' | 'fine')}
              >
                <option value="bonus">+ Bonus / Allowance</option>
                <option value="fine">- Fine / Deduction</option>
              </Select>
              <Input
                inputMode="decimal"
                placeholder="Amount (₹)"
                value={adjAmount}
                onChange={(e) => {
                  setAdjAmount(e.target.value)
                  setAdjError('')
                }}
              />
              <Input
                placeholder="Reason / Note"
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => createAdjMutation.mutate()}
                loading={createAdjMutation.isPending}
                disabled={!adjAmount}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </Button>
            </div>
            {adjError && <div className="text-xs text-rose-600 font-medium">{adjError}</div>}
          </div>
        </div>
      </div>
    </Modal>
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
}: {
  open: boolean
  onClose: () => void
  row: CycleRow
  payoutDate: string
  upadEntries: UpadEntry[]
  onUpdateRecovery: (amount: string) => void
  currentRecovery: string
}) {
  const [mode, setMode] = useState<'give' | 'recover'>('give')

  // Give Upad Form
  const [giveCategory, setGiveCategory] = useState<UpadCategory>('regular')
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
            <div>Chalu: {formatMoney(row.regularUpadPaise)}</div>
            {row.extraUpadPaise > 0 && <div>Main: {formatMoney(row.extraUpadPaise)}</div>}
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
  const [status, setStatus] = useState<CycleStatus>(record?.status ?? 'full')
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
      await saveAttendance({
        employeeId: employee.id,
        date,
        status,
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
  const pay = dayPayPaise(status || '', otMinutes, ratePaise, divisor)

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
        <div className="grid grid-cols-3 gap-2.5">
          {(['full', 'half', 'absent'] as AttendanceStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={clsx(
                'rounded-2xl border p-3 text-center transition-all',
                status === value
                  ? value === 'full'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                    : value === 'half'
                      ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-500/20'
                      : 'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-500/20'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300',
              )}
            >
              <div className="text-xl font-black">{STATUS_LABEL[value]}</div>
              <div className="mt-0.5 text-xs font-bold">{STATUS_NAME[value]}</div>
            </button>
          ))}
        </div>

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
}: {
  open: boolean
  onClose: () => void
  employee: Employee
  row: CycleRow
  initialCategory: UpadCategory
  payoutDate: string
}) {
  const [category, setCategory] = useState<UpadCategory>(initialCategory)
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
                  {value === 'regular' || value === 'chalu' ? 'Chalu Upad' : 'Main Upad'}
                </div>
                <div className="mt-0.5 text-base font-black text-stone-900 tabular-nums">
                  {formatMoney(valueBalance, { showZero: true })}
                </div>
              </button>
            )
          })}
        </div>

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
