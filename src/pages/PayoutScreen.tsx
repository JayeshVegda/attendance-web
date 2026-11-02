import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EMPTY_INPUTS,
  formatEngineError,
  loadWorkerContexts,
  newIdempotencyKey,
  repairPendingRun,
  savePayout,
  type WorkerContext,
} from '../lib/payout-service'
import {
  type AttendanceRow,
  type DayStatus,
  type EngineError,
  type EngineWarning,
  type PayoutInputs,
  computePayout,
  unmarkedDaysFor,
  upadBalance,
} from '../lib/engine'
import { addDays, daysBetweenInclusive, formatDateLong, formatDateShort, todayKey } from '../lib/dates'
import { calculateDenominations, formatMoney, parseMoneyInput, paiseToInput, formatHours } from '../lib/money'
import { Avatar, Badge, Button, Card, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import {
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  Info,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react'
import { getSettings, listRuns } from '../lib/api'
import { isChaluUpadEnabled, isMotoUpadEnabled, isRealPayoutRun, lastClosedRun, useUpadBuckets } from '../lib/cycle'
import { pb } from '../lib/pb'
import type { Attendance } from '../lib/types'

type RowInputState = {
  cr: string // Chalu recovery ₹
  mr: string // Main recovery ₹
  ngChalu: string // New Chalu upad given ₹
  ngMoto: string // New Main upad given ₹
  adj: string // + / - Adjustment ₹ (Bonus or Deduction)
  sp: string // Salary paid ₹ (empty = full payable)
  ng?: string // legacy fallback
  nb?: 'chalu' | 'moto' // legacy fallback
}

function getRowInput(inputs: Record<string, RowInputState>, empId: string): RowInputState {
  const cur = inputs[empId]
  return {
    cr: cur?.cr ?? '',
    mr: cur?.mr ?? '',
    ngChalu: cur?.ngChalu ?? (cur?.nb === 'chalu' ? (cur.ng ?? '') : ''),
    ngMoto: cur?.ngMoto ?? (cur?.nb === 'moto' ? (cur.ng ?? '') : ''),
    adj: cur?.adj ?? '',
    sp: cur?.sp ?? '',
  }
}

const STATUS_LETTER: Record<string, string> = { full: 'P', half: 'H', absent: 'A' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function PayoutScreen({
  onNavigate,
  initialWorkerId,
}: {
  onNavigate: (path: string) => void
  initialWorkerId?: string
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [payoutDate, setPayoutDate] = useState(todayKey())
  const [includePayoutDay, setIncludePayoutDay] = useState(true)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')
  const [inputs, setInputs] = useState<Record<string, RowInputState>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [inspectingWorkerId, setInspectingWorkerId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  function openConfirm() {
    setConfirmKey(newIdempotencyKey())
    setConfirmOpen(true)
  }

  const cutoff = includePayoutDay ? payoutDate : addDays(payoutDate, -1)

  const contextsQuery = useQuery({ queryKey: ['payout-contexts'], queryFn: loadWorkerContexts })
  const attendanceQuery = useQuery({
    queryKey: ['payout-attendance'],
    queryFn: () => pb.collection('attendance').getFullList<Attendance>({ sort: 'date' }),
  })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const settings = settingsQuery.data
  const upadConfig = useUpadBuckets(settings)
  const isChaluOn = upadConfig.isChaluOn
  const isMotoOn = upadConfig.isMotoOn
  const hasAnyUpad = upadConfig.hasAny

  // Calculate live preview directly using pure calculation engine
  const preview = useMemo(() => {
    if (!contextsQuery.data || !attendanceQuery.data) return []
    const rawAtt = attendanceQuery.data
    const allEngineAtt: AttendanceRow[] = rawAtt.map((a) => ({
      id: a.id,
      employee: a.employee,
      date: (a.date ?? '').slice(0, 10),
      status: a.status as DayStatus,
      ot_minutes: a.ot_minutes ?? 0,
      settled: !!a.settled_payout,
    }))

    return contextsQuery.data.map((ctx) => {
      const inp = getRowInput(inputs, ctx.employee.id)
      const crPaise = parseMoneyInput(inp.cr)
      const mrPaise = parseMoneyInput(inp.mr)
      const ngChaluPaise = parseMoneyInput(inp.ngChalu)
      const ngMotoPaise = parseMoneyInput(inp.ngMoto)
      const adjPaise = parseMoneyInput(inp.adj)
      const totalNewUpadPaise = ngChaluPaise + ngMotoPaise

      const hasActivity =
        ctx.attendance.some((a) => !a.settled && a.date <= cutoff) ||
        ctx.adjustments.some((a) => !a.settled && a.date <= cutoff)
      const carryDiffers = ctx.worker.opening_carry_paise !== 0
      const chaluBal = isChaluOn ? upadBalance(ctx.upads, 'chalu', ctx.worker.opening_chalu_paise, cutoff) : 0
      const motoBal = isMotoOn ? upadBalance(ctx.upads, 'moto', ctx.worker.opening_moto_paise, cutoff) : 0
      const included = hasActivity || carryDiffers || chaluBal !== 0 || motoBal !== 0

      if (!included) {
        return {
          context: ctx,
          included: false,
          computation: null,
          errors: [],
          warnings: [],
          unmarkedDates: [],
          salaryPaidPaise: 0,
          cashToHandOverPaise: 0,
          closingCarryPaise: 0,
        }
      }

      // First run with salary_paid_paise = 0 to determine maximum net payable
      const baseMerged: PayoutInputs = {
        chalu_recovery_paise: crPaise,
        moto_recovery_paise: mrPaise,
        new_chalu_given_paise: ngChaluPaise,
        new_moto_given_paise: ngMotoPaise,
        new_upad_given_paise: totalNewUpadPaise,
        new_upad_bucket: 'chalu',
        payout_adjustment_paise: adjPaise,
        salary_paid_paise: 0,
      }
      const out = computePayout(
        ctx.worker,
        ctx.paidUpToDate,
        cutoff,
        ctx.rates,
        ctx.periods,
        ctx.attendance,
        ctx.adjustments,
        ctx.upads,
        baseMerged,
        { chalu_enabled: isChaluOn, moto_enabled: isMotoOn },
      )

      if (!out.ok) {
        return {
          context: ctx,
          included: true,
          computation: null,
          errors: out.errors,
          warnings: [],
          unmarkedDates: [],
          salaryPaidPaise: 0,
          cashToHandOverPaise: 0,
          closingCarryPaise: 0,
        }
      }

      const netPayable = out.result.payable_paise
      const spPaise = inp.sp.trim() === '' ? netPayable : parseMoneyInput(inp.sp)

      // Extra validations
      const extraErrors: EngineError[] = []
      if (spPaise < 0 || spPaise > netPayable) {
        extraErrors.push({
          code: 'salary_paid_out_of_range',
          amount: Math.max(0, spPaise - netPayable),
        })
      }

      const finalMerged: PayoutInputs = {
        ...baseMerged,
        salary_paid_paise: spPaise,
      }
      const finalOut = computePayout(
        ctx.worker,
        ctx.paidUpToDate,
        cutoff,
        ctx.rates,
        ctx.periods,
        ctx.attendance,
        ctx.adjustments,
        ctx.upads,
        finalMerged,
        { chalu_enabled: isChaluOn, moto_enabled: isMotoOn },
      )

      const unmarked = unmarkedDaysFor(
        ctx.worker,
        ctx.paidUpToDate,
        cutoff,
        ctx.periods,
        ctx.attendance,
        allEngineAtt,
      )

      const comp = finalOut.ok ? finalOut.result : out.result
      const allErrors = [...(finalOut.ok ? [] : finalOut.errors), ...extraErrors]

      return {
        context: ctx,
        included: true,
        computation: comp,
        errors: allErrors,
        warnings: comp.warnings,
        unmarkedDates: unmarked,
        salaryPaidPaise: spPaise,
        cashToHandOverPaise: spPaise + totalNewUpadPaise,
        closingCarryPaise: Math.max(0, netPayable - spPaise),
      }
    })
  }, [contextsQuery.data, attendanceQuery.data, cutoff, inputs])

  const includedRows = useMemo(() => preview.filter((r) => r.included), [preview])

  // Initialize selection
  useEffect(() => {
    if (includedRows.length === 0) return
    setSelected((prev) => {
      if (Object.keys(prev).length > 0) return prev
      const initial: Record<string, boolean> = {}
      for (const r of includedRows) {
        initial[r.context.employee.id] = initialWorkerId ? r.context.employee.id === initialWorkerId : true
      }
      return initial
    })
  }, [includedRows, initialWorkerId])

  const selectedRows = useMemo(() => {
    return includedRows.filter((r) => selected[r.context.employee.id])
  }, [includedRows, selected])

  const cleanSelectedRows = useMemo(() => {
    return selectedRows.filter((r) => r.computation && r.errors.length === 0)
  }, [selectedRows])

  const hasAnyErrors = useMemo(() => {
    return selectedRows.some((r) => r.errors.length > 0)
  }, [selectedRows])

  // Table Totals
  const totals = useMemo(() => {
    let carry = 0
    let earned = 0
    let adj = 0
    let chaluBal = 0
    let motoBal = 0
    let chaluRec = 0
    let motoRec = 0
    let newUpad = 0
    let newChalu = 0
    let newMoto = 0
    let payoutAdj = 0
    let payable = 0
    let salaryPaid = 0
    let cashToHand = 0
    let closingCarry = 0

    for (const r of cleanSelectedRows) {
      const c = r.computation!
      carry += c.carry_paise
      earned += c.earned_paise
      adj += c.adjustments_paise
      chaluBal += c.chalu_balance_paise
      motoBal += c.moto_balance_paise
      chaluRec += c.chalu_recovery_paise
      motoRec += c.moto_recovery_paise
      newUpad += c.new_upad_given_paise
      newChalu += c.new_chalu_given_paise ?? 0
      newMoto += c.new_moto_given_paise ?? 0
      payoutAdj += c.payout_adjustment_paise ?? 0
      payable += c.payable_paise
      salaryPaid += r.salaryPaidPaise
      cashToHand += r.cashToHandOverPaise
      closingCarry += r.closingCarryPaise
    }

    return {
      carry,
      earned,
      adj,
      chaluBal,
      motoBal,
      chaluRec,
      motoRec,
      newUpad,
      newChalu,
      newMoto,
      payoutAdj,
      payable,
      salaryPaid,
      cashToHand,
      closingCarry,
    }
  }, [cleanSelectedRows])

  const denoms = useMemo(() => calculateDenominations(totals.cashToHand), [totals.cashToHand])

  // Payout reminder
  const latestRun = runsQuery.data ? lastClosedRun(runsQuery.data) : undefined
  const daysSinceLastPayout = latestRun
    ? Math.max(0, daysBetweenInclusive(latestRun.payout_date, todayKey()) - 1)
    : null

  const setRowField = (empId: string, field: keyof RowInputState, val: string) => {
    setInputs((prev) => {
      const cur = getRowInput(prev, empId)
      return { ...prev, [empId]: { ...cur, [field]: val } }
    })
  }

  const setAllSelection = (checked: boolean) => {
    const next: Record<string, boolean> = {}
    for (const r of includedRows) next[r.context.employee.id] = checked
    setSelected(next)
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      savePayout({
        payoutDate,
        cutoff,
        note: '',
        idempotencyKey: confirmKey ?? newIdempotencyKey(),
        rows: cleanSelectedRows.map((r) => {
          const inp = getRowInput(inputs, r.context.employee.id)
          const ngChaluPaise = parseMoneyInput(inp.ngChalu)
          const ngMotoPaise = parseMoneyInput(inp.ngMoto)
          const adjPaise = parseMoneyInput(inp.adj)
          const totalNewUpad = ngChaluPaise + ngMotoPaise
          return {
            context: r.context,
            inputs: {
              ...EMPTY_INPUTS,
              chalu_recovery_paise: parseMoneyInput(inp.cr),
              moto_recovery_paise: parseMoneyInput(inp.mr),
              new_chalu_given_paise: ngChaluPaise,
              new_moto_given_paise: ngMotoPaise,
              new_upad_given_paise: totalNewUpad,
              new_upad_bucket: 'chalu',
              payout_adjustment_paise: adjPaise,
              salary_paid_paise: r.salaryPaidPaise,
            },
          }
        }),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries()
      toast('Payout confirmed and issued for ticked workers.')
      setInputs({})
      setConfirmOpen(false)
      onNavigate(`reports/${res.runId}`)
    },
    onError: (err) => {
      setConfirmOpen(false)
      toast(err instanceof Error ? err.message : 'Payout failed to save.', 'error')
    },
  })

  const repairMutation = useMutation({
    mutationFn: (runId: string) => repairPendingRun(runId),
    onSuccess: (_res, runId) => {
      void queryClient.invalidateQueries()
      toast('Interrupted payout cleaned up. You can save the payout again.')
      setConfirmKey(null)
      setConfirmOpen(false)
      void runId
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Repair failed.', 'error'),
  })

  if (contextsQuery.isLoading || attendanceQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-stone-500 font-semibold">
        <Spinner className="h-6 w-6" />
        <span>Loading payroll records…</span>
      </div>
    )
  }

  if (contextsQuery.isError || attendanceQuery.isError) {
    const err = contextsQuery.error || attendanceQuery.error
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-center my-12">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 mb-2 font-black">
          ⚠
        </div>
        <div className="text-sm font-bold text-rose-950">Failed to load payroll records</div>
        <div className="text-xs text-rose-700 font-mono mt-1 mb-4">
          {err instanceof Error ? err.message : 'Could not reach server'}
        </div>
        <Button
          size="sm"
          className="bg-rose-700 hover:bg-rose-800 text-white font-bold"
          onClick={() => {
            void contextsQuery.refetch()
            void attendanceQuery.refetch()
            void runsQuery.refetch()
          }}
        >
          Retry Loading
        </Button>
      </div>
    )
  }

  const allSelected = includedRows.length > 0 && includedRows.every((r) => selected[r.context.employee.id])
  const inspectingRow = preview.find((r) => r.context.employee.id === inspectingWorkerId)
  const pendingRuns = (runsQuery.data ?? []).filter((r) => !r.voided && r.status === 'pending')

  return (
    <div className="w-full space-y-2 pb-12 select-text">
      {/* 0. Pending (interrupted) payout banner */}
      {pendingRuns.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <TriangleAlert className="h-4 w-4 text-amber-700" />
            <span className="font-black text-amber-900">
              An earlier payout save was interrupted ({pendingRuns.length > 1 ? `${pendingRuns.length} runs` : formatDateShort(pendingRuns[0].payout_date)}).
            </span>
            <span className="text-amber-800">It is excluded from all money until repaired.</span>
          </div>
          <div className="flex gap-2">
            {pendingRuns.map((r) => (
              <Button
                key={r.id}
                size="sm"
                className="bg-amber-700 hover:bg-amber-800 text-white font-bold"
                disabled={repairMutation.isPending}
                onClick={() => repairMutation.mutate(r.id)}
              >
                Repair payout
              </Button>
            ))}
          </div>
        </div>
      )}
      {/* 1. Fast Control & Summary Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-2xs">
        {/* Left: Date & Cutoff controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-black text-stone-900 text-sm">Issue Payout</span>
          <span className="text-stone-300">|</span>
          <label className="flex items-center gap-1.5 font-bold text-stone-700">
            <span>Date:</span>
            <input
              type="date"
              value={payoutDate}
              onChange={(e) => setPayoutDate(e.target.value)}
              className="h-7 rounded border border-stone-300 bg-stone-50 px-2 text-xs font-bold focus:border-emerald-600 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 font-bold text-stone-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includePayoutDay}
              onChange={(e) => setIncludePayoutDay(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-emerald-600"
            />
            <span>Count today ({formatDateShort(cutoff)})</span>
          </label>
        </div>

        {/* Center: Hero Cash Needed Pill & Notes popover toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800">
              Cash to Hand Over:
            </span>
            <span className="text-base font-black text-emerald-950 tabular-nums">
              {formatMoney(totals.cashToHand)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setNotesOpen(!notesOpen)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition select-none ${
              notesOpen
                ? 'border-emerald-700 bg-emerald-700 text-white shadow-2xs'
                : 'border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100'
            }`}
            title="Click to toggle currency denomination checklist"
          >
            <Banknote className="h-3.5 w-3.5 text-emerald-600" />
            <span>Notes</span>
            <span className="text-[10px] opacity-75">
              ({denoms.notes.filter((n) => n.count > 0).length} types)
            </span>
          </button>
        </div>

        {/* Right: View Switcher & Save Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-2.5 py-1 rounded transition ${
                viewMode === 'cards'
                  ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded transition ${
                viewMode === 'table'
                  ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Table
            </button>
          </div>

          <Button
            size="sm"
            disabled={hasAnyErrors || cleanSelectedRows.length === 0}
            onClick={() => openConfirm()}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-black px-4 shadow-xs"
          >
            <Wallet className="h-3.5 w-3.5 mr-1" />
            <span>Save Payout ({cleanSelectedRows.length})</span>
          </Button>
        </div>
      </div>

      {/* Floating Notes Denominations Checklist Banner */}
      {notesOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-950 via-teal-950 to-stone-900 px-3.5 py-2 text-xs font-mono text-white shadow-md">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 mr-1">
            Withdrawal Checklist:
          </span>
          {denoms.notes
            .filter((n) => n.count > 0)
            .map((n) => (
              <span
                key={n.note}
                className="rounded bg-white/20 px-2 py-0.5 font-bold text-white tabular-nums border border-white/10"
              >
                {n.count} × ₹{n.note} = ₹{(n.count * n.note).toLocaleString('en-IN')}
              </span>
            ))}
          {denoms.coins > 0 && (
            <span className="rounded bg-white/20 px-2 py-0.5 font-bold text-emerald-200 tabular-nums border border-white/10">
              Coins: ₹{denoms.coins}
            </span>
          )}
          <button
            type="button"
            onClick={() => setNotesOpen(false)}
            className="ml-auto text-stone-400 hover:text-white text-xs px-1 font-bold"
          >
            ✕ Close
          </button>
        </div>
      )}



      {/* 2. Main Payout View: Cards or Table */}
      {viewMode === 'cards' ? (
        <div className="space-y-3">
          {/* Quick Select All Header */}
          <div className="flex items-center justify-between px-2 text-xs font-bold text-stone-600">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => setAllSelection(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-emerald-600"
              />
              <span>Select All Active Workers ({includedRows.length})</span>
            </label>
            <span className="text-stone-400 text-[11px]">
              Click on any worker name for day-by-day attendance inspection
            </span>
          </div>

          {/* Cards Grid / List */}
          {includedRows.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500 shadow-2xs">
              <p className="font-bold text-stone-800 text-sm">No active workers found for cutoff {formatDateShort(cutoff)}</p>
              <p className="text-xs text-stone-400 mt-1">
                There are no unsettled attendance records, unpaid carry, or upad for this date.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {includedRows.map((r) => {
                const emp = r.context.employee
                const c = r.computation
                const isTicked = !!selected[emp.id]
                const inp = getRowInput(inputs, emp.id)
                const isInactive = !emp.active

                // Upad history context: last taken & last payment
                const chaluGiven = r.context.upads
                  .filter((u) => !u.voided && u.bucket === 'chalu' && u.kind === 'given')
                  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.id ?? '').localeCompare(a.id ?? ''))[0]

                const chaluPaid = r.context.upads
                  .filter((u) => !u.voided && u.bucket === 'chalu' && (u.kind === 'recovery' || u.kind === 'returned'))
                  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.id ?? '').localeCompare(a.id ?? ''))[0]

                const motoGiven = r.context.upads
                  .filter((u) => !u.voided && u.bucket === 'moto' && u.kind === 'given')
                  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.id ?? '').localeCompare(a.id ?? ''))[0]

                const motoPaid = r.context.upads
                  .filter((u) => !u.voided && u.bucket === 'moto' && (u.kind === 'recovery' || u.kind === 'returned'))
                  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.id ?? '').localeCompare(a.id ?? ''))[0]

              const fullCount = c ? c.day_breakdown.filter((d) => d.status === 'full').length : 0
              const halfCount = c ? c.day_breakdown.filter((d) => d.status === 'half').length : 0
              const absentCount = c ? c.day_breakdown.filter((d) => d.status === 'absent').length : 0
              const cycleDays = c ? c.day_breakdown.length : 0
              const daysWorked = c ? c.day_breakdown.reduce((sum, b) => sum + (b.days_worked !== undefined ? b.days_worked : b.status === 'full' ? 1 : b.status === 'half' ? 0.5 : 0), 0) : (fullCount + halfCount * 0.5)
              const otMins = c ? c.day_breakdown.reduce((sum, d) => sum + d.ot_minutes, 0) : 0

              const handleQuickSettle = () => {
                if (!c) return
                const crVal = upadConfig.isChaluOn ? Math.min(c.chalu_balance_paise, c.total_due_paise) : 0
                const mrVal = upadConfig.isMotoOn ? Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - crVal)) : 0
                const netAfter = Math.max(0, c.total_due_paise - crVal - mrVal)
                setInputs((prev) => ({
                  ...prev,
                  [emp.id]: {
                    ...inp,
                    cr: crVal > 0 ? (crVal / 100).toString() : '',
                    mr: mrVal > 0 ? (mrVal / 100).toString() : '',
                    sp: (netAfter / 100).toString(),
                    ngChalu: '',
                    ngMoto: '',
                    adj: '',
                  },
                }))
              }

              return (
                <div
                  key={emp.id}
                  className={`rounded-xl border transition-all duration-150 p-3 bg-white shadow-2xs ${
                    !isTicked
                      ? 'opacity-40 border-stone-200 bg-stone-50/50'
                      : r.errors.length > 0
                        ? 'border-rose-300 ring-1 ring-rose-200'
                        : 'border-stone-200 hover:border-emerald-300'
                  }`}
                >
                  {/* Card Header: Worker Identity & Quick Status */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2 mb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isTicked}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [emp.id]: e.target.checked }))}
                        className="h-4 w-4 rounded accent-emerald-600 cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => setInspectingWorkerId(emp.id)}
                        className="flex flex-wrap items-center gap-1.5 text-left group hover:text-emerald-700 cursor-pointer"
                        title="Click to view daily attendance and ledger"
                      >
                        <span className="text-sm font-black text-stone-900 group-hover:text-emerald-700">
                          {emp.name}
                        </span>
                        <span className="text-xs font-semibold text-stone-400">#{emp.employee_no}</span>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
                          ₹{emp.daily_rate_paise / 100}/d
                        </span>
                        {c && c.day_breakdown.length > 0 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] font-bold text-stone-700 tracking-tight"
                            title={`Cycle ${cycleDays} days: ${fullCount} Present, ${halfCount} Half, ${absentCount} Absent, ${formatHours(otMins)} Overtime`}
                          >
                            <span className="text-stone-900 font-extrabold">{daysWorked}/{cycleDays}d</span>
                            <span className="text-stone-300">·</span>
                            <span className="text-emerald-700">{fullCount}P</span>
                            {halfCount > 0 && <span className="text-amber-700">{halfCount}H</span>}
                            {absentCount > 0 && <span className="text-rose-700">{absentCount}A</span>}
                            {otMins > 0 && (
                              <>
                                <span className="text-stone-300">·</span>
                                <span className="text-teal-800 font-black">+{formatHours(otMins)} OT</span>
                              </>
                            )}
                          </span>
                        )}
                      </button>

                      {/* Daily Attendance Pills: Denser, compact badges */}
                      {c && c.day_breakdown.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pl-2 border-l border-stone-200">
                          {c.day_breakdown.map((d, i) => {
                            const curMonth = parseInt(d.date.slice(5, 7), 10) - 1
                            const prevMonth = i > 0 ? parseInt(c.day_breakdown[i - 1].date.slice(5, 7), 10) - 1 : -1
                            const showMonth = i === 0 || curMonth !== prevMonth
                            const monthLabel = MONTH_NAMES[curMonth] ?? ''

                            const isHours = d.status === 'hours'
                            const isFull = d.status === 'full'
                            const isHalf = d.status === 'half'
                            const isAbsent = d.status === 'absent'
                            const hasOt = d.ot_minutes > 0
                            const dayNum = parseInt(d.date.slice(8, 10), 10)

                            let statusStr = '—'
                            if (isHours) {
                              const hrs = d.worked_minutes ? (d.worked_minutes % 60 === 0 ? `${d.worked_minutes / 60}` : (d.worked_minutes / 60).toFixed(1)) : '0'
                              statusStr = `${hrs}h`
                            } else if (isFull) {
                              statusStr = 'P'
                            } else if (isHalf) {
                              statusStr = 'H'
                            } else if (isAbsent) {
                              statusStr = 'A'
                            }

                            const otText = hasOt
                              ? `+${d.ot_minutes % 60 === 0 ? `${d.ot_minutes / 60}h` : formatHours(d.ot_minutes)}`
                              : ''

                            return (
                              <div key={d.date} className="inline-flex items-center gap-1">
                                {showMonth && (
                                  <span className="text-[10px] uppercase font-bold tracking-wider text-stone-400 select-none px-0.5">
                                    {monthLabel}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setInspectingWorkerId(emp.id)}
                                  className={clsx(
                                    'inline-flex items-center gap-1 h-[22px] px-1.5 py-0.5 text-[11px] font-medium leading-none rounded-[6px] border transition-all cursor-pointer select-none shadow-2xs whitespace-nowrap',
                                    isHours && 'bg-sky-50 text-sky-800 border-sky-200/70 hover:bg-sky-100',
                                    isFull && !hasOt && 'bg-emerald-50 text-emerald-800 border-emerald-200/70 hover:bg-emerald-100',
                                    isFull && hasOt && 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200',
                                    isHalf && 'bg-amber-50 text-amber-800 border-amber-200/70 hover:bg-amber-100',
                                    isAbsent && 'bg-rose-50 text-rose-700 border-rose-200/70 hover:bg-rose-100',
                                    !isHours && !isFull && !isHalf && !isAbsent && 'bg-stone-50 text-stone-500 border-stone-200/70 hover:bg-stone-100',
                                  )}
                                  title={`${d.date}: ${isHours ? `${statusStr} worked` : isFull ? 'Present' : isHalf ? 'Half day' : isAbsent ? 'Absent' : 'Unmarked'}${hasOt ? ` (${otText} OT)` : ''}`}
                                >
                                  <span className="opacity-75">{dayNum}</span>
                                  <span className="font-bold">{statusStr}</span>
                                  {hasOt && <span className="font-bold tabular-nums text-emerald-800">{otText}</span>}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {isInactive && (
                        <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          Inactive
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {r.errors.length > 0 ? (
                        <span className="rounded-lg bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-bold text-rose-700">
                          ⚠️ {r.errors.map((e) => formatEngineError(e)).join('; ')}
                        </span>
                      ) : r.unmarkedDates.length > 0 ? (
                        <span className="rounded-lg bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {r.unmarkedDates.length}d unmarked
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-emerald-700">✓ Ready</span>
                      )}

                      {isInactive && c && ((upadConfig.isChaluOn && c.chalu_balance_paise > 0) || (upadConfig.isMotoOn && c.moto_balance_paise > 0)) && (
                        <button
                          type="button"
                          onClick={handleQuickSettle}
                          className="rounded-lg bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 text-xs font-bold text-amber-900"
                          title="Offset upad balance against carry and settle"
                        >
                          Settle Inactive
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card Body: 3 Categorized Blocks */}
                  <div className={clsx('grid grid-cols-1 gap-3 text-xs', upadConfig.isBothOff ? 'lg:grid-cols-2' : 'lg:grid-cols-3')}>
                    {/* Block 1: Work & Owed (Earnings) */}
                    <div className="rounded-xl border border-stone-200/90 bg-stone-50/70 p-3 flex flex-col justify-between space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-stone-700 border-b border-stone-200/80 pb-1.5">
                        <span>1. Earnings & Carry</span>
                        <span className="font-semibold text-stone-600 tabular-nums normal-case text-xs">
                          {c ? `${daysWorked}/${cycleDays}d worked` : '0d'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {/* Base Wages & Overtime Card */}
                        <div className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-2xs space-y-1.5">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-stone-900">Base Wages</span>
                              <span className="rounded bg-stone-100 text-stone-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                                {daysWorked}d × ₹{emp.daily_rate_paise / 100}
                              </span>
                            </div>
                            <span className="text-xs font-black tabular-nums text-stone-900">
                              {c ? formatMoney(c.earned_paise - c.ot_paise) : '₹0'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-stone-100 text-stone-500">
                            <div className="flex items-center gap-1">
                              <span className="text-stone-400 font-medium">Overtime:</span>
                              <span className="font-semibold text-stone-700">
                                {otMins > 0 ? `${formatHours(otMins)} OT` : 'None (0h)'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-stone-400 font-medium">OT Pay:</span>
                              <span
                                className={clsx(
                                  'font-bold tabular-nums',
                                  (c?.ot_paise ?? 0) > 0 ? 'text-teal-700' : 'text-stone-500',
                                )}
                              >
                                {(c?.ot_paise ?? 0) > 0 ? `+${formatMoney(c!.ot_paise)}` : '₹0'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[10px] pt-0.5 text-stone-400">
                            <span className="font-medium">
                              Standard: 8h/d · ₹{(emp.daily_rate_paise / 800).toFixed(1)}/h
                            </span>
                            <span className="font-semibold text-stone-700 tabular-nums">
                              Earned: {c ? formatMoney(c.earned_paise) : '₹0'}
                            </span>
                          </div>
                        </div>

                        {/* Prior Carry & Adjustments Card */}
                        <div className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-2xs space-y-1.5">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-stone-900">Prior Carry</span>
                              <span className="rounded bg-stone-100 text-stone-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                                {(c?.carry_paise ?? 0) > 0 ? 'Unpaid balance' : 'Nil'}
                              </span>
                            </div>
                            <span className="text-xs font-black tabular-nums text-stone-900">
                              {c ? formatMoney(c.carry_paise) : '₹0'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-stone-100 text-stone-500">
                            <div className="flex items-center gap-1">
                              <span className="text-stone-400 font-medium">Bonus / Adjustments:</span>
                              <span
                                className={clsx(
                                  'font-bold tabular-nums',
                                  (c?.adjustments_paise ?? 0) > 0
                                    ? 'text-emerald-700'
                                    : (c?.adjustments_paise ?? 0) < 0
                                      ? 'text-rose-700'
                                      : 'text-stone-500',
                                )}
                              >
                                {(c?.adjustments_paise ?? 0) > 0 ? '+' : ''}
                                {c ? formatMoney(c.adjustments_paise) : '₹0'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-stone-400 font-medium">Status:</span>
                              <span className="font-semibold text-stone-600">
                                {(c?.carry_paise ?? 0) > 0 ? 'Carried' : 'Normal'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[10px] pt-0.5 text-stone-400">
                            <span className="font-medium">
                              Cycle net: Wages + Carry + Adj
                            </span>
                            <span className="font-semibold text-stone-700 tabular-nums">
                              Total: {c ? formatMoney(c.total_due_paise) : '₹0'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-stone-200/90 pt-1.5 flex justify-between font-bold text-stone-900">
                        <span className="text-xs font-bold text-stone-800">Gross Due:</span>
                        <span className="tabular-nums text-sm font-black text-stone-900">
                          {c ? formatMoney(c.total_due_paise) : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Block 2: Upad Deductions */}
                    {upadConfig.hasAny && (
                      <div
                        className={clsx(
                          'rounded-xl border border-stone-200/90 bg-stone-50/70 p-3 space-y-2',
                          upadConfig.isBothOn ? 'flex flex-col justify-between' : 'flex flex-col justify-start',
                        )}
                      >
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-stone-700 border-b border-stone-200/80 pb-1.5">
                          <span>2. {upadConfig.sectionTitle}</span>
                          <span
                            className={clsx(
                              'font-bold tabular-nums normal-case text-[11px] px-2 py-0.5 rounded-md border',
                              c && c.chalu_after_paise + c.moto_after_paise > 0
                                ? 'bg-amber-50 text-amber-900 border-amber-200/70'
                                : 'bg-white text-stone-500 border-stone-200',
                            )}
                            title={
                              upadConfig.isBothOn
                                ? `${upadConfig.chaluLabel}: ${formatMoney(c ? c.chalu_after_paise : 0)} + ${upadConfig.motoLabel}: ${formatMoney(c ? c.moto_after_paise : 0)}`
                                : undefined
                            }
                          >
                            Remaining:{' '}
                            <strong>
                              {formatMoney(
                                upadConfig.isBothOn
                                  ? (c ? c.chalu_after_paise + c.moto_after_paise : 0)
                                  : upadConfig.singleBucket?.id === 'chalu'
                                    ? (c ? c.chalu_after_paise : 0)
                                    : (c ? c.moto_after_paise : 0),
                              )}
                            </strong>
                          </span>
                        </div>

                        {upadConfig.isOnlyOneOn && (() => {
                          const b = upadConfig.singleBucket!
                          const isChalu = b.id === 'chalu'
                          const balPaise = c ? (isChalu ? c.chalu_balance_paise : c.moto_balance_paise) : 0
                          const cutVal = isChalu ? inp.cr : inp.mr
                          const setCut = (val: string) => setRowField(emp.id, isChalu ? 'cr' : 'mr', val)
                          const lastGiven = isChalu ? chaluGiven : motoGiven
                          const lastPaid = isChalu ? chaluPaid : motoPaid
                          const openingPaise = isChalu ? (emp.opening_chalu_paise ?? 0) : (emp.opening_moto_paise ?? 0)
                          const cutPaise = c ? (isChalu ? c.chalu_recovery_paise : c.moto_recovery_paise) : 0

                          return (
                            <div className="space-y-2">
                              <div className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-2xs space-y-1.5">
                                <div className="flex items-center justify-between gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-stone-900">{b.label}</span>
                                    <span
                                      className={clsx(
                                        'rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums border',
                                        isChalu
                                          ? 'bg-amber-50 text-amber-900 border-amber-200/60'
                                          : 'bg-purple-50 text-purple-900 border-purple-200/60',
                                      )}
                                    >
                                      Bal: {formatMoney(balPaise)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-stone-400 font-medium">Cut:</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      value={cutVal}
                                      onChange={(e) => setCut(e.target.value)}
                                      className="h-7.5 w-20 px-2 text-right font-bold text-xs rounded-md border border-stone-300 bg-white tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-400 focus:outline-none"
                                    />
                                    {c && balPaise > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const maxVal = Math.min(balPaise, c.total_due_paise)
                                          setCut((maxVal / 100).toString())
                                        }}
                                        className="text-[10px] font-bold text-stone-700 hover:bg-stone-100 px-2 py-1 rounded-md border border-stone-300 bg-stone-50 cursor-pointer transition"
                                        title="Deduct maximum possible"
                                      >
                                        Max
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Last Taken & Last Paid Context */}
                                <div className="flex flex-wrap items-center justify-between text-[10px] pt-1 border-t border-stone-100 gap-1 text-stone-500">
                                  <div className="flex items-center gap-1">
                                    <span className="text-stone-400">Last taken:</span>
                                    <span className="font-semibold text-stone-700">
                                      {lastGiven && lastGiven.date
                                        ? `${formatMoney(lastGiven.amount_paise)} (${formatDateShort(lastGiven.date)})`
                                        : openingPaise > 0
                                          ? `${formatMoney(openingPaise)} (Opening)`
                                          : '—'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-stone-400">Last paid:</span>
                                    <span className="font-semibold text-stone-700">
                                      {lastPaid && lastPaid.date
                                        ? `${formatMoney(lastPaid.amount_paise)} (${formatDateShort(lastPaid.date)})`
                                        : '—'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Total Deducted directly under the single row */}
                              <div className="border-t border-stone-200/90 pt-1.5 flex justify-between font-bold text-stone-900">
                                <span className="text-xs font-bold text-stone-800">Total Deducted:</span>
                                <span className="tabular-nums text-xs font-black text-rose-700">
                                  -{formatMoney(cutPaise)}
                                </span>
                              </div>
                            </div>
                          )
                        })()}

                        {upadConfig.isBothOn && (
                          <>
                            <div className="space-y-2">
                              {/* Chalu Upad Card */}
                              <div className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-2xs space-y-1.5">
                                <div className="flex items-center justify-between gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-stone-900">{upadConfig.chaluLabel}</span>
                                    <span className="rounded bg-amber-50 text-amber-900 border border-amber-200/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                                      Bal: {c ? formatMoney(c.chalu_balance_paise) : '₹0'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-stone-400 font-medium">Cut:</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      value={inp.cr}
                                      onChange={(e) => setRowField(emp.id, 'cr', e.target.value)}
                                      className="h-7.5 w-20 px-2 text-right font-bold text-xs rounded-md border border-stone-300 bg-white tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-400 focus:outline-none"
                                    />
                                    {c && c.chalu_balance_paise > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const maxVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                                          setRowField(emp.id, 'cr', (maxVal / 100).toString())
                                        }}
                                        className="text-[10px] font-bold text-stone-700 hover:bg-stone-100 px-2 py-1 rounded-md border border-stone-300 bg-stone-50 cursor-pointer transition"
                                        title="Deduct maximum possible"
                                      >
                                        Max
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Last Taken & Last Paid Context */}
                                <div className="flex flex-wrap items-center justify-between text-[10px] pt-1 border-t border-stone-100 gap-1 text-stone-500">
                                  <div className="flex items-center gap-1">
                                    <span className="text-stone-400">Last taken:</span>
                                    <span className="font-semibold text-stone-700">
                                      {chaluGiven && chaluGiven.date
                                        ? `${formatMoney(chaluGiven.amount_paise)} (${formatDateShort(chaluGiven.date)})`
                                        : (emp.opening_chalu_paise ?? 0) > 0
                                          ? `${formatMoney(emp.opening_chalu_paise ?? 0)} (Opening)`
                                          : '—'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-stone-400">Last paid:</span>
                                    <span className="font-semibold text-stone-700">
                                      {chaluPaid && chaluPaid.date
                                        ? `${formatMoney(chaluPaid.amount_paise)} (${formatDateShort(chaluPaid.date)})`
                                        : '—'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Moto Upad Card */}
                              <div className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-2xs space-y-1.5">
                                <div className="flex items-center justify-between gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-stone-900">{upadConfig.motoLabel}</span>
                                    <span className="rounded bg-purple-50 text-purple-900 border border-purple-200/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                                      Bal: {c ? formatMoney(c.moto_balance_paise) : '₹0'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-stone-400 font-medium">Cut:</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      value={inp.mr}
                                      onChange={(e) => setRowField(emp.id, 'mr', e.target.value)}
                                      className="h-7.5 w-20 px-2 text-right font-bold text-xs rounded-md border border-stone-300 bg-white tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-400 focus:outline-none"
                                    />
                                    {c && c.moto_balance_paise > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const crVal = parseMoneyInput(inp.cr)
                                          const maxVal = Math.min(
                                            c.moto_balance_paise,
                                            Math.max(0, c.total_due_paise - crVal),
                                          )
                                          setRowField(emp.id, 'mr', (maxVal / 100).toString())
                                        }}
                                        className="text-[10px] font-bold text-stone-700 hover:bg-stone-100 px-2 py-1 rounded-md border border-stone-300 bg-stone-50 cursor-pointer transition"
                                        title="Deduct maximum possible"
                                      >
                                        Max
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Last Taken & Last Paid Context */}
                                <div className="flex flex-wrap items-center justify-between text-[10px] pt-1 border-t border-stone-100 gap-1 text-stone-500">
                                  <div className="flex items-center gap-1">
                                    <span className="text-stone-400">Last taken:</span>
                                    <span className="font-semibold text-stone-700">
                                      {motoGiven && motoGiven.date
                                        ? `${formatMoney(motoGiven.amount_paise)} (${formatDateShort(motoGiven.date)})`
                                        : (emp.opening_moto_paise ?? 0) > 0
                                          ? `${formatMoney(emp.opening_moto_paise ?? 0)} (Opening)`
                                          : '—'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-stone-400">Last paid:</span>
                                    <span className="font-semibold text-stone-700">
                                      {motoPaid && motoPaid.date
                                        ? `${formatMoney(motoPaid.amount_paise)} (${formatDateShort(motoPaid.date)})`
                                        : '—'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="border-t border-stone-200/90 pt-1.5 flex justify-between font-bold text-stone-900">
                              <span className="text-xs font-bold text-stone-800">Total Deducted:</span>
                              <span className="tabular-nums text-xs font-black text-rose-700">
                                -{formatMoney(c ? c.chalu_recovery_paise + c.moto_recovery_paise : 0)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Block 3: Cash Handover (Main Hero Focus) */}
                    <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/50 p-3 flex flex-col justify-between space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-emerald-950 border-b border-emerald-200 pb-1.5">
                        <span>3. Cash Handover</span>
                        <span className="font-bold text-emerald-800 text-xs">
                          Net: {c ? formatMoney(c.payable_paise) : '—'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        {/* New Upads */}
                        {upadConfig.isBothOn && (
                          <>
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-bold text-emerald-950">
                                New {upadConfig.chaluLabel}:
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={inp.ngChalu ?? ''}
                                onChange={(e) => setRowField(emp.id, 'ngChalu', e.target.value)}
                                className="h-7.5 w-full px-2 text-right font-bold text-xs rounded-md border border-emerald-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-bold text-purple-950">
                                New {upadConfig.motoLabel}:
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={inp.ngMoto ?? ''}
                                onChange={(e) => setRowField(emp.id, 'ngMoto', e.target.value)}
                                className="h-7.5 w-full px-2 text-right font-bold text-xs rounded-md border border-purple-300 bg-white tabular-nums focus:border-purple-600 focus:outline-none"
                              />
                            </div>
                          </>
                        )}

                        {upadConfig.isOnlyOneOn && (() => {
                          const isChalu = upadConfig.singleBucket!.id === 'chalu'
                          const fieldKey = isChalu ? 'ngChalu' : 'ngMoto'
                          const val = isChalu ? inp.ngChalu : inp.ngMoto

                          return (
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-bold text-emerald-950">
                                {upadConfig.singleBucket!.newLabel}:
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={val ?? ''}
                                onChange={(e) => setRowField(emp.id, fieldKey, e.target.value)}
                                className="h-7.5 w-full px-2 text-right font-bold text-xs rounded-md border border-emerald-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                              />
                            </div>
                          )
                        })()}

                        {/* Adjustment (+/-) */}
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-bold text-stone-700">
                            Adjustment (+/-):
                          </label>
                          <input
                            type="text"
                            placeholder="+Bonus / -Fine"
                            value={inp.adj ?? ''}
                            onChange={(e) => setRowField(emp.id, 'adj', e.target.value)}
                            className="h-7.5 w-full px-2 text-right font-semibold text-xs rounded-md border border-stone-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none placeholder:text-[10px] placeholder:font-normal placeholder:text-stone-400"
                            title="Add bonus (e.g. 500) or deduction (e.g. -200)"
                          />
                        </div>

                        {/* Salary Paid */}
                        <div className={clsx("flex flex-col gap-1", upadConfig.isOnlyOneOn && "col-span-2")}>
                          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-950">
                            <span>Salary Paid:</span>
                            {inp.sp !== '' && (
                              <button
                                type="button"
                                onClick={() => setRowField(emp.id, 'sp', '')}
                                className="text-[10px] font-bold text-emerald-800 hover:underline cursor-pointer"
                                title="Reset to full payable amount"
                              >
                                Full
                              </button>
                            )}
                          </div>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder={c ? paiseToInput(c.payable_paise) : '0'}
                            value={inp.sp}
                            onChange={(e) => setRowField(emp.id, 'sp', e.target.value)}
                            className="h-7.5 w-full px-2 text-right font-bold text-xs rounded-md border border-emerald-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* The Hero Cash in Hand Box */}
                      <div className="rounded-xl bg-emerald-800 text-white p-3 flex items-center justify-between shadow-xs">
                        <div>
                          <div className="text-[10px] uppercase font-extrabold tracking-wider text-emerald-200">
                            CASH TO HAND
                          </div>
                          <div className="text-[10px] text-emerald-100/90 font-medium">
                            {r.salaryPaidPaise > 0 && `${formatMoney(r.salaryPaidPaise)} Sal`}
                            {upadConfig.isBothOn && (
                              <>
                                {parseMoneyInput(inp.ngChalu) > 0 && ` + ${formatMoney(parseMoneyInput(inp.ngChalu))} ${upadConfig.chaluLabel}`}
                                {parseMoneyInput(inp.ngMoto) > 0 && ` + ${formatMoney(parseMoneyInput(inp.ngMoto))} ${upadConfig.motoLabel}`}
                              </>
                            )}
                            {upadConfig.isOnlyOneOn && (() => {
                              const isChalu = upadConfig.singleBucket!.id === 'chalu'
                              const amt = parseMoneyInput(isChalu ? inp.ngChalu : inp.ngMoto)
                              return amt > 0 ? ` + ${formatMoney(amt)} ${upadConfig.singleBucket!.label}` : null
                            })()}
                            {parseMoneyInput(inp.adj) !== 0 && ` (${parseMoneyInput(inp.adj) > 0 ? '+' : ''}${formatMoney(parseMoneyInput(inp.adj))} Adj)`}
                          </div>
                          {c && r.closingCarryPaise > 0 && (
                            <div className="text-[10px] text-amber-200 font-semibold">
                              Carry forward: {formatMoney(r.closingCarryPaise)}
                            </div>
                          )}
                        </div>
                        <div className="text-2xl font-black tabular-nums tracking-tight text-white">
                          {c ? formatMoney(r.cashToHandOverPaise) : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            </div>
          )}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
          <table className="w-full border-collapse text-xs">
            <thead>
              {/* Top Group Headers */}
              <tr className="bg-stone-100 text-stone-600 font-bold text-[10px] uppercase tracking-wider border-b border-stone-200 select-none">
                <th
                  colSpan={2}
                  className="py-1 px-2.5 text-left sticky left-0 bg-stone-100 z-20 border-r border-stone-200"
                >
                  Worker & Prior
                </th>
                <th colSpan={2} className="py-1 px-2 text-center border-r border-stone-200">
                  Current Work
                </th>
                {upadConfig.isBothOn && (
                  <>
                    <th
                      colSpan={2}
                      className="py-1 px-2 text-center bg-amber-50/70 border-r border-amber-200 text-amber-900"
                    >
                      {upadConfig.chaluLabel}
                    </th>
                    <th
                      colSpan={2}
                      className="py-1 px-2 text-center bg-purple-50/70 border-r border-purple-200 text-purple-900"
                    >
                      {upadConfig.motoLabel}
                    </th>
                  </>
                )}
                {upadConfig.isOnlyOneOn && (
                  <th
                    colSpan={2}
                    className="py-1 px-2 text-center bg-amber-50/70 border-r border-amber-200 text-amber-900"
                  >
                    {upadConfig.sectionTitle}
                  </th>
                )}
                <th colSpan={upadConfig.isBothOn ? 8 : upadConfig.isOnlyOneOn ? 7 : 6} className="py-1 px-2.5 text-center bg-emerald-50/50 text-emerald-950">
                  Settlement & Cash Handover
                </th>
              </tr>

              {/* Second Tier Column Headers */}
              <tr className="bg-stone-50 text-stone-700 font-bold text-[11px] border-b border-stone-300 select-none">
                <th className="py-1.5 px-2.5 text-left sticky left-0 bg-stone-50 z-20 border-r border-stone-200 whitespace-nowrap">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => setAllSelection(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-emerald-600"
                    />
                    <span>Worker ({includedRows.length})</span>
                  </label>
                </th>
                <th
                  className="py-1.5 px-2 text-right border-r border-stone-200 whitespace-nowrap text-stone-600"
                  title="Previous unpaid salary brought forward"
                >
                  Carry
                </th>
                <th
                  className="py-1.5 px-2 text-right whitespace-nowrap text-stone-900"
                  title="Earned this cycle (Days + OT)"
                >
                  Earned
                </th>
                <th
                  className="py-1.5 px-2 text-right border-r border-stone-200 whitespace-nowrap text-stone-600"
                  title="Bonus (+) or Fine (-)"
                >
                  Adj
                </th>
                {upadConfig.isBothOn && (
                  <>
                    <th
                      className="py-1.5 px-2 text-right whitespace-nowrap text-stone-500"
                      title={`Current ${upadConfig.chaluLabel} balance`}
                    >
                      {upadConfig.chaluLabel} Bal
                    </th>
                    <th
                      className="py-1.5 px-2 text-center whitespace-nowrap bg-amber-50/70 border-r border-amber-200 text-amber-900"
                      title={`${upadConfig.chaluLabel} recovery to deduct`}
                    >
                      {upadConfig.chaluLabel} Cut ₹
                    </th>
                    <th
                      className="py-1.5 px-2 text-right whitespace-nowrap text-stone-500"
                      title={`Current ${upadConfig.motoLabel} balance`}
                    >
                      {upadConfig.motoLabel} Bal
                    </th>
                    <th
                      className="py-1.5 px-2 text-center whitespace-nowrap bg-purple-50/70 border-r border-purple-200 text-purple-900"
                      title={`${upadConfig.motoLabel} recovery to deduct`}
                    >
                      {upadConfig.motoLabel} Cut ₹
                    </th>
                  </>
                )}
                {upadConfig.isOnlyOneOn && (
                  <>
                    <th
                      className="py-1.5 px-2 text-right whitespace-nowrap text-stone-500"
                      title={`Current ${upadConfig.singleBucket!.label} balance`}
                    >
                      {upadConfig.singleBucket!.label} Bal
                    </th>
                    <th
                      className="py-1.5 px-2 text-center whitespace-nowrap bg-amber-50/70 border-r border-amber-200 text-amber-900"
                      title={`${upadConfig.singleBucket!.label} recovery to deduct`}
                    >
                      {upadConfig.singleBucket!.cutLabel} ₹
                    </th>
                  </>
                )}
                <th
                  className="py-1.5 px-2.5 text-right whitespace-nowrap font-black text-stone-900 bg-stone-100 border-r border-stone-200"
                  title="Net salary due after deducting upad"
                >
                  Payable
                </th>
                {upadConfig.isBothOn && (
                  <>
                    <th
                      className="py-1.5 px-2 text-center whitespace-nowrap"
                      title={`Give new ${upadConfig.chaluLabel} cash today`}
                    >
                      New {upadConfig.chaluLabel} ₹
                    </th>
                    <th
                      className="py-1.5 px-2 text-center whitespace-nowrap"
                      title={`Give new ${upadConfig.motoLabel} cash today`}
                    >
                      New {upadConfig.motoLabel} ₹
                    </th>
                  </>
                )}
                {upadConfig.isOnlyOneOn && (
                  <th
                    className="py-1.5 px-2 text-center whitespace-nowrap"
                    title={`Give new ${upadConfig.singleBucket!.label} cash today`}
                  >
                    New {upadConfig.singleBucket!.label} ₹
                  </th>
                )}
                <th
                  className="py-1.5 px-2 text-center whitespace-nowrap"
                  title="Adjustment: +Bonus or -Fine"
                >
                  Adj (+/-) ₹
                </th>
                <th
                  className="py-1.5 px-2 text-center whitespace-nowrap bg-sky-50/70 border-x border-sky-200 text-sky-900"
                  title="Salary actually paid out (blank = 100% full)"
                >
                  Salary Paid ₹
                </th>
                <th
                  className="py-1.5 px-2.5 text-right whitespace-nowrap font-black text-emerald-900 bg-emerald-100/70 border-r border-emerald-200"
                  title="Physical cash to hand over: Salary Paid + New Upads"
                >
                  Cash to Hand
                </th>
                <th
                  className="py-1.5 px-2 text-right whitespace-nowrap text-stone-600 border-r border-stone-200"
                  title="Unpaid salary carried to next week"
                >
                  Carry Out
                </th>
                <th className="py-1.5 px-2.5 text-left whitespace-nowrap">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-100 font-medium">
              {includedRows.length === 0 ? (
                <tr>
                  <td colSpan={upadConfig.isBothOn ? 16 : upadConfig.isOnlyOneOn ? 14 : 11} className="py-8 text-center text-stone-400 text-xs font-semibold">
                    No active workers found for this payout cutoff ({formatDateShort(cutoff)})
                  </td>
                </tr>
              ) : (
                includedRows.map((r) => {
                const emp = r.context.employee
                const c = r.computation
                const isTicked = !!selected[emp.id]
                const inp = getRowInput(inputs, emp.id)
                const isInactive = !emp.active

                const handleQuickSettle = () => {
                  if (!c) return
                  const crVal = upadConfig.isChaluOn ? Math.min(c.chalu_balance_paise, c.total_due_paise) : 0
                  const mrVal = upadConfig.isMotoOn ? Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - crVal)) : 0
                  const netAfter = Math.max(0, c.total_due_paise - crVal - mrVal)
                  setInputs((prev) => ({
                    ...prev,
                    [emp.id]: {
                      ...inp,
                      cr: crVal > 0 ? (crVal / 100).toString() : '',
                      mr: mrVal > 0 ? (mrVal / 100).toString() : '',
                      sp: (netAfter / 100).toString(),
                      ngChalu: '',
                      ngMoto: '',
                      adj: '',
                    },
                  }))
                }

                return (
                  <tr
                    key={emp.id}
                    className={`hover:bg-stone-50/80 transition-colors ${
                      !isTicked ? 'opacity-40 bg-stone-50/30' : ''
                    }`}
                  >
                    {/* 1. Worker (Sticky Left) */}
                    <td className="py-1 px-2.5 whitespace-nowrap sticky left-0 bg-white z-10 border-r border-stone-100">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isTicked}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [emp.id]: e.target.checked }))
                          }
                          className="h-3.5 w-3.5 rounded accent-emerald-600 cursor-pointer"
                        />
                        <button
                          type="button"
                          onClick={() => setInspectingWorkerId(emp.id)}
                          className="flex flex-wrap items-center gap-1 text-left group hover:text-emerald-700 cursor-pointer"
                          title="Click to view full attendance & upad ledger breakdown"
                        >
                          <span className="font-black text-stone-900 group-hover:text-emerald-700 truncate max-w-[130px]">
                            {emp.name}
                          </span>
                          <span className="text-[10px] text-stone-400">#{emp.employee_no}</span>
                          {isInactive && (
                            <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1 rounded">
                              Inactive
                            </span>
                          )}
                          {c && c.day_breakdown.length > 0 && (() => {
                            const fullCount = c.day_breakdown.filter((d) => d.status === 'full').length
                            const halfCount = c.day_breakdown.filter((d) => d.status === 'half').length
                            const cycleDays = c.day_breakdown.length
                            const daysWorked = c ? c.day_breakdown.reduce((sum, b) => sum + (b.days_worked !== undefined ? b.days_worked : b.status === 'full' ? 1 : b.status === 'half' ? 0.5 : 0), 0) : (fullCount + halfCount * 0.5)
                            const otMins = c.day_breakdown.reduce((sum, d) => sum + d.ot_minutes, 0)
                            return (
                              <span className="text-[9px] font-bold text-stone-600 bg-stone-100 px-1 rounded">
                                {daysWorked}/{cycleDays}d{otMins > 0 ? ` +${formatHours(otMins)}` : ''}
                              </span>
                            )
                          })()}
                          <Info className="h-3 w-3 text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      </div>
                    </td>

                    {/* 2. Carry In */}
                    <td className="py-1 px-2 text-right tabular-nums text-stone-700 border-r border-stone-100">
                      {c ? formatMoney(c.carry_paise) : '—'}
                    </td>

                    {/* 3. Earned (Days + OT) */}
                    <td
                      className="py-1 px-2 text-right tabular-nums font-bold text-stone-900 cursor-pointer hover:bg-stone-100/50"
                      onClick={() => setInspectingWorkerId(emp.id)}
                      title={
                        c
                          ? `${c.day_breakdown.length} days recorded. Click to inspect days & OT.`
                          : ''
                      }
                    >
                      <span>{c ? formatMoney(c.earned_paise) : '—'}</span>
                      {c && c.ot_paise > 0 && (
                        <span
                          className="ml-1 text-[10px] text-teal-700 font-semibold"
                          title={`${formatMoney(c.ot_paise)} OT`}
                        >
                          *
                        </span>
                      )}
                    </td>

                    {/* 4. Adj (Bonus/Fine) */}
                    <td className="py-1 px-2 text-right tabular-nums text-stone-700 border-r border-stone-100">
                      {c && c.adjustments_paise !== 0 ? (
                        <span
                          className={
                            c.adjustments_paise > 0
                              ? 'text-emerald-700 font-bold'
                              : 'text-rose-700 font-bold'
                          }
                        >
                          {c.adjustments_paise > 0 ? '+' : ''}
                          {formatMoney(c.adjustments_paise)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>

                    {/* Upad Bal & Cut */}
                    {upadConfig.isBothOn && (
                      <>
                        {/* Chalu Bal */}
                        <td
                          className="py-1 px-2 text-right tabular-nums text-stone-500 cursor-pointer hover:text-amber-800"
                          title={`Click balance to fill ${upadConfig.chaluLabel} Cut`}
                          onClick={() => {
                            if (!c || c.chalu_balance_paise === 0) return
                            const maxVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                            setRowField(emp.id, 'cr', (maxVal / 100).toString())
                          }}
                        >
                          {c && c.chalu_balance_paise > 0 ? formatMoney(c.chalu_balance_paise) : '0'}
                        </td>

                        {/* Chalu Cut ₹ */}
                        <td className="py-0.5 px-1 text-center bg-amber-50/40 border-r border-amber-200/50">
                          <div className="flex items-center justify-center gap-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={inp.cr}
                              onChange={(e) => setRowField(emp.id, 'cr', e.target.value)}
                              className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-amber-600 focus:outline-none"
                            />
                            {c && c.chalu_balance_paise > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const maxVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                                  setRowField(emp.id, 'cr', (maxVal / 100).toString())
                                }}
                                className="text-[9px] font-bold text-amber-800 hover:bg-amber-100 px-1 py-0.5 rounded cursor-pointer"
                                title="Fill maximum recoverable"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Moto Bal */}
                        <td
                          className="py-1 px-2 text-right tabular-nums text-stone-500 cursor-pointer hover:text-purple-800"
                          title={`Click balance to fill ${upadConfig.motoLabel} Cut`}
                          onClick={() => {
                            if (!c || c.moto_balance_paise === 0) return
                            const crVal = parseMoneyInput(inp.cr)
                            const maxVal = Math.min(
                              c.moto_balance_paise,
                              Math.max(0, c.total_due_paise - crVal),
                            )
                            setRowField(emp.id, 'mr', (maxVal / 100).toString())
                          }}
                        >
                          {c && c.moto_balance_paise > 0 ? formatMoney(c.moto_balance_paise) : '0'}
                        </td>

                        {/* Moto Cut ₹ */}
                        <td className="py-0.5 px-1 text-center bg-purple-50/40 border-r border-purple-200/50">
                          <div className="flex items-center justify-center gap-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={inp.mr}
                              onChange={(e) => setRowField(emp.id, 'mr', e.target.value)}
                              className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-purple-600 focus:outline-none"
                            />
                            {c && c.moto_balance_paise > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const crVal = parseMoneyInput(inp.cr)
                                  const maxVal = Math.min(
                                    c.moto_balance_paise,
                                    Math.max(0, c.total_due_paise - crVal),
                                  )
                                  setRowField(emp.id, 'mr', (maxVal / 100).toString())
                                }}
                                className="text-[9px] font-bold text-purple-800 hover:bg-purple-100 px-1 py-0.5 rounded cursor-pointer"
                                title="Fill maximum recoverable"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}

                    {upadConfig.isOnlyOneOn && (() => {
                      const isChalu = upadConfig.singleBucket!.id === 'chalu'
                      const balPaise = c ? (isChalu ? c.chalu_balance_paise : c.moto_balance_paise) : 0
                      const cutVal = isChalu ? inp.cr : inp.mr
                      const fieldKey = isChalu ? 'cr' : 'mr'

                      return (
                        <>
                          <td
                            className="py-1 px-2 text-right tabular-nums text-stone-500 cursor-pointer hover:text-amber-800"
                            title={`Click balance to fill ${upadConfig.singleBucket!.label} Cut`}
                            onClick={() => {
                              if (!c || balPaise === 0) return
                              const maxVal = Math.min(balPaise, c.total_due_paise)
                              setRowField(emp.id, fieldKey, (maxVal / 100).toString())
                            }}
                          >
                            {balPaise > 0 ? formatMoney(balPaise) : '0'}
                          </td>
                          <td className="py-0.5 px-1 text-center bg-amber-50/40 border-r border-amber-200/50">
                            <div className="flex items-center justify-center gap-0.5">
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={cutVal}
                                onChange={(e) => setRowField(emp.id, fieldKey, e.target.value)}
                                className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-amber-600 focus:outline-none"
                              />
                              {c && balPaise > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const maxVal = Math.min(balPaise, c.total_due_paise)
                                    setRowField(emp.id, fieldKey, (maxVal / 100).toString())
                                  }}
                                  className="text-[9px] font-bold text-amber-800 hover:bg-amber-100 px-1 py-0.5 rounded cursor-pointer"
                                  title="Fill maximum recoverable"
                                >
                                  Max
                                </button>
                              )}
                            </div>
                          </td>
                        </>
                      )
                    })()}

                    {/* 9. Net Payable */}
                    <td className="py-1 px-2.5 text-right tabular-nums font-black text-xs text-stone-900 bg-stone-100 border-r border-stone-200">
                      {c ? formatMoney(c.payable_paise) : '—'}
                    </td>

                    {/* New Upads */}
                    {upadConfig.isBothOn && (
                      <>
                        <td className="py-0.5 px-1 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={inp.ngChalu ?? ''}
                            onChange={(e) => setRowField(emp.id, 'ngChalu', e.target.value)}
                            className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-emerald-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                          />
                        </td>
                        <td className="py-0.5 px-1 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={inp.ngMoto ?? ''}
                            onChange={(e) => setRowField(emp.id, 'ngMoto', e.target.value)}
                            className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-purple-300 bg-white tabular-nums focus:border-purple-600 focus:outline-none"
                          />
                        </td>
                      </>
                    )}

                    {upadConfig.isOnlyOneOn && (() => {
                      const isChalu = upadConfig.singleBucket!.id === 'chalu'
                      const fieldKey = isChalu ? 'ngChalu' : 'ngMoto'
                      const val = isChalu ? inp.ngChalu : inp.ngMoto

                      return (
                        <td className="py-0.5 px-1 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={val ?? ''}
                            onChange={(e) => setRowField(emp.id, fieldKey, e.target.value)}
                            className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-emerald-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                          />
                        </td>
                      )
                    })()}

                    {/* 12. Adjustment (+/-) ₹ */}
                    <td className="py-0.5 px-1 text-center">
                      <input
                        type="text"
                        placeholder="0"
                        value={inp.adj ?? ''}
                        onChange={(e) => setRowField(emp.id, 'adj', e.target.value)}
                        className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                        title="Enter positive for bonus, negative for deduction"
                      />
                    </td>

                    {/* 11. Salary Paid ₹ */}
                    <td className="py-0.5 px-1 text-center bg-sky-50/40 border-x border-sky-200/50">
                      <div className="flex items-center justify-center gap-0.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={c ? paiseToInput(c.payable_paise) : '0'}
                          value={inp.sp}
                          onChange={(e) => setRowField(emp.id, 'sp', e.target.value)}
                          className="h-6.5 w-18 px-1 text-right font-bold text-xs rounded border border-sky-300 bg-white tabular-nums focus:border-sky-500 focus:outline-none"
                          title="Leave blank to pay full payable amount"
                        />
                        {inp.sp !== '' && (
                          <button
                            type="button"
                            onClick={() => setRowField(emp.id, 'sp', '')}
                            className="text-[9px] font-bold text-sky-800 hover:bg-sky-100 px-1 py-0.5 rounded"
                            title="Reset to 100% full payout"
                          >
                            Full
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 12. Cash to Hand Over (High Impact) */}
                    <td className="py-1 px-2.5 text-right tabular-nums font-black text-sm text-emerald-900 bg-emerald-100/70 border-r border-emerald-200">
                      {c ? formatMoney(r.cashToHandOverPaise) : '—'}
                    </td>

                    {/* 13. Closing Carry */}
                    <td className="py-1 px-2 text-right tabular-nums text-stone-600 border-r border-stone-100">
                      {c && r.closingCarryPaise > 0 ? (
                        <span
                          className="font-bold text-amber-800"
                          title="Unpaid salary carried to next week"
                        >
                          {formatMoney(r.closingCarryPaise)}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>

                    {/* 14. Status / Detail */}
                    <td className="py-1 px-2 text-left whitespace-nowrap text-xs">
                      {r.errors.length > 0 ? (
                        <span className="text-rose-700 font-bold bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 text-[10px]">
                          {r.errors.map((err) => formatEngineError(err)).join('; ')}
                        </span>
                      ) : isInactive && c && ((upadConfig.isChaluOn && c.chalu_balance_paise > 0) || (upadConfig.isMotoOn && c.moto_balance_paise > 0)) ? (
                        <button
                          type="button"
                          onClick={handleQuickSettle}
                          className="rounded bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-900 border border-amber-300 transition cursor-pointer"
                          title="Offset balance against carry and pay net"
                        >
                          Settle Inactive
                        </button>
                      ) : r.unmarkedDates.length > 0 ? (
                        <span
                          className="text-amber-800 font-semibold bg-amber-50 px-1.5 py-0.5 rounded text-[10px]"
                          title="Unmarked dates"
                        >
                          {r.unmarkedDates.length}d unmarked
                        </span>
                      ) : (
                        <span className="text-emerald-700 text-[11px] font-bold">✓ Ready</span>
                      )}
                    </td>
                  </tr>
                )
              }))}
            </tbody>

            {/* Sticky Dense Totals Footer */}
            <tfoot>
              <tr className="bg-stone-100 font-black text-stone-900 border-t-2 border-stone-300 tabular-nums text-xs">
                <td className="py-1.5 px-2.5 text-left sticky left-0 bg-stone-100 z-10 border-r border-stone-200 whitespace-nowrap">
                  Total ({cleanSelectedRows.length} ticked)
                </td>
                <td className="py-1.5 px-2 text-right border-r border-stone-200">
                  {formatMoney(totals.carry)}
                </td>
                <td className="py-1.5 px-2 text-right">{formatMoney(totals.earned)}</td>
                <td className="py-1.5 px-2 text-right border-r border-stone-200">
                  {totals.adj !== 0
                    ? totals.adj > 0
                      ? `+${formatMoney(totals.adj)}`
                      : formatMoney(totals.adj)
                    : '—'}
                </td>
                {upadConfig.isBothOn && (
                  <>
                    <td className="py-1.5 px-2 text-right text-stone-500">
                      {formatMoney(totals.chaluBal)}
                    </td>
                    <td className="py-1.5 px-2 text-center bg-amber-100/60 border-r border-amber-200 text-amber-950 font-bold">
                      -{formatMoney(totals.chaluRec)}
                    </td>
                    <td className="py-1.5 px-2 text-right text-stone-500">
                      {formatMoney(totals.motoBal)}
                    </td>
                    <td className="py-1.5 px-2 text-center bg-purple-100/60 border-r border-purple-200 text-purple-950 font-bold">
                      -{formatMoney(totals.motoRec)}
                    </td>
                  </>
                )}
                {upadConfig.isOnlyOneOn && (() => {
                  const isChalu = upadConfig.singleBucket!.id === 'chalu'
                  const bal = isChalu ? totals.chaluBal : totals.motoBal
                  const rec = isChalu ? totals.chaluRec : totals.motoRec
                  return (
                    <>
                      <td className="py-1.5 px-2 text-right text-stone-500">
                        {formatMoney(bal)}
                      </td>
                      <td className="py-1.5 px-2 text-center bg-amber-100/60 border-r border-amber-200 text-amber-950 font-bold">
                        -{formatMoney(rec)}
                      </td>
                    </>
                  )
                })()}
                <td className="py-1.5 px-2.5 text-right font-black text-stone-950 bg-stone-200/70 border-r border-stone-200">
                  {formatMoney(totals.payable)}
                </td>
                {upadConfig.isBothOn && (
                  <>
                    <td className="py-1.5 px-2 text-center text-emerald-800">
                      {totals.newChalu > 0 ? `+${formatMoney(totals.newChalu)}` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-center text-purple-800">
                      {totals.newMoto > 0 ? `+${formatMoney(totals.newMoto)}` : '—'}
                    </td>
                  </>
                )}
                {upadConfig.isOnlyOneOn && (() => {
                  const isChalu = upadConfig.singleBucket!.id === 'chalu'
                  const newAmt = isChalu ? totals.newChalu : totals.newMoto
                  return (
                    <td className="py-1.5 px-2 text-center text-emerald-800">
                      {newAmt > 0 ? `+${formatMoney(newAmt)}` : '—'}
                    </td>
                  )
                })()}
                <td className="py-1.5 px-2 text-center text-stone-800">
                  {totals.payoutAdj !== 0
                    ? totals.payoutAdj > 0
                      ? `+${formatMoney(totals.payoutAdj)}`
                      : formatMoney(totals.payoutAdj)
                    : '—'}
                </td>
                <td className="py-1.5 px-2 text-center bg-sky-100/60 border-x border-sky-200 text-sky-950 font-bold">
                  {formatMoney(totals.salaryPaid)}
                </td>
                <td className="py-1.5 px-2.5 text-right font-black text-sm text-emerald-950 bg-emerald-100 border-r border-emerald-200">
                  {formatMoney(totals.cashToHand)}
                </td>
                <td className="py-1.5 px-2 text-right text-stone-700 border-r border-stone-200">
                  {formatMoney(totals.closingCarry)}
                </td>
                <td className="py-1.5 px-2 text-left">
                  {hasAnyErrors ? (
                    <span className="text-rose-700 font-bold text-xs">Errors present</span>
                  ) : (
                    <span className="text-emerald-800 font-bold text-xs">All Clear</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 3. Slide-Over Worker Inspector Drawer */}
      {inspectingRow && inspectingRow.computation && (
        <WorkerInspectorDrawer
          row={inspectingRow}
          upadConfig={upadConfig}
          onClose={() => setInspectingWorkerId(null)}
        />
      )}

      {/* 4. Confirmation Modal */}
      {confirmOpen && (
        <ConfirmModal
          payoutDate={payoutDate}
          cutoff={cutoff}
          workersCount={cleanSelectedRows.length}
          payable={totals.payable}
          cashToHand={totals.cashToHand}
          denoms={denoms}
          loading={saveMutation.isPending}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => saveMutation.mutate()}
        />
      )}
    </div>
  )
}

function WorkerInspectorDrawer({
  row,
  upadConfig,
  onClose,
}: {
  row: {
    context: WorkerContext
    computation: any
    errors: EngineError[]
    warnings: EngineWarning[]
    unmarkedDates: string[]
  }
  upadConfig: ReturnType<typeof useUpadBuckets>
  onClose: () => void
}) {
  const emp = row.context.employee
  const c = row.computation

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-2xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white h-full shadow-2xl p-5 overflow-y-auto flex flex-col justify-between"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <div>
              <div className="text-lg font-black text-stone-900">{emp.name}</div>
              <div className="text-xs text-stone-500 font-medium">
                Worker #{emp.employee_no} · Rate: {formatMoney(row.context.rates[0]?.daily_rate_paise ?? 0)}/day
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Daily Attendance Grid */}
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-stone-600 mb-2">
              Attendance Records ({formatDateShort(c.from_date)} → {formatDateShort(c.cutoff)})
            </div>
            <div className="space-y-1.5">
              {c.day_breakdown.map((d: any) => (
                <div
                  key={d.date}
                  className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs tabular-nums"
                >
                  <div>
                    <strong className="text-stone-900">{formatDateLong(d.date)}</strong>
                    <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-bold text-stone-700 border border-stone-200">
                      {d.status === 'hours'
                        ? `${d.worked_minutes ? (d.worked_minutes % 60 === 0 ? d.worked_minutes / 60 : (d.worked_minutes / 60).toFixed(1)) : 0}h`
                        : (STATUS_LETTER[d.status] ?? d.status)}
                    </span>
                    {d.is_late_entry && (
                      <span className="ml-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-1 rounded">
                        Late
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-stone-800">{formatMoney(d.base_paise)}</span>
                    {d.ot_paise > 0 && (
                      <span className="ml-1 font-bold text-emerald-700">+{formatMoney(d.ot_paise)} OT</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Balances Summary */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 space-y-2 text-xs">
            <div className="font-bold text-stone-900 uppercase text-[10px] tracking-wider">
              {upadConfig.hasAny ? 'Upad Balances' : 'Cycle Balances'}
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Opening Carry:</span>
              <span className="font-bold tabular-nums text-stone-900">{formatMoney(c.carry_paise)}</span>
            </div>
            {upadConfig.isChaluOn && (
              <div className="flex justify-between">
                <span className="text-stone-600">{upadConfig.chaluLabel} Balance:</span>
                <span className="font-bold tabular-nums text-stone-900">{formatMoney(c.chalu_balance_paise)}</span>
              </div>
            )}
            {upadConfig.isMotoOn && (
              <div className="flex justify-between">
                <span className="text-stone-600">{upadConfig.motoLabel} Balance:</span>
                <span className="font-bold tabular-nums text-stone-900">{formatMoney(c.moto_balance_paise)}</span>
              </div>
            )}
            <div className="border-t border-stone-200 pt-1.5 flex justify-between font-bold">
              <span className="text-stone-800">Gross Available:</span>
              <span className="font-black tabular-nums text-emerald-800">{formatMoney(c.total_due_paise)}</span>
            </div>
          </div>

          {/* Warnings */}
          {row.unmarkedDates.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 font-medium">
              ⚠️ {row.unmarkedDates.length} days unmarked in this cycle: {row.unmarkedDates.map((d) => formatDateShort(d)).join(', ')}.
            </div>
          )}
        </div>

        <Button variant="secondary" onClick={onClose} className="w-full mt-4">
          Close Inspector
        </Button>
      </div>
    </div>
  )
}

function ConfirmModal({
  payoutDate,
  cutoff,
  workersCount,
  payable,
  cashToHand,
  denoms,
  loading,
  onClose,
  onConfirm,
}: {
  payoutDate: string
  cutoff: string
  workersCount: number
  payable: number
  cashToHand: number
  denoms: ReturnType<typeof calculateDenominations>
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-black text-stone-900">Confirm Payout</h3>
        <p className="mt-1 text-xs text-stone-600">
          Closing payout date <strong>{formatDateLong(payoutDate)}</strong> (cutoff {formatDateShort(cutoff)}).
        </p>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-stone-500">Ticked Workers:</span>
            <span className="font-bold text-stone-900">{workersCount} workers</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Net Payable:</span>
            <span className="font-bold text-stone-900">{formatMoney(payable)}</span>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-sm">
            <span className="font-bold text-stone-800">Total Cash to Hand Over:</span>
            <span className="font-black text-emerald-800 text-base">{formatMoney(cashToHand)}</span>
          </div>
        </div>

        {/* Note Breakdown */}
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs">
          <div className="font-bold text-emerald-950 uppercase text-[10px]">
            Withdrawal Notes Checklist
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {denoms.notes
              .filter((n) => n.count > 0)
              .map((n) => (
                <span
                  key={n.note}
                  className="rounded bg-white px-2 py-0.5 font-mono font-bold text-emerald-950 border border-emerald-200"
                >
                  {n.count} × ₹{n.note}
                </span>
              ))}
            {denoms.coins > 0 && (
              <span
                key="loose"
                className="rounded bg-amber-50 px-2 py-0.5 font-mono font-bold text-amber-900 border border-amber-200"
              >
                ₹{denoms.coins} coins/change
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading}
            disabled={workersCount === 0}
            onClick={onConfirm}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
          >
            Confirm & Issue ({workersCount})
          </Button>
        </div>
      </Card>
    </div>
  )
}
