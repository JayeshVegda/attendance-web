import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  History,
  LockKeyhole,
  Search,
  Wallet,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import clsx from 'clsx'
import { addDays, dateKey, formatDateRange, formatDateShort, todayKey, weekdayShort } from '../lib/dates'
import {
  calcDayEarnings,
  calcPayoutSettlement,
  calcToPay,
  calcUpadAfter,
  calcUpadBalance,
  calcWarnings,
  formatHours,
  formatMoney,
  paiseToInput,
  parseMoneyInput,
} from '../lib/attendance-calc'
import { tx, useLanguage } from '../lib/i18n'
import {
  addUpadEntry,
  deleteAttendance,
  loadAppData,
  latestStatement,
  saveAttendance,
  saveDraft,
  savePayoutBatch,
  toggleHoliday,
  unlockPayout,
} from '../lib/attendance-service'
import type { AppData, Attendance, AttendanceStatus, CycleDraft, Employee } from '../lib/types'
import { Avatar, Badge, Button, Card, Field, Input, Modal, Select, Tabs, Textarea } from '../components/ui'

type Tab = 'today' | 'cycle'
type DraftInput = Pick<CycleDraft, 'adj_paise' | 'adj_note' | 'deduct_paise' | 'give_upad_paise' | 'typed_paise' | 'is_done'>

const blankDraft = (): DraftInput => ({
  adj_paise: 0,
  adj_note: '',
  deduct_paise: 0,
  give_upad_paise: 0,
  typed_paise: null,
  is_done: false,
})

function inclusiveDays(start: string, end: string): string[] {
  const count = Math.max(
    0,
    Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000) + 1,
  )
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

function rowBoundary(worker: Employee): string {
  return worker.paid_up_to ? addDays(dateKey(worker.paid_up_to), 1) : dateKey(worker.joined_on)
}

function dayMap(attendance: Attendance[]): Map<string, Attendance> {
  return new Map(attendance.map((a) => [`${a.employee}:${dateKey(a.date)}`, a]))
}

function nextStatus(status?: AttendanceStatus): AttendanceStatus | undefined {
  return status === undefined ? 'full' : status === 'full' ? 'half' : status === 'half' ? 'absent' : undefined
}

function attendanceLabel(status?: AttendanceStatus): string {
  return status === 'full' ? 'P' : status === 'half' ? 'H' : status === 'absent' ? 'A' : status === 'hours' ? 'Hrs' : '—'
}

function readDrawerCash(day: string): string {
  try {
    const stored = localStorage.getItem(`kapil-drawer-${day}`)
    if (!stored) return ''
    const parsed = JSON.parse(stored) as { cashInput?: unknown }
    return typeof parsed.cashInput === 'string' ? parsed.cashInput : ''
  } catch {
    return ''
  }
}

