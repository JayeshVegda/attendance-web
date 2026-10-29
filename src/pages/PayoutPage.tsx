import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Coins,
  History,
  RotateCcw,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import {
  buildCycleRows,
  createPayout,
  deletePayout,
  getPayrollData,
  getSettings,
  listRuns,
  listStatements,
} from '../lib/api'
import { cycleStartFor, lastPayoutDate, otDivisor, settingValue } from '../lib/cycle'
import { addDays, daysBetweenInclusive, formatDateLong, formatDateRange, todayKey } from '../lib/dates'
import { formatMoney, paiseToInput, parseMoneyInput } from '../lib/money'
import type { CycleRow, PayoutRun, Statement } from '../lib/types'
import { useToast } from '../components/Toast'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Stat,
  Textarea,
} from '../components/ui'

type RowInput = {
  recovery: string
  paid: string | null
  included: boolean
}

function blankInput(): RowInput {
  return { recovery: '', paid: null, included: true }
}

function adjustRows(baseRows: CycleRow[], entries: Record<string, RowInput>): CycleRow[] {
  return baseRows.map((row) => {
    const entry = entries[row.employee.id] ?? blankInput()
    const requestedRecovery = Math.max(0, parseMoneyInput(entry.recovery))
    const recovery = Math.min(requestedRecovery, row.upadOutstandingPaise, row.totalDuePaise)
    const due = Math.max(0, row.totalDuePaise - recovery)
    const paidInput = entry.paid === null ? paiseToInput(due) : entry.paid
    const paid = Math.min(Math.max(0, parseMoneyInput(paidInput)), due)
    return {
      ...row,
      upadRecoveryPaise: recovery,
      totalDuePaise: due,
      paidPaise: paid,
      closingPaise: due - paid,
      included: entry.included !== false,
    }
  })
}

