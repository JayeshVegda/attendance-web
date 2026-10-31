import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EMPTY_INPUTS,
  formatEngineError,
  loadWorkerContexts,
  savePayout,
  type PreviewRow,
  type WorkerContext,
} from '../lib/payout-service'
import {
  type AttendanceRow,
  type DayStatus,
  type EngineError,
  type EngineWarning,
  type PayoutComputation,
  type PayoutInputs,
  computePayout,
  unmarkedDaysFor,
  upadBalance,
} from '../lib/engine'
import { addDays, daysBetweenInclusive, formatDateLong, formatDateShort, todayKey } from '../lib/dates'
import { calculateDenominations, formatMoney, parseMoneyInput, paiseToInput } from '../lib/money'
import { Avatar, Badge, Button, Card, EmptyState, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { CheckCircle2, ChevronDown, ChevronRight, TriangleAlert, Wallet } from 'lucide-react'
import { listRuns } from '../lib/api'
import { pb } from '../lib/pb'
import type { Attendance } from '../lib/types'

type RowInputState = {
  cr: string // Chalu recovery ₹
  mr: string // Main recovery ₹
  ng: string // New upad given ₹
  nb: 'chalu' | 'moto' // New upad bucket
  sp: string // Salary paid ₹ (empty = full payable)
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
  const [inputs, setInputs] = useState<Record<string, RowInputState>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
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
      const inp = inputs[ctx.employee.id] || { cr: '', mr: '', ng: '', nb: 'chalu', sp: '' }
      const crPaise = parseMoneyInput(inp.cr)
      const mrPaise = parseMoneyInput(inp.mr)
      const ngPaise = parseMoneyInput(inp.ng)

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
        new_upad_bucket: inp.nb || 'chalu',
        new_upad_given_paise: ngPaise,
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
        cashToHandOverPaise: spPaise + ngPaise,
        closingCarryPaise: Math.max(0, netPayable - spPaise),
      }
    })
  }, [contextsQuery.data, attendanceQuery.data, cutoff, inputs])

  const includedRows = useMemo(() => preview.filter((r) => r.included), [preview])

  // Initialize selection
  useEffect(() => {
    if (includedRows.length === 0) return
    setSelected((prev) => {
      // If already initialized, preserve
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
      const cur = prev[empId] || { cr: '', mr: '', ng: '', nb: 'chalu', sp: '' }
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
          const inp = inputs[r.context.employee.id] || { cr: '', mr: '', ng: '', nb: 'chalu', sp: '' }
          return {
            context: r.context,
            inputs: {
              ...EMPTY_INPUTS,
              chalu_recovery_paise: parseMoneyInput(inp.cr),
              moto_recovery_paise: parseMoneyInput(inp.mr),
              new_upad_bucket: inp.nb || 'chalu',
              new_upad_given_paise: parseMoneyInput(inp.ng),
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

  return (
    <div className="space-y-3 max-w-[1400px] mx-auto pb-16">
      {/* Top Header & Fast Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-3 sm:px-4 rounded-xl border border-stone-200 shadow-xs">
        <div>
          <div className="text-base font-black text-stone-900 flex items-center gap-2">
            <span>Issue Payout (પગાર ચૂકવણી)</span>
            <Badge tone="green">{includedRows.length} Workers Active</Badge>
          </div>
          <div className="text-xs text-stone-500">
            Verify earnings, deduct Chalu / Main upad, and pay out cash. All fields update live.
          </div>
        </div>

        {/* Payout Date & Cutoff bar */}
        <div className="flex flex-wrap items-center gap-3 text-xs bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200">
          <label className="flex items-center gap-1.5 font-bold text-stone-700">
            <span>Date:</span>
            <input
              type="date"
              value={payoutDate}
              onChange={(e) => setPayoutDate(e.target.value)}
              className="h-7 px-2 py-0.5 rounded border border-stone-300 font-medium text-xs bg-white"
            />
          </label>
          <label className="flex items-center gap-1.5 font-bold text-stone-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includePayoutDay}
              onChange={(e) => setIncludePayoutDay(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-emerald-600"
            />
            <span>Count today</span>
          </label>
          <span className="text-stone-400">|</span>
          <span className="text-stone-600 font-medium">
            Cutoff: <strong className="text-stone-900">{formatDateShort(cutoff)}</strong>
          </span>
        </div>
      </div>

      {/* Gentle Payout Reminder Banner */}
      {daysSinceLastPayout !== null && daysSinceLastPayout >= 4 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          <TriangleAlert className="h-4 w-4 text-amber-700 shrink-0" />
          <span>
            Last payout was <strong>{daysSinceLastPayout} days ago</strong> on {formatDateLong(latestRun!.payout_date)}. Weekly payouts are settled on Thursdays.
          </span>
        </div>
      )}

      {/* Hero Cash Needed Banner with Denomination Breakdown */}
      {cleanSelectedRows.length > 0 && (
        <div className="rounded-xl bg-gradient-to-r from-emerald-950 via-teal-900 to-stone-900 px-4 py-3 text-white shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
              Total Cash to Hand Over (હાથમાં આપવાની કુલ રોકડ)
            </div>
            <div className="text-2xl font-black tracking-tight text-white tabular-nums">
              {formatMoney(totals.cashToHand)}
            </div>
            <div className="text-[11px] text-emerald-200/80">
              {cleanSelectedRows.length} workers ticked · Net Payable: {formatMoney(totals.payable)} · Upad Recovered: {formatMoney(totals.chaluRec + totals.motoRec)}
            </div>
          </div>

          {/* Compact Note Count Checklist */}
          <div className="flex flex-wrap items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15 text-xs font-mono">
            <span className="text-[10px] uppercase font-bold text-emerald-200 mr-1">Notes:</span>
            {denoms.notes.filter((n) => n.count > 0).map((n) => (
              <span key={n.note} className="rounded bg-white/20 px-2 py-0.5 font-bold text-white tabular-nums">
                {n.count} × ₹{n.note}
              </span>
            ))}
            {denoms.coins > 0 && (
              <span className="rounded bg-white/20 px-2 py-0.5 font-bold text-emerald-200 tabular-nums">
                Coins: {formatMoney(denoms.coins * 100)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Dense Payout Table */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-stone-100/90 text-stone-700 font-bold border-b border-stone-200 select-none">
              <th className="py-2 px-2.5 text-left whitespace-nowrap sticky left-0 bg-stone-100 z-10">
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
              <th className="py-2 px-2 text-right whitespace-nowrap">Carry</th>
              <th className="py-2 px-2 text-right whitespace-nowrap">Earned</th>
              <th className="py-2 px-2 text-right whitespace-nowrap">Adj</th>
              <th className="py-2 px-2 text-right whitespace-nowrap text-stone-500">Chalu Bal</th>
              <th className="py-2 px-2 text-right whitespace-nowrap text-stone-500">Main Bal</th>
              <th className="py-2 px-2 text-center whitespace-nowrap bg-amber-50/70 border-x border-amber-200/60 text-amber-900">
                Chalu Rec ₹
              </th>
              <th className="py-2 px-2 text-center whitespace-nowrap bg-amber-50/70 border-r border-amber-200/60 text-amber-900">
                Main Rec ₹
              </th>
              <th className="py-2 px-2 text-center whitespace-nowrap bg-stone-50 text-stone-700">
                New Upad ₹
              </th>
              <th className="py-2 px-2.5 text-right whitespace-nowrap font-black text-stone-900 bg-stone-50">
                Payable
              </th>
              <th className="py-2 px-2 text-center whitespace-nowrap bg-sky-50/70 border-x border-sky-200/60 text-sky-900">
                Salary Paid ₹
              </th>
              <th className="py-2 px-2.5 text-right whitespace-nowrap font-black text-emerald-800 bg-emerald-50/70">
                Cash to Hand
              </th>
              <th className="py-2 px-2 text-right whitespace-nowrap text-stone-600">Carry Out</th>
              <th className="py-2 px-2.5 text-left whitespace-nowrap">Flags / Detail</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-stone-100">
            {includedRows.map((r) => {
              const emp = r.context.employee
              const c = r.computation
              const isTicked = !!selected[emp.id]
              const isExp = !!expanded[emp.id]
              const inp = inputs[emp.id] || { cr: '', mr: '', ng: '', nb: 'chalu', sp: '' }
              const isInactive = !emp.active

              // Settle full inactive worker shortcut
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
                <>
                  <tr
                    key={emp.id}
                    className={`hover:bg-stone-50/80 transition-colors ${!isTicked ? 'opacity-40 bg-stone-50/30' : ''}`}
                  >
                    {/* 1. Worker */}
                    <td className="py-1.5 px-2.5 whitespace-nowrap sticky left-0 bg-white z-10 border-r border-stone-100">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isTicked}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [emp.id]: e.target.checked }))}
                          className="h-3.5 w-3.5 rounded accent-emerald-600 cursor-pointer"
                        />
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [emp.id]: !prev[emp.id] }))}
                          className="flex items-center gap-1.5 text-left group"
                          title="Click to view days & overtime breakdown"
                        >
                          <Avatar name={emp.name} size="sm" />
                          <div className="min-w-0">
                            <div className="font-extrabold text-stone-900 group-hover:text-emerald-700 truncate">
                              {emp.name}
                            </div>
                            <div className="text-[10px] text-stone-400">
                              #{emp.employee_no}
                              {isInactive && <span className="ml-1 text-amber-700 font-bold">Inactive</span>}
                            </div>
                          </div>
                          {isExp ? (
                            <ChevronDown className="h-3 w-3 text-stone-400" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-stone-300 group-hover:text-stone-500" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* 2. Carry */}
                    <td className="py-1.5 px-2 text-right tabular-nums text-stone-700">
                      {c ? formatMoney(c.carry_paise) : '—'}
                    </td>

                    {/* 3. Earned */}
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-stone-900">
                      {c ? formatMoney(c.earned_paise) : '—'}
                      {c && c.ot_paise > 0 && (
                        <div className="text-[10px] text-teal-700 font-bold leading-none">
                          +{formatMoney(c.ot_paise)} OT
                        </div>
                      )}
                    </td>

                    {/* 4. Adj */}
                    <td className="py-1.5 px-2 text-right tabular-nums text-stone-700">
                      {c && c.adjustments_paise !== 0 ? (
                        <span className={c.adjustments_paise > 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                          {c.adjustments_paise > 0 ? '+' : ''}{formatMoney(c.adjustments_paise)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>

                    {/* 5. Chalu Bal */}
                    <td className="py-1.5 px-2 text-right tabular-nums text-stone-600">
                      {c && c.chalu_balance_paise > 0 ? formatMoney(c.chalu_balance_paise) : '0'}
                    </td>

                    {/* 6. Main Bal */}
                    <td className="py-1.5 px-2 text-right tabular-nums text-stone-600">
                      {c && c.moto_balance_paise > 0 ? formatMoney(c.moto_balance_paise) : '0'}
                    </td>

                    {/* 7. Chalu Recovery ₹ */}
                    <td className="py-1 px-1.5 text-center bg-amber-50/40 border-x border-amber-200/50">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={inp.cr}
                          onChange={(e) => setRowField(emp.id, 'cr', e.target.value)}
                          className="h-7 w-18 px-1.5 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        {c && c.chalu_balance_paise > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const maxVal = Math.min(c.chalu_balance_paise, c.total_due_paise)
                              setRowField(emp.id, 'cr', (maxVal / 100).toString())
                            }}
                            className="text-[10px] font-bold text-amber-800 hover:underline"
                            title="Fill maximum recoverable from Chalu"
                          >
                            Max
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 8. Main Recovery ₹ */}
                    <td className="py-1 px-1.5 text-center bg-amber-50/40 border-r border-amber-200/50">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={inp.mr}
                          onChange={(e) => setRowField(emp.id, 'mr', e.target.value)}
                          className="h-7 w-18 px-1.5 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        {c && c.moto_balance_paise > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const crVal = parseMoneyInput(inp.cr)
                              const maxVal = Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - crVal))
                              setRowField(emp.id, 'mr', (maxVal / 100).toString())
                            }}
                            className="text-[10px] font-bold text-amber-800 hover:underline"
                            title="Fill maximum recoverable from Main"
                          >
                            Max
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 9. New Upad Given ₹ */}
                    <td className="py-1 px-1.5 text-center bg-stone-50/60">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={inp.ng}
                          onChange={(e) => setRowField(emp.id, 'ng', e.target.value)}
                          className="h-7 w-16 px-1.5 text-right font-bold text-xs rounded border border-stone-300 bg-white tabular-nums focus:border-stone-500 focus:outline-none"
                        />
                        <select
                          value={inp.nb}
                          onChange={(e) => setRowField(emp.id, 'nb', e.target.value as 'chalu' | 'moto')}
                          className="h-7 px-1 text-[10px] font-semibold rounded border border-stone-300 bg-white"
                        >
                          <option value="chalu">Chalu</option>
                          <option value="moto">Main</option>
                        </select>
                      </div>
                    </td>

                    {/* 10. Net Payable */}
                    <td className="py-1.5 px-2.5 text-right tabular-nums font-black text-sm text-stone-900 bg-stone-50/80">
                      {c ? formatMoney(c.payable_paise) : '—'}
                    </td>

                    {/* 11. Salary Paid ₹ (blank = full) */}
                    <td className="py-1 px-1.5 text-center bg-sky-50/40 border-x border-sky-200/50">
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={c ? paiseToInput(c.payable_paise) : '0'}
                          value={inp.sp}
                          onChange={(e) => setRowField(emp.id, 'sp', e.target.value)}
                          className="h-7 w-20 px-1.5 text-right font-bold text-xs rounded border border-sky-300 bg-white tabular-nums focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          title="Leave blank to pay full payable amount"
                        />
                        {inp.sp !== '' && (
                          <button
                            type="button"
                            onClick={() => setRowField(emp.id, 'sp', '')}
                            className="text-[10px] font-bold text-sky-800 hover:underline"
                            title="Reset to full payout"
                          >
                            Full
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 12. Cash to Hand Over */}
                    <td className="py-1.5 px-2.5 text-right tabular-nums font-black text-sm text-emerald-800 bg-emerald-50/50">
                      {c ? formatMoney(r.cashToHandOverPaise) : '—'}
                    </td>

                    {/* 13. Closing Carry */}
                    <td className="py-1.5 px-2 text-right tabular-nums text-stone-600">
                      {c && r.closingCarryPaise > 0 ? (
                        <span className="font-bold text-amber-800" title="Unpaid salary carried forward to next week">
                          {formatMoney(r.closingCarryPaise)}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>

                    {/* 14. Flags / Detail */}
                    <td className="py-1.5 px-2.5 text-left text-xs whitespace-nowrap">
                      {r.errors.length > 0 ? (
                        <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          {r.errors.map((err) => formatEngineError(err)).join(', ')}
                        </span>
                      ) : isInactive && c && (c.chalu_balance_paise > 0 || c.moto_balance_paise > 0) ? (
                        <button
                          type="button"
                          onClick={handleQuickSettle}
                          className="rounded bg-amber-100 hover:bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900 border border-amber-300 transition"
                          title="Offset upad against carry and pay balance"
                        >
                          Settle Inactive
                        </button>
                      ) : r.unmarkedDates.length > 0 ? (
                        <span className="text-amber-800 font-semibold bg-amber-50 px-1.5 py-0.5 rounded text-[10px]" title="Unmarked days in cycle">
                          {r.unmarkedDates.length}d unmarked
                        </span>
                      ) : (
                        <span className="text-emerald-700 text-[11px] font-semibold">Ready ✓</span>
                      )}
                    </td>
                  </tr>

                  {/* Expanded Sub-Row showing day-by-day marks */}
                  {isExp && c && (
                    <tr className="bg-stone-50/90 border-b border-stone-200">
                      <td colSpan={14} className="py-2.5 px-4 text-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <div className="font-bold text-stone-800 mb-1">
                              Daily Attendance Breakdown ({formatDateShort(c.from_date)} → {formatDateShort(c.cutoff)})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {c.day_breakdown.map((d) => (
                                <span
                                  key={d.date}
                                  className="rounded border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700 tabular-nums shadow-2xs"
                                  title={`${formatDateLong(d.date)} · Base: ${formatMoney(d.base_paise)}, OT: ${formatMoney(d.ot_paise)}`}
                                >
                                  <strong>{formatDateShort(d.date).slice(0, 6)}</strong> {STATUS_LETTER[d.status] ?? d.status}
                                  {d.ot_paise > 0 && <span className="font-bold text-emerald-700"> +{formatMoney(d.ot_paise)}</span>}
                                  {d.is_late_entry && <span className="text-amber-700 font-bold" title="Late entry">*</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right text-[11px] text-stone-500 font-medium shrink-0">
                            Rate: <strong className="text-stone-800">{formatMoney(c.day_breakdown[0]?.rate_paise ?? 0)}/d</strong> · OT Divisor: 8h
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>

          {/* Dense Sticky Summary Totals Footer */}
          <tfoot>
            <tr className="bg-stone-100 font-black text-stone-900 border-t-2 border-stone-300 tabular-nums">
              <td className="py-2 px-2.5 text-left sticky left-0 bg-stone-100 z-10 border-r border-stone-200">
                Total ({cleanSelectedRows.length} ticked)
              </td>
              <td className="py-2 px-2 text-right">{formatMoney(totals.carry)}</td>
              <td className="py-2 px-2 text-right">{formatMoney(totals.earned)}</td>
              <td className="py-2 px-2 text-right">
                {totals.adj !== 0 ? (totals.adj > 0 ? `+${formatMoney(totals.adj)}` : formatMoney(totals.adj)) : '—'}
              </td>
              <td className="py-2 px-2 text-right text-stone-600">{formatMoney(totals.chaluBal)}</td>
              <td className="py-2 px-2 text-right text-stone-600">{formatMoney(totals.motoBal)}</td>
              <td className="py-2 px-2 text-center bg-amber-100/60 border-x border-amber-200 text-amber-950 font-bold">
                -{formatMoney(totals.chaluRec)}
              </td>
              <td className="py-2 px-2 text-center bg-amber-100/60 border-r border-amber-200 text-amber-950 font-bold">
                -{formatMoney(totals.motoRec)}
              </td>
              <td className="py-2 px-2 text-center text-stone-800">
                {totals.newUpad > 0 ? `+${formatMoney(totals.newUpad)}` : '—'}
              </td>
              <td className="py-2 px-2.5 text-right font-black text-sm text-stone-950 bg-stone-200/60">
                {formatMoney(totals.payable)}
              </td>
              <td className="py-2 px-2 text-center bg-sky-100/60 border-x border-sky-200 text-sky-950 font-bold">
                {formatMoney(totals.salaryPaid)}
              </td>
              <td className="py-2 px-2.5 text-right font-black text-base text-emerald-900 bg-emerald-100">
                {formatMoney(totals.cashToHand)}
              </td>
              <td className="py-2 px-2 text-right text-stone-700">
                {formatMoney(totals.closingCarry)}
              </td>
              <td className="py-2 px-2.5 text-left">
                {hasAnyErrors ? (
                  <span className="text-rose-700 font-bold text-xs">Blocked</span>
                ) : (
                  <span className="text-emerald-800 font-bold text-xs">All OK</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Save Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
        <div className="text-xs text-stone-600">
          Ready to finalize? Ticked workers will have statements issued and attendance marked settled.
          {hasAnyErrors && (
            <div className="text-rose-700 font-bold mt-0.5">
              Fix the red messages on ticked workers to enable saving.
            </div>
          )}
        </div>

        <Button
          size="lg"
          disabled={hasAnyErrors || cleanSelectedRows.length === 0}
          onClick={() => setConfirmOpen(true)}
          className="bg-emerald-700 hover:bg-emerald-800 text-white font-black shadow-md shrink-0 px-6"
        >
          <Wallet className="h-4 w-4 mr-1.5" />
          <span>Save Payout for Ticked Workers ({cleanSelectedRows.length})</span>
        </Button>
      </div>

      {/* Confirmation Modal */}
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
            {denoms.notes.filter((n) => n.count > 0).map((n) => (
              <span key={n.note} className="rounded bg-white px-2 py-0.5 font-mono font-bold text-emerald-950 border border-emerald-200">
                {n.count} × ₹{n.note}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={onConfirm} className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold">
            Confirm & Issue ({workersCount})
          </Button>
        </div>
      </Card>
    </div>
  )
}