export default function AttendancePage() {
  useLanguage()
  const today = todayKey()
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab')
      if (p === 'cycle' || p === 'today') return p
    }
    return 'today'
  })
  const [rollDate, setRollDate] = useState(today)
  const [cycleChoice, setCycleChoice] = useState('open')
  const [search, setSearch] = useState('')
  const [drawerCashInput, setDrawerCashInput] = useState(() => readDrawerCash(today))
  const [collapsed, setCollapsed] = useState(false)
  const [workerPopup, setWorkerPopup] = useState<string | null>(null)
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftInput>>({})
  const [adjInputs, setAdjInputs] = useState<Record<string, string>>({})
  const [upadPopup, setUpadPopup] = useState<{ worker?: string; date: string } | null>(null)
  const [payoutConfirm, setPayoutConfirm] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockRun, setUnlockRun] = useState<string | null>(null)
  const [hoursEditor, setHoursEditor] = useState<{ employee: string; date: string } | null>(null)
  const [dayPicker, setDayPicker] = useState<{ employee: string; date: string } | null>(null)
  const [hoursValue, setHoursValue] = useState('4')
  const [otValue, setOtValue] = useState('0')
  const [hoursPickerWorker, setHoursPickerWorker] = useState<string | null>(null)
  const [quickHourValue, setQuickHourValue] = useState('')

  // Zoom scaling for attendance register and roll call
  const [tableZoom, setTableZoom] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('kapil_attendance_zoom')
      if (saved) {
        const val = Number(saved)
        if (!Number.isNaN(val) && val >= 70 && val <= 140) return val
      }
    } catch {}
    return 100
  })

  function changeZoom(delta: number) {
    setTableZoom((prev) => {
      const next = Math.min(140, Math.max(70, prev + delta))
      try {
        localStorage.setItem('kapil_attendance_zoom', String(next))
      } catch {}
      return next
    })
  }

  function resetZoom() {
    setTableZoom(100)
    try {
      localStorage.setItem('kapil_attendance_zoom', '100')
    } catch {}
  }

  // Notion-style dynamic resizable column widths
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('kapil_cycle_col_widths_v2') || localStorage.getItem('kapil_cycle_col_widths')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Discard any stale cramped widths (< 60px) from older sessions
        const cleaned: Record<string, number> = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && v >= 60) {
            cleaned[k] = v
          }
        }
        return cleaned
      }
      return {}
    } catch {
      return {}
    }
  })

  function startColResize(e: React.MouseEvent, colKey: string) {
    e.preventDefault()
    e.stopPropagation()
    const th = e.currentTarget.parentElement as HTMLElement
    const startX = e.clientX
    const startWidth = th.getBoundingClientRect().width

    function onMouseMove(moveEvent: MouseEvent) {
      const delta = moveEvent.clientX - startX
      const nextWidth = Math.max(60, Math.round(startWidth + delta))
      setColWidths((prev) => {
        const next = { ...prev, [colKey]: nextWidth }
        try {
          localStorage.setItem('kapil_cycle_col_widths_v2', JSON.stringify(next))
        } catch {}
        return next
      })
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function resetColWidth(e: React.MouseEvent, colKey: string) {
    e.preventDefault()
    e.stopPropagation()
    setColWidths((prev) => {
      const next = { ...prev }
      delete next[colKey]
      try {
        localStorage.setItem('kapil_cycle_col_widths_v2', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const queryClient = useQueryClient()
  const dataQuery = useQuery({ queryKey: ['attendance-data'], queryFn: loadAppData })
  const data = dataQuery.data

  useEffect(() => {
    try {
      localStorage.setItem(`kapil-drawer-${today}`, JSON.stringify({ cashInput: drawerCashInput }))
    } catch {
      // Drawer tracking remains available for this page session when storage is unavailable.
    }
  }, [today, drawerCashInput])

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['attendance-data'] })
  }

  const attendanceMutation = useMutation({
    mutationFn: saveAttendance,
    onSuccess: refresh,
  })

  const payoutMutation = useMutation({
    mutationFn: async () => {
      const done = rows.filter((row) => row.draft.is_done).map((row) => ({ employee: row.employee.id, ...row.draft }))
      await Promise.all(done.map((draft) => saveDraft(draft.employee, draft)))
      return savePayoutBatch(
        done.map((row) => ({ ...blankDraft(), ...row, id: '' } as CycleDraft)),
        today,
      )
    },
    onSuccess: () => {
      setPayoutConfirm(false)
      setCycleChoice('open')
      setDraftEdits({})
      void refresh()
    },
  })

  const unlockMutation = useMutation({
    mutationFn: () => unlockPayout(unlockRun!, unlockReason, 'Local user'),
    onSuccess: () => {
      setUnlockRun(null)
      setUnlockReason('')
      void refresh()
    },
  })

  const employees = data?.employees ?? []
  const activeEmployees = employees.filter((e) => e.status === 'active')
  const attendanceByDay = useMemo(() => dayMap(data?.attendance ?? []), [data?.attendance])
  const draftByWorker = useMemo(() => new Map((data?.drafts ?? []).map((d) => [d.employee, d])), [data?.drafts])

  const selectedRun = cycleChoice === 'open' ? undefined : data?.runs.find((r) => r.id === cycleChoice)
  const selectedStatements = (data?.statements ?? []).filter((s) => s.payout_run === selectedRun?.id)

  const openStarts = activeEmployees.map(rowBoundary).filter(Boolean)
  const cycleStart = selectedRun
    ? selectedStatements.map((s) => dateKey(s.start_date)).sort()[0] ?? today
    : openStarts.sort()[0] ?? today
  const cycleEnd = selectedRun
    ? selectedStatements.map((s) => dateKey(s.end_date)).sort().at(-1) ?? dateKey(selectedRun.run_date)
    : today

  const days = useMemo(() => inclusiveDays(cycleStart, cycleEnd), [cycleStart, cycleEnd])
  const holidays = new Set((data?.holidays ?? []).map((h) => dateKey(h.date)))

  function draftFor(employeeId: string): DraftInput {
    if (draftEdits[employeeId]) return draftEdits[employeeId]
    const d = draftByWorker.get(employeeId)
    return d
      ? {
          adj_paise: d.adj_paise,
          adj_note: d.adj_note ?? '',
          deduct_paise: d.deduct_paise,
          give_upad_paise: d.give_upad_paise,
          // PocketBase stores an empty optional number as 0; while a row is
          // unfinished, treat that storage default as an empty To Pay field.
          typed_paise: d.is_done ? d.typed_paise ?? null : null,
          is_done: d.is_done,
        }
      : blankDraft()
  }

  async function writeDraft(employeeId: string, patch: Partial<DraftInput>) {
    const current = draftFor(employeeId)
    const next = { ...current, ...patch }
    // Section 7: If a done row's Adj, Deduct or Give changes, return to not done automatically
    if (
      current.is_done &&
      (patch.adj_paise !== undefined ||
        patch.adj_note !== undefined ||
        patch.deduct_paise !== undefined ||
        patch.give_upad_paise !== undefined) &&
      patch.is_done === undefined &&
      patch.typed_paise === undefined
    ) {
      next.is_done = false
      next.typed_paise = null
    }

    setDraftEdits((curr) => ({ ...curr, [employeeId]: next }))
    await saveDraft(employeeId, next)
  }

  function markAttendance(
    employee: Employee,
    date: string,
    status?: AttendanceStatus,
    worked = 0,
    ot = 0,
    notes = '',
  ) {
    if (employee.paid_up_to && date <= dateKey(employee.paid_up_to)) return

    const existing = attendanceByDay.get(`${employee.id}:${date}`)
    if (status === undefined) {
      void deleteAttendance(employee.id, date).then(refresh)
    } else {
      attendanceMutation.mutate({
        employee: employee.id,
        date,
        status,
        worked_minutes: status === 'hours' ? worked : 0,
        ot_minutes: status === 'absent' ? 0 : ot,
        notes: notes || existing?.notes || '',
      })
    }
    // Section 7: If a done row's attendance changes, it returns to not done automatically
    if (!selectedRun && draftFor(employee.id).is_done) {
      void writeDraft(employee.id, { is_done: false, typed_paise: null })
    }
  }

  function showHours(employee: Employee, date: string, existing?: Attendance) {
    if (employee.paid_up_to && date <= dateKey(employee.paid_up_to)) return
    setHoursEditor({ employee: employee.id, date })
    setHoursValue(String(Math.max(1, Math.round((existing?.worked_minutes ?? 240) / 60))))
    setOtValue(String(Math.round((existing?.ot_minutes ?? 0) / 60)))
  }

  const rollRows = activeEmployees.filter((e) =>
    `${e.name} ${e.role}`.toLowerCase().includes(search.toLowerCase()),
  )
  const todayRows = rollRows.map((e) => {
    const isLocked = Boolean(e.paid_up_to && rollDate <= dateKey(e.paid_up_to))
    const att = attendanceByDay.get(`${e.id}:${rollDate}`)
    const boundary = rowBoundary(e)
    const workerDays = (data?.attendance ?? []).filter(
      (a) => a.employee === e.id && !a.settled_payout && dateKey(a.date) >= boundary,
    )
    const earnings = workerDays.reduce(
      (sum, a) =>
        sum +
        calcDayEarnings(
          a,
          e.daily_rate_paise,
          data!.settings.shift_hours,
          data!.settings.ot_multiplier,
        ).earned_paise,
      0,
    )
    const upadBalance = calcUpadBalance(
      e.opening_upad_paise,
      (data?.upad ?? []).filter((u) => u.employee === e.id),
    )
    return { employee: e, att, isLocked, workerDaysCount: workerDays.length, earnings, upadBalance }
  })
  const markedCount = todayRows.filter((r) => r.att).length

  const rows = employees.map((employee) => {
    const statement = selectedRun ? selectedStatements.find((s) => s.employee === employee.id) : undefined
    const start = selectedRun ? statement && dateKey(statement.start_date) : rowBoundary(employee)
    const workerAttendance = (data?.attendance ?? []).filter(
      (a) =>
        a.employee === employee.id &&
        dateKey(a.date) >= (start || today) &&
        dateKey(a.date) <= cycleEnd &&
        (!selectedRun || a.settled_payout === selectedRun.id),
    )
    const draft = draftFor(employee.id)
    const earnings = workerAttendance.reduce(
      (sum, a) =>
        sum +
        calcDayEarnings(
          a,
          employee.daily_rate_paise,
          data!.settings.shift_hours,
          data!.settings.ot_multiplier,
        ).earned_paise,
      0,
    )
    const fraction = workerAttendance.reduce(
      (sum, a) =>
        sum +
        calcDayEarnings(
          a,
          employee.daily_rate_paise,
          data!.settings.shift_hours,
          data!.settings.ot_multiplier,
        ).day_fraction,
      0,
    )

    // Formatted attendance breakdown: e.g. 5P + 5OT + 3HR or 3P + 2H + 4OT
    const pCount = workerAttendance.filter((a) => a.status === 'full').length
    const hCount = workerAttendance.filter((a) => a.status === 'half').length
    const customMinutes = workerAttendance
      .filter((a) => a.status === 'hours')
      .reduce((sum, a) => sum + (a.worked_minutes || 0), 0)
    const customHours = Math.round((customMinutes / 60) * 10) / 10
    const otTotalMinutes = workerAttendance.reduce(
      (sum, a) => sum + (a.status !== 'absent' ? a.ot_minutes || 0 : 0),
      0,
    )
    const otHours = Math.round((otTotalMinutes / 60) * 10) / 10

    const earnedParts: string[] = []
    if (pCount > 0) earnedParts.push(`${pCount}P`)
    if (hCount > 0) earnedParts.push(`${hCount}H`)
    if (customHours > 0) earnedParts.push(`${customHours}HR`)
    if (otHours > 0) earnedParts.push(`${otHours}OT`)
    const earnedBreakdown = earnedParts.length ? earnedParts.join(' + ') : '0P'

    const carry = selectedRun
      ? statement?.opening_paise ?? 0
      : latestStatement(data?.statements ?? [], employee.id, data?.runs ?? [])?.closing_paise ??
        employee.opening_carry_paise ??
        0
    const upadBalance = calcUpadBalance(
      employee.opening_upad_paise,
      (data?.upad ?? []).filter((u) => u.employee === employee.id),
    )
    const toPay = selectedRun
      ? statement?.calculated_paise ?? 0
      : calcToPay(carry, earnings, draft.adj_paise, draft.deduct_paise, draft.give_upad_paise)
    const settlement = calcPayoutSettlement(toPay, selectedRun ? statement?.paid_paise ?? 0 : draft.typed_paise ?? 0)
    const afterUpad = selectedRun
      ? upadBalance
      : calcUpadAfter(upadBalance, draft.deduct_paise, draft.give_upad_paise)

    const hasInput =
      draft.adj_paise !== 0 ||
      Boolean(draft.adj_note) ||
      draft.deduct_paise !== 0 ||
      draft.give_upad_paise !== 0 ||
      draft.typed_paise !== null

    const noActivity = !workerAttendance.length && carry === 0 && upadBalance === 0

    const warnings = calcWarnings(earnings, carry, upadBalance, draft.deduct_paise, toPay, draft.typed_paise)

    return {
      employee,
      statement,
      start,
      workerAttendance,
      draft,
      earnings,
      fraction,
      earnedBreakdown,
      carry,
      upadBalance,
      toPay,
      settlement,
      afterUpad,
      hasInput,
      noActivity,
      warnings,
    }
  })

  const doneRows = rows.filter((row) => !selectedRun && row.draft.is_done)
  const totalToPay = rows.reduce(
    (sum, row) => sum + (selectedRun ? row.statement?.calculated_paise ?? 0 : row.toPay),
    0,
  )
  const totalPaid = selectedRun
    ? rows.reduce((sum, row) => sum + (row.statement?.paid_paise ?? 0), 0)
    : doneRows.reduce((sum, row) => sum + (row.draft.typed_paise ?? 0), 0)
  const paidInRunsToday = (data?.runs ?? [])
    .filter((run) => dateKey(run.run_date) === today)
    .reduce((sum, run) => sum + run.total_paid_paise, 0)
  const paidSoFar = totalPaid + (selectedRun ? 0 : paidInRunsToday)
  const drawerLeft = parseMoneyInput(drawerCashInput) - paidSoFar
  const displayRows = rows.filter((row) =>
    `${row.employee.name} ${row.employee.role} ${row.employee.phone}`.toLowerCase().includes(search.toLowerCase()),
  )

  if (dataQuery.isLoading) {
    return <div role="status" aria-live="polite" className="p-10 text-center text-xs font-semibold text-stone-500">{tx("Loading attendance records…")}</div>
  }
  if (dataQuery.isError || !data) {
    return (
      <div role="alert" aria-live="assertive" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-900">
        {tx("Could not connect to the local PocketBase database (port 8091). Verify the server is running.")}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{tx('Attendance')}</h1>
      {/* View Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-2.5 shadow-2xs">
        <div className="flex items-center gap-3">
          <div role="tablist" aria-label={tx("Attendance tabs")} className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-semibold text-stone-600">
            <button
              id="attendance-tab-today"
              role="tab"
              aria-controls="attendance-panel-today"
              aria-selected={tab === 'today'}
              tabIndex={tab === 'today' ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  const next = tab === 'today' ? 'cycle' : 'today'
                  setTab(next)
                  document.getElementById(`attendance-tab-${next}`)?.focus()
                }
              }}
              onClick={() => setTab('today')}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition cursor-pointer',
                tab === 'today' ? 'bg-white font-bold text-stone-900 shadow-2xs' : 'hover:text-stone-900',
              )}
            >
              <CalendarCheck className={clsx('h-3.5 w-3.5', tab === 'today' ? 'text-emerald-700' : 'text-stone-400')} />
              {tx("Today's Roll Call")}
            </button>
            <button
              id="attendance-tab-cycle"
              role="tab"
              aria-controls="attendance-panel-cycle"
              aria-selected={tab === 'cycle'}
              tabIndex={tab === 'cycle' ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  const next = tab === 'today' ? 'cycle' : 'today'
                  setTab(next)
                  document.getElementById(`attendance-tab-${next}`)?.focus()
                }
              }}
              onClick={() => setTab('cycle')}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition cursor-pointer',
                tab === 'cycle' ? 'bg-white font-bold text-stone-900 shadow-2xs' : 'hover:text-stone-900',
              )}
            >
              <CalendarDays className={clsx('h-3.5 w-3.5', tab === 'cycle' ? 'text-emerald-700' : 'text-stone-400')} />
              {tx("Cycle Register")}
            </button>
          </div>
          <span className="text-xs font-semibold text-stone-500">
            {tab === 'today'
              ? formatDateShort(rollDate)
              : selectedRun
                ? `${tx("Closed")} · ${formatDateShort(selectedRun.run_date)}`
                : formatDateRange(openStarts.sort()[0] ?? today, today)}
          </span>
        </div>

        {tab === 'today' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            {markedCount} {tx('of')} {todayRows.length} {tx('marked')}
          </span>
        )}
      </div>

      {tab === 'today' ? (
        /* Tab A: Today's Roll Call */
        <section id="attendance-panel-today" role="tabpanel" aria-labelledby="attendance-tab-today" tabIndex={0} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xs">
          <div className="flex flex-col gap-2.5 border-b border-stone-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1">
                <button
                  aria-label={tx("Previous day")}
                  onClick={() => setRollDate(addDays(rollDate, -1))}
                  className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <input
                  aria-label={tx("Roll call date")}
                  type="date"
                  value={rollDate}
                  max={today}
                  onChange={(e) => setRollDate(e.target.value)}
                  className="h-8 rounded-lg border border-stone-200 bg-white px-2.5 font-mono text-xs font-semibold text-stone-800 outline-none transition focus:border-stone-900 cursor-pointer"
                />
                <button
                  aria-label={tx("Next day")}
                  disabled={rollDate >= today}
                  onClick={() => setRollDate(addDays(rollDate, 1))}
                  className="rounded-lg border border-stone-200 bg-white p-1.5 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                {rollDate !== today && (
                  <button
                    onClick={() => setRollDate(today)}
                    className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-bold text-stone-700 transition hover:bg-stone-50 cursor-pointer"
                  >
                    {tx("Today")}
                  </button>
                )}
              </div>

            </div>

            <div className="flex items-center gap-2">
              <div className="w-full sm:w-56">
                <SearchBox value={search} onChange={setSearch} placeholder={tx("Search worker…")} />
              </div>
              <ZoomControl zoom={tableZoom} onChange={changeZoom} onReset={resetZoom} />
            </div>
          </div>

          <div
            className="divide-y divide-stone-100 transition-[zoom] duration-150"
            style={{ zoom: tableZoom !== 100 ? `${tableZoom}%` : undefined }}
          >
            {todayRows.map(({ employee, att, isLocked, workerDaysCount, earnings, upadBalance }) => (
              <div
                key={employee.id}
                className={clsx(
                  'flex flex-col gap-2.5 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between',
                  isLocked ? 'bg-stone-50/60 opacity-60' : 'hover:bg-stone-50/70',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={employee.name} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-stone-900">{employee.name}</span>
                      {isLocked && (
                        <span title="This date is closed and settled" className="inline-flex items-center gap-0.5 rounded bg-stone-200 px-1.5 py-0.2 text-[9px] font-bold text-stone-600">
                          <LockKeyhole className="h-2.5 w-2.5" /> {tx("Closed")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                      <span className="font-mono font-semibold text-stone-800">{formatMoney(employee.daily_rate_paise)}/d</span>
                      <span className="text-stone-300">·</span>
                      <span>{tx(employee.role || 'Worker')}</span>
                      <span className="text-stone-300">·</span>
                      <span className="font-mono font-semibold text-emerald-800">{workerDaysCount}d ({formatMoney(earnings)})</span>
                      {upadBalance > 0 && (
                        <>
                          <span className="text-stone-300">·</span>
                          <span className="font-mono font-semibold text-slate-700">Upad: {formatMoney(upadBalance)}</span>
                        </>
                      )}
                      {att?.status === 'hours' && (
                        <>
                          <span className="text-stone-300">·</span>
                          <span className="font-semibold text-sky-800">{formatHours(att.worked_minutes)} worked</span>
                        </>
                      )}
                      {Boolean(att?.ot_minutes) && (
                        <>
                          <span className="text-stone-300">·</span>
                          <span className="font-semibold text-emerald-700">+{formatHours(att!.ot_minutes)} OT</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-auto">
                  <StatusPill
                    active={att?.status === 'full'}
                    disabled={isLocked}
                    label="P"
                    hint="Full"
                    tone="emerald"
                    onClick={() => markAttendance(employee, rollDate, att?.status === 'full' ? undefined : 'full')}
                  />
                  <StatusPill
                    active={att?.status === 'half'}
                    disabled={isLocked}
                    label="H"
                    hint="Half"
                    tone="amber"
                    onClick={() => markAttendance(employee, rollDate, att?.status === 'half' ? undefined : 'half')}
                  />
                  <StatusPill
                    active={att?.status === 'absent'}
                    disabled={isLocked}
                    label="A"
                    hint="Absent"
                    tone="rose"
                    onClick={() => markAttendance(employee, rollDate, att?.status === 'absent' ? undefined : 'absent')}
                  />

                  {/* Hours Picker */}
                  <div className="relative inline-flex">
                    <button
                      type="button"
                      disabled={isLocked}
                      aria-expanded={hoursPickerWorker === employee.id}
                      onClick={() => {
                        setHoursPickerWorker(hoursPickerWorker === employee.id ? null : employee.id)
                        setQuickHourValue('')
                      }}
                      className={clsx(
                        'flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-bold transition disabled:opacity-40 cursor-pointer select-none',
                        att?.status === 'hours'
                          ? 'border-sky-600 bg-sky-600 text-white shadow-2xs'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-sky-300 hover:bg-sky-50',
                      )}
                    >
                      {att?.status === 'hours' ? `${Number((att.worked_minutes / 60).toFixed(1))}h` : 'Hrs'}
                    </button>
                    {hoursPickerWorker === employee.id && !isLocked && (
                      <div className="absolute right-0 top-9.5 z-30 flex items-center gap-1 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl">
                        <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">{tx("Hours")}</span>
                        {[1, 2, 3, 4, 5, 6, 7].map((hour) => (
                          <button
                            key={hour}
                            type="button"
                            aria-label={`${hour} ${tx('hours worked')}`}
                            onClick={() => {
                              markAttendance(employee, rollDate, 'hours', hour * 60, att?.ot_minutes ?? 0)
                              setHoursPickerWorker(null)
                            }}
                            className={clsx(
                              'flex h-6.5 w-6.5 items-center justify-center rounded-md text-xs font-bold transition cursor-pointer',
                              att?.status === 'hours' && att.worked_minutes === hour * 60
                                ? 'bg-sky-600 text-white'
                                : 'bg-stone-100 text-stone-700 hover:bg-sky-100 hover:text-sky-800',
                            )}
                          >
                            {hour}
                          </button>
                        ))}
                        <div className="border-l border-stone-200 pl-1">
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            aria-label={tx("Custom work hours")}
                            placeholder="h"
                            value={quickHourValue}
                            onChange={(e) => setQuickHourValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && Number(quickHourValue) > 0) {
                                markAttendance(
                                  employee,
                                  rollDate,
                                  'hours',
                                  Math.round(Number(quickHourValue) * 60),
                                  att?.ot_minutes ?? 0,
                                )
                                setHoursPickerWorker(null)
                                setQuickHourValue('')
                              }
                            }}
                            className="h-6.5 w-11 rounded border border-stone-300 px-1 text-center font-mono text-xs font-bold outline-none focus:border-sky-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* OT Pills 1-4 */}
                  <div
                    className="inline-flex shrink-0 items-center rounded-lg border border-stone-200 bg-stone-50 p-0.5"
                    aria-label={tx("Overtime")}
                  >
                    <span className="hidden px-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 lg:inline">{tx("OT")}</span>
                    {[1, 2, 3, 4].map((hour) => (
                      <button
                        key={hour}
                        type="button"
                        aria-label={`${hour} ${tx('hour overtime')}`}
                        aria-pressed={att?.ot_minutes === hour * 60}
                        disabled={isLocked || att?.status === 'absent'}
                        onClick={() =>
                          markAttendance(
                            employee,
                            rollDate,
                            att?.status ?? 'full',
                            att?.worked_minutes ?? 0,
                            att?.ot_minutes === hour * 60 ? 0 : hour * 60,
                          )
                        }
                        title={
                          att?.status === 'absent'
                            ? tx('Overtime blocked for absent days')
                            : `${hour} ${tx('hour overtime')}`
                        }
                        className={clsx(
                          'flex h-7 min-w-7 items-center justify-center rounded px-1.5 font-mono text-xs font-bold transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-25 active:scale-[0.96] cursor-pointer',
                          att?.ot_minutes === hour * 60
                            ? 'bg-stone-900 text-white shadow-2xs'
                            : 'text-stone-700 hover:bg-stone-200',
                        )}
                      >
                        {hour}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setUpadPopup({ worker: employee.id, date: rollDate })}
                    className="inline-flex h-8 shrink-0 items-center rounded-lg border border-stone-200 bg-stone-50 px-2.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 active:scale-[0.96] cursor-pointer"
                  >
                    {tx("+ Upad")}
                  </button>

                  {att && !isLocked && (
                    <button
                      type="button"
                      aria-label={`Clear attendance for ${employee.name}`}
                      onClick={() => markAttendance(employee, rollDate)}
                      className="flex size-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-400 transition hover:border-stone-300 hover:text-rose-700 active:scale-[0.96] cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!todayRows.length && (
              <div className="p-8 text-center text-xs text-stone-500">{tx("No active workers match this search.")}</div>
            )}
          </div>
        </section>
      ) : (
        /* Tab B: Cycle Register */
        <section id="attendance-panel-cycle" role="tabpanel" aria-labelledby="attendance-tab-cycle" tabIndex={0} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xs">
          {/* Top Bar - Clean financial control toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <select
                  value={cycleChoice}
                  aria-label={tx('Select cycle')}
                  onChange={(e) => setCycleChoice(e.target.value)}
                  className="h-8.5 rounded-lg border border-stone-200 bg-stone-50 pl-2.5 pr-8 text-xs font-bold text-stone-900 shadow-2xs outline-none transition hover:bg-stone-100 focus:border-stone-900 cursor-pointer appearance-none"
                >
                  <option value="open">
                    {tx('Open Cycle')} · {formatDateRange(openStarts.sort()[0] ?? today, today)}
                  </option>
                  {data.runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      🔒 {tx('Closed Cycle')} · {formatDateShort(r.run_date)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              </div>

              {!selectedRun && (
                <label className="flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 text-[11px] font-medium text-stone-500">
                  {tx('Drawer cash')}
                  <span className="text-stone-300">₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={tx('Drawer cash')}
                    value={drawerCashInput}
                    onChange={(event) => setDrawerCashInput(event.target.value)}
                    placeholder="0"
                    className="w-20 bg-transparent text-right font-mono text-xs font-bold text-stone-900 outline-none placeholder:text-stone-300"
                  />
                </label>
              )}

              <div className="flex items-center gap-2 border-l border-stone-200 pl-3">
                <div className="flex items-baseline gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1">
                  <span className="text-[11px] font-medium text-stone-500">{tx("Total To Pay:")}</span>
                  <span className="font-mono text-xs font-bold text-stone-900 tabular-nums">
                    {formatMoney(totalToPay)}
                  </span>
                </div>

                <div className="flex items-baseline gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1">
                  <span className="text-[11px] font-medium text-stone-500">{tx('Paid so far:')}</span>
                  <span className="font-mono text-xs font-bold text-emerald-800 tabular-nums">
                    {formatMoney(paidSoFar)}
                  </span>
                </div>

                <div className="hidden sm:flex items-baseline gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1">
                  <span className="text-[11px] font-medium text-stone-500">{tx("Ready:")}</span>
                  <span className="text-xs font-bold text-stone-800 tabular-nums">
                    {doneRows.length} / {rows.length}
                  </span>
                </div>

                {!selectedRun && <div className={clsx(
                  'flex items-baseline gap-1.5 rounded-lg px-2.5 py-1',
                  drawerLeft < 0 ? 'bg-rose-50 text-rose-800' : 'bg-stone-100 text-stone-700',
                )}>
                  <span className="text-[11px] font-medium">{tx('Drawer left:')}</span>
                  <span className="font-mono text-xs font-bold tabular-nums">{formatMoney(drawerLeft, { signed: true })}</span>
                </div>}
              </div>

              {selectedRun && (
                <button
                  onClick={() => setUnlockRun(selectedRun.id)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-bold text-amber-900 transition hover:bg-amber-100 cursor-pointer"
                >
                  <LockKeyhole className="h-3.5 w-3.5" /> {tx("Unlock Cycle")}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="w-36 sm:w-44">
                <SearchBox value={search} onChange={setSearch} placeholder={tx('Search worker…')} />
              </div>
              <ZoomControl zoom={tableZoom} onChange={changeZoom} onReset={resetZoom} />
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-xs font-bold text-stone-700 shadow-2xs transition hover:bg-stone-50 hover:text-stone-900 cursor-pointer"
              >
                {collapsed ? <ChevronDown className="h-3.5 w-3.5 text-stone-500" /> : <ChevronUp className="h-3.5 w-3.5 text-stone-500" />}
                <span>{collapsed ? tx('Expand Days') : tx('Collapse Days')}</span>
              </button>

              <button
                type="button"
                disabled={Boolean(selectedRun) || !doneRows.length}
                onClick={() => setPayoutConfirm(true)}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span>{tx('Payout')} ({doneRows.length})</span>
              </button>
            </div>
          </div>

          {/* Table Container - Notion-style refined data grid */}
          <div
            className="overflow-x-auto border-t border-stone-200 bg-white transition-[zoom] duration-150"
            style={{ zoom: tableZoom !== 100 ? `${tableZoom}%` : undefined }}
          >
            <table aria-label={tx('Cycle Register')} className="w-full border-separate border-spacing-0 text-xs">
              <caption className="sr-only">{tx('Cycle Register')}</caption>
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50/80 text-[11px] font-semibold text-stone-500">
                  {/* Worker Column Header */}
                  <th
                    style={{ width: colWidths['worker'] ? `${colWidths['worker']}px` : undefined }}
                    className="sticky left-0 top-0 z-30 w-52 min-w-[13rem] border-b border-r border-stone-200 bg-stone-50 px-3 py-2 text-left font-bold text-stone-700 relative group select-none shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                  >
                    <span>{tx("Worker")}</span>
                    <div
                      onMouseDown={(e) => startColResize(e, 'worker')}
                      onDoubleClick={(e) => resetColWidth(e, 'worker')}
                      title="Drag to resize, double-click to reset"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                    />
                  </th>

                  {/* Day Columns Header - Balanced compact width */}
                  {(collapsed ? ['Days'] : days).map((day) => {
                    const isHoliday = holidays.has(day)
                    const isCollapsed = day === 'Days'
                    return (
                      <th
                        key={day}
                        style={{ width: colWidths[day] ? `${colWidths[day]}px` : undefined }}
                        onClick={() => {
                          if (!isCollapsed && !selectedRun) {
                            void toggleHoliday(day).then(refresh)
                          }
                        }}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && !isCollapsed && !selectedRun) {
                            e.preventDefault()
                            void toggleHoliday(day).then(refresh)
                          }
                        }}
                        tabIndex={!isCollapsed && !selectedRun ? 0 : undefined}
                        role={!isCollapsed && !selectedRun ? 'button' : undefined}
                        aria-label={
                          !isCollapsed
                            ? `Day ${Number(day.slice(-2))}, ${weekdayShort(day)}${day === today ? `, ${tx('Today')}` : ''}${isHoliday ? ', holiday marked. Press to unmark' : '. Press to mark as holiday'}`
                            : undefined
                        }
                        title={
                          !isCollapsed
                            ? isHoliday
                              ? 'Holiday marked. Click to unmark'
                              : 'Click to mark as Holiday'
                            : undefined
                        }
                        className={clsx(
                          'sticky top-0 z-10 border-b border-r px-1 py-1.5 text-center transition-colors duration-150 select-none relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
                          isCollapsed ? 'min-w-[3.6rem]' : 'min-w-[4.25rem] w-[4.5rem]',
                          !isCollapsed && !selectedRun && 'cursor-pointer',
                          !isCollapsed &&
                            (isHoliday
                              ? 'border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100/80'
                              : 'border-stone-200/70 bg-stone-50/80 text-stone-600 hover:bg-stone-100/80'),
                        )}
                      >
                        {isCollapsed ? (
                          <div className="text-xs font-bold text-stone-700">{tx("Days")}</div>
                        ) : (
                          <div className="flex flex-col items-center justify-center leading-tight">
                            <span
                              className={clsx(
                                'text-[10px] font-bold uppercase tracking-wider',
                                isHoliday ? 'text-rose-600' : 'text-stone-400',
                              )}
                            >
                              {weekdayShort(day)}
                            </span>
                            {day === today && <span className="text-[8px] font-black uppercase leading-none text-emerald-700">{tx('Today')}</span>}
                            <span
                              className={clsx(
                                'mt-0.5 text-xs font-bold',
                                isHoliday ? 'text-rose-950 font-black' : 'text-stone-800',
                              )}
                            >
                              {Number(day.slice(-2))}
                            </span>
                            {isHoliday && (
                              <span className="mt-0.5 block h-1 w-2 rounded-full bg-rose-500" />
                            )}
                          </div>
                        )}
                        <div
                          onMouseDown={(e) => startColResize(e, day)}
                          onDoubleClick={(e) => resetColWidth(e, day)}
                          title="Drag to resize, double-click to reset"
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                        />
                      </th>
                    )
                  })}

                  <th
                    style={{ width: colWidths['earned'] ? `${colWidths['earned']}px` : undefined }}
                    className="sticky top-0 z-10 w-24 min-w-[6rem] border-b border-r border-stone-200/70 bg-stone-50/80 px-2.5 py-2 text-right font-semibold text-stone-600 relative group select-none"
                  >
                    <span>{tx("Earned")}</span>
                    <div
                      onMouseDown={(e) => startColResize(e, 'earned')}
                      onDoubleClick={(e) => resetColWidth(e, 'earned')}
                      title="Drag to resize, double-click to reset"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                    />
                  </th>
                  <th
                    style={{ width: colWidths['adj'] ? `${colWidths['adj']}px` : undefined }}
                    className="sticky top-0 z-10 w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-stone-200/70 bg-stone-50/80 px-1.5 py-2 text-right font-semibold text-stone-600 relative group select-none"
                  >
                    <span>{tx("Adj (+/−)")}</span>
                    <div
                      onMouseDown={(e) => startColResize(e, 'adj')}
                      onDoubleClick={(e) => resetColWidth(e, 'adj')}
                      title="Drag to resize, double-click to reset"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                    />
                  </th>
                  <th
                    style={{ width: colWidths['upad'] ? `${colWidths['upad']}px` : undefined }}
                    className="sticky top-0 z-10 w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-rose-200 bg-rose-50 px-1.5 py-2 text-right font-bold text-rose-900 relative group select-none"
                  >
                    <span>{tx("Upad")}</span>
                    <div
                      onMouseDown={(e) => startColResize(e, 'upad')}
                      onDoubleClick={(e) => resetColWidth(e, 'upad')}
                      title="Drag to resize, double-click to reset"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                    />
                  </th>
                  <th
                    style={{ width: colWidths['deduct'] ? `${colWidths['deduct']}px` : undefined }}
                    className="sticky top-0 z-10 w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-rose-200 bg-rose-50 px-1.5 py-2 text-right font-bold text-rose-900 relative group select-none"
                  >
                    <span>{tx("Upad Deduct")}</span>
                    <div
                      onMouseDown={(e) => startColResize(e, 'deduct')}
                      onDoubleClick={(e) => resetColWidth(e, 'deduct')}
                      title="Drag to resize, double-click to reset"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                    />
                  </th>
                  <th
                    style={{ width: colWidths['give'] ? `${colWidths['give']}px` : undefined }}
                    className="sticky top-0 z-10 w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-sky-200 bg-sky-50 px-1.5 py-2 text-right font-bold text-sky-900 relative group select-none"
                  >
                    <span>{tx("Give Upad")}</span>
                    <div
                      onMouseDown={(e) => startColResize(e, 'give')}
                      onDoubleClick={(e) => resetColWidth(e, 'give')}
                      title="Drag to resize, double-click to reset"
                      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-stone-400/50 active:bg-emerald-600 transition"
                    />
                  </th>
                  <th
                    style={{ width: colWidths['topay'] ? `${colWidths['topay']}px` : undefined }}
                    className="sticky top-0 z-10 w-24 min-w-[6rem] max-w-[7rem] border-b border-stone-200 bg-stone-50/80 px-2 py-2 text-right font-bold text-stone-900 select-none"
                  >
                    <span>{tx("To Pay")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                  {displayRows.map((row, rowIndex) => {
                  const locked = Boolean(selectedRun) || dateKey(cycleEnd) < rowBoundary(row.employee)
                  const rowTone = selectedRun
                    ? 'bg-stone-50/50 text-stone-500'
                    : row.draft.is_done
                      ? row.settlement.carry_out_paise > 0
                        ? 'bg-amber-50/70'
                        : 'bg-emerald-50/50'
                      : row.hasInput
                        ? 'bg-amber-50/45'
                      : row.noActivity
                        ? 'bg-stone-50/40 text-stone-400'
                        : 'bg-white'

                  return (
                    <tr key={row.employee.id} className={clsx('transition-colors hover:bg-stone-50/70', rowTone)}>
                      {/* Worker Column - Notion-style Title with Avatar & 2-line layout */}
                      <td
                        style={{ width: colWidths['worker'] ? `${colWidths['worker']}px` : undefined }}
                        className={clsx(
                          'sticky left-0 z-20 border-b border-r border-stone-200 px-3.5 py-2.5 text-left shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]',
                          selectedRun
                            ? 'bg-stone-100'
                            : row.draft.is_done
                              ? row.settlement.carry_out_paise > 0 ? 'bg-amber-100' : 'bg-emerald-50'
                              : row.hasInput ? 'bg-amber-50' : row.noActivity ? 'bg-stone-50' : 'bg-white',
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <span aria-hidden="true" className="w-4 shrink-0 text-right font-mono text-[9px] font-semibold tabular-nums text-stone-400">
                            {rowIndex + 1}
                          </span>
                          {/* Worker Avatar Pill */}
                          <div className={clsx(
                            'flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold select-none',
                            row.draft.is_done
                              ? row.settlement.carry_out_paise > 0
                                ? 'bg-amber-200/70 text-amber-950'
                                : 'bg-emerald-200/70 text-emerald-900'
                              : row.hasInput
                                ? 'bg-amber-100 text-amber-950'
                                : 'bg-stone-100 text-stone-700',
                          )}>
                            {row.employee.name
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')}
                          </div>

                          <div className="min-w-0 flex-1">
                            {/* Line 1: Name, Done indicator, Daily Rate */}
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <button
                                  disabled={Boolean(selectedRun)}
                                  onClick={() => setWorkerPopup(row.employee.id)}
                                  className="truncate text-left text-xs sm:text-[13px] font-bold text-stone-900 transition hover:text-emerald-700 cursor-pointer"
                                >
                                  {row.employee.name}
                                </button>
                                {locked && <LockKeyhole className="h-3 w-3 shrink-0 text-stone-400" />}
                                {row.draft.is_done && (
                                  <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-800">
                                    {tx("✓ Done")}
                                  </span>
                                )}
                              </div>
                              <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-stone-500">
                                {formatMoney(row.employee.daily_rate_paise)}/d
                              </span>
                            </div>

                            {/* Line 2: Carry & Upad Notion-style Tags */}
                            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                              {row.carry > 0 ? (
                                <span
                                  title={`${tx('Unpaid salary carry')} · ${formatDateRange(row.start || today, cycleEnd)} · ${formatMoney(row.carry)}`}
                                  className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 ring-1 ring-amber-600/20 tabular-nums"
                                >
                                  {tx('Carry +')}{formatMoney(row.carry)}
                                </span>
                              ) : row.carry < 0 ? (
                                <span
                                  title={`${tx('Salary balance owed')} · ${formatDateRange(row.start || today, cycleEnd)} · ${formatMoney(row.carry, { signed: true })}`}
                                  className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-900 ring-1 ring-rose-600/20 tabular-nums"
                                >
                                  {tx('Carry −')}{formatMoney(Math.abs(row.carry))}
                                </span>
                              ) : (
                                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 tabular-nums">
                                  {tx("Carry ₹0")}
                                </span>
                              )}

                              {row.upadBalance > 0 ? (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800 ring-1 ring-slate-300/60 tabular-nums">
                                  {tx('Upad')} {formatMoney(row.upadBalance)}
                                </span>
                              ) : (
                                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 tabular-nums">
                                  {tx('Upad')} ₹0
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Day Columns */}
                      {(collapsed ? ['Days'] : days).map((day) => {
                        if (day === 'Days') {
                          return (
                            <td
                              key="days-summary"
                              style={{ width: colWidths['Days'] ? `${colWidths['Days']}px` : undefined }}
                              className="min-w-[4.25rem] w-[4.5rem] border-b border-r border-stone-200 px-2 py-2 text-center text-xs font-bold tabular-nums"
                            >
                              {row.fraction.toFixed(row.fraction % 1 ? 1 : 0)}d
                            </td>
                          )
                        }

                        const isHoliday = holidays.has(day)
                        const beforeBoundary = day < rowBoundary(row.employee)
                        const att = attendanceByDay.get(`${row.employee.id}:${day}`)
                        const badge =
                          att?.status === 'hours'
                            ? `${Number((att.worked_minutes / 60).toFixed(1))}h`
                            : attendanceLabel(att?.status)

                        return (
                          <td
                            key={day}
                            style={{ width: colWidths[day] ? `${colWidths[day]}px` : undefined }}
                            className={clsx(
                              'min-w-[4.25rem] w-[4.5rem] border-b border-r px-1 py-1.5 text-center align-middle transition-colors',
                              isHoliday
                                ? 'border-rose-100 bg-rose-50/40'
                                : (beforeBoundary || selectedRun)
                                  ? 'border-stone-200/60 bg-stone-50/50'
                                  : 'border-stone-200/60 bg-white hover:bg-stone-50/60',
                            )}
                          >
                            <div className="relative inline-flex items-center justify-center">
                              <button
                                type="button"
                                aria-label={`${row.employee.name}, ${formatDateShort(day)}: ${badge}`}
                                disabled={beforeBoundary || Boolean(selectedRun)}
                                aria-expanded={dayPicker?.employee === row.employee.id && dayPicker.date === day}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') setDayPicker(null)
                                }}
                                onClick={() => setDayPicker((current) => current?.employee === row.employee.id && current.date === day ? null : { employee: row.employee.id, date: day })}
                                title={`${row.employee.name} · ${weekdayShort(day)} ${formatDateShort(day)} · Choose attendance`}
                                className={clsx(
                                  'h-8 w-11 flex items-center justify-center rounded-lg text-xs font-black transition-all duration-150 ease-out select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
                                  beforeBoundary || selectedRun
                                    ? 'cursor-not-allowed bg-stone-100 text-stone-300'
                                    : att?.status === 'full'
                                      ? 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 active:scale-95'
                                      : att?.status === 'half'
                                        ? 'bg-amber-500 text-white shadow-xs hover:bg-amber-600 active:scale-95'
                                        : att?.status === 'absent'
                                          ? 'bg-rose-500 text-white shadow-xs hover:bg-rose-600 active:scale-95'
                                          : att?.status === 'hours'
                                            ? 'bg-sky-600 text-white shadow-xs hover:bg-sky-700 active:scale-95'
                                            : isHoliday
                                              ? 'border-2 border-dashed border-rose-300 bg-rose-50/50 text-rose-300 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95'
                                              : 'border-2 border-dashed border-stone-200 bg-stone-50/40 text-stone-300 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95',
                                )}
                              >
                                <span>{badge === '—' ? (isHoliday ? tx('Off') : '') : badge}</span>
                              </button>
                              {dayPicker?.employee === row.employee.id && dayPicker.date === day && !beforeBoundary && !selectedRun && (
                                <div
                                  role="group"
                                  aria-label={`Attendance for ${row.employee.name}, ${formatDateShort(day)}`}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') setDayPicker(null)
                                  }}
                                  className="absolute left-1/2 top-full z-40 mt-1 grid -translate-x-1/2 grid-cols-2 gap-1 rounded-lg border border-stone-200 bg-white p-1.5 shadow-xl"
                                >
                                  {([
                                    ['full', 'P', 'bg-emerald-600'],
                                    ['half', 'H', 'bg-amber-500'],
                                    ['absent', 'A', 'bg-rose-500'],
                                  ] as const).map(([status, label, color]) => (
                                    <button key={status} type="button" onClick={() => { markAttendance(row.employee, day, status); setDayPicker(null) }} className={`h-7 min-w-8 rounded px-2 text-[10px] font-black text-white ${color}`}>
                                      {label}
                                    </button>
                                  ))}
                                  <button type="button" onClick={() => { showHours(row.employee, day, att); setDayPicker(null) }} className="h-7 rounded bg-sky-50 px-2 text-[10px] font-black text-sky-800 ring-1 ring-sky-200">{tx("Custom")}</button>
                                  <button type="button" onClick={() => { markAttendance(row.employee, day, undefined); setDayPicker(null) }} className="col-span-2 h-6 rounded text-[9px] font-semibold text-stone-500 hover:bg-stone-100">{tx("Clear")}</button>
                                </div>
                              )}

                              {Boolean(att?.ot_minutes) && (
                                <span
                                  title={`+${formatHours(att!.ot_minutes)} Overtime`}
                                  className="pointer-events-none absolute -right-1 -top-1 rounded bg-stone-900 px-1 py-0.2 text-[8px] font-black leading-tight text-white shadow-xs"
                                >
                                  +{formatHours(att!.ot_minutes)}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                  {!displayRows.length && (
                    <tr>
                      <td colSpan={collapsed ? 8 : days.length + 7} className="p-8 text-center text-xs text-stone-500">
                        {tx('No active workers match this search.')}
                      </td>
                    </tr>
                  )}

                      {/* Earned Column */}
                      <td
                        style={{ width: colWidths['earned'] ? `${colWidths['earned']}px` : undefined }}
                        className="w-24 min-w-[6rem] border-b border-r border-stone-200/60 px-2 py-1.5 text-right tabular-nums align-middle whitespace-nowrap"
                      >
                        <div className="font-mono text-xs sm:text-[13px] font-bold text-stone-900">
                          {formatMoney(row.earnings)}
                        </div>
                        <div className="mt-0.5">
                          <span className="inline-block rounded bg-stone-100 px-1 py-0.2 text-[9px] font-semibold text-stone-600 tabular-nums whitespace-nowrap">
                            {row.earnedBreakdown}
                          </span>
                        </div>
                      </td>

                      {/* Adj (+/−) Column */}
                      <td
                        style={{ width: colWidths['adj'] ? `${colWidths['adj']}px` : undefined }}
                        className="w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-stone-200/60 px-1.5 py-1.5 text-right tabular-nums align-middle"
                      >
                        <div className="flex flex-col items-end gap-0.5 w-full">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Adjustment for ${row.employee.name}`}
                            disabled={locked}
                            className={clsx(
                              'h-8 w-full max-w-[4.75rem] rounded-md border px-1.5 text-right font-mono text-xs font-semibold tabular-nums shadow-2xs outline-none transition',
                              row.draft.adj_paise > 0
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-950 font-bold focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600'
                                : row.draft.adj_paise < 0
                                  ? 'border-rose-300 bg-rose-50 text-rose-950 font-bold focus:border-rose-600 focus:ring-1 focus:ring-rose-600'
                                  : 'border-stone-200/60 bg-stone-50/40 text-stone-400 hover:bg-white hover:border-stone-300 focus:bg-white focus:border-stone-900 focus:ring-1 focus:ring-stone-900 focus:text-stone-900',
                              locked && 'cursor-not-allowed bg-stone-100 text-stone-400',
                            )}
                            value={adjInputs[row.employee.id] ?? paiseToInput(row.draft.adj_paise)}
                            placeholder="0"
                            onChange={(e) => {
                              const val = e.target.value
                              setAdjInputs((curr) => ({ ...curr, [row.employee.id]: val }))
                              void writeDraft(row.employee.id, {
                                adj_paise: parseMoneyInput(val),
                              })
                            }}
                            onBlur={(e) => {
                              const val = parseMoneyInput(e.target.value)
                              setAdjInputs((curr) => ({ ...curr, [row.employee.id]: paiseToInput(val) }))
                              void writeDraft(row.employee.id, {
                                adj_paise: val,
                                adj_note: row.draft.adj_note,
                              })
                            }}
                          />
                          <input
                            aria-label={`Adjustment note for ${row.employee.name}`}
                            disabled={locked}
                            className="w-full max-w-[4.75rem] border-b border-transparent bg-transparent px-1 text-[10px] text-right text-stone-500 outline-none placeholder:text-stone-300 hover:border-stone-200 focus:border-stone-400 focus:text-stone-800 transition"
                            placeholder="+ note"
                            value={row.draft.adj_note}
                            onChange={(e) =>
                              void writeDraft(row.employee.id, {
                                adj_note: e.target.value,
                              })
                            }
                          />
                        </div>
                      </td>

                      {/* Upad Column */}
                      <td
                        style={{ width: colWidths['upad'] ? `${colWidths['upad']}px` : undefined }}
                        className="w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-stone-200/60 px-1.5 py-1.5 text-right tabular-nums align-middle whitespace-nowrap"
                      >
                        <div className="font-mono text-xs font-bold text-slate-800">
                          {formatMoney(row.upadBalance)}
                        </div>
                        <div className="mt-0.5 text-[9px] font-medium text-stone-400">
                          {tx('rem:')} {formatMoney(row.afterUpad)}
                        </div>
                      </td>

                      {/* Deduct Column */}
                      <td
                        style={{ width: colWidths['deduct'] ? `${colWidths['deduct']}px` : undefined }}
                        className="w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-stone-200/60 px-1.5 py-1.5 text-right tabular-nums align-middle"
                      >
                        <div className="flex flex-col items-end w-full">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`Upad Deduct for ${row.employee.name}`}
                            disabled={locked}
                            className={clsx(
                              'h-8 w-full max-w-[4.75rem] rounded-md border px-1.5 text-right font-mono text-xs font-semibold tabular-nums shadow-2xs outline-none transition',
                              row.warnings.deductExceedsUpad
                                ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-1 focus:ring-rose-600'
                                : row.draft.deduct_paise > 0
                                  ? 'border-stone-300 bg-white text-stone-900 font-bold focus:border-stone-900 focus:ring-1 focus:ring-stone-900'
                                  : 'border-stone-200/60 bg-stone-50/40 text-stone-400 hover:bg-white hover:border-stone-300 focus:bg-white focus:border-stone-900 focus:ring-1 focus:ring-stone-900 focus:text-stone-900',
                              locked && 'cursor-not-allowed bg-stone-100 text-stone-400',
                            )}
                            value={paiseToInput(row.draft.deduct_paise)}
                            placeholder="0"
                            onChange={(e) =>
                              void writeDraft(row.employee.id, {
                                deduct_paise: parseMoneyInput(e.target.value),
                              })
                            }
                          />
                          {row.warnings.deductExceedsUpad && (
                            <span className="mt-0.5 text-[9px] font-semibold text-rose-700">
                              {tx("Exceeds")}
                            </span>
                          )}
                          {row.warnings.deductExceedsEarnings && !row.warnings.deductExceedsUpad && (
                            <span className="mt-0.5 text-[9px] font-semibold text-amber-700">
                              {tx("Exceeds earned")}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Give Upad Column */}
                      <td
                        style={{ width: colWidths['give'] ? `${colWidths['give']}px` : undefined }}
                        className="w-20 min-w-[5rem] max-w-[5.5rem] border-b border-r border-stone-200/60 px-1.5 py-1.5 text-right tabular-nums align-middle"
                      >
                        <div className="flex flex-col items-end w-full">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`Give Upad for ${row.employee.name}`}
                            disabled={locked}
                            className={clsx(
                              'h-8 w-full max-w-[4.75rem] rounded-md border px-1.5 text-right font-mono text-xs font-semibold tabular-nums shadow-2xs outline-none transition',
                              row.draft.give_upad_paise > 0
                                ? 'border-stone-300 bg-white text-stone-900 font-bold focus:border-stone-900 focus:ring-1 focus:ring-stone-900'
                                : 'border-stone-200/60 bg-stone-50/40 text-stone-400 hover:bg-white hover:border-stone-300 focus:bg-white focus:border-stone-900 focus:ring-1 focus:ring-stone-900 focus:text-stone-900',
                              locked && 'cursor-not-allowed bg-stone-100 text-stone-400',
                            )}
                            value={paiseToInput(row.draft.give_upad_paise)}
                            placeholder="0"
                            onChange={(e) =>
                              void writeDraft(row.employee.id, {
                                give_upad_paise: parseMoneyInput(e.target.value),
                              })
                            }
                          />
                        </div>
                      </td>

                      {/* To Pay Column */}
                      <td
                        style={{ width: colWidths['topay'] ? `${colWidths['topay']}px` : undefined }}
                        className="w-24 min-w-[6rem] max-w-[7rem] border-b border-stone-200 px-2 py-1.5 text-right tabular-nums align-middle whitespace-nowrap"
                      >
                        <div className="flex flex-col items-end w-full">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`To Pay for ${row.employee.name}`}
                            disabled={locked}
                            className={clsx(
                              'h-8 w-full max-w-[5.5rem] rounded-md px-1.5 text-right font-mono text-xs font-bold tabular-nums shadow-2xs outline-none transition',
                              row.draft.is_done
                                ? 'border-2 border-emerald-600 bg-emerald-50 text-emerald-950 font-black'
                              : 'border border-stone-300 bg-white text-stone-900 hover:border-stone-400 focus:border-stone-500 focus:bg-stone-100 focus:ring-1 focus:ring-stone-400',
                              locked && 'cursor-not-allowed bg-stone-100 text-stone-400',
                            )}
                            placeholder={paiseToInput(row.toPay)}
                            value={row.draft.typed_paise === null ? '' : paiseToInput(row.draft.typed_paise)}
                            onChange={(e) => {
                              const val = e.target.value
                              void writeDraft(row.employee.id, {
                                typed_paise: val === '' ? null : parseMoneyInput(val),
                                is_done: false,
                              })
                            }}
                            onBlur={(e) => {
                              const val = e.target.value
                              void writeDraft(row.employee.id, {
                                typed_paise: val === '' ? null : parseMoneyInput(val),
                                is_done: val !== '',
                              })
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur()
                              }
                            }}
                          />

                          {row.draft.is_done ? (
                            row.settlement.carry_out_paise > 0 ? (
                              <span className="mt-0.5 whitespace-nowrap text-[9px] font-semibold text-amber-800">
                                {tx('Carry +')}{formatMoney(row.settlement.carry_out_paise)}
                              </span>
                            ) : row.settlement.carry_out_paise < 0 ? (
                              <span className="mt-0.5 whitespace-nowrap text-[9px] font-semibold text-amber-800">
                                {tx('Overpaid −')}{formatMoney(Math.abs(row.settlement.carry_out_paise))}
                              </span>
                            ) : (
                              <span className="mt-0.5 whitespace-nowrap text-[9px] font-semibold text-emerald-700">
                                {tx("Paid in full ✓")}
                              </span>
                            )
                          ) : row.warnings.owesMoney ? (
                            <span className="mt-0.5 whitespace-nowrap text-[9px] font-bold text-rose-700">
                              {tx("Owes money")}
                            </span>
                          ) : (
                            <span className="mt-0.5 whitespace-nowrap text-[9px] font-medium text-stone-400">
                              {tx('To pay:')} {formatMoney(row.toPay)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {selectedRun && (
            <div className="border-t border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
              Closed cycle is read-only. This payout included {selectedStatements.length} worker statements.
            </div>
          )}
        </section>
      )}

      {/* Redesigned Worker Detail Popup */}
      {workerPopup && (
        <WorkerPopup
          employee={employees.find((e) => e.id === workerPopup)!}
          data={data}
          days={days}
          draft={draftFor(workerPopup)}
          onClose={() => setWorkerPopup(null)}
          onAttendance={markAttendance}
          onHours={showHours}
          onDraft={writeDraft}
          onUpad={(employee, kind, amount, note) =>
            addUpadEntry({ employee, kind, amount_paise: amount, note, date: today }).then(refresh)
          }
        />
      )}

      {/* Upad Dialog */}
      {upadPopup && (
        <UpadDialog
          date={upadPopup.date}
          employee={upadPopup.worker}
          employees={employees}
          onClose={() => setUpadPopup(null)}
          onSave={(employee, kind, amount, note) =>
            addUpadEntry({ employee, date: upadPopup.date, kind, amount_paise: amount, note }).then(refresh)
          }
        />
      )}

      {/* Hours Editor Modal */}
      {hoursEditor && (
        <Modal
          open
          onClose={() => setHoursEditor(null)}
          title={tx("Custom Hours & Overtime")}
          description={`Record exact work duration for ${formatDateShort(hoursEditor.date)}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setHoursEditor(null)}>
                {tx("Cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const worker = employees.find((e) => e.id === hoursEditor.employee)
                  if (worker) {
                    markAttendance(
                      worker,
                      hoursEditor.date,
                      'hours',
                      Math.round(Number(hoursValue) * 60),
                      Math.round(Number(otValue) * 60),
                    )
                  }
                  setHoursEditor(null)
                }}
              >
                {tx("Save Hours")}
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx('Hours Worked (regular)')} hint={tx('e.g. 4 for half day, 8 for full day')}>
              <Input
                autoFocus
                type="number"
                min="0"
                step="0.5"
                value={hoursValue}
                onChange={(e) => setHoursValue(e.target.value)}
                placeholder="8"
              />
            </Field>
            <Field label={tx('Overtime (hours)')} hint={tx('Additional OT hours worked')}>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={otValue}
                onChange={(e) => setOtValue(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* Confirm Payout Dialog */}
      {payoutConfirm && (
        <Modal
          open
          onClose={() => setPayoutConfirm(false)}
          title={`${tx('Confirm Payout')} · ${doneRows.length} ${tx('Workers in this Batch')}`}
          description={tx('Only completed (done) rows will be finalized into this payout batch. Open rows stay pending.')}
          size="md"
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={payoutMutation.isPending}
                onClick={() => setPayoutConfirm(false)}
              >
                {tx("Cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={payoutMutation.isPending}
                onClick={() => payoutMutation.mutate()}
              >
                {tx('Confirm Payout')} ({formatMoney(totalPaid)})
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-stone-500">
                {tx('Workers in this Batch')} ({doneRows.length})
              </div>
              <div className="divide-y divide-stone-200/70 max-h-56 overflow-y-auto overscroll-contain">
                {doneRows.map((r) => (
                  <div key={r.employee.id} className="flex items-center justify-between py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-stone-800">{r.employee.name}</span>
                      <span className="font-mono text-[10px] text-stone-400">
                        {r.fraction.toFixed(r.fraction % 1 ? 1 : 0)}d {tx('worked')}
                      </span>
                    </div>
                    <span className="font-mono font-bold tabular-nums text-emerald-900">
                      {formatMoney(r.draft.typed_paise ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-stone-200 pt-2.5 text-sm font-black">
                <span className="text-stone-900">{tx("Total Net Payout")}</span>
                <span className="font-mono text-emerald-800 tabular-nums">{formatMoney(totalPaid)}</span>
              </div>
            </div>

            {payoutMutation.isError && (
              <div role="alert" aria-live="assertive" className="rounded-lg bg-rose-50 p-2.5 text-xs font-bold text-rose-800 ring-1 ring-rose-200">
                {payoutMutation.error.message}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Unlock Run Dialog */}
      {unlockRun && (
        <Modal
          open
          onClose={() => { setUnlockRun(null); setUnlockReason('') }}
          title={tx("Unlock Closed Payout")}
          description={tx('Reverses this payout batch, voids statements, restores employee balances, and reopens attendance for editing.')}
          size="sm"
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={unlockMutation.isPending}
                onClick={() => { setUnlockRun(null); setUnlockReason('') }}
              >
                {tx("Cancel")}
              </Button>
              <Button
                variant="amber"
                size="sm"
                loading={unlockMutation.isPending}
                disabled={!unlockReason.trim()}
                onClick={() => unlockMutation.mutate()}
              >
                {tx("Unlock Payout Batch")}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="Reason for Unlocking (required for audit log)">
              <Textarea
                autoFocus
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder={tx("e.g. Correcting overtime entry for Ramesh or adjusting daily rate")}
                className="min-h-22"
              />
            </Field>

            {unlockMutation.isError && (
              <div role="alert" aria-live="assertive" className="rounded-lg bg-rose-50 p-2.5 text-xs font-bold text-rose-800 ring-1 ring-rose-200">
                {unlockMutation.error.message}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function RegisterMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'red' | 'green'
}) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap text-xs">
      <span className="font-semibold text-stone-500">{label}</span>
      <span
        className={clsx(
          'font-black tabular-nums text-stone-900',
          tone === 'red' && 'text-rose-700',
          tone === 'green' && 'text-emerald-700',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
      <input
        aria-label={tx("Search")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="h-7 w-full rounded-lg border border-stone-200 bg-white pl-7 pr-2 text-xs font-medium text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-emerald-600"
      />
    </label>
  )
}

function ZoomControl({
  zoom,
  onChange,
  onReset,
}: {
  zoom: number
  onChange: (delta: number) => void
  onReset: () => void
}) {
  return (
    <div className="inline-flex h-8.5 items-center rounded-lg border border-stone-200 bg-white p-0.5 shadow-2xs">
      <button
        type="button"
        onClick={() => onChange(-10)}
        disabled={zoom <= 70}
        aria-label={tx('Zoom out')}
        title={tx('Zoom out (smaller text & compact grid)')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label={tx('Reset zoom')}
        title={tx('Reset zoom to 100%')}
        className="min-w-[3.25rem] px-1 text-center font-mono text-xs font-bold text-stone-700 transition hover:text-emerald-700 cursor-pointer select-none"
      >
        {zoom}%
      </button>
      <button
        type="button"
        onClick={() => onChange(10)}
        disabled={zoom >= 140}
        aria-label={tx('Zoom in')}
        title={tx('Zoom in (larger text & cells)')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function StatusPill({
  active,
  disabled,
  label,
  hint,
  tone,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  label: string
  hint: string
  tone: 'emerald' | 'amber' | 'rose'
  onClick: () => void
}) {
  const activeStyles = {
    emerald: 'bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700 active:scale-95',
    amber: 'bg-amber-500 text-white shadow-2xs hover:bg-amber-600 active:scale-95',
    rose: 'bg-rose-500 text-white shadow-2xs hover:bg-rose-600 active:scale-95',
  }
  const idleStyles = {
    emerald: 'border border-stone-200 bg-white text-stone-700 hover:border-emerald-400 hover:bg-emerald-50/40 hover:text-emerald-800 active:scale-95',
    amber: 'border border-stone-200 bg-white text-stone-700 hover:border-amber-400 hover:bg-amber-50/40 hover:text-amber-800 active:scale-95',
    rose: 'border border-stone-200 bg-white text-stone-700 hover:border-rose-400 hover:bg-rose-50/40 hover:text-rose-800 active:scale-95',
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={tx(hint)}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none cursor-pointer',
        active ? activeStyles[tone] : idleStyles[tone],
      )}
    >
      <span>{label}</span>
      <span className="hidden text-[10px] font-medium opacity-80 md:inline">{hint}</span>
    </button>
  )
}

function UpadDialog({
  date,
  employee,
  employees,
  onClose,
  onSave,
}: {
  date: string
  employee?: string
  employees: Employee[]
  onClose: () => void
  onSave: (employee: string, kind: 'give' | 'repay', amount: number, note: string) => Promise<unknown>
}) {
  const [worker, setWorker] = useState(employee ?? employees[0]?.id ?? '')
  const [kind, setKind] = useState<'give' | 'repay'>('give')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeWorker = employees.find((e) => e.id === worker)

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'give' ? tx('Give Upad Advance') : tx('Record Cash Return')}
      description={`${tx(kind === 'give' ? 'Give an advance to' : 'Record cash returned by')} ${activeWorker?.name ?? tx('Worker')} ${tx('on')} ${formatDateShort(date)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {tx("Cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!worker || !parseMoneyInput(amount)}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onSave(worker, kind, parseMoneyInput(amount), note)
                onClose()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not save this Upad entry.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {kind === 'give' ? tx('Give Upad') : tx('Record Cash Return')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Type Selector */}
        <div className="flex gap-2">
          {(['give', 'repay'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setKind(v)}
              className={clsx(
                'flex-1 rounded-xl border py-2 text-xs font-bold transition select-none cursor-pointer',
                kind === v
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-2xs'
                  : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
              )}
            >
              {v === 'give' ? tx('Give Advance (+)') : tx('Cash Return (−)')}
            </button>
          ))}
        </div>

        <Field label={tx('Worker')}>
          <Select
            disabled={Boolean(employee)}
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({formatMoney(e.daily_rate_paise)}/d)
              </option>
            ))}
          </Select>
        </Field>

        <Field label={tx('Amount (₹)')}>
          <Input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono text-base font-bold tabular-nums"
            placeholder="₹0"
          />
        </Field>

        <Field label={tx('Note (optional)')} hint={tx('e.g. Festival advance, emergency cash')}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tx("Add a short note…")}
          />
        </Field>

        {error && (
          <div role="alert" aria-live="assertive" className="rounded-lg bg-rose-50 p-2.5 text-xs font-bold text-rose-800 ring-1 ring-rose-200">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

/* Redesigned Worker Detail Popup (Section 10.2) */
function WorkerPopup({
  employee,
  data,
  days,
  draft,
  onClose,
  onAttendance,
  onHours,
  onDraft,
  onUpad,
}: {
  employee: Employee
  data: AppData
  days: string[]
  draft: DraftInput
  onClose: () => void
  onAttendance: (
    employee: Employee,
    date: string,
    status?: AttendanceStatus,
    worked?: number,
    ot?: number,
    notes?: string,
  ) => void
  onHours: (employee: Employee, date: string, existing?: Attendance) => void
  onDraft: (employee: string, patch: Partial<DraftInput>) => Promise<void>
  onUpad: (employee: string, kind: 'give' | 'deduct' | 'repay', amount: number, note: string) => Promise<unknown>
}) {
  const [activeTab, setActiveTab] = useState<'settlement' | 'attendance' | 'upad'>('settlement')
  const [upadAmount, setUpadAmount] = useState('')
  const [upadKind, setUpadKind] = useState<'give' | 'deduct' | 'repay'>('give')
  const [upadNote, setUpadNote] = useState('')
  const [savingUpad, setSavingUpad] = useState(false)
  const [upadError, setUpadError] = useState('')

  const boundary = rowBoundary(employee)
  const cycleEnd = days.at(-1) ?? todayKey()
  const workerDays = data.attendance.filter(
    (a) =>
      a.employee === employee.id &&
      !a.settled_payout &&
      dateKey(a.date) >= boundary &&
      dateKey(a.date) <= cycleEnd,
  )
  const earned = workerDays.reduce(
    (sum, att) =>
      sum +
      calcDayEarnings(
        att,
        employee.daily_rate_paise,
        data.settings.shift_hours,
        data.settings.ot_multiplier,
      ).earned_paise,
    0,
  )

  const orderedUpad = data.upad
    .filter((e) => e.employee === employee.id && !e.voided)
    .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)))

  let running = employee.opening_upad_paise
  const ledger = orderedUpad
    .map((entry) => {
      running += entry.kind === 'give' ? entry.amount_paise : -entry.amount_paise
      return { entry, balance: running }
    })
    .slice(-8)
    .reverse()

  const currentUpadBalance = calcUpadBalance(employee.opening_upad_paise, orderedUpad)
  const carry =
    latestStatement(data.statements, employee.id, data.runs)?.closing_paise ??
    employee.opening_carry_paise ??
    0

  const toPay = calcToPay(carry, earned, draft.adj_paise, draft.deduct_paise, draft.give_upad_paise)
  const settlement = calcPayoutSettlement(toPay, draft.typed_paise ?? 0)
  const upadAfter = calcUpadAfter(currentUpadBalance, draft.deduct_paise, draft.give_upad_paise)

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-3">
          <Avatar name={employee.name} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold text-stone-900">{employee.name}</span>
              {draft.is_done ? (
                <Badge tone="green">{tx("✓ Done")}</Badge>
              ) : (
                <Badge tone="neutral">{tx("Open Draft")}</Badge>
              )}
              <Badge tone="neutral">{tx(employee.role || 'Worker')}</Badge>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs font-medium text-stone-500">
              <span className="font-mono font-bold text-stone-800">{formatMoney(employee.daily_rate_paise)} / day</span>
              {employee.phone && (
                <>
                  <span>·</span>
                  <span>{employee.phone}</span>
                </>
              )}
            </div>
          </div>
        </div>
      }
      footer={
        <>
          {activeTab === 'settlement' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void onDraft(employee.id, {
                  typed_paise: toPay,
                  is_done: true,
                })
              }
            >
              Pay Exact ({formatMoney(toPay)})
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {tx("Close")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{tx("Cycle Days")}</div>
            <div className="mt-0.5 font-mono text-base font-extrabold text-stone-900 tabular-nums">
              {workerDays.length}d <span className="text-xs font-normal text-stone-500">({formatMoney(earned)})</span>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{tx("Salary Carry")}</div>
            <div className="mt-0.5 font-mono text-base font-extrabold tabular-nums">
              {carry > 0 ? (
                <span className="text-amber-800">+{formatMoney(carry)}</span>
              ) : carry < 0 ? (
                <span className="text-rose-700">−{formatMoney(Math.abs(carry))}</span>
              ) : (
                <span className="text-stone-700">₹0</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{tx("Upad Balance")}</div>
            <div className="mt-0.5 font-mono text-base font-extrabold text-slate-800 tabular-nums">
              {formatMoney(currentUpadBalance)}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">{tx("Net To Pay")}</div>
            <div className="mt-0.5 font-mono text-base font-extrabold text-emerald-950 tabular-nums">
              {formatMoney(toPay)}
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { id: 'settlement', label: tx('Settlement & Payout'), icon: <Wallet className="h-3.5 w-3.5" /> },
            { id: 'attendance', label: tx('Attendance Days'), count: workerDays.length, icon: <CalendarCheck className="h-3.5 w-3.5" /> },
            { id: 'upad', label: tx('Upad Ledger & Actions'), icon: <Coins className="h-3.5 w-3.5" /> },
          ]}
        />

        {/* Tab 1: Settlement & Payout */}
        {activeTab === 'settlement' && (
          <div className="space-y-3">
            {/* Visual Formula Line */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50/70 p-3 font-mono text-xs tabular-nums">
              <span className="font-semibold text-stone-700">{tx('Carry')} ({formatMoney(carry)})</span>
              <span className="text-stone-400">+</span>
              <span className="font-semibold text-stone-700">{tx('Earned')} ({formatMoney(earned)})</span>
              <span className="text-stone-400">{draft.adj_paise < 0 ? '−' : '+'}</span>
              <span className="font-semibold text-stone-700">{tx('Adjustment')} ({formatMoney(Math.abs(draft.adj_paise))})</span>
              <span className="text-stone-400">−</span>
              <span className="font-semibold text-rose-700">Upad Deduct ({formatMoney(draft.deduct_paise)})</span>
              <span className="text-stone-400">+</span>
              <span className="font-semibold text-sky-700">{tx('Give Upad')} ({formatMoney(draft.give_upad_paise)})</span>
              <span className="text-stone-400">=</span>
              <span className="font-black text-stone-900 text-sm">{formatMoney(toPay)}</span>
            </div>

            {/* Adjustments & Upad in Settlement Grid */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
                <div className="text-xs font-bold text-stone-800">{tx("Salary Adjustment (+/−)")}</div>
                <Field label={tx('Adjustment (₹)')} hint={tx('Positive for bonus/add, negative for penalty/deduct')}>
                  <Input
                    inputMode="decimal"
                    value={paiseToInput(draft.adj_paise)}
                    onChange={(e) =>
                      void onDraft(employee.id, {
                        adj_paise: parseMoneyInput(e.target.value),
                      })
                    }
                    className="font-mono text-xs font-bold tabular-nums"
                  />
                </Field>
                <Field label={tx('Adjustment Note')}>
                  <Input
                    value={draft.adj_note}
                    onChange={(e) =>
                      void onDraft(employee.id, {
                        adj_note: e.target.value,
                      })
                    }
                    placeholder={tx("e.g. Festival bonus, late arrival")}
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-3 space-y-2">
                <div className="text-xs font-bold text-stone-800">{tx("Upad in this Settlement")}</div>
                <Field label={tx('Deduct Upad from Salary (₹)')} hint={`${tx('Max available:')} ${formatMoney(currentUpadBalance)}`}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={paiseToInput(draft.deduct_paise)}
                    onChange={(e) =>
                      void onDraft(employee.id, {
                        deduct_paise: parseMoneyInput(e.target.value),
                      })
                    }
                    className="font-mono text-xs font-bold tabular-nums"
                  />
                </Field>
                <Field label={tx('Give Upad (₹)')}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={paiseToInput(draft.give_upad_paise)}
                    onChange={(e) =>
                      void onDraft(employee.id, {
                        give_upad_paise: parseMoneyInput(e.target.value),
                      })
                    }
                    className="font-mono text-xs font-bold tabular-nums"
                  />
                </Field>
                <div className="text-[11px] font-medium text-stone-500">
                  {tx("Remaining Upad after payout:")} <b className="font-mono text-stone-800">{formatMoney(upadAfter)}</b>
                </div>
              </div>
            </div>

            {/* Amount Actually Paid Box */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-900">
                  {tx("Amount Paid to Worker (Typed)")}
                </span>
                <span className="text-[11px] text-stone-500 font-medium">
                  {tx("Calculated target:")} <b className="font-mono text-stone-800">{formatMoney(toPay)}</b>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  placeholder={paiseToInput(toPay)}
                  value={draft.typed_paise === null ? '' : paiseToInput(draft.typed_paise)}
                  onChange={(e) =>
                    void onDraft(employee.id, {
                      typed_paise: e.target.value === '' ? null : parseMoneyInput(e.target.value),
                      is_done: false,
                    })
                  }
                  onBlur={(e) =>
                    void onDraft(employee.id, {
                      typed_paise: e.target.value === '' ? null : parseMoneyInput(e.target.value),
                      is_done: e.target.value !== '',
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur()
                    }
                  }}
                  className={clsx(
                    'h-10 flex-1 font-mono text-base font-bold tabular-nums',
                    draft.is_done ? 'border-emerald-600 bg-white ring-2 ring-emerald-600/20' : '',
                  )}
                />

                <Button
                  variant="primary"
                  onClick={() =>
                    void onDraft(employee.id, {
                      typed_paise: toPay,
                      is_done: true,
                    })
                  }
                >
                  {tx("Pay Exact")}
                </Button>
              </div>

              {/* Settlement Result Explanation */}
              <div className="text-xs font-semibold">
                {draft.is_done ? (
                  settlement.carry_out_paise > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-800">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      {tx('Carry +')}{formatMoney(settlement.carry_out_paise)} {tx('unpaid salary forward to next cycle')}
                    </span>
                  ) : settlement.carry_out_paise < 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-800">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      {tx('Overpaid −')}{formatMoney(Math.abs(settlement.carry_out_paise))} {tx('will be deducted from next cycle')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-emerald-800">
                      <Check className="h-4 w-4 text-emerald-600" />
                      {tx("Paid in full (Carry: ₹0)")}
                    </span>
                  )
                ) : (
                  <span className="text-stone-400 font-normal">{tx("Untyped draft (open row)")}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Attendance Days */}
        {activeTab === 'attendance' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>{tx("Choose P, H, A, Custom, or Clear for each day.")}</span>
              <span className="font-mono font-bold text-stone-700">{workerDays.length} days worked</span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {days.map((day) => {
                const att = data.attendance.find((a) => a.employee === employee.id && dateKey(a.date) === day)
                const locked = day < boundary
                const status = att?.status
                const isHoliday = data.holidays.some((h) => dateKey(h.date) === day)

                return (
                  <div
                    key={day}
                    className={clsx(
                      'flex flex-col items-center rounded-xl border p-2 text-center transition shadow-2xs',
                      locked
                        ? 'border-stone-200 bg-stone-50 text-stone-400'
                        : isHoliday
                          ? 'border-rose-200 bg-rose-50/50'
                          : 'border-stone-200 bg-white',
                    )}
                  >
                    <div className="text-[10px] font-bold text-stone-400 uppercase">{weekdayShort(day)}</div>
                    <div className="text-xs font-bold text-stone-800">{Number(day.slice(-2))}</div>

                    <div className="relative mt-1.5 inline-flex flex-col items-center">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => onAttendance(employee, day, nextStatus(status))}
                        className={clsx(
                          'h-8.5 w-12 flex items-center justify-center rounded-lg text-xs font-black shadow-xs transition-all duration-150 ease-out select-none active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 cursor-pointer',
                          status === 'full'
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : status === 'half'
                              ? 'bg-amber-500 text-white hover:bg-amber-600'
                              : status === 'absent'
                                ? 'bg-rose-500 text-white hover:bg-rose-600'
                                : status === 'hours'
                                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                                  : 'border-2 border-dashed border-stone-200 bg-stone-50 text-stone-300 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700',
                        )}
                      >
                        {status === 'hours'
                          ? `${Math.round((att?.worked_minutes || 0) / 60)}h`
                          : attendanceLabel(status)}
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => onHours(employee, day, att)}
                        aria-label={`Set custom hours for ${employee.name} on ${formatDateShort(day)}`}
                        title={tx("Set custom work hours and overtime")}
                        className="mt-1 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-sky-800 ring-1 ring-sky-200 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-40"
                      >
                        {tx("Custom")}
                      </button>

                      {Boolean(att?.ot_minutes) && (
                        <span className="pointer-events-none absolute -right-1 -top-1 rounded bg-stone-900 px-1 py-0.2 text-[8px] font-black leading-tight text-white shadow-xs">
                          +{formatHours(att!.ot_minutes)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Upad Ledger & Quick Actions */}
        {activeTab === 'upad' && (
          <div className="grid gap-4 sm:grid-cols-[1.1fr_1fr]">
            {/* Left: Action Form */}
            <div className="rounded-xl border border-stone-200 bg-white p-3.5 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                  <Coins className="h-4 w-4 text-slate-700" />
                  {tx("Quick Upad Action")}
                </span>
                <span className="text-[11px] text-stone-500">
                  {tx("Current:")} <b className="font-mono text-stone-900">{formatMoney(currentUpadBalance)}</b>
                </span>
              </div>

              <div className="flex gap-1 rounded-xl border border-stone-200 bg-stone-50 p-1">
                {(['give', 'deduct', 'repay'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setUpadKind(k)}
                    className={clsx(
                      'flex-1 rounded-lg py-1.5 text-center text-xs font-bold transition select-none cursor-pointer',
                      upadKind === k
                        ? 'bg-white text-stone-900 shadow-2xs'
                        : 'text-stone-600 hover:text-stone-900',
                    )}
                  >
                    {tx(k === 'give' ? 'Give Upad' : k === 'deduct' ? 'Upad Deduct' : 'Cash Return')}
                  </button>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Amount (₹)">
                  <Input
                    inputMode="decimal"
                    value={upadAmount}
                    onChange={(e) => setUpadAmount(e.target.value)}
                    placeholder="₹0"
                    className="font-mono text-xs font-bold tabular-nums"
                  />
                </Field>
                <Field label="Note (optional)">
                  <Input
                    value={upadNote}
                    onChange={(e) => setUpadNote(e.target.value)}
                    placeholder={tx("e.g. Festival advance")}
                  />
                </Field>
              </div>

              {upadError && (
                <div role="alert" aria-live="assertive" className="rounded-lg bg-rose-50 p-2 text-xs font-bold text-rose-800 ring-1 ring-rose-200">
                  {upadError}
                </div>
              )}

              <Button
                variant="primary"
                size="sm"
                className="w-full"
                loading={savingUpad}
                disabled={!parseMoneyInput(upadAmount)}
                onClick={async () => {
                  const val = parseMoneyInput(upadAmount)
                  if (val <= 0) return
                  setSavingUpad(true)
                  setUpadError('')
                  try {
                    if (upadKind === 'repay') {
                      await onUpad(employee.id, 'repay', val, upadNote || 'Cash Return')
                    } else if (upadKind === 'give') {
                      await onDraft(employee.id, { give_upad_paise: val })
                    } else {
                      await onDraft(employee.id, { deduct_paise: val })
                    }
                    setUpadAmount('')
                    setUpadNote('')
                  } catch (err) {
                    setUpadError(err instanceof Error ? err.message : 'Failed to apply.')
                  } finally {
                    setSavingUpad(false)
                  }
                }}
              >
                {upadKind === 'repay' ? 'Record Cash Repayment' : 'Apply to Cycle Draft'}
              </Button>
            </div>

            {/* Right: Recent Ledger History */}
            <div className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-stone-400" /> {tx("Recent Ledger Entries")}
                </div>
                <div className="divide-y divide-stone-100 max-h-48 overflow-y-auto overscroll-contain">
                  {ledger.length ? (
                    ledger.map(({ entry, balance }) => (
                      <div key={entry.id} className="flex items-center justify-between py-1.5 text-xs">
                        <div>
                          <div className="font-semibold text-stone-800">
                            {entry.note ||
                              (entry.kind === 'give'
                                ? tx('Advance given')
                                : entry.kind === 'deduct'
                                  ? tx('Upad Deduct')
                                  : tx('Cash returned'))}
                          </div>
                          <div className="text-[10px] text-stone-400">{formatDateShort(entry.date)}</div>
                        </div>
                        <div className="text-right">
                          <div
                            className={clsx(
                              'font-mono font-bold tabular-nums',
                              entry.kind === 'give' ? 'text-slate-800' : 'text-stone-800',
                            )}
                          >
                            {entry.kind === 'give' ? '+' : '−'}
                            {formatMoney(entry.amount_paise)}
                          </div>
                          <div className="font-mono text-[9px] text-stone-400 tabular-nums">{tx('Bal')} {formatMoney(balance)}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-xs text-stone-400">{tx("No ledger entries.")}</div>
                  )}
                </div>
              </div>

              <div className="border-t border-stone-100 pt-2 text-[11px] text-stone-500 flex justify-between">
                <span>{tx("Opening:")} <b className="font-mono">{formatMoney(employee.opening_upad_paise)}</b></span>
                <span>{tx("Current:")} <b className="font-mono text-stone-900">{formatMoney(currentUpadBalance)}</b></span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
