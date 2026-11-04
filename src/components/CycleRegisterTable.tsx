import React, { useMemo, useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  Search,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  HandCoins,
  History,
  Lock,
  MoreVertical,
  Pencil,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  UserCheck,
  UserMinus,
} from 'lucide-react'
import {
  calculateDeductCap,
  calculatePaidCap,
  calculateToPay,
  calculateNewCarry,
  getWorkerUpadBalance,
  getWorkerUpadLedger,
  workerFromDate,
  dayEarnings,
  rateOn,
  inAnyPeriod,
  DEFAULT_FULL_DAY_MINUTES,
  type DayStatus,
  type UpadRow,
} from '../lib/engine'
import {
  formatMoney,
  formatHours,
  paiseToInput,
  rupeesToPaise,
} from '../lib/money'
import {
  addDays,
  dateKey,
  daysBetweenInclusive,
  formatDateLong,
  formatDateShort,
  todayKey,
  weekdayShort,
  isFriday,
} from '../lib/dates'
import {
  createAdjustment,
  createSalaryWriteoff,
  createUpadEntry,
  deleteAdjustment,
  deleteAttendance,
  deleteCycleDraft,
  deleteUpadEntry,
  getPayrollData,
  listCycleDrafts,
  listStatements,
  saveAttendance,
  saveCycleDraft,
  setEmployeeActive,
} from '../lib/api'
import {
  computeNextCycleStartFromPaidDates,
  getWorkerPaidUpToDate,
  otDivisor,
  realPayoutRuns,
} from '../lib/cycle'
import { pb, COLLECTIONS } from '../lib/pb'
import { useToast } from './Toast'
import { Avatar, Button, Field, Input, Modal } from './ui'
import { StatementModal, type StatementData } from './StatementModal'
import { UpadHistoryModal } from './UpadHistoryModal'
import { UpadReturnModal } from './UpadReturnModal'
import { LeavingSettlementModal, type LeavingSettlementData } from './LeavingSettlementModal'
import { CloseCycleModal, type UndoneWorkerSummary } from './CloseCycleModal'
import type {
  Adjustment,
  Attendance,
  AttendanceStatus,
  CycleDraft,
  Employee,
  PayoutRun,
  SettingsMap,
  Statement,
  UpadEntry,
} from '../lib/types'

type RowDraftState = {
  deductInput: string
  giveUpadInput: string
  paidInput: string
  paidDate: string
  workCountedUpTo: string
  isDone: boolean
  createdUpadIds?: string
  adjustmentAmountInput: string
  adjustmentNoteInput: string
}

const NEXT_ATTENDANCE_STATUS: Record<string, AttendanceStatus | null> = {
  none: 'full',
  full: 'half',
  half: 'absent',
  absent: null,
  hours: null,
}

function attendanceCellStyle(status?: AttendanceStatus | null) {
  if (status === 'full') {
    return 'border-emerald-300 bg-emerald-50 text-emerald-950 font-black hover:bg-emerald-100 hover:border-emerald-400'
  }
  if (status === 'half') {
    return 'border-amber-300 bg-amber-50 text-amber-950 font-black hover:bg-amber-100 hover:border-amber-400'
  }
  if (status === 'absent') {
    return 'border-rose-300 bg-rose-50 text-rose-950 font-black hover:bg-rose-100 hover:border-rose-400'
  }
  if (status === 'hours') {
    return 'border-sky-300 bg-sky-50 text-sky-950 font-black hover:bg-sky-100 hover:border-sky-400'
  }
  return 'border-stone-200 bg-stone-50/60 text-stone-300 hover:border-emerald-400 hover:bg-white hover:text-stone-500'
}

function parseAdjustmentInput(raw: string): number {
  const trimmed = (raw || '').trim().replace(/\s+/g, '')
  if (!trimmed || trimmed === '+' || trimmed === '-') return 0
  const isNegative = trimmed.startsWith('-')
  const clean = trimmed.replace(/^[+-]/, '')
  const num = Number.parseFloat(clean)
  if (!Number.isFinite(num)) return 0
  const paise = Math.round(num * 100)
  return isNegative ? -paise : paise
}

function getToPaySummary(row: {
  earnedPaise: number
  carryPaise: number
  adjustmentPaise: number
  deductPaise: number
  giveUpadPaise: number
}): string {
  const parts: string[] = []
  parts.push(formatMoney(row.earnedPaise))
  if (row.carryPaise > 0) parts.push(`+${formatMoney(row.carryPaise)} carry`)
  if (row.adjustmentPaise > 0) parts.push(`+${formatMoney(row.adjustmentPaise)} adj`)
  if (row.adjustmentPaise < 0) parts.push(`-${formatMoney(Math.abs(row.adjustmentPaise))} adj`)
  if (row.deductPaise > 0) parts.push(`-${formatMoney(row.deductPaise)} ded`)
  if (row.giveUpadPaise > 0) parts.push(`+${formatMoney(row.giveUpadPaise)} upad`)

  if (parts.length === 1) return `Earned ${parts[0]}`
  return parts.join(' ')
}

