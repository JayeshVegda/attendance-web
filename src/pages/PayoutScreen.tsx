import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EMPTY_INPUTS,
  formatEngineError,
  loadWorkerContexts,
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
import { listRuns } from '../lib/api'
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

const STATUS_LETTER: Record<string, string> = { full: 'P', half: 'H', absent: 'A' }

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

  const cutoff = includePayoutDay ? payoutDate : addDays(payoutDate, -1)

  const contextsQuery = useQuery({ queryKey: ['payout-contexts'], queryFn: loadWorkerContexts })
  const attendanceQuery = useQuery({
    queryKey: ['payout-attendance'],
    queryFn: () => pb.collection('attendance').getFullList<Attendance>({ sort: 'date' }),
  })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })

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
      const inp = inputs[ctx.employee.id] || { cr: '', mr: '', ngChalu: '', ngMoto: '', adj: '', sp: '' }
      const crPaise = parseMoneyInput(inp.cr)
      const mrPaise = parseMoneyInput(inp.mr)
      const ngChaluPaise = parseMoneyInput(inp.ngChalu || (inp.nb === 'chalu' ? (inp.ng ?? '') : ''))
      const ngMotoPaise = parseMoneyInput(inp.ngMoto || (inp.nb === 'moto' ? (inp.ng ?? '') : ''))
      const adjPaise = parseMoneyInput(inp.adj)
      const totalNewUpadPaise = ngChaluPaise + ngMotoPaise

      const hasActivity =
        ctx.attendance.some((a) => !a.settled && a.date <= cutoff) ||
        ctx.adjustments.some((a) => !a.settled && a.date <= cutoff)
      const carryDiffers = ctx.worker.opening_carry_paise !== 0
      const chaluBal = upadBalance(ctx.upads, 'chalu', ctx.worker.opening_chalu_paise, cutoff)
      const motoBal = upadBalance(ctx.upads, 'moto', ctx.worker.opening_moto_paise, cutoff)
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
  const latestRun = runsQuery.data?.find((r) => r.status === 'closed' && !r.voided)
  const daysSinceLastPayout = latestRun
    ? Math.max(0, daysBetweenInclusive(latestRun.payout_date, todayKey()) - 1)
    : null

  const setRowField = (empId: string, field: keyof RowInputState, val: string) => {
    setInputs((prev) => {
      const cur = prev[empId] || { cr: '', mr: '', ngChalu: '', ngMoto: '', adj: '', sp: '' }
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
        rows: cleanSelectedRows.map((r) => {
          const inp = inputs[r.context.employee.id] || { cr: '', mr: '', ngChalu: '', ngMoto: '', adj: '', sp: '' }
          const ngChaluPaise = parseMoneyInput(inp.ngChalu || (inp.nb === 'chalu' ? (inp.ng ?? '') : ''))
          const ngMotoPaise = parseMoneyInput(inp.ngMoto || (inp.nb === 'moto' ? (inp.ng ?? '') : ''))
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

  if (contextsQuery.isLoading || attendanceQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-stone-500 font-semibold">
        <Spinner className="h-6 w-6" />
        <span>Loading payroll records…</span>
      </div>
    )
  }

  const allSelected = includedRows.length > 0 && includedRows.every((r) => selected[r.context.employee.id])
  const inspectingRow = preview.find((r) => r.context.employee.id === inspectingWorkerId)

  return (
    <div className="w-full space-y-2 pb-12 select-text">
      {/* 1. Fast Control & Summary Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-2xs">
        {/* Left: Date & Cutoff controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-black text-stone-900 text-sm">Issue Payout (પગાર)</span>
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
              Cash to Hand Over (રોકડ):
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
            onClick={() => setConfirmOpen(true)}
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

      {/* Payout Reminder if overdue */}
      {daysSinceLastPayout !== null && daysSinceLastPayout >= 4 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">
          <TriangleAlert className="h-3.5 w-3.5 text-amber-700 shrink-0" />
          <span>
            Last payout was <strong>{daysSinceLastPayout} days ago</strong> on {formatDateLong(latestRun!.payout_date)}.
          </span>
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
          <div className="space-y-2.5">
            {includedRows.map((r) => {
              const emp = r.context.employee
              const c = r.computation
              const isTicked = !!selected[emp.id]
              const inp = inputs[emp.id] || { cr: '', mr: '', ng: '', nb: 'chalu', sp: '' }
              const isInactive = !emp.active

              const handleQuickSettle = () => {
                if (!c) return
                const crVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                const mrVal = Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - crVal))
                const netAfter = Math.max(0, c.total_due_paise - crVal - mrVal)
                setInputs((prev) => ({
                  ...prev,
                  [emp.id]: {
                    ...inp,
                    cr: crVal > 0 ? (crVal / 100).toString() : '',
                    mr: mrVal > 0 ? (mrVal / 100).toString() : '',
                    sp: (netAfter / 100).toString(),
                    ng: '',
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
                        {c && c.day_breakdown.length > 0 && (() => {
                          const fullCount = c.day_breakdown.filter((d) => d.status === 'full').length
                          const halfCount = c.day_breakdown.filter((d) => d.status === 'half').length
                          const absentCount = c.day_breakdown.filter((d) => d.status === 'absent').length
                          const cycleDays = c.day_breakdown.length
                          const daysWorked = fullCount + halfCount * 0.5
                          const otMins = c.day_breakdown.reduce((sum, d) => sum + d.ot_minutes, 0)
                          return (
                            <span
                              className="inline-flex items-center gap-1 rounded-md bg-stone-100 border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-bold text-stone-700 tracking-tight"
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
                          )
                        })()}
                      </button>

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

                      {isInactive && c && (c.chalu_balance_paise > 0 || c.moto_balance_paise > 0) && (
                        <button
                          type="button"
                          onClick={handleQuickSettle}
                          className="rounded-lg bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 text-xs font-bold text-amber-900"
                          title="Offset loan balance against carry and settle"
                        >
                          Settle Inactive
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card Body: 3 Categorized Blocks */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 text-xs">
                    {/* Block 1: Work & Owed (Earnings) */}
                    <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-2.5 flex flex-col justify-between space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-stone-500 border-b border-stone-200/60 pb-1">
                        <span>1. Earnings & Carry (કમાણી)</span>
                        <span>{c ? `${c.day_breakdown.length} days` : '0d'}</span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-stone-500">Days Earned:</span>
                          <span className="font-bold tabular-nums text-stone-900">
                            {c ? formatMoney(c.earned_paise - c.ot_paise) : '—'}
                          </span>
                        </div>
                        {c && c.ot_paise > 0 && (
                          <div className="flex justify-between text-teal-800 font-semibold">
                            <span>Overtime Pay:</span>
                            <span className="tabular-nums">+{formatMoney(c.ot_paise)}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-stone-500">Prior Carry (બાકી):</span>
                          <span className="font-semibold tabular-nums text-stone-700">
                            {c ? formatMoney(c.carry_paise) : '—'}
                          </span>
                        </div>
                        {c && c.adjustments_paise !== 0 && (
                          <div className="flex justify-between">
                            <span className="text-stone-500">Bonus / Jama (જમા):</span>
                            <span
                              className={`font-bold tabular-nums ${
                                c.adjustments_paise > 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {c.adjustments_paise > 0 ? '+' : ''}
                              {formatMoney(c.adjustments_paise)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-stone-200 pt-1 flex justify-between font-extrabold text-stone-900">
                        <span>Gross Due (કુલ લેણાં):</span>
                        <span className="tabular-nums text-sm">
                          {c ? formatMoney(c.total_due_paise) : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Block 2: Loan Deductions (Upad) */}
                    <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-2.5 flex flex-col justify-between space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-amber-900 border-b border-amber-200/60 pb-1">
                        <span>2. Loan Deductions (ઉપાડ કપાત)</span>
                        <span
                          className="font-bold text-amber-950 tabular-nums normal-case text-[11px]"
                          title={`Chalu: ${formatMoney(c ? c.chalu_after_paise : 0)} + Main: ${formatMoney(c ? c.moto_after_paise : 0)}`}
                        >
                          Remaining: <strong>{formatMoney(c ? c.chalu_after_paise + c.moto_after_paise : 0)}</strong>
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {/* Chalu Cut */}
                        <div className="flex items-center justify-between gap-1">
                          <div>
                            <div className="text-[11px] font-bold text-amber-950">Chalu Loan:</div>
                            <div className="text-[10px] text-stone-500 tabular-nums">
                              Bal: {c ? formatMoney(c.chalu_balance_paise) : '0'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={inp.cr}
                              onChange={(e) => setRowField(emp.id, 'cr', e.target.value)}
                              className="h-7 w-20 px-1.5 text-right font-black text-xs rounded border border-amber-300 bg-white tabular-nums focus:border-amber-600 focus:outline-none"
                            />
                            {c && c.chalu_balance_paise > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const maxVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                                  setRowField(emp.id, 'cr', (maxVal / 100).toString())
                                }}
                                className="text-[10px] font-bold text-amber-800 hover:bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 bg-white"
                                title="Deduct maximum possible"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Moto Cut */}
                        <div className="flex items-center justify-between gap-1">
                          <div>
                            <div className="text-[11px] font-bold text-amber-950">Main Loan:</div>
                            <div className="text-[10px] text-stone-500 tabular-nums">
                              Bal: {c ? formatMoney(c.moto_balance_paise) : '0'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={inp.mr}
                              onChange={(e) => setRowField(emp.id, 'mr', e.target.value)}
                              className="h-7 w-20 px-1.5 text-right font-black text-xs rounded border border-amber-300 bg-white tabular-nums focus:border-amber-600 focus:outline-none"
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
                                className="text-[10px] font-bold text-amber-800 hover:bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 bg-white"
                                title="Deduct maximum possible"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-amber-200 pt-1 flex justify-between font-extrabold text-amber-900">
                        <span>Total Deducted:</span>
                        <span className="tabular-nums">
                          -{formatMoney(c ? c.chalu_recovery_paise + c.moto_recovery_paise : 0)}
                        </span>
                      </div>
                    </div>

                    {/* Block 3: Cash Handover (Main Hero Focus) */}
                    <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50/80 p-2.5 flex flex-col justify-between space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-emerald-950 border-b border-emerald-200 pb-1">
                        <span>3. Cash Handover (રોકડ ચૂકવણી)</span>
                        <span className="font-bold text-emerald-800">
                          Net: {c ? formatMoney(c.payable_paise) : '—'}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {/* New Chalu Upad */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-emerald-950">
                            New Chalu Upad:
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={inp.ngChalu ?? ''}
                            onChange={(e) => setRowField(emp.id, 'ngChalu', e.target.value)}
                            className="h-7 w-24 px-1.5 text-right font-black text-xs rounded border border-emerald-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                          />
                        </div>

                        {/* New Main Upad */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-emerald-950">
                            New Main Upad:
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={inp.ngMoto ?? ''}
                            onChange={(e) => setRowField(emp.id, 'ngMoto', e.target.value)}
                            className="h-7 w-24 px-1.5 text-right font-black text-xs rounded border border-purple-300 bg-white tabular-nums focus:border-purple-600 focus:outline-none"
                          />
                        </div>

                        {/* Adjustment (+/-) */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-emerald-950">
                            Adjustment (+/-):
                          </span>
                          <input
                            type="text"
                            placeholder="+Bonus / -Fine"
                            value={inp.adj ?? ''}
                            onChange={(e) => setRowField(emp.id, 'adj', e.target.value)}
                            className="h-7 w-28 px-1.5 text-right font-black text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-emerald-600 focus:outline-none placeholder:text-[10px] placeholder:font-normal"
                            title="Add bonus (e.g. 500) or deduction (e.g. -200)"
                          />
                        </div>

                        {/* Salary Paid */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-emerald-950">
                            Salary Paid:
                          </span>
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder={c ? paiseToInput(c.payable_paise) : '0'}
                              value={inp.sp}
                              onChange={(e) => setRowField(emp.id, 'sp', e.target.value)}
                              className="h-7 w-24 px-1.5 text-right font-black text-xs rounded border border-emerald-400 bg-white tabular-nums focus:border-emerald-600 focus:outline-none"
                              title="Leave blank to pay full payable amount"
                            />
                            {inp.sp !== '' && (
                              <button
                                type="button"
                                onClick={() => setRowField(emp.id, 'sp', '')}
                                className="text-[9px] font-bold text-emerald-900 hover:bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-300 bg-white"
                              >
                                Full
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* The Hero Cash in Hand Box */}
                      <div className="rounded-xl bg-emerald-800 text-white px-3 py-1.5 flex items-center justify-between shadow-xs">
                        <div>
                          <div className="text-[9px] uppercase font-bold tracking-wider text-emerald-200">
                            CASH TO HAND (હાથમાં રોકડ)
                          </div>
                          <div className="text-[9px] text-emerald-100/90 font-medium">
                            {r.salaryPaidPaise > 0 && `${formatMoney(r.salaryPaidPaise)} Sal`}
                            {parseMoneyInput(inp.ngChalu) > 0 && ` + ${formatMoney(parseMoneyInput(inp.ngChalu))} Chalu`}
                            {parseMoneyInput(inp.ngMoto) > 0 && ` + ${formatMoney(parseMoneyInput(inp.ngMoto))} Main`}
                            {parseMoneyInput(inp.adj) !== 0 && ` (${parseMoneyInput(inp.adj) > 0 ? '+' : ''}${formatMoney(parseMoneyInput(inp.adj))} Adj)`}
                          </div>
                          {c && r.closingCarryPaise > 0 && (
                            <div className="text-[10px] text-amber-200 font-semibold">
                              Carry out: {formatMoney(r.closingCarryPaise)}
                            </div>
                          )}
                        </div>
                        <div className="text-xl font-black tabular-nums tracking-tight text-white">
                          {c ? formatMoney(r.cashToHandOverPaise) : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
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
                <th
                  colSpan={2}
                  className="py-1 px-2 text-center bg-amber-50/70 border-r border-amber-200 text-amber-900"
                >
                  Chalu Loan (ચાલુ)
                </th>
                <th
                  colSpan={2}
                  className="py-1 px-2 text-center bg-amber-50/70 border-r border-amber-200 text-amber-900"
                >
                  Moto Loan (મોટો)
                </th>
                <th colSpan={8} className="py-1 px-2.5 text-center bg-emerald-50/50 text-emerald-950">
                  Settlement & Cash Handover (ચૂકવણી)
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
                <th
                  className="py-1.5 px-2 text-right whitespace-nowrap text-stone-500"
                  title="Current Chalu balance"
                >
                  Chalu Bal
                </th>
                <th
                  className="py-1.5 px-2 text-center whitespace-nowrap bg-amber-50/70 border-r border-amber-200 text-amber-900"
                  title="Chalu recovery to deduct"
                >
                  Chalu Cut ₹
                </th>
                <th
                  className="py-1.5 px-2 text-right whitespace-nowrap text-stone-500"
                  title="Current Moto balance"
                >
                  Moto Bal
                </th>
                <th
                  className="py-1.5 px-2 text-center whitespace-nowrap bg-amber-50/70 border-r border-amber-200 text-amber-900"
                  title="Moto recovery to deduct"
                >
                  Moto Cut ₹
                </th>
                <th
                  className="py-1.5 px-2.5 text-right whitespace-nowrap font-black text-stone-900 bg-stone-100 border-r border-stone-200"
                  title="Net salary due after deducting loans"
                >
                  Payable
                </th>
                <th
                  className="py-1.5 px-2 text-center whitespace-nowrap"
                  title="Give new Chalu upad cash today"
                >
                  New Chalu ₹
                </th>
                <th
                  className="py-1.5 px-2 text-center whitespace-nowrap"
                  title="Give new Main upad cash today"
                >
                  New Main ₹
                </th>
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
              {includedRows.map((r) => {
                const emp = r.context.employee
                const c = r.computation
                const isTicked = !!selected[emp.id]
                const inp = inputs[emp.id] || { cr: '', mr: '', ng: '', nb: 'chalu', sp: '' }
                const isInactive = !emp.active

                const handleQuickSettle = () => {
                  if (!c) return
                  const crVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                  const mrVal = Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - crVal))
                  const netAfter = Math.max(0, c.total_due_paise - crVal - mrVal)
                  setInputs((prev) => ({
                    ...prev,
                    [emp.id]: {
                      ...inp,
                      cr: crVal > 0 ? (crVal / 100).toString() : '',
                      mr: mrVal > 0 ? (mrVal / 100).toString() : '',
                      sp: (netAfter / 100).toString(),
                      ng: '',
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
                            const daysWorked = fullCount + halfCount * 0.5
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

                    {/* 5. Chalu Bal */}
                    <td
                      className="py-1 px-2 text-right tabular-nums text-stone-500 cursor-pointer hover:text-amber-800"
                      title="Click balance to fill Chalu Cut"
                      onClick={() => {
                        if (!c || c.chalu_balance_paise === 0) return
                        const maxVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                        setRowField(emp.id, 'cr', (maxVal / 100).toString())
                      }}
                    >
                      {c && c.chalu_balance_paise > 0 ? formatMoney(c.chalu_balance_paise) : '0'}
                    </td>

                    {/* 6. Chalu Cut ₹ */}
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
                            className="text-[9px] font-bold text-amber-800 hover:bg-amber-100 px-1 py-0.5 rounded"
                            title="Fill maximum recoverable"
                          >
                            Max
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 7. Moto Bal */}
                    <td
                      className="py-1 px-2 text-right tabular-nums text-stone-500 cursor-pointer hover:text-amber-800"
                      title="Click balance to fill Moto Cut"
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

                    {/* 8. Moto Cut ₹ */}
                    <td className="py-0.5 px-1 text-center bg-amber-50/40 border-r border-amber-200/50">
                      <div className="flex items-center justify-center gap-0.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={inp.mr}
                          onChange={(e) => setRowField(emp.id, 'mr', e.target.value)}
                          className="h-6.5 w-16 px-1 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-amber-600 focus:outline-none"
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
                            className="text-[9px] font-bold text-amber-800 hover:bg-amber-100 px-1 py-0.5 rounded"
                            title="Fill maximum recoverable"
                          >
                            Max
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 9. Net Payable */}
                    <td className="py-1 px-2.5 text-right tabular-nums font-black text-xs text-stone-900 bg-stone-100 border-r border-stone-200">
                      {c ? formatMoney(c.payable_paise) : '—'}
                    </td>

                    {/* 10. New Chalu Upad ₹ */}
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

                    {/* 11. New Main Upad ₹ */}
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
                      ) : isInactive && c && (c.chalu_balance_paise > 0 || c.moto_balance_paise > 0) ? (
                        <button
                          type="button"
                          onClick={handleQuickSettle}
                          className="rounded bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold text-amber-900 border border-amber-300 transition"
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
              })}
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
                <td className="py-1.5 px-2 text-right text-stone-500">
                  {formatMoney(totals.chaluBal)}
                </td>
                <td className="py-1.5 px-2 text-center bg-amber-100/60 border-r border-amber-200 text-amber-950 font-bold">
                  -{formatMoney(totals.chaluRec)}
                </td>
                <td className="py-1.5 px-2 text-right text-stone-500">
                  {formatMoney(totals.motoBal)}
                </td>
                <td className="py-1.5 px-2 text-center bg-amber-100/60 border-r border-amber-200 text-amber-950 font-bold">
                  -{formatMoney(totals.motoRec)}
                </td>
                <td className="py-1.5 px-2.5 text-right font-black text-stone-950 bg-stone-200/70 border-r border-stone-200">
                  {formatMoney(totals.payable)}
                </td>
                <td className="py-1.5 px-2 text-center text-emerald-800">
                  {totals.newChalu > 0 ? `+${formatMoney(totals.newChalu)}` : '—'}
                </td>
                <td className="py-1.5 px-2 text-center text-purple-800">
                  {totals.newMoto > 0 ? `+${formatMoney(totals.newMoto)}` : '—'}
                </td>
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
  onClose,
}: {
  row: {
    context: WorkerContext
    computation: any
    errors: EngineError[]
    warnings: EngineWarning[]
    unmarkedDates: string[]
  }
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
                      {STATUS_LETTER[d.status] ?? d.status}
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

          {/* Loan & Balances Summary */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 space-y-2 text-xs">
            <div className="font-bold text-stone-900 uppercase text-[10px] tracking-wider">
              Upad & Loan Balances
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Opening Carry (બાકી):</span>
              <span className="font-bold tabular-nums text-stone-900">{formatMoney(c.carry_paise)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Chalu Upad Balance:</span>
              <span className="font-bold tabular-nums text-stone-900">{formatMoney(c.chalu_balance_paise)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-600">Moto Upad Balance:</span>
              <span className="font-bold tabular-nums text-stone-900">{formatMoney(c.moto_balance_paise)}</span>
            </div>
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
        <h3 className="text-lg font-black text-stone-900">Confirm Payout (પગાર ચૂકવણી ખાતરી)</h3>
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
            Withdrawal Notes Checklist (નોટો)
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
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading}
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