export default function PayoutPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [cycleStart, setCycleStart] = useState('')
  const [payoutDate, setPayoutDate] = useState('')
  const [entries, setEntries] = useState<Record<string, RowInput>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [note, setNote] = useState('')
  const [detailRun, setDetailRun] = useState<PayoutRun | null>(null)
  const [undoRun, setUndoRun] = useState<PayoutRun | null>(null)
  const initialized = useRef(false)
  const toast = useToast()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const statementsQuery = useQuery({ queryKey: ['statements'], queryFn: listStatements })

  useEffect(() => {
    if (initialized.current) return
    if (!settingsQuery.data || !runsQuery.isSuccess) return
    const start = cycleStartFor(runsQuery.data, settingsQuery.data)
    const today = todayKey()
    setCycleStart(start)
    setPayoutDate(today < start ? start : today)
    initialized.current = true
  }, [settingsQuery.data, runsQuery.data, runsQuery.isSuccess])

  useEffect(() => {
    setEntries({})
    setConfirmOpen(false)
  }, [cycleStart, payoutDate])

  const validRange = Boolean(cycleStart && payoutDate && cycleStart <= payoutDate)
  const payrollQuery = useQuery({
    queryKey: ['payroll', cycleStart, payoutDate],
    queryFn: () => getPayrollData(cycleStart, payoutDate),
    enabled: validRange,
  })

  const baseRows = useMemo(() => {
    if (!payrollQuery.data) return []
    return buildCycleRows(payrollQuery.data, cycleStart, payoutDate)
  }, [payrollQuery.data, cycleStart, payoutDate])

  const rows = useMemo(() => adjustRows(baseRows, entries), [baseRows, entries])
  const includedRows = rows.filter((row) => row.included)
  const totals = includedRows.reduce(
    (sum, row) => {
      sum.opening += row.openingPaise
      sum.earned += row.earnedPaise
      sum.adjustment += row.adjustmentPaise
      sum.due += row.totalDuePaise
      sum.recovery += row.upadRecoveryPaise
      sum.paid += row.paidPaise
      sum.closing += row.closingPaise
      return sum
    },
    { opening: 0, earned: 0, adjustment: 0, due: 0, recovery: 0, paid: 0, closing: 0 },
  )

  const createMutation = useMutation({
    mutationFn: () =>
      createPayout({
        cycleStart,
        payoutDate,
        rows,
        note: note.trim(),
      }),
    onSuccess: (run) => {
      toast('Payout closed and statements saved')
      setConfirmOpen(false)
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      queryClient.invalidateQueries({ queryKey: ['statements'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      const next = addDays(payoutDate, 1)
      initialized.current = true
      setCycleStart(next)
      setPayoutDate(todayKey() > next ? todayKey() : next)
      onNavigate(`reports/${run.id}`)
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Could not close payout', 'error'),
  })

  const undoMutation = useMutation({
    mutationFn: (run: PayoutRun) => deletePayout(run.id),
    onSuccess: () => {
      toast('Payout undone')
      setUndoRun(null)
      initialized.current = false
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      queryClient.invalidateQueries({ queryKey: ['statements'] })
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Could not undo payout', 'error'),
  })

  const latestRun = useMemo(() => {
    return [...(runsQuery.data ?? [])].sort((a, b) => b.payout_date.localeCompare(a.payout_date))[0]
  }, [runsQuery.data])

  const divisor = payrollQuery.data ? otDivisor(payrollQuery.data.settings) : 8
  const loading = settingsQuery.isLoading || runsQuery.isLoading || payrollQuery.isLoading
  const hasDataError = payrollQuery.isError

  return (
    <div>
      <PageHeader
        eyebrow="Salary settlement"
        title="Payout"
        description="Review the open cycle, recover upad, enter what was actually paid, and carry the rest forward."
        actions={
          <Button variant="secondary" onClick={() => onNavigate('reports')}>
            <History className="h-4 w-4" /> Payout history
          </Button>
        }
      />

      <Card className="mb-5 p-4 sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <Field label="Cycle start" hint="Usually the day after the previous payout.">
            <Input type="date" value={cycleStart} onChange={(event) => setCycleStart(event.target.value)} />
          </Field>
          <Field
            label="Payout date"
            hint={
              cycleStart && payoutDate && cycleStart <= payoutDate
                ? `${daysBetweenInclusive(cycleStart, payoutDate)} days in this cycle`
                : 'Payout date must be on or after the cycle start.'
            }
            error={cycleStart && payoutDate && cycleStart > payoutDate ? 'Payout date is before the cycle start.' : undefined}
          >
            <Input type="date" min={cycleStart || undefined} value={payoutDate} onChange={(event) => setPayoutDate(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2 pb-0.5">
            <Button
              variant="secondary"
              onClick={() => {
                const start = cycleStartFor(runsQuery.data ?? [], settingsQuery.data ?? {})
                setCycleStart(start)
                setPayoutDate(todayKey() < start ? start : todayKey())
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!validRange || !includedRows.length || loading || createMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4" /> Close payout
            </Button>
          </div>
        </div>
        {cycleStart && payoutDate && cycleStart <= payoutDate && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 text-xs text-stone-500">
            <Badge tone="green">Open cycle</Badge>
            <span>{formatDateRange(cycleStart, payoutDate)}</span>
            <span className="text-stone-300">·</span>
            <span>{settingValue(settingsQuery.data ?? {}, 'business_name') || 'હાજરી પગાર'}</span>
            {lastPayoutDate(runsQuery.data ?? []) && (
              <>
                <span className="text-stone-300">·</span>
                <span>Last payout {formatDateLong(lastPayoutDate(runsQuery.data ?? [])!)}</span>
              </>
            )}
          </div>
        )}
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Employees" value={includedRows.length} hint={`${rows.length - includedRows.length} skipped`} icon={<Users className="h-4 w-4" />} />
        <Stat label="Total due" value={formatMoney(totals.due)} hint={`Opening ${formatMoney(totals.opening)}`} icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Upad recovery" value={formatMoney(totals.recovery)} hint="Deducted this payout" tone={totals.recovery ? 'amber' : 'default'} icon={<Coins className="h-4 w-4" />} />
        <Stat label="Paying out" value={formatMoney(totals.paid)} hint="Cash / bank paid now" tone="green" />
        <Stat label="Carry forward" value={formatMoney(totals.closing)} hint="Unpaid salary balance" tone={totals.closing ? 'red' : 'default'} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-stone-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-stone-800">Cycle statement preview</div>
            <div className="text-[11px] text-stone-500">
              Edit upad recovery or paid amount. Blank recovery means no deduction.
            </div>
          </div>
          <div className="text-[11px] text-stone-500">OT divisor: {divisor} hours/day</div>
        </div>

        {!validRange ? (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Choose a valid payout cycle"
            description="The payout date must be on or after the cycle start."
          />
        ) : hasDataError ? (
          <EmptyState
            title="Could not load payroll"
            description="Check that PocketBase is running and try again."
            action={<Button onClick={() => payrollQuery.refetch()}>Retry</Button>}
          />
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-stone-500">
            <Spinner /> Calculating payroll…
          </div>
        ) : !rows.length ? (
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="No employees in this cycle"
            description="Mark attendance first, or add employees who should be included."
            action={<Button onClick={() => onNavigate('attendance')}>Go to attendance</Button>}
          />
        ) : (
          <div className="table-scroll max-h-[calc(100vh-24rem)]">
            <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 min-w-[12.5rem] border-b border-stone-200 bg-stone-50 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    Employee
                  </th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">Opening</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">Earned</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">Adjust</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">Upad out.</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-amber-50 px-1.5 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-amber-700">Recover</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">Total due</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-emerald-50 px-1.5 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-emerald-800">Paid now</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500">Carry</th>
                  <th className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50 px-2 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-stone-500">In</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const entry = entries[row.employee.id] ?? blankInput()
                  const paidValue = entry.paid === null ? paiseToInput(row.totalDuePaise) : entry.paid
                  const excluded = !row.included
                  return (
                    <tr key={row.employee.id} className={clsx(excluded && 'bg-stone-50 opacity-60')}>
                      <td className={clsx('sticky left-0 z-10 border-b border-stone-100 px-3 py-2', excluded ? 'bg-stone-50' : 'bg-white')}>
                        <button
                          className="text-left"
                          onClick={() => onNavigate(`employees/${row.employee.id}`)}
                        >
                          <div className="text-[13px] font-semibold text-stone-800 hover:text-emerald-700">
                            {row.employee.name}
                          </div>
                          <div className="mt-0.5 text-[10px] text-stone-400">
                            #{row.employee.employee_no} · {row.daysWorked} days · {row.otMinutes > 0 ? `${(row.otMinutes / 60).toFixed(1)}h OT` : 'no OT'}
                          </div>
                        </button>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2 text-right tabular-nums text-stone-600">{formatMoney(row.openingPaise)}</td>
                      <td className="border-b border-stone-100 px-2 py-2 text-right tabular-nums font-medium text-stone-800">{formatMoney(row.earnedPaise)}</td>
                      <td className={clsx('border-b border-stone-100 px-2 py-2 text-right tabular-nums', row.adjustmentPaise < 0 ? 'text-rose-600' : 'text-stone-600')}>{formatMoney(row.adjustmentPaise)}</td>
                      <td className="border-b border-stone-100 px-2 py-2 text-right tabular-nums text-stone-600">{formatMoney(row.upadOutstandingPaise)}</td>
                      <td className="border-b border-stone-100 bg-amber-50/40 px-1 py-2 text-right">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-stone-400">₹</span>
                          <Input
                            className="h-8 min-w-[4.5rem] py-1 pl-5 pr-1.5 text-right text-xs tabular-nums"
                            inputMode="decimal"
                            placeholder="0"
                            value={entry.recovery}
                            disabled={excluded || row.upadOutstandingPaise === 0}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) =>
                              setEntries((current) => ({
                                ...current,
                                [row.employee.id]: { ...(current[row.employee.id] ?? blankInput()), recovery: event.target.value },
                              }))
                            }
                          />
                          {row.upadOutstandingPaise > 0 && (
                            <button
                              className="mt-0.5 text-[9px] font-semibold text-amber-700 hover:underline"
                              onClick={() =>
                                setEntries((current) => ({
                                  ...current,
                                  [row.employee.id]: {
                                    ...(current[row.employee.id] ?? blankInput()),
                                    recovery: paiseToInput(Math.min(row.upadOutstandingPaise, row.totalDuePaise)),
                                  },
                                }))
                              }
                            >
                              recover all
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2 text-right tabular-nums font-semibold text-stone-900">{formatMoney(row.totalDuePaise)}</td>
                      <td className="border-b border-stone-100 bg-emerald-50/40 px-1 py-2 text-right">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-stone-400">₹</span>
                          <Input
                            className="h-8 min-w-[4.5rem] py-1 pl-5 pr-1.5 text-right text-xs font-semibold tabular-nums"
                            inputMode="decimal"
                            value={paidValue}
                            disabled={excluded}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) =>
                              setEntries((current) => ({
                                ...current,
                                [row.employee.id]: { ...(current[row.employee.id] ?? blankInput()), paid: event.target.value },
                              }))
                            }
                          />
                          <div className="mt-0.5 flex justify-end gap-1">
                            <button
                              className="text-[9px] font-semibold text-emerald-700 hover:underline"
                              onClick={() =>
                                setEntries((current) => ({
                                  ...current,
                                  [row.employee.id]: { ...(current[row.employee.id] ?? blankInput()), paid: '0' },
                                }))
                              }
                            >
                              unpaid
                            </button>
                            <span className="text-[9px] text-stone-300">·</span>
                            <button
                              className="text-[9px] font-semibold text-emerald-700 hover:underline"
                              onClick={() =>
                                setEntries((current) => ({
                                  ...current,
                                  [row.employee.id]: { ...(current[row.employee.id] ?? blankInput()), paid: null },
                                }))
                              }
                            >
                              full
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className={clsx('border-b border-stone-100 px-2 py-2 text-right tabular-nums font-semibold', row.closingPaise ? 'text-rose-600' : 'text-stone-400')}>
                        {formatMoney(row.closingPaise)}
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={row.included}
                          onChange={(event) =>
                            setEntries((current) => ({
                              ...current,
                              [row.employee.id]: { ...(current[row.employee.id] ?? blankInput()), included: event.target.checked },
                            }))
                          }
                          className="h-4 w-4 accent-emerald-700"
                          aria-label={`Include ${row.employee.name}`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky left-0 bottom-0 z-20 border-t border-stone-200 bg-stone-50 px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-stone-500">
                    Totals
                  </td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-2 py-3 text-right text-xs font-semibold tabular-nums text-stone-700">{formatMoney(totals.opening)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-2 py-3 text-right text-xs font-semibold tabular-nums text-stone-700">{formatMoney(totals.earned)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-2 py-3 text-right text-xs font-semibold tabular-nums text-stone-700">{formatMoney(totals.adjustment)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-3 py-3" />
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-amber-50 px-2 py-3 text-right text-xs font-bold tabular-nums text-amber-800">{formatMoney(totals.recovery)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-2 py-3 text-right text-xs font-bold tabular-nums text-stone-900">{formatMoney(totals.due)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-emerald-50 px-2 py-3 text-right text-xs font-bold tabular-nums text-emerald-800">{formatMoney(totals.paid)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-2 py-3 text-right text-xs font-bold tabular-nums text-rose-700">{formatMoney(totals.closing)}</td>
                  <td className="sticky bottom-0 z-10 border-t border-stone-200 bg-stone-50 px-2 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 text-[11px] leading-5 text-stone-500">
        Salary rule: opening balance + this cycle’s earned salary + adjustments − upad recovery − paid now = carry forward. A blank paid field defaults to the full remaining due.
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-stone-800">Payout history</div>
            <div className="text-[11px] text-stone-500">Only the latest payout can be undone.</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('reports')}>
            All reports <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        {!runsQuery.data?.length ? (
          <div className="px-4 py-8 text-center text-sm text-stone-500">No payouts closed yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-stone-50 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="px-4 py-2.5">Payout</th>
                  <th className="px-4 py-2.5">Cycle</th>
                  <th className="px-4 py-2.5 text-center">Staff</th>
                  <th className="px-4 py-2.5 text-right">Due</th>
                  <th className="px-4 py-2.5 text-right">Paid</th>
                  <th className="px-4 py-2.5 text-right">Recovery</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runsQuery.data.map((run) => (
                  <tr key={run.id} className="border-t border-stone-100 hover:bg-stone-50/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-stone-800">{formatDateLong(run.payout_date)}</div>
                      <div className="text-[10px] text-stone-400">{run.status === 'closed' ? 'Closed' : run.status}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500">{formatDateRange(run.cycle_start, run.payout_date)}</td>
                    <td className="px-4 py-3 text-center text-stone-600">{run.employee_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-stone-700">{formatMoney(run.total_due_paise)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-800">{formatMoney(run.total_paid_paise)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-700">{formatMoney(run.total_upad_recovery_paise)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetailRun(run)}>
                          View
                        </Button>
                        {latestRun?.id === run.id ? (
                          <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" onClick={() => setUndoRun(run)}>
                            <Undo2 className="h-3.5 w-3.5" /> Undo
                          </Button>
                        ) : (
                          <span className="inline-flex items-center px-2 text-[10px] text-stone-300">locked</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Close this payout?"
        description="This saves a salary statement for every included employee and records payments and upad recovery."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={createMutation.isPending}>
              Keep editing
            </Button>
            <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
              <CheckCircle2 className="h-4 w-4" /> Save {includedRows.length} statements
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Cycle</span>
              <span className="font-semibold text-stone-800">{formatDateRange(cycleStart, payoutDate)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-stone-500">Included employees</span>
              <span className="font-semibold text-stone-800">{includedRows.length}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-stone-200 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Total due</div>
              <div className="mt-1 text-lg font-bold text-stone-900">{formatMoney(totals.due)}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Upad recovery</div>
              <div className="mt-1 text-lg font-bold text-amber-800">{formatMoney(totals.recovery)}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Paying now</div>
              <div className="mt-1 text-lg font-bold text-emerald-800">{formatMoney(totals.paid)}</div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">Carry forward</div>
              <div className="mt-1 text-lg font-bold text-rose-800">{formatMoney(totals.closing)}</div>
            </div>
          </div>
          <Field label="Payout note" hint="Optional — saved with this payout.">
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. paid in cash, partial due to..." />
          </Field>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>After closing, the next cycle starts the day after this payout date. The latest payout can be undone from history.</span>
            </div>
          </div>
        </div>
      </Modal>

      {detailRun && (
        <RunDetailModal
          run={detailRun}
          employees={payrollQuery.data?.employees ?? []}
          statements={(statementsQuery.data ?? []).filter((statement) => statement.payout_run === detailRun.id)}
          onClose={() => setDetailRun(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(undoRun)}
        onClose={() => setUndoRun(null)}
        onConfirm={() => undoRun && undoMutation.mutate(undoRun)}
        title="Undo latest payout?"
        message={`This permanently removes the ${undoRun ? formatDateLong(undoRun.payout_date) : ''} payout, all its statements, recorded payments, and upad recovery entries. Attendance is not affected.`}
        confirmLabel="Undo payout"
        loading={undoMutation.isPending}
      />
    </div>
  )
}

function RunDetailModal({
  run,
  employees,
  statements,
  onClose,
}: {
  run: PayoutRun
  employees: import('../lib/types').Employee[]
  statements: Statement[]
  onClose: () => void
}) {
  const nameFor = (id: string) => employees.find((employee) => employee.id === id)?.name ?? id
  return (
    <Modal
      open
      onClose={onClose}
      title={`Payout · ${formatDateLong(run.payout_date)}`}
      description={`Cycle ${formatDateRange(run.cycle_start, run.payout_date)}`}
      size="xl"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="table-scroll">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-stone-50 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500">
            <tr>
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2 text-right">Opening</th>
              <th className="px-3 py-2 text-right">Earned</th>
              <th className="px-3 py-2 text-right">Recovery</th>
              <th className="px-3 py-2 text-right">Due</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Carry</th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <tr key={statement.id} className="border-t border-stone-100">
                <td className="px-3 py-2 font-medium text-stone-800">{nameFor(statement.employee)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(statement.opening_paise)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(statement.earned_paise)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700">{formatMoney(statement.upad_recovery_paise)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatMoney(statement.total_due_paise)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-800">{formatMoney(statement.paid_paise)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-600">{formatMoney(statement.closing_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