export function CycleRegisterTable({
  cycleStart,
  gridEndDate,
  activeEmployees = [],
  allEmployees = [],
  statements = [],
  attendance = [],
  upadEntries = [],
  adjustments = [],
  rates = [],
  periods = [],
  settings = {},
  isPastCycle = false,
  selectedCycleId,
  completedRuns = [],
  onSelectCycleId,
  onOpenAttendanceEditor,
  viewMode,
  onViewModeChange,
}: {
  cycleStart: string
  gridEndDate: string
  activeEmployees: Employee[]
  allEmployees: Employee[]
  statements: Statement[]
  attendance: Attendance[]
  upadEntries: UpadEntry[]
  adjustments: Adjustment[]
  rates: any[]
  periods: any[]
  settings: SettingsMap
  isPastCycle: boolean
  selectedCycleId: string
  completedRuns: PayoutRun[]
  onSelectCycleId: (id: string) => void
  onOpenAttendanceEditor: (employeeId: string, date: string) => void
  viewMode?: 'today' | 'cycle'
  onViewModeChange?: (mode: 'today' | 'cycle') => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const today = todayKey()
  const fullDayMinutes = DEFAULT_FULL_DAY_MINUTES

  // View state
  const [isWeekCollapsed, setIsWeekCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [rowMenuWorkerId, setRowMenuWorkerId] = useState<string | null>(null)
  const [activeAdjModalWorker, setActiveAdjModalWorker] = useState<Employee | null>(null)
  const [statementData, setStatementData] = useState<StatementData | null>(null)
  const [upadHistoryWorker, setUpadHistoryWorker] = useState<Employee | null>(null)
  const [upadReturnWorker, setUpadReturnWorker] = useState<Employee | null>(null)
  const [leavingWorkerData, setLeavingWorkerData] = useState<LeavingSettlementData | null>(null)
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [isClosingCycle, setIsClosingCycle] = useState(false)

  // Local state for staged draft inputs (keyed by employeeId)
  const [rowStates, setRowStates] = useState<Record<string, RowDraftState>>({})

  // Fetch persisted drafts from PocketBase
  const draftsQuery = useQuery({
    queryKey: ['cycle_drafts', cycleStart],
    queryFn: () => listCycleDrafts(cycleStart),
    enabled: Boolean(cycleStart && !isPastCycle),
  })

  // Sync drafts into local rowStates
  useEffect(() => {
    if (!draftsQuery.data) return
    setRowStates((prev) => {
      const next = { ...prev }
      for (const draft of draftsQuery.data!) {
        const empId = draft.employee
        let draftAdj = ''
        if (draft.note) {
          try {
            const parsed = JSON.parse(draft.note)
            if (parsed.adj !== undefined) draftAdj = String(parsed.adj)
          } catch {
            draftAdj = draft.note
          }
        }
        next[empId] = {
          deductInput: draft.deduct_paise ? paiseToInput(draft.deduct_paise) : (next[empId]?.deductInput ?? ''),
          giveUpadInput: draft.give_upad_paise ? paiseToInput(draft.give_upad_paise) : (next[empId]?.giveUpadInput ?? ''),
          paidInput: draft.paid_paise !== null && draft.paid_paise !== undefined
            ? paiseToInput(draft.paid_paise)
            : (next[empId]?.paidInput ?? ''),
          paidDate: draft.paid_date || next[empId]?.paidDate || today,
          workCountedUpTo: draft.work_counted_up_to || next[empId]?.workCountedUpTo || gridEndDate,
          isDone: Boolean(draft.is_done),
          createdUpadIds: draft.created_upad_ids || next[empId]?.createdUpadIds,
          adjustmentAmountInput: draftAdj !== '' ? draftAdj : (next[empId]?.adjustmentAmountInput ?? ''),
          adjustmentNoteInput: next[empId]?.adjustmentNoteInput ?? '',
        }
      }
      return next
    })
  }, [draftsQuery.data, gridEndDate, today])

  // Paid up to dates per worker
  const workerPaidUpToMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const emp of allEmployees) {
      const paidDate = getWorkerPaidUpToDate(emp.id, statements)
      if (paidDate) map.set(emp.id, paidDate)
    }
    return map
  }, [allEmployees, statements])

  // Latest non-voided statement per worker
  const latestStatementMap = useMemo(() => {
    const map = new Map<string, Statement>()
    for (const s of statements) {
      if (s.voided) continue
      const cur = map.get(s.employee)
      if (!cur || (s.payout_date && (!cur.payout_date || s.payout_date > cur.payout_date))) {
        map.set(s.employee, s)
      }
    }
    return map
  }, [statements])

  // Date range for day columns
  const days = useMemo(() => {
    if (!cycleStart || !gridEndDate || cycleStart > gridEndDate) return []
    const length = Math.max(1, daysBetweenInclusive(cycleStart, gridEndDate))
    return Array.from({ length }, (_, index) => addDays(cycleStart, index))
  }, [cycleStart, gridEndDate])

  // Check days where at least one worker is marked
  const daysWithAnyMarks = useMemo(() => {
    const set = new Set<string>()
    for (const a of attendance) {
      if (a.date >= cycleStart && a.date <= gridEndDate && (a.status || (a.ot_minutes ?? 0) > 0)) {
        set.add(dateKey(a.date))
      }
    }
    return set
  }, [attendance, cycleStart, gridEndDate])

  // Attendance lookup map
  const attendanceMap = useMemo(() => {
    const map = new Map<string, Attendance>()
    for (const a of attendance) {
      map.set(`${a.employee}_${dateKey(a.date)}`, a)
    }
    return map
  }, [attendance])

  // Helper to get row state
  function getRowState(employeeId: string): RowDraftState {
    if (rowStates[employeeId]) return rowStates[employeeId]

    // Check if worker has un-settled database adjustments
    const workerAdjs = adjustments.filter(
      (a) => a.employee === employeeId && !a.settled_payout && dateKey(a.date) <= gridEndDate,
    )
    let defaultDbAdjustmentPaise = 0
    for (const a of workerAdjs) {
      if (a.kind === 'deduction') defaultDbAdjustmentPaise -= a.amount_paise
      else defaultDbAdjustmentPaise += a.amount_paise
    }
    const initialAdj = defaultDbAdjustmentPaise !== 0
      ? (defaultDbAdjustmentPaise > 0 ? paiseToInput(defaultDbAdjustmentPaise) : `-${paiseToInput(Math.abs(defaultDbAdjustmentPaise))}`)
      : ''

    return {
      deductInput: '',
      giveUpadInput: '',
      paidInput: '',
      paidDate: today,
      workCountedUpTo: gridEndDate,
      isDone: false,
      createdUpadIds: '',
      adjustmentAmountInput: initialAdj,
      adjustmentNoteInput: '',
    }
  }

  function setRowState(employeeId: string, patch: Partial<RowDraftState>) {
    setRowStates((prev) => {
      const cur = prev[employeeId] || getRowState(employeeId)
      const updated = { ...cur, ...patch }
      return { ...prev, [employeeId]: updated }
    })
  }

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return activeEmployees
    const q = search.trim().toLowerCase()
    return activeEmployees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.employee_no && e.employee_no.toLowerCase().includes(q)),
    )
  }, [activeEmployees, search])

  // Row calculations for each active worker
  const calculatedRows = useMemo(() => {
    return filteredEmployees.map((employee, rowIndex) => {
      const state = getRowState(employee.id)
      const paidUpTo = workerPaidUpToMap.get(employee.id) || ''
      const latestStmt = latestStatementMap.get(employee.id)

      // Carry from latest statement or opening
      const carryPaise = latestStmt ? latestStmt.closing_paise : (employee.opening_salary_paise ?? 0)

      // Upad balance
      const upadRows: UpadRow[] = upadEntries
        .filter((u) => u.employee === employee.id && !u.voided)
        .map((u) => ({
          id: u.id,
          employee: u.employee,
          date: dateKey(u.date),
          kind: u.kind,
          amount_paise: u.amount_paise,
          note: u.note,
          voided: u.voided,
        }))
      const upadBalancePaise = getWorkerUpadBalance(upadRows, employee.opening_upad_paise ?? 0)

      // Last upad entry for hover tooltip
      const sortedUpads = [...upadRows].sort((a, b) => b.date.localeCompare(a.date))
      const lastUpad = sortedUpads[0]
      const lastUpadTooltip = lastUpad
        ? `${lastUpad.kind === 'given' ? '+' : '-'}${formatMoney(lastUpad.amount_paise)} · ${formatDateShort(lastUpad.date)}${lastUpad.note ? ` (${lastUpad.note})` : ''}`
        : 'No prior upad'

      // Earned wages and OT up to workCountedUpTo
      const fromDate = workerFromDate(
        {
          id: employee.id,
          opening_carry_paise: carryPaise,
          opening_date: employee.opening_date || employee.joined_on || cycleStart,
        },
        paidUpTo,
      )
      const cutoffDate = state.workCountedUpTo || gridEndDate

      let earnedPaise = 0
      let daysWorkedCount = 0
      let otMinutesCount = 0
      const unmarkedDays: string[] = []

      for (const d of days) {
        if (d > cutoffDate) continue
        const att = attendanceMap.get(`${employee.id}_${d}`)
        const hasJoined = !employee.joined_on || employee.joined_on <= d
        if (!hasJoined) continue

        if (!att || !att.status) {
          if (daysWithAnyMarks.has(d)) {
            unmarkedDays.push(d)
          }
          continue
        }

        const rate = rateOn(rates, d) ?? employee.daily_rate_paise ?? 0
        const e = dayEarnings(att.status, att.ot_minutes ?? 0, rate, att.worked_minutes, fullDayMinutes)
        earnedPaise += e.total_paise
        daysWorkedCount += e.days_worked
        otMinutesCount += att.ot_minutes ?? 0
      }

      // Unsettled adjustments up to cutoff
      const workerAdjs = adjustments.filter(
        (a) => a.employee === employee.id && !a.settled_payout && dateKey(a.date) <= cutoffDate,
      )
      let defaultDbAdjustmentPaise = 0
      for (const a of workerAdjs) {
        if (a.kind === 'deduction') defaultDbAdjustmentPaise -= a.amount_paise
        else defaultDbAdjustmentPaise += a.amount_paise
      }

      // If user typed in adjustment input, parse it (+599 -> +59900, -400 -> -40000)
      let adjustmentPaise = defaultDbAdjustmentPaise
      if (state.adjustmentAmountInput !== undefined && state.adjustmentAmountInput.trim() !== '') {
        adjustmentPaise = parseAdjustmentInput(state.adjustmentAmountInput)
      }

      // Deduct, Give upad, To pay, Paid, New carry
      const grossSalaryDue = Math.max(0, carryPaise + earnedPaise + adjustmentPaise)
      const deductCapPaise = calculateDeductCap(upadBalancePaise, grossSalaryDue)

      const deductPaise = Math.max(0, rupeesToPaise(Number.parseFloat(state.deductInput) || 0))
      const giveUpadPaise = Math.max(0, rupeesToPaise(Number.parseFloat(state.giveUpadInput) || 0))

      const toPayPaise = calculateToPay(carryPaise, earnedPaise, adjustmentPaise, deductPaise, giveUpadPaise)
      const paidCapPaise = calculatePaidCap(toPayPaise)

      const paidPaise = state.paidInput.trim() !== ''
        ? Math.max(0, rupeesToPaise(Number.parseFloat(state.paidInput) || 0))
        : null

      const newCarryPaise = calculateNewCarry(toPayPaise, paidPaise !== null ? paidPaise : 0)

      // Dynamic Upad calculations
      const upadRemainingAfterDeduct = Math.max(0, upadBalancePaise - deductPaise)
      const projectedUpadPaise = upadRemainingAfterDeduct + giveUpadPaise

      // Warning triggers
      const isDeductOverCap = deductPaise > deductCapPaise
      const isPaidOverCap = paidPaise !== null && paidPaise > toPayPaise
      const isPaidUnderNewUpad = paidPaise !== null && giveUpadPaise > 0 && paidPaise < giveUpadPaise

      return {
        employee,
        rowIndex,
        carryPaise,
        upadBalancePaise,
        upadRemainingAfterDeduct,
        projectedUpadPaise,
        lastUpadTooltip,
        unmarkedDays,
        earnedPaise,
        daysWorkedCount,
        otMinutesCount,
        adjustmentPaise,
        workerAdjs,
        deductCapPaise,
        deductPaise,
        giveUpadPaise,
        toPayPaise,
        paidCapPaise,
        paidPaise,
        newCarryPaise,
        isDeductOverCap,
        isPaidOverCap,
        isPaidUnderNewUpad,
        isDone: state.isDone,
        state,
      }
    })
  }, [
    filteredEmployees,
    rowStates,
    workerPaidUpToMap,
    latestStatementMap,
    upadEntries,
    attendanceMap,
    days,
    gridEndDate,
    cycleStart,
    daysWithAnyMarks,
    rates,
    adjustments,
  ])

  // Save staged inputs to PocketBase draft
  async function persistDraft(employeeId: string, updated: RowDraftState) {
    if (isPastCycle) return
    try {
      await saveCycleDraft({
        employee: employeeId,
        cycle_start: cycleStart,
        deduct_paise: rupeesToPaise(Number.parseFloat(updated.deductInput) || 0),
        give_upad_paise: rupeesToPaise(Number.parseFloat(updated.giveUpadInput) || 0),
        paid_paise: updated.paidInput.trim() !== '' ? rupeesToPaise(Number.parseFloat(updated.paidInput) || 0) : null,
        paid_date: updated.paidDate,
        work_counted_up_to: updated.workCountedUpTo,
        is_done: updated.isDone,
        created_upad_ids: updated.createdUpadIds,
        note: JSON.stringify({ adj: updated.adjustmentAmountInput }),
      })
    } catch (e) {
      console.error('Failed to persist draft to PocketBase', e)
    }
  }

  // Handle Enter or Blur on Paid input -> Auto Done
  async function handlePaidCommit(employee: Employee, rowIndex: number) {
    const curState = getRowState(employee.id)
    if (curState.paidInput.trim() === '') return // stays plain if empty

    const rowCalc = calculatedRows[rowIndex]
    if (!rowCalc) return

    const paidPaise = Math.max(0, rupeesToPaise(Number.parseFloat(curState.paidInput) || 0))
    const deductPaise = rowCalc.deductPaise
    const giveUpadPaise = rowCalc.giveUpadPaise
    const paidDate = curState.paidDate || today

    let createdIds: string[] = []

    // If wasn't already done, post entries to upad ledger and adjustments
    if (!curState.isDone) {
      try {
        const formattedDate = paidDate.includes(' ') ? paidDate : `${paidDate} 12:00:00.000Z`
        if (deductPaise > 0) {
          const rec = await createUpadEntry({
            employeeId: employee.id,
            date: formattedDate,
            amountPaise: deductPaise,
            kind: 'recovery',
            category: 'regular',
            note: 'Cycle salary deduction',
          })
          createdIds.push(rec.id)
        }
        if (giveUpadPaise > 0) {
          const giv = await createUpadEntry({
            employeeId: employee.id,
            date: formattedDate,
            amountPaise: giveUpadPaise,
            kind: 'given',
            category: 'regular',
            note: 'Cycle advance given',
          })
          createdIds.push(giv.id)
        }
        if (rowCalc.adjustmentPaise !== 0) {
          const adj = await createAdjustment({
            employeeId: employee.id,
            date: formattedDate,
            amountPaise: Math.abs(rowCalc.adjustmentPaise),
            kind: rowCalc.adjustmentPaise < 0 ? 'deduction' : 'bonus',
            note: `Cycle adjustment (${rowCalc.adjustmentPaise > 0 ? '+' : ''}${formatMoney(rowCalc.adjustmentPaise)})`,
          })
          createdIds.push(`adj:${adj.id}`)
        }
      } catch (e) {
        console.error('Failed to post upad/adj entries for done row', e)
      }
    } else if (curState.createdUpadIds) {
      try {
        createdIds = JSON.parse(curState.createdUpadIds)
      } catch {
        createdIds = []
      }
    }

    const updatedState: RowDraftState = {
      ...curState,
      isDone: true,
      createdUpadIds: JSON.stringify(createdIds),
    }

    setRowState(employee.id, updatedState)
    await persistDraft(employee.id, updatedState)
    queryClient.invalidateQueries({ queryKey: ['upad'] })
    queryClient.invalidateQueries({ queryKey: ['adjustments'] })

    // Move focus to the next row's Paid input
    const nextIndex = rowIndex + 1
    if (nextIndex < calculatedRows.length) {
      setTimeout(() => {
        const nextInput = document.getElementById(`paid-input-${nextIndex}`)
        nextInput?.focus()
      }, 50)
    }
  }

  // Handle Undo / Clear Paid
  async function handleUndoRow(employee: Employee) {
    const curState = getRowState(employee.id)
    if (!curState.isDone) return

    // Revert created upad/adjustment entries
    if (curState.createdUpadIds) {
      try {
        const ids: string[] = JSON.parse(curState.createdUpadIds)
        for (const id of ids) {
          if (id.startsWith('adj:')) {
            await deleteAdjustment(id.slice(4)).catch(() => {})
          } else {
            await deleteUpadEntry(id).catch(() => {})
          }
        }
      } catch (e) {
        console.error('Failed to delete posted upad/adj entries on undo', e)
      }
    }

    const updatedState: RowDraftState = {
      ...curState,
      isDone: false,
      paidInput: '',
      createdUpadIds: '',
    }

    setRowState(employee.id, updatedState)
    await persistDraft(employee.id, updatedState)
    queryClient.invalidateQueries({ queryKey: ['upad'] })
    queryClient.invalidateQueries({ queryKey: ['adjustments'] })
    toast(`Row settlement undone for ${employee.name}`, 'info')
  }

  // Attendance Click Cycling: None -> Full (P) -> Half (H) -> Absent (A) -> None
  async function handleAttendanceCellClick(employee: Employee, day: string, e: React.MouseEvent) {
    if (isPastCycle) return
    if (e.shiftKey) {
      onOpenAttendanceEditor(employee.id, day)
      return
    }

    const att = attendanceMap.get(`${employee.id}_${day}`)
    const currentStatus = (att?.status as AttendanceStatus) || 'none'
    const nextStatus = NEXT_ATTENDANCE_STATUS[currentStatus]

    try {
      if (!nextStatus) {
        await deleteAttendance(att?.id, employee.id, day)
      } else {
        await saveAttendance({
          employeeId: employee.id,
          date: day,
          status: nextStatus,
          otMinutes: att?.ot_minutes || 0,
          existingId: att?.id,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
    } catch (err) {
      console.error('Failed to cycle attendance status', err)
      toast('Could not save attendance', 'error')
    }
  }

  // Focus helper for keyboard navigation
  function focusRowInput(
    prefix: 'adjustment-input' | 'deduct-input' | 'give-upad-input' | 'paid-input',
    targetIndex: number,
  ) {
    if (targetIndex >= 0 && targetIndex < calculatedRows.length) {
      const el = document.getElementById(`${prefix}-${targetIndex}`) as HTMLInputElement | null
      if (el) {
        el.focus()
        el.select()
        const rowEl = document.getElementById(`register-row-${targetIndex}`)
        rowEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }

  // Global keyboard shortcuts (1..9 jump, Alt+1..9 jump from input)
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Ignore if any modal is open
      if (
        closeModalOpen ||
        statementData ||
        upadHistoryWorker ||
        upadReturnWorker ||
        leavingWorkerData
      ) {
        return
      }

      // If Escape is pressed, blur active input so row shortcuts can be used immediately
      if (e.key === 'Escape') {
        const el = document.activeElement as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
          el.blur()
        }
        return
      }

      let digit: number | null = null
      if (e.code.startsWith('Digit')) {
        const d = Number.parseInt(e.code.replace('Digit', ''), 10)
        if (d >= 1 && d <= 9) digit = d
      } else if (e.code.startsWith('Numpad')) {
        const d = Number.parseInt(e.code.replace('Numpad', ''), 10)
        if (d >= 1 && d <= 9) digit = d
      } else if (/^[1-9]$/.test(e.key)) {
        digit = Number.parseInt(e.key, 10)
      }

      if (digit === null) return

      const index = digit - 1
      if (index < 0 || index >= calculatedRows.length) return

      const activeTag = (document.activeElement as HTMLElement)?.tagName
      const isInputActive =
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT' ||
        (document.activeElement as HTMLElement)?.isContentEditable

      if (e.altKey || e.ctrlKey || !isInputActive) {
        e.preventDefault()
        focusRowInput('paid-input', index)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [
    calculatedRows.length,
    closeModalOpen,
    statementData,
    upadHistoryWorker,
    upadReturnWorker,
    leavingWorkerData,
  ])

  // Summary figures for table footer
  const tableTotals = useMemo(() => {
    return calculatedRows.reduce(
      (acc, r) => ({
        carry: acc.carry + r.carryPaise,
        earned: acc.earned + r.earnedPaise,
        adjustment: acc.adjustment + r.adjustmentPaise,
        deduct: acc.deduct + r.deductPaise,
        giveUpad: acc.giveUpad + r.giveUpadPaise,
        toPay: acc.toPay + r.toPayPaise,
        paid: acc.paid + (r.paidPaise ?? 0),
        newCarry: acc.newCarry + r.newCarryPaise,
        daysWorked: acc.daysWorked + r.daysWorkedCount,
        otMinutes: acc.otMinutes + r.otMinutesCount,
      }),
      {
        carry: 0,
        earned: 0,
        adjustment: 0,
        deduct: 0,
        giveUpad: 0,
        toPay: 0,
        paid: 0,
        newCarry: 0,
        daysWorked: 0,
        otMinutes: 0,
      },
    )
  }, [calculatedRows])

  // Close Cycle details
  const doneRows = calculatedRows.filter((r) => r.isDone)
  const undoneRows = calculatedRows.filter((r) => !r.isDone)

  const paidDatesList = doneRows.map((r) => r.state.paidDate || today)
  const latestPaidDate = paidDatesList.length > 0
    ? paidDatesList.reduce((max, cur) => (cur > max ? cur : max))
    : today

  const nextCycleStart = computeNextCycleStartFromPaidDates(paidDatesList, addDays(latestPaidDate, 1))

  // Execute Close Cycle
  async function handleConfirmCloseCycle() {
    setIsClosingCycle(true)
    try {
      // 1. Create payout_runs record
      const runRecord = await pb.collection(COLLECTIONS.runs).create({
        cycle_start: cycleStart,
        payout_date: latestPaidDate,
        cutoff_date: gridEndDate,
        status: 'completed',
        voided: false,
        note: `Cycle ${formatDateShort(cycleStart)} - ${formatDateShort(latestPaidDate)}`,
        employee_count: calculatedRows.length,
        total_due_paise: tableTotals.toPay,
        total_paid_paise: tableTotals.paid,
        total_upad_recovery_paise: tableTotals.deduct,
      })

      const runId = runRecord.id

      // 2. Finalize each worker row
      for (const r of calculatedRows) {
        const emp = r.employee
        const isDone = r.isDone

        let closingPaise = isDone ? r.newCarryPaise : (r.carryPaise + r.earnedPaise + r.adjustmentPaise)
        let paidPaise = isDone ? (r.paidPaise ?? 0) : 0
        let deductPaise = isDone ? r.deductPaise : 0

        // Create statement
        const stmt = await pb.collection(COLLECTIONS.statements).create({
          payout_run: runId,
          employee: emp.id,
          cycle_start: cycleStart,
          payout_date: latestPaidDate,
          opening_paise: r.carryPaise,
          earned_paise: r.earnedPaise,
          adjustment_paise: r.adjustmentPaise,
          upad_outstanding_paise: r.upadBalancePaise,
          upad_recovery_paise: deductPaise,
          total_due_paise: isDone ? r.toPayPaise : (r.carryPaise + r.earnedPaise + r.adjustmentPaise),
          paid_paise: paidPaise,
          closing_paise: closingPaise,
          days_worked: r.daysWorkedCount,
          ot_minutes: r.otMinutesCount,
          note: isDone ? '' : 'Undone row: carried to next cycle',
          voided: false,
        })

        // If paid, create salary payment
        if (paidPaise > 0) {
          await pb.collection(COLLECTIONS.payments).create({
            employee: emp.id,
            statement: stmt.id,
            paid_on: r.state.paidDate || latestPaidDate,
            amount_paise: paidPaise,
            note: '',
            voided: false,
          })
        }

        // Link upad entries if created
        if (isDone && r.state.createdUpadIds) {
          try {
            const upadIds: string[] = JSON.parse(r.state.createdUpadIds)
            for (const uid of upadIds) {
              await pb.collection(COLLECTIONS.upad).update(uid, {
                payout: runId,
                payout_id: runId,
                statement: stmt.id,
              }).catch(() => {})
            }
          } catch {}
        }

        // Settle attendance up to cutoff
        const cutoff = r.state.workCountedUpTo || gridEndDate
        for (const a of attendance) {
          if (a.employee === emp.id && !a.settled_payout && dateKey(a.date) <= cutoff) {
            await pb.collection(COLLECTIONS.attendance).update(a.id, {
              settled_payout: runId,
            }).catch(() => {})
          }
        }

        // Settle adjustments up to cutoff
        for (const adj of adjustments) {
          if (adj.employee === emp.id && !adj.settled_payout && dateKey(adj.date) <= cutoff) {
            await pb.collection(COLLECTIONS.adjustments).update(adj.id, {
              settled_payout: runId,
              payout_id: runId,
            }).catch(() => {})
          }
        }

        // Cleanup cycle drafts
        if (draftsQuery.data) {
          const draft = draftsQuery.data.find((d) => d.employee === emp.id)
          if (draft) {
            await deleteCycleDraft(draft.id).catch(() => {})
          }
        }
      }

      setCloseModalOpen(false)
      toast(`Cycle closed! Next cycle begins on ${formatDateShort(nextCycleStart)}`, 'success')
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      queryClient.invalidateQueries({ queryKey: ['statements'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['cycle_drafts'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    } catch (e: any) {
      toast(e?.message || 'Failed to close cycle', 'error')
    } finally {
      setIsClosingCycle(false)
    }
  }

  return (
    <>
      {/* Unified Single Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 border-b border-stone-200 bg-white px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Mode Tabs (Today vs Register) */}
          {onViewModeChange && (
            <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-bold text-stone-600">
              <button
                type="button"
                onClick={() => onViewModeChange('today')}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-stone-600 transition-all hover:text-stone-900 cursor-pointer"
              >
                <CalendarCheck className="h-3.5 w-3.5 text-stone-400" />
                <span>Today's Roll Call</span>
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('cycle')}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-emerald-800 shadow-2xs font-extrabold cursor-pointer"
              >
                <CalendarDays className="h-3.5 w-3.5 text-emerald-700" />
                <span>Cycle Register</span>
              </button>
            </div>
          )}

          {/* Cycle Selector Dropdown */}
          <select
            value={selectedCycleId}
            onChange={(e) => onSelectCycleId(e.target.value)}
            className="rounded-lg border border-stone-200 bg-stone-50 hover:bg-white px-2.5 py-1 text-xs font-bold text-stone-800 shadow-2xs focus:border-emerald-600 focus:outline-none cursor-pointer transition-colors"
          >
            <option value="open">🟢 Open Cycle ({formatDateShort(cycleStart)} – {formatDateShort(gridEndDate)})</option>
            {completedRuns.map((run) => (
              <option key={run.id} value={run.id}>
                🔒 Closed: {formatDateShort(run.cycle_start)} – {formatDateShort(run.payout_date)} ({run.employee_count} workers)
              </option>
            ))}
          </select>

          {/* Active workers and marked count summary */}
          <span className="hidden sm:inline text-xs font-semibold text-stone-500">
            {activeEmployees.length} workers · <span className="text-emerald-700 font-bold">{doneRows.length} paid</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Worker Search */}
          <div className="relative w-36 sm:w-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search worker…"
              className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1 pl-8 pr-6 text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:bg-white focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Collapse/Expand Week Toggle */}
          <button
            type="button"
            onClick={() => setIsWeekCollapsed(!isWeekCollapsed)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700 shadow-2xs transition-colors cursor-pointer"
            title={isWeekCollapsed ? 'Expand daily attendance days' : 'Collapse days into single Week column'}
          >
            {isWeekCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-emerald-700" /> : <ChevronDown className="h-3.5 w-3.5 text-emerald-700" />}
            <span>{isWeekCollapsed ? 'Expand Week' : 'Collapse Week'}</span>
          </button>

          {/* Single Close Cycle Button */}
          {!isPastCycle && (
            <button
              type="button"
              onClick={() => setCloseModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1 text-xs font-black text-white shadow-xs transition-colors cursor-pointer"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Close Cycle</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 8-Column Table */}
      <div className="table-scroll max-h-[75vh] border-b border-stone-200">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm attendance-grid">
          <thead>
            <tr className="bg-stone-100 text-[11px] font-black uppercase tracking-wider text-stone-700 border-b border-stone-200">
              {/* 1. Worker */}
              <th className="sticky left-0 top-0 z-30 min-w-[13.5rem] border-b border-stone-200 bg-stone-100 px-2.5 py-2 text-left">
                Worker
              </th>

              {/* 2. Week (Collapsed single column OR Expanded days) */}
              {isWeekCollapsed ? (
                <th className="sticky top-0 z-10 min-w-[6.5rem] border-b border-l border-stone-200 bg-stone-100 px-2 py-2 text-center text-stone-800">
                  <div className="flex items-center justify-center gap-1.5">
                    <span>Week</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setIsWeekCollapsed(false)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 shadow-2xs transition cursor-pointer"
                      title="Expand daily attendance days"
                    >
                      <ChevronRight className="h-3 w-3 text-emerald-700" />
                      <span>Expand</span>
                    </button>
                  </div>
                </th>
              ) : (
                days.map((day) => {
                  const isT = day === today
                  return (
                    <th
                      key={day}
                      className={clsx(
                        'sticky top-0 z-10 min-w-[3.6rem] border-b border-l border-stone-200 px-1 py-1 text-center',
                        isT ? 'bg-emerald-50 text-emerald-950 font-bold' : 'bg-stone-50 text-stone-800',
                      )}
                    >
                      <div className="text-[10px] uppercase font-bold text-stone-500">
                        {weekdayShort(day)}
                      </div>
                      <div className="text-xs font-black tabular-nums">
                        {Number(day.slice(8, 10))}
                      </div>
                      {isT && (
                        <span className="rounded-full bg-emerald-700 px-1 py-0.2 text-[8px] font-bold text-white leading-none inline-block">
                          Today
                        </span>
                      )}
                    </th>
                  )
                })
              )}

              {/* 3. Earned (with Collapse days button when expanded) */}
              <th className="sticky top-0 z-10 min-w-[6rem] border-b border-l border-stone-200 bg-stone-100 px-2 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {!isWeekCollapsed && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setIsWeekCollapsed(true)}
                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 shadow-2xs transition cursor-pointer"
                      title="Collapse attendance days into single Week column"
                    >
                      <ChevronDown className="h-3 w-3 text-emerald-700" />
                      <span>Days</span>
                    </button>
                  )}
                  <span>Earned</span>
                </div>
              </th>

              {/* 4. Adjustment (Inline Input) */}
              <th className="sticky top-0 z-10 min-w-[5.5rem] border-b border-l border-stone-200 bg-stone-100 px-1.5 py-2 text-right">
                Adj (+/-)
              </th>

              {/* 5. Deduct (input) */}
              <th className="sticky top-0 z-10 min-w-[6.5rem] border-b border-l border-amber-200 bg-amber-50/70 px-1.5 py-2 text-right text-amber-950 font-black">
                Deduct
              </th>

              {/* 6. Give upad (input) */}
              <th className="sticky top-0 z-10 min-w-[6.5rem] border-b border-l border-sky-200 bg-sky-50/70 px-1.5 py-2 text-right text-sky-950 font-black">
                Give Upad
              </th>

              {/* 7. To pay */}
              <th className="sticky top-0 z-10 min-w-[7.5rem] border-b border-l border-stone-200 bg-stone-100 px-2.5 py-2 text-right text-stone-900 font-black">
                To Pay
              </th>

              {/* 8. Paid & New Carry */}
              <th className="sticky top-0 z-10 min-w-[7.5rem] border-b border-l border-emerald-200 bg-emerald-50/80 px-2 py-2 text-right text-emerald-950 font-black">
                Paid / Carry
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-stone-100">
            {calculatedRows.map((row) => {
              const { employee, rowIndex, state } = row
              const isDone = row.isDone

              return (
                <tr
                  key={employee.id}
                  id={`register-row-${rowIndex}`}
                  className={clsx(
                    'transition-colors',
                    rowMenuWorkerId === employee.id ? 'relative z-50' : '',
                    isDone
                      ? 'bg-emerald-50/70 hover:bg-emerald-50/90'
                      : 'hover:bg-stone-50/80 bg-white',
                  )}
                >
                  {/* 1. Worker Cell */}
                  <td
                    className={clsx(
                      'sticky left-0 border-b border-stone-200 px-2.5 py-1.5 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]',
                      isDone ? 'bg-emerald-50/95' : 'bg-white',
                      rowMenuWorkerId === employee.id ? 'z-50' : 'z-20',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {/* Worker numeric shortcut badge (clickable to jump) */}
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => focusRowInput('paid-input', rowIndex)}
                            className={clsx(
                              'inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded font-mono text-[11px] font-bold tracking-tight select-none border cursor-pointer transition shadow-2xs hover:scale-105 active:scale-95 shrink-0',
                              isDone
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : 'bg-stone-100 text-stone-700 border-stone-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-800',
                            )}
                            title={`Click or press 'Alt+${rowIndex + 1}' (or '${rowIndex + 1}') to jump here`}
                          >
                            {rowIndex + 1}
                          </button>

                          <span
                            onClick={() => focusRowInput('paid-input', rowIndex)}
                            className="truncate text-xs font-bold text-stone-900 cursor-pointer hover:text-emerald-800 transition"
                            title={`Click to jump to ${employee.name}'s Paid input`}
                          >
                            {employee.name}
                          </span>

                          {/* Unmarked days warning icon */}
                          {row.unmarkedDays.length > 0 && (
                            <span
                              title={`Unmarked on ${row.unmarkedDays.map(formatDateShort).join(', ')} while others were marked`}
                              className="text-amber-500 cursor-help shrink-0"
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                            </span>
                          )}

                          {isDone && (
                            <span className="rounded-full bg-emerald-100 border border-emerald-300 text-emerald-800 px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                              ✓
                            </span>
                          )}
                        </div>

                        {/* Subtitle with hover tooltip and dynamic Upad balance math */}
                        <div
                          className="mt-0.5 text-[11px] text-stone-500 font-medium cursor-help flex items-center gap-1 truncate"
                          title={`Last Upad: ${row.lastUpadTooltip}`}
                        >
                          <span>Carry {formatMoney(row.carryPaise)}</span>
                          <span className="text-stone-300">·</span>
                          {row.deductPaise > 0 || row.giveUpadPaise > 0 ? (
                            <span className="font-bold text-amber-900 inline-flex items-center gap-0.5 truncate">
                              Upad {formatMoney(row.upadBalancePaise)}
                              <span className="text-stone-400 font-bold">→</span>
                              <span className={clsx(row.projectedUpadPaise === 0 ? 'text-emerald-700 font-black' : 'text-amber-900 font-black')}>
                                {formatMoney(row.projectedUpadPaise)}
                              </span>
                            </span>
                          ) : (
                            <span className={clsx(row.upadBalancePaise > 0 ? 'text-amber-800 font-bold' : 'text-stone-500')}>
                              Upad {formatMoney(row.upadBalancePaise)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row Action Menu (⋮) */}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setRowMenuWorkerId(rowMenuWorkerId === employee.id ? null : employee.id)}
                          className={clsx(
                            'h-6 w-6 rounded flex items-center justify-center transition cursor-pointer',
                            rowMenuWorkerId === employee.id
                              ? 'bg-stone-200 text-stone-900'
                              : 'text-stone-400 hover:bg-stone-100 hover:text-stone-800',
                          )}
                          title="Actions menu"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>

                        {rowMenuWorkerId === employee.id && (
                          <>
                            {/* Backdrop to close menu when clicking anywhere */}
                            <div
                              className="fixed inset-0 z-[55] cursor-default"
                              onClick={(e) => {
                                e.stopPropagation()
                                setRowMenuWorkerId(null)
                              }}
                            />
                            <div
                              className={clsx(
                                'absolute right-0 z-[60] w-52 rounded-xl border border-stone-200 bg-white p-1 text-left shadow-2xl text-xs',
                                rowIndex >= calculatedRows.length - 2 ? 'bottom-full mb-1' : 'top-full mt-1',
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setStatementData({
                                    employee,
                                    cycleStart,
                                    payoutDate: state.paidDate || today,
                                    daysWorked: row.daysWorkedCount,
                                    otMinutes: row.otMinutesCount,
                                    openingCarryPaise: row.carryPaise,
                                    earnedPaise: row.earnedPaise,
                                    adjustmentPaise: row.adjustmentPaise,
                                    adjustmentNote: row.workerAdjs.map((a) => a.note).filter(Boolean).join(', '),
                                    deductPaise: row.deductPaise,
                                    giveUpadPaise: row.giveUpadPaise,
                                    toPayPaise: row.toPayPaise,
                                    paidPaise: row.paidPaise ?? 0,
                                    newCarryPaise: row.newCarryPaise,
                                    upadBalancePaise: row.upadBalancePaise - row.deductPaise + row.giveUpadPaise,
                                    businessName: settings.business_name,
                                  })
                                  setRowMenuWorkerId(null)
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-stone-700 hover:bg-stone-100"
                              >
                                <Printer className="h-3.5 w-3.5 text-stone-500" />
                                View / Print Statement
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setUpadHistoryWorker(employee)
                                  setRowMenuWorkerId(null)
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-stone-700 hover:bg-stone-100"
                              >
                                <History className="h-3.5 w-3.5 text-amber-600" />
                                Upad History
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setUpadReturnWorker(employee)
                                  setRowMenuWorkerId(null)
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-stone-700 hover:bg-stone-100"
                              >
                                <HandCoins className="h-3.5 w-3.5 text-sky-600" />
                                Upad Returned (Cash Handback)
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setLeavingWorkerData({
                                    employee,
                                    grossSalaryDuePaise: row.carryPaise + row.earnedPaise + row.adjustmentPaise,
                                    cycleStart,
                                    carryPaise: row.carryPaise,
                                    earnedPaise: row.earnedPaise,
                                    adjustmentPaise: row.adjustmentPaise,
                                    upadBalancePaise: row.upadBalancePaise,
                                  })
                                  setRowMenuWorkerId(null)
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-rose-700 hover:bg-rose-50"
                              >
                                <UserMinus className="h-3.5 w-3.5 text-rose-600" />
                                Leaving-Worker Settlement
                              </button>

                              {isDone && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleUndoRow(employee)
                                    setRowMenuWorkerId(null)
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
                                >
                                  <Undo2 className="h-3.5 w-3.5 text-amber-700" />
                                  Undo Row Settlement
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 2. Week Cell (Collapsed summary OR Expanded days with Click-Cycling) */}
                  {isWeekCollapsed ? (
                    <td className="border-b border-l border-stone-200 px-2 py-1.5 text-center tabular-nums text-stone-800 font-bold text-xs">
                      {row.daysWorkedCount}d {row.otMinutesCount > 0 ? `+${formatHours(row.otMinutesCount)}` : ''}
                    </td>
                  ) : (
                    days.map((day) => {
                      const att = attendanceMap.get(`${employee.id}_${day}`)
                      const isClosed = isFriday(day) && !att?.status

                      let badgeText = '—'
                      if (att?.status === 'full') badgeText = 'P'
                      else if (att?.status === 'half') badgeText = 'H'
                      else if (att?.status === 'absent') badgeText = 'A'
                      else if (att?.status === 'hours') {
                        badgeText = `${((att.worked_minutes ?? 0) / 60).toFixed(1)}h`
                      } else if (isClosed) {
                        badgeText = 'OFF'
                      }

                      return (
                        <td
                          key={day}
                          className="border-b border-l border-stone-200 p-1 text-center select-none"
                        >
                          <button
                            type="button"
                            tabIndex={-1}
                            disabled={isPastCycle}
                            onClick={(e) => handleAttendanceCellClick(employee, day, e)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              onOpenAttendanceEditor(employee.id, day)
                            }}
                            onDoubleClick={() => onOpenAttendanceEditor(employee.id, day)}
                            title={`${employee.name} · ${weekdayShort(day)} ${formatDateShort(day)}\nStatus: ${att?.status ? (att.status === 'full' ? 'Full day (P)' : att.status === 'half' ? 'Half day (H)' : att.status === 'absent' ? 'Absent (A)' : `${((att.worked_minutes ?? 0) / 60).toFixed(1)}h`) : 'Blank'}\nClick to cycle: P → H → A → Clear\nDouble-click or right-click for OT/Hours`}
                            className={clsx(
                              'relative flex flex-col items-center justify-center w-8 h-8 mx-auto rounded-lg border text-xs font-black transition-all select-none shadow-2xs cursor-pointer',
                              attendanceCellStyle(att?.status as AttendanceStatus),
                            )}
                          >
                            <span className="text-xs font-black leading-tight">{badgeText}</span>
                            {(att?.ot_minutes ?? 0) > 0 && (
                              <span className="mt-0.5 inline-flex items-center rounded px-0.5 text-[8px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300/80 tabular-nums leading-none">
                                +{formatHours(att!.ot_minutes)}
                              </span>
                            )}
                            {Boolean(att?.note) && (
                              <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                            )}
                          </button>
                        </td>
                      )
                    })
                  )}

                  {/* 3. Earned */}
                  <td className="border-b border-l border-stone-200 px-2 py-1.5 text-right tabular-nums">
                    <div className="font-bold text-stone-900 text-xs">
                      {formatMoney(row.earnedPaise)}
                    </div>
                    <div className="text-[10px] text-stone-500 font-medium">
                      {row.daysWorkedCount}d {row.otMinutesCount > 0 ? `+${formatHours(row.otMinutesCount)}` : ''}
                    </div>
                  </td>

                  {/* 4. Adjustment (Inline Input Box: e.g. 599 for +599, -400 for -400) */}
                  <td className="border-b border-l border-stone-200 px-1.5 py-1.5 text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <input
                        id={`adjustment-input-${rowIndex}`}
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        value={state.adjustmentAmountInput}
                        disabled={isPastCycle}
                        onChange={(e) => {
                          const val = e.target.value
                          setRowState(employee.id, { adjustmentAmountInput: val })
                          persistDraft(employee.id, { ...state, adjustmentAmountInput: val })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            focusRowInput('adjustment-input', rowIndex + 1)
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            focusRowInput('adjustment-input', rowIndex - 1)
                          } else if (e.key === 'Enter') {
                            e.preventDefault()
                            focusRowInput('deduct-input', rowIndex)
                          }
                        }}
                        className={clsx(
                          'w-16 h-7 rounded border px-1.5 text-right text-xs font-bold tabular-nums focus:outline-none transition shadow-2xs',
                          row.adjustmentPaise > 0
                            ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 focus:border-emerald-500'
                            : row.adjustmentPaise < 0
                              ? 'border-rose-300 bg-rose-50/70 text-rose-800 focus:border-rose-500'
                              : 'border-stone-200 bg-white text-stone-800 focus:border-stone-800',
                          isDone && 'bg-stone-100/70 border-stone-200 text-stone-500',
                        )}
                      />
                      {row.adjustmentPaise !== 0 && (
                        <span
                          className={clsx(
                            'text-[9px] font-bold mt-0.5 whitespace-nowrap',
                            row.adjustmentPaise > 0 ? 'text-emerald-700' : 'text-rose-700',
                          )}
                        >
                          {row.adjustmentPaise > 0 ? `+${formatMoney(row.adjustmentPaise)}` : `-${formatMoney(Math.abs(row.adjustmentPaise))}`}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* 5. Deduct (input) */}
                  <td className="border-b border-l border-amber-200/60 bg-amber-50/20 px-1.5 py-1.5 text-right">
                    <div className="flex flex-col items-end">
                      <input
                        id={`deduct-input-${rowIndex}`}
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={state.deductInput}
                        disabled={isDone || isPastCycle}
                        onChange={(e) => {
                          const val = e.target.value
                          setRowState(employee.id, { deductInput: val })
                          persistDraft(employee.id, { ...state, deductInput: val })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            focusRowInput('deduct-input', rowIndex + 1)
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            focusRowInput('deduct-input', rowIndex - 1)
                          } else if (e.key === 'Enter') {
                            e.preventDefault()
                            focusRowInput('give-upad-input', rowIndex)
                          }
                        }}
                        className={clsx(
                          'w-20 h-7 rounded border px-1.5 text-right text-xs font-bold tabular-nums focus:outline-none shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                          row.isDeductOverCap
                            ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-600'
                            : 'border-stone-200 bg-white text-amber-950 focus:border-amber-600',
                          isDone && 'bg-stone-100/70 border-stone-200 text-stone-500',
                        )}
                      />
                      {row.isDeductOverCap ? (
                        <div className="text-[10px] font-bold text-rose-600 mt-0.5 whitespace-nowrap">
                          Cap: {formatMoney(row.deductCapPaise)}
                        </div>
                      ) : row.deductPaise > 0 ? (
                        <div className="text-[10px] font-bold text-amber-800 mt-0.5 whitespace-nowrap">
                          {row.upadRemainingAfterDeduct === 0 ? 'Rem: ₹0 ✓' : `Rem: ${formatMoney(row.upadRemainingAfterDeduct)}`}
                        </div>
                      ) : (
                        <div className="text-[10px] text-stone-500 font-medium mt-0.5 whitespace-nowrap">
                          {row.upadBalancePaise > 0 ? `Bal: ${formatMoney(row.upadBalancePaise)}` : 'Bal: ₹0'}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 6. Give upad (input) */}
                  <td className="border-b border-l border-sky-200/60 bg-sky-50/20 px-1.5 py-1.5 text-right">
                    <div className="flex flex-col items-end">
                      <input
                        id={`give-upad-input-${rowIndex}`}
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0"
                        value={state.giveUpadInput}
                        disabled={isDone || isPastCycle}
                        onChange={(e) => {
                          const val = e.target.value
                          setRowState(employee.id, { giveUpadInput: val })
                          persistDraft(employee.id, { ...state, giveUpadInput: val })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            focusRowInput('give-upad-input', rowIndex + 1)
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            focusRowInput('give-upad-input', rowIndex - 1)
                          } else if (e.key === 'Enter') {
                            e.preventDefault()
                            focusRowInput('paid-input', rowIndex)
                          }
                        }}
                        className={clsx(
                          'w-20 h-7 rounded border border-stone-200 bg-white px-1.5 text-right text-xs font-bold tabular-nums text-sky-950 focus:border-sky-600 focus:outline-none shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                          isDone && 'bg-stone-100/70 border-stone-200 text-stone-500',
                        )}
                      />
                      {row.giveUpadPaise > 0 ? (
                        <div
                          className="text-[10px] font-bold text-sky-800 mt-0.5 whitespace-nowrap"
                          title={`Previous Upad ${formatMoney(row.upadBalancePaise)} + Given ${formatMoney(row.giveUpadPaise)} → ${formatMoney(row.projectedUpadPaise)}`}
                        >
                          {row.deductPaise > 0
                            ? `Rem ${formatMoney(row.upadRemainingAfterDeduct)} + ${formatMoney(row.giveUpadPaise)} → ${formatMoney(row.projectedUpadPaise)}`
                            : `Prev ${formatMoney(row.upadBalancePaise)} + ${formatMoney(row.giveUpadPaise)} → ${formatMoney(row.projectedUpadPaise)}`}
                        </div>
                      ) : (
                        <div className="text-[10px] text-stone-500 font-medium mt-0.5 whitespace-nowrap">
                          {row.upadBalancePaise > 0 ? `Bal: ${formatMoney(row.upadBalancePaise)}` : 'Bal: ₹0'}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 7. To Pay */}
                  <td className="border-b border-l border-stone-200 px-2.5 py-1.5 text-right tabular-nums">
                    <div className="font-black text-stone-900 text-xs">
                      {formatMoney(row.toPayPaise)}
                    </div>
                    <div
                      className="text-[10px] text-stone-500 font-medium mt-0.5 whitespace-nowrap"
                      title={getToPaySummary(row)}
                    >
                      {getToPaySummary(row)}
                    </div>
                  </td>

                  {/* 8. Paid (input) with Carry in bottom */}
                  <td className="border-b border-l border-emerald-200/60 bg-emerald-50/30 px-2 py-1.5 text-right">
                    <div className="flex flex-col items-end">
                      <input
                        id={`paid-input-${rowIndex}`}
                        type="number"
                        min="0"
                        step="any"
                        placeholder={paiseToInput(row.toPayPaise)}
                        value={state.paidInput}
                        disabled={isPastCycle}
                        onChange={(e) => {
                          const val = e.target.value
                          setRowState(employee.id, { paidInput: val })
                          if (val === '') {
                            handleUndoRow(employee)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            focusRowInput('paid-input', rowIndex + 1)
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            focusRowInput('paid-input', rowIndex - 1)
                          } else if (e.key === 'Enter') {
                            e.preventDefault()
                            handlePaidCommit(employee, rowIndex)
                          }
                        }}
                        onBlur={() => handlePaidCommit(employee, rowIndex)}
                        className={clsx(
                          'w-22 h-7 rounded border px-1.5 text-right text-xs font-black tabular-nums focus:outline-none shadow-2xs placeholder:text-stone-400 placeholder:font-normal [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                          row.isPaidOverCap
                            ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-600'
                            : 'border-stone-300 bg-white text-emerald-950 focus:border-emerald-600',
                          isDone && 'border-emerald-400 bg-emerald-100/60 text-emerald-950',
                        )}
                      />

                      {/* Bottom Carry Display */}
                      {row.isPaidOverCap ? (
                        <div className="text-[10px] font-bold text-rose-600 mt-0.5 whitespace-nowrap">
                          Cap: {formatMoney(row.toPayPaise)}
                        </div>
                      ) : row.isPaidUnderNewUpad ? (
                        <div className="text-[10px] font-bold text-amber-700 mt-0.5 whitespace-nowrap">
                          &lt; Upad ({formatMoney(row.giveUpadPaise)})
                        </div>
                      ) : state.paidInput.trim() !== '' ? (
                        row.newCarryPaise > 0 ? (
                          <div className="text-[10px] font-bold text-amber-800 mt-0.5 whitespace-nowrap">
                            Carry: {formatMoney(row.newCarryPaise)}
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-emerald-700 mt-0.5 whitespace-nowrap">
                            Carry: ₹0 ✓
                          </div>
                        )
                      ) : (
                        <div className="text-[10px] text-stone-400 font-medium mt-0.5 whitespace-nowrap">
                          Carry: {formatMoney(row.newCarryPaise)}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>

          {/* Table Footer Totals */}
          <tfoot>
            <tr className="bg-stone-100 font-black text-stone-900 border-t-2 border-stone-300 text-xs">
              <td className="sticky left-0 z-20 border-t border-stone-300 bg-stone-100 px-2.5 py-2">
                Total ({calculatedRows.length} workers)
              </td>
              {isWeekCollapsed ? (
                <td className="border-t border-l border-stone-300 px-2 py-2 text-center tabular-nums font-bold">
                  {tableTotals.daysWorked}d {tableTotals.otMinutes > 0 ? `+${formatHours(tableTotals.otMinutes)}` : ''}
                </td>
              ) : (
                days.map((day) => (
                  <td key={day} className="border-t border-l border-stone-300 px-1 py-2 text-center text-[10px] text-stone-400 font-bold">
                    —
                  </td>
                ))
              )}
              <td className="border-t border-l border-stone-300 px-2 py-2 text-right tabular-nums">
                {formatMoney(tableTotals.earned)}
              </td>
              <td className="border-t border-l border-stone-300 px-1.5 py-2 text-right tabular-nums">
                {tableTotals.adjustment > 0 ? `+${formatMoney(tableTotals.adjustment)}` : formatMoney(tableTotals.adjustment)}
              </td>
              <td className="border-t border-l border-stone-300 px-1.5 py-2 text-right tabular-nums text-amber-900">
                {formatMoney(tableTotals.deduct)}
              </td>
              <td className="border-t border-l border-stone-300 px-1.5 py-2 text-right tabular-nums text-sky-900">
                {formatMoney(tableTotals.giveUpad)}
              </td>
              <td className="border-t border-l border-stone-300 px-2.5 py-2 text-right tabular-nums text-stone-950 font-black">
                {formatMoney(tableTotals.toPay)}
              </td>
              <td className="border-t border-l border-stone-300 px-2 py-2 text-right tabular-nums text-emerald-950 font-black">
                <div>{formatMoney(tableTotals.paid)}</div>
                <div className="text-[10px] text-stone-500 font-bold mt-0.5">
                  Carry: {formatMoney(tableTotals.newCarry)}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Adjustment Popover/Modal */}
      {activeAdjModalWorker && (
        <AdjustmentModal
          open={Boolean(activeAdjModalWorker)}
          onClose={() => setActiveAdjModalWorker(null)}
          employee={activeAdjModalWorker}
          date={today}
        />
      )}

      {/* Statement Modal */}
      <StatementModal
        open={Boolean(statementData)}
        onClose={() => setStatementData(null)}
        data={statementData}
      />

      {/* Upad History Modal */}
      <UpadHistoryModal
        open={Boolean(upadHistoryWorker)}
        onClose={() => setUpadHistoryWorker(null)}
        employee={upadHistoryWorker}
        upadEntries={upadEntries}
      />

      {/* Upad Return Modal */}
      <UpadReturnModal
        open={Boolean(upadReturnWorker)}
        onClose={() => setUpadReturnWorker(null)}
        employee={upadReturnWorker}
        currentUpadPaise={
          upadReturnWorker
            ? getWorkerUpadBalance(
                upadEntries.filter((u) => u.employee === upadReturnWorker.id && !u.voided).map((u) => ({
                  id: u.id,
                  employee: u.employee,
                  date: dateKey(u.date),
                  kind: u.kind,
                  amount_paise: u.amount_paise,
                })),
                upadReturnWorker.opening_upad_paise ?? 0,
              )
            : 0
        }
      />

      {/* Leaving Worker Settlement Modal */}
      <LeavingSettlementModal
        open={Boolean(leavingWorkerData)}
        onClose={() => setLeavingWorkerData(null)}
        data={leavingWorkerData}
      />

      {/* Close Cycle Confirmation Modal */}
      <CloseCycleModal
        open={closeModalOpen}
        onClose={() => setCloseModalOpen(false)}
        cycleStart={cycleStart}
        latestPaidDate={latestPaidDate}
        nextCycleStart={nextCycleStart}
        doneCount={doneRows.length}
        undoneWorkers={undoneRows.map((r) => ({
          id: r.employee.id,
          name: r.employee.name,
          fullDuePaise: r.carryPaise + r.earnedPaise + r.adjustmentPaise,
        }))}
        totalPaidPaise={tableTotals.paid}
        totalDeductPaise={tableTotals.deduct}
        isClosing={isClosingCycle}
        onConfirmClose={handleConfirmCloseCycle}
      />
    </>
  )
}

function AdjustmentModal({
  open,
  onClose,
  employee,
  date,
}: {
  open: boolean
  onClose: () => void
  employee: Employee
  date: string
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = useState<'bonus' | 'deduction'>('bonus')
  const [amountInput, setAmountInput] = useState('')
  const [note, setNote] = useState('')

  const mutation = useMutation({
    mutationFn: async () => {
      const amtPaise = rupeesToPaise(Number.parseFloat(amountInput) || 0)
      if (amtPaise <= 0) throw new Error('Enter a valid amount > 0')

      await createAdjustment({
        employeeId: employee.id,
        date: date.includes(' ') ? date : `${date} 12:00:00.000Z`,
        amountPaise: amtPaise,
        kind,
        note: note.trim() || (kind === 'bonus' ? 'Bonus' : 'Deduction'),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      toast(`Adjustment recorded for ${employee.name}`, 'success')
      onClose()
    },
    onError: (err: Error) => {
      toast(err.message || 'Failed to save adjustment', 'error')
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Add Adjustment: ${employee.name}`}
      description="Add a bonus or deduction to this cycle salary"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amountInput}
            className="bg-emerald-700 hover:bg-emerald-800 font-bold"
          >
            {mutation.isPending ? 'Saving...' : 'Save Adjustment'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setKind('bonus')}
            className={clsx(
              'rounded-lg py-1.5 text-xs font-bold border transition',
              kind === 'bonus'
                ? 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-1 ring-emerald-500'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
            )}
          >
            + Bonus / Add
          </button>
          <button
            type="button"
            onClick={() => setKind('deduction')}
            className={clsx(
              'rounded-lg py-1.5 text-xs font-bold border transition',
              kind === 'deduction'
                ? 'bg-rose-50 border-rose-500 text-rose-900 ring-1 ring-rose-500'
                : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50',
            )}
          >
            − Deduction / Cut
          </button>
        </div>

        <Field label="Amount (₹)">
          <Input
            type="number"
            min="1"
            step="any"
            placeholder="0"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Note (Optional)">
          <Input
            type="text"
            placeholder="e.g. Festival gift, transport allowance"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
