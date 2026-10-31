import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EMPTY_INPUTS,
  buildPreview,
  formatEngineError,
  loadWorkerContexts,
  savePayout,
  type PreviewRow,
  type WorkerContext,
} from '../lib/payout-service'
import { addDays, daysBetweenInclusive, formatDateLong, formatDateShort, todayKey } from '../lib/dates'
import { calculateDenominations, formatMoney, parseMoneyInput, paiseToInput } from '../lib/money'
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Stat } from '../components/ui'
import { useToast } from '../components/Toast'
import { CheckCircle2, CircleAlert, HandCoins, Info, TriangleAlert, UserCheck, Wallet } from 'lucide-react'
import { listRuns } from '../lib/api'
import { pb } from '../lib/pb'
import type { Attendance, UpadCategory } from '../lib/types'

type ScreenInputs = {
  chalu_recovery_paise?: number
  moto_recovery_paise?: number
  new_upad_bucket?: 'chalu' | 'moto'
  new_upad_given_paise?: number
  salary_paid_paise?: number
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
  const [inputs, setInputs] = useState<Record<string, ScreenInputs>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    return initialWorkerId ? new Set([initialWorkerId]) : new Set()
  })
  const [confirmOpen, setConfirmOpen] = useState(false)

  const cutoff = includePayoutDay ? payoutDate : addDays(payoutDate, -1)

  const contextsQuery = useQuery({ queryKey: ['payout-contexts'], queryFn: loadWorkerContexts })
  const attendanceQuery = useQuery({
    queryKey: ['payout-attendance'],
    queryFn: () => pb.collection('attendance').getFullList<Attendance>({ sort: 'date' }),
  })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })

  const preview = useMemo(() => {
    if (!contextsQuery.data || !attendanceQuery.data) return []
    return buildPreview(contextsQuery.data, cutoff, inputs, attendanceQuery.data)
  }, [contextsQuery.data, attendanceQuery.data, cutoff, inputs])

  const included = preview.filter((r) => r.included)

  // Auto-select all included if none initially selected and no initialWorkerId was specified
  useEffect(() => {
    if (!initialWorkerId && included.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set(included.map((r) => r.context.employee.id)))
    }
  }, [included, initialWorkerId, selectedIds.size])

  // Filter preview by selection
  const activeRows = included.filter((r) => selectedIds.has(r.context.employee.id))
  const cleanRows = activeRows.filter((r) => r.computation)
  const errorRows = activeRows.filter((r) => !r.computation)

  const totals = useMemo(() => {
    const t = { due: 0, payable: 0, recovery: 0, cashInHand: 0 }
    for (const r of cleanRows) {
      const c = r.computation!
      t.due += c.total_due_paise
      t.payable += c.payable_paise
      t.recovery += c.chalu_recovery_paise + c.moto_recovery_paise
      t.cashInHand += c.cash_to_hand_over_paise
    }
    return t
  }, [cleanRows])

  const denoms = useMemo(() => calculateDenominations(totals.cashInHand), [totals.cashInHand])

  // Payout reminder: how long ago was the last payout?
  const latestRun = runsQuery.data?.find((r) => r.status === 'closed' && !r.voided)
  const daysSinceLastPayout = latestRun
    ? Math.max(0, daysBetweenInclusive(latestRun.payout_date, todayKey()) - 1)
    : null

  const saveMutation = useMutation({
    mutationFn: () =>
      savePayout({
        payoutDate,
        cutoff,
        note: '',
        rows: cleanRows.flatMap((r) => {
          const user: ScreenInputs = inputs[r.context.employee.id] ?? {}
          return [
            {
              context: r.context,
              inputs: {
                ...EMPTY_INPUTS,
                chalu_recovery_paise: user.chalu_recovery_paise ?? 0,
                moto_recovery_paise: user.moto_recovery_paise ?? 0,
                new_upad_bucket: user.new_upad_bucket ?? 'chalu',
                new_upad_given_paise: user.new_upad_given_paise ?? 0,
                salary_paid_paise: user.salary_paid_paise ?? 0,
              },
            },
          ]
        }),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries()
      toast('Payout saved and statements issued successfully.')
      setInputs({})
      setConfirmOpen(false)
      onNavigate(`reports/${res.runId}`)
    },
    onError: (err) => {
      setConfirmOpen(false)
      toast(err instanceof Error ? err.message : 'Payout failed to save. Nothing was changed.', 'error')
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
  if (contextsQuery.isError || attendanceQuery.isError) {
    return (
      <EmptyState
        icon={<TriangleAlert className="h-8 w-8 text-rose-600" />}
        title="Could not load payroll data"
        description="Check that PocketBase is running and refresh."
      />
    )
  }

  const setWorkerInput = (empId: string, patch: ScreenInputs) =>
    setInputs((prev) => ({ ...prev, [empId]: { ...prev[empId], ...patch } }))

  const toggleSelectWorker = (empId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === included.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(included.map((r) => r.context.employee.id)))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Step 2: Payout & Settlement"
        title="Issue Payout (પગાર ચૂકવણી)"
        description="Close books up to the cutoff date. Each worker has their own cycle window. Deduct Chalu / Main upad, hand over cash, and carry forward any remainder."
      />

      {/* Gentle Payout Reminder Banner */}
      {daysSinceLastPayout !== null && daysSinceLastPayout >= 4 && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900 shadow-2xs">
          <TriangleAlert className="h-4 w-4 text-amber-700 shrink-0" />
          <span>
            Last payout was <strong>{daysSinceLastPayout} days ago</strong> on {formatDateLong(latestRun!.payout_date)}. Payouts are usually settled weekly on Thursdays.
          </span>
        </div>
      )}

      {/* Cutoff & Payout Date Selector Card */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-5">
          <Field label="Payout Date (ચૂકવણી તારીખ)" className="w-48">
            <Input type="date" value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} />
          </Field>
          <label className="flex h-10 items-center gap-2.5 text-sm font-semibold text-stone-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-emerald-600 cursor-pointer"
              checked={includePayoutDay}
              onChange={(e) => setIncludePayoutDay(e.target.checked)}
            />
            Count the payout day's attendance
          </label>
          <div className="text-xs text-stone-500 pb-2.5">
            Cutoff date: <Badge tone="green">{formatDateShort(cutoff)}</Badge>
          </div>
        </div>
      </Card>

      {/* Hero: Cash Needed Today Banner with Note Denomination Breakdown */}
      {cleanRows.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-900 to-stone-900 p-5 text-white shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                Cash Needed Today · આજે જોઈતી કુલ રોકડ
              </div>
              <div className="mt-1 text-3xl font-black tabular-nums tracking-tight text-white">
                {formatMoney(totals.cashInHand)}
              </div>
              <div className="mt-1 text-xs text-emerald-100/80 font-medium">
                For {cleanRows.length} selected worker{cleanRows.length > 1 ? 's' : ''} · Net Payable: {formatMoney(totals.payable)} · Upad Recovered: {formatMoney(totals.recovery)}
              </div>
            </div>

            {/* Note Denomination Breakdown Pill List */}
            <div className="rounded-xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur-xs">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-200">
                Bank Cash Withdrawal (નોટોની ગણતરી)
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {denoms.notes.filter((n) => n.count > 0).map((n) => (
                  <span key={n.note} className="rounded-lg bg-white/20 px-2.5 py-1 font-mono font-bold text-white tabular-nums">
                    {n.count} × ₹{n.note}
                  </span>
                ))}
                {denoms.coins > 0 && (
                  <span className="rounded-lg bg-white/20 px-2.5 py-1 font-mono font-bold text-emerald-200 tabular-nums">
                    Coins: {formatMoney(denoms.coins * 100)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Summary Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total Due (કુલ લેણી)" value={formatMoney(totals.due)} />
        <Stat label="Upad Recovery (કપાત)" value={formatMoney(totals.recovery)} />
        <Stat label="Cash in Hand (હાથમાં રોકડ)" value={formatMoney(totals.cashInHand)} hint="payable + new upad" tone="teal" />
        <Stat
          label="Selected Workers"
          value={`${cleanRows.length} / ${included.length}`}
          hint={errorRows.length ? `${errorRows.length} blocked` : 'All ready'}
        />
      </div>

      {/* Worker Selection Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-xs">
        <label className="flex items-center gap-2 font-bold text-stone-800 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 rounded accent-emerald-600 cursor-pointer"
            checked={selectedIds.size === included.length && included.length > 0}
            onChange={toggleSelectAll}
          />
          <span>Select All Workers ({included.length})</span>
        </label>
        {initialWorkerId && (
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(included.map((r) => r.context.employee.id)))}
            className="font-bold text-emerald-800 hover:underline"
          >
            Show All Workers
          </button>
        )}
      </div>

      {included.length === 0 && (
        <EmptyState title="Nothing to pay out" description="No unsettled work or outstanding balances up to this cutoff." />
      )}

      {/* Error rows */}
      {errorRows.map((r) => (
        <ErrorRow key={r.context.employee.id} row={r} />
      ))}

      {/* Clean Worker Payout Rows */}
      <div className="space-y-3">
        {cleanRows.map((r) => (
          <WorkerRow
            key={r.context.employee.id}
            row={r}
            selected={selectedIds.has(r.context.employee.id)}
            onToggleSelect={() => toggleSelectWorker(r.context.employee.id)}
            inputs={inputs[r.context.employee.id] ?? {}}
            onInput={(patch) => setWorkerInput(r.context.employee.id, patch)}
          />
        ))}
      </div>

      {cleanRows.length > 0 && (
        <Card className="sticky bottom-4 z-20 border-2 border-emerald-600/30 bg-white p-4 sm:p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-stone-600">
              <div>
                Net Payable to {cleanRows.length} workers: <span className="text-base font-black text-stone-900 tabular-nums">{formatMoney(totals.payable)}</span>
              </div>
              <div className="text-xs text-stone-500">
                Total cash to hand over: <strong className="text-emerald-800">{formatMoney(totals.cashInHand)}</strong>
              </div>
            </div>
            <Button
              size="lg"
              disabled={errorRows.length > 0 || cleanRows.length === 0}
              onClick={() => setConfirmOpen(true)}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-black shadow-md"
            >
              <Wallet className="h-5 w-5 mr-1" />
              <span>Confirm & Issue Payout ({cleanRows.length})</span>
            </Button>
          </div>
          {errorRows.length > 0 && (
            <div className="mt-3 text-xs font-bold text-rose-700">
              Please fix the blocked worker error above before confirming the payout run.
            </div>
          )}
        </Card>
      )}

      {confirmOpen && (
        <ConfirmPayout
          cutoff={cutoff}
          payoutDate={payoutDate}
          workers={cleanRows.length}
          payable={totals.payable}
          cashInHand={totals.cashInHand}
          denoms={denoms}
          loading={saveMutation.isPending}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => saveMutation.mutate()}
        />
      )}
    </div>
  )
}

function ConfirmPayout({
  cutoff,
  payoutDate,
  workers,
  payable,
  cashInHand,
  denoms,
  loading,
  onClose,
  onConfirm,
}: {
  cutoff: string
  payoutDate: string
  workers: number
  payable: number
  cashInHand: number
  denoms: ReturnType<typeof calculateDenominations>
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-black text-stone-900">Confirm Payout Settlement (ખાતરી)</h3>
        <p className="mt-1 text-xs text-stone-600">
          Payout date <strong>{formatDateLong(payoutDate)}</strong> with cutoff through <strong>{formatDateLong(cutoff)}</strong>.
        </p>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-2 text-sm text-stone-800">
          <div className="flex justify-between">
            <span className="text-stone-500">Selected Workers:</span>
            <span className="font-bold">{workers} workers</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Net Payable:</span>
            <span className="font-black text-stone-900">{formatMoney(payable)}</span>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 text-base">
            <span className="font-bold text-stone-700">Cash Handed Over:</span>
            <span className="font-black text-emerald-800">{formatMoney(cashInHand)}</span>
          </div>
        </div>

        {/* Note Denomination Checklist */}
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs">
          <div className="font-bold text-emerald-950 uppercase text-[10px] tracking-wider">
            Required Note Denominations (નોટો)
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {denoms.notes.filter((n) => n.count > 0).map((n) => (
              <span key={n.note} className="rounded bg-white px-2 py-0.5 font-mono font-bold text-emerald-950 border border-emerald-200">
                {n.count} × ₹{n.note}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={onConfirm} className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold">
            Confirm & Issue All
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ErrorRow({ row }: { row: PreviewRow }) {
  const e = row.context.employee
  return (
    <Card className="border-rose-300 bg-rose-50/70 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={e.name} />
        <div className="flex-1">
          <div className="font-bold text-stone-900">{e.name}</div>
          <div className="text-xs text-rose-700 font-semibold">Blocked — resolve to include in payout</div>
        </div>
        <CircleAlert className="h-5 w-5 text-rose-600 shrink-0" />
      </div>
      <ul className="mt-2 list-inside list-disc text-xs text-rose-800 font-medium">
        {row.errors.map((err, i) => (
          <li key={i}>{formatEngineError(err)}</li>
        ))}
      </ul>
    </Card>
  )
}

function WorkerRow({
  row,
  selected,
  onToggleSelect,
  inputs,
  onInput,
}: {
  row: PreviewRow
  selected: boolean
  onToggleSelect: () => void
  inputs: ScreenInputs
  onInput: (patch: ScreenInputs) => void
}) {
  const ctx = row.context
  const c = row.computation!
  const isInactive = !ctx.employee.active
  const from = addDays(ctx.paidUpToDate || ctx.worker.opening_date, 1)
  const window = `${formatDateShort(from)} → ${formatDateShort(c.cutoff)}`

  const deductionLeftover = row.warnings.find((w) => w.code === 'deduction_exceeds_due')?.leftover_paise ?? 0
  const lateCount = c.late_entry_count

  // Inactive worker final settlement handler
  const handleFinalSettlement = () => {
    const chaluRec = Math.min(c.chalu_balance_paise, c.total_due_paise)
    const motoRec = Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - chaluRec))
    const payableAfterRec = Math.max(0, c.total_due_paise - chaluRec - motoRec)
    onInput({
      chalu_recovery_paise: chaluRec,
      moto_recovery_paise: motoRec,
      salary_paid_paise: payableAfterRec,
      new_upad_given_paise: 0,
    })
  }

  return (
    <Card className={`p-4 sm:p-5 transition-colors ${!selected ? 'opacity-50 bg-stone-50/50' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 rounded accent-emerald-600 cursor-pointer"
          checked={selected}
          onChange={onToggleSelect}
          title="Include in this payout"
        />
        <Avatar name={ctx.employee.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-stone-900">{ctx.employee.name}</span>
            <span className="text-xs text-stone-400">#{ctx.employee.employee_no}</span>
            {isInactive && (
              <Badge tone="neutral">Inactive · Final Settlement</Badge>
            )}
          </div>
          <div className="text-xs text-stone-500">
            Last payout: {formatDateShort(ctx.paidUpToDate || ctx.worker.opening_date)} · Carry in: <span className="font-semibold">{formatMoney(c.carry_paise)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Total Due</div>
          <div className="text-base font-black text-stone-900 tabular-nums">{formatMoney(c.total_due_paise)}</div>
        </div>
      </div>

      {/* Inactive Worker Final Settlement Quick Action */}
      {isInactive && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50/80 px-3.5 py-2 text-xs">
          <div className="text-amber-900 font-medium">
            Worker is inactive. Ready to settle final account (offset upad against carry)?
          </div>
          <Button size="sm" variant="secondary" onClick={handleFinalSettlement} className="text-xs font-bold shrink-0">
            Auto-fill Final Settlement
          </Button>
        </div>
      )}

      {/* Attendance day pill list */}
      <div className="mt-3 text-xs font-semibold text-stone-500">
        Attendance: {window} ({c.day_breakdown.length} days recorded)
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {c.day_breakdown.map((d) => (
          <span
            key={d.date}
            title={`${formatDateLong(d.date)} · rate ${formatMoney(d.rate_paise)}/d · base ${formatMoney(d.base_paise)}, OT ${formatMoney(d.ot_paise)}`}
            className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] text-stone-600 tabular-nums"
          >
            {formatDateShort(d.date).slice(0, 6)} <strong>{STATUS_LETTER[d.status] ?? d.status}</strong>
            {d.ot_paise > 0 && <span className="font-bold text-emerald-700"> +{formatMoney(d.ot_paise)}</span>}
            {d.is_late_entry && <span className="font-bold text-amber-600" title="Late entry">*</span>}
          </span>
        ))}
      </div>

      {/* Warnings */}
      {row.unmarkedDates.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 font-medium">
          <TriangleAlert className="h-4 w-4 text-amber-700 shrink-0" />
          <span>
            Unmarked days in cycle: {row.unmarkedDates.map((d) => formatDateShort(d)).join(', ')}. Check roll call if needed.
          </span>
        </div>
      )}

      {/* Top summary row */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5 border-t border-stone-100 pt-3">
        <T label="Carry In" value={formatMoney(c.carry_paise)} />
        <T label="Earned + Adjustments" value={formatMoney(c.earned_paise + c.adjustments_paise)} hint={c.ot_paise > 0 ? `incl OT ${formatMoney(c.ot_paise)}` : undefined} />
        <T label="Salary Paid" value={formatMoney(c.salary_paid_paise)} tone={c.salary_paid_paise > 0 ? 'amber' : 'default'} />
        <T label="Upad Recovered" value={formatMoney(c.chalu_recovery_paise + c.moto_recovery_paise)} />
        <T label="Net Payable" value={formatMoney(c.payable_paise)} strong />
      </div>

      {/* Upad Buckets & Payment Inputs */}
      <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
        {/* Chalu Upad Bucket */}
        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-stone-800 text-xs">ચાલુ ઉપાડ (Chalu Upad)</span>
            <button
              type="button"
              onClick={() => onInput({ chalu_recovery_paise: Math.min(c.chalu_balance_paise, c.total_due_paise) })}
              className="text-[10px] font-extrabold uppercase text-emerald-700 hover:underline"
            >
              Max ({formatMoney(Math.min(c.chalu_balance_paise, c.total_due_paise))})
            </button>
          </div>
          <div className="mb-2 text-[11px] text-stone-500">
            Bal: <strong className="text-stone-800">{formatMoney(c.chalu_balance_paise)}</strong> · After: <span className={c.chalu_after_paise < 0 ? 'font-bold text-rose-700' : 'font-semibold text-stone-700'}>{formatMoney(c.chalu_after_paise)}</span>
          </div>
          <Field label="Recover from salary">
            <Input
              inputMode="decimal"
              placeholder="0"
              value={inputs.chalu_recovery_paise === undefined ? '' : paiseToInput(inputs.chalu_recovery_paise ?? 0)}
              onChange={(e) => onInput({ chalu_recovery_paise: parseMoneyInput(e.target.value) })}
            />
          </Field>
        </div>

        {/* Main Upad Bucket */}
        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-stone-800 text-xs">મોટો ઉપાડ (Main Upad)</span>
            <button
              type="button"
              onClick={() => onInput({ moto_recovery_paise: Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - (inputs.chalu_recovery_paise ?? 0))) })}
              className="text-[10px] font-extrabold uppercase text-emerald-700 hover:underline"
            >
              Max ({formatMoney(Math.min(c.moto_balance_paise, Math.max(0, c.total_due_paise - (inputs.chalu_recovery_paise ?? 0))))})
            </button>
          </div>
          <div className="mb-2 text-[11px] text-stone-500">
            Bal: <strong className="text-stone-800">{formatMoney(c.moto_balance_paise)}</strong> · After: <span className={c.moto_after_paise < 0 ? 'font-bold text-rose-700' : 'font-semibold text-stone-700'}>{formatMoney(c.moto_after_paise)}</span>
          </div>
          <Field label="Recover from salary">
            <Input
              inputMode="decimal"
              placeholder="0"
              value={inputs.moto_recovery_paise === undefined ? '' : paiseToInput(inputs.moto_recovery_paise ?? 0)}
              onChange={(e) => onInput({ moto_recovery_paise: parseMoneyInput(e.target.value) })}
            />
          </Field>
        </div>

        {/* Payments & New Upad */}
        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-stone-800 text-xs">Salary Payment & New Upad</span>
            <button
              type="button"
              onClick={() => onInput({ salary_paid_paise: c.payable_paise })}
              className="text-[10px] font-extrabold uppercase text-emerald-700 hover:underline"
            >
              Full Pay ({formatMoney(c.payable_paise)})
            </button>
          </div>
          <Field label="Salary paid now">
            <Input
              inputMode="decimal"
              placeholder="0"
              value={inputs.salary_paid_paise === undefined ? '' : paiseToInput(inputs.salary_paid_paise ?? 0)}
              onChange={(e) => onInput({ salary_paid_paise: parseMoneyInput(e.target.value) })}
            />
          </Field>
          <div className="flex gap-2">
            <Field label="New upad given" className="flex-1">
              <Input
                inputMode="decimal"
                placeholder="0"
                value={inputs.new_upad_given_paise === undefined ? '' : paiseToInput(inputs.new_upad_given_paise ?? 0)}
                onChange={(e) => onInput({ new_upad_given_paise: parseMoneyInput(e.target.value) })}
              />
            </Field>
            <Field label="Bucket" className="w-24">
              <Select
                value={inputs.new_upad_bucket ?? 'chalu'}
                onChange={(e) => onInput({ new_upad_bucket: e.target.value as 'chalu' | 'moto' })}
                className="h-9 text-xs"
              >
                <option value="chalu">Chalu</option>
                <option value="moto">Main</option>
              </Select>
            </Field>
          </div>
        </div>
      </div>

      {/* Row Footer with Cash Handover */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3 text-xs">
        <div className="flex flex-col gap-0.5 text-stone-500">
          {lateCount > 0 && (
            <span className="font-medium text-amber-800">
              {lateCount} late unsettled day{lateCount > 1 ? 's' : ''} included from before last payout (marked *).
            </span>
          )}
          {deductionLeftover > 0 && (
            <span className="font-medium text-amber-800">
              Deduction overflow {formatMoney(deductionLeftover)} carried as write-off.
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-stone-700">
            Cash to hand over: <span className="text-base font-black text-emerald-800 tabular-nums">{formatMoney(c.cash_to_hand_over_paise)}</span>
          </div>
          <div className="text-[11px] text-stone-500 font-medium">
            Stays with us (Carry out): <strong className="text-stone-800">{formatMoney(c.closing_carry_paise)}</strong>
          </div>
        </div>
      </div>
    </Card>
  )
}

function T({
  label,
  value,
  hint,
  strong,
  tone,
}: {
  label: string
  value: string
  hint?: string
  strong?: boolean
  tone?: 'amber' | 'default'
}) {
  return (
    <div>
      <div className="text-[10px] uppercase font-bold text-stone-400 tracking-wider">{label}</div>
      <div className={`mt-0.5 text-sm tabular-nums font-extrabold ${strong ? 'text-stone-950 font-black' : tone === 'amber' ? 'text-amber-700' : 'text-stone-800'}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-stone-500">{hint}</div>}
    </div>
  )
}
