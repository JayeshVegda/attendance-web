import { useMemo, useState } from 'react'
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
import { addDays, formatDateShort, formatDateLong, todayKey } from '../lib/dates'
import { formatMoney, parseMoneyInput, paiseToInput } from '../lib/money'
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Spinner, Stat } from '../components/ui'
import { useToast } from '../components/Toast'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { pb } from '../lib/pb'
import type { Attendance } from '../lib/types'

type ScreenInputs = {
  chalu_recovery_paise?: number
  moto_recovery_paise?: number
  new_upad_given_paise?: number
  salary_paid_paise?: number
}

const STATUS_LETTER: Record<string, string> = { full: 'P', half: 'H', absent: 'A' }

export default function PayoutScreen({ onNavigate }: { onNavigate: (path: string) => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [payoutDate, setPayoutDate] = useState(todayKey())
  const [includePayoutDay, setIncludePayoutDay] = useState(true)
  const [inputs, setInputs] = useState<Record<string, ScreenInputs>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)

  const cutoff = includePayoutDay ? payoutDate : addDays(payoutDate, -1)

  const contextsQuery = useQuery({ queryKey: ['payout-contexts'], queryFn: loadWorkerContexts })
  const attendanceQuery = useQuery({
    queryKey: ['payout-attendance'],
    queryFn: () => pb.collection('attendance').getFullList<Attendance>({ sort: 'date' }),
  })

  const preview = useMemo(() => {
    if (!contextsQuery.data || !attendanceQuery.data) return []
    return buildPreview(contextsQuery.data, cutoff, inputs, attendanceQuery.data)
  }, [contextsQuery.data, attendanceQuery.data, cutoff, inputs])

  const included = preview.filter((r) => r.included)
  const cleanRows = included.filter((r) => r.computation)
  const errorRows = included.filter((r) => !r.computation)

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
                new_upad_given_paise: user.new_upad_given_paise ?? 0,
                salary_paid_paise: user.salary_paid_paise ?? 0,
              },
            },
          ]
        }),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries()
      toast('Payout saved and statements issued.')
      setInputs({})
      setConfirmOpen(false)
      onNavigate(`reports/${res.runId}`)
    },
    onError: () => {
      setConfirmOpen(false)
      toast('Payout failed to save. Nothing was changed.', 'error')
    },
  })

  if (contextsQuery.isLoading || attendanceQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }
  if (contextsQuery.isError || attendanceQuery.isError) {
    return (
      <EmptyState
        icon={<TriangleAlert />}
        title="Could not load payroll data"
        description="Check that PocketBase is running and refresh."
      />
    )
  }

  const setWorkerInput = (empId: string, patch: ScreenInputs) =>
    setInputs((prev) => ({ ...prev, [empId]: { ...prev[empId], ...patch } }))

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Payroll"
        title="Issue Payout"
        description="Close each worker's books up to the cutoff date. The payout day itself can be included or left for next time."
      />

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Payout date" className="w-44">
            <Input type="date" value={payoutDate} onChange={(e) => setPayoutDate(e.target.value)} />
          </Field>
          <label className="flex h-9.5 items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-600"
              checked={includePayoutDay}
              onChange={(e) => setIncludePayoutDay(e.target.checked)}
            />
            Count the payout day
          </label>
          <div className="text-sm text-stone-500">
            Cutoff: <Badge tone="green">{formatDateShort(cutoff)}</Badge>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total due" value={formatMoney(totals.due)} />
        <Stat label="Upad recovery" value={formatMoney(totals.recovery)} />
        <Stat label="Cash in hand" value={formatMoney(totals.cashInHand)} hint="payable + new upad given" />
        <Stat label="Workers" value={String(cleanRows.length)} hint={errorRows.length ? `${errorRows.length} blocked` : undefined} />
      </div>

      {cleanRows.length === 0 && errorRows.length === 0 && (
        <EmptyState title="Nothing to pay out" description="No unsettled work up to this cutoff for any worker." />
      )}

      {errorRows.map((r) => (
        <ErrorRow key={r.context.employee.id} row={r} />
      ))}

      <div className="space-y-3">
        {cleanRows.map((r) => (
          <WorkerRow
            key={r.context.employee.id}
            row={r}
            inputs={inputs[r.context.employee.id] ?? {}}
            onInput={(patch) => setWorkerInput(r.context.employee.id, patch)}
          />
        ))}
      </div>

      {cleanRows.length > 0 && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-stone-600">
              <div>
                Payable to workers: <span className="font-bold text-stone-900">{formatMoney(totals.payable)}</span>
              </div>
              <div>
                Cash in hand after: <span className="font-bold text-stone-900">{formatMoney(totals.cashInHand)}</span>
              </div>
            </div>
            <Button size="lg" disabled={errorRows.length > 0} onClick={() => setConfirmOpen(true)}>
              Issue Payout ({cleanRows.length})
            </Button>
          </div>
          {errorRows.length > 0 && <div className="mt-3 text-sm font-medium text-rose-700">Resolve blocked workers above before saving.</div>}
        </Card>
      )}

      {confirmOpen && (
        <ConfirmPayout
          cutoff={cutoff}
          payoutDate={payoutDate}
          workers={cleanRows.length}
          payable={totals.payable}
          cashInHand={totals.cashInHand}
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
  loading,
  onClose,
  onConfirm,
}: {
  cutoff: string
  payoutDate: string
  workers: number
  payable: number
  cashInHand: number
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-stone-900">Confirm payout</h3>
        <p className="mt-1 text-sm text-stone-600">
          Payout day {formatDateLong(payoutDate)}, cutoff {formatDateLong(cutoff)}.
        </p>
        <div className="mt-4 space-y-1 text-sm text-stone-700">
          <div>Workers: {workers}</div>
          <div>Amount payable: {formatMoney(payable)}</div>
          <div>Cash in hand after: {formatMoney(cashInHand)}</div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={onConfirm}>
            Confirm & Issue
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ErrorRow({ row }: { row: PreviewRow }) {
  const e = row.context.employee
  return (
    <Card className="border-rose-300 bg-rose-50/60 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={e.name} />
        <div className="flex-1">
          <div className="font-bold text-stone-900">{e.name}</div>
          <div className="text-sm text-rose-700">Blocked — resolve to include</div>
        </div>
        <CircleAlert className="h-5 w-5 text-rose-600" />
      </div>
      <ul className="mt-2 list-inside list-disc text-sm text-rose-700">
        {row.errors.map((err, i) => (
          <li key={i}>{formatEngineError(err)}</li>
        ))}
      </ul>
    </Card>
  )
}

function WorkerRow({
  row,
  inputs,
  onInput,
}: {
  row: PreviewRow
  inputs: ScreenInputs
  onInput: (patch: ScreenInputs) => void
}) {
  const ctx = row.context
  const c = row.computation!
  const from = addDays(ctx.paidUpToDate || ctx.worker.opening_date, 1)
  const window = `${formatDateShort(from)} → ${formatDateShort(cutoff(ctx))}`

  function cutoff(ctx: WorkerContext) {
    return c.cutoff
  }

  const deductionLeftover = row.warnings.find((w) => w.code === 'deduction_exceeds_due')?.leftover_paise ?? 0
  const lateCount = c.late_entry_count

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={ctx.employee.name} />
        <div className="flex-1">
          <div className="font-bold text-stone-900">{ctx.employee.name}</div>
          <div className="text-xs text-stone-500">
            Past payout: {formatDateShort(ctx.paidUpToDate || ctx.worker.opening_date)} · carry in {formatMoney(c.carry_paise)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-stone-500">Total due</div>
          <div className="font-bold text-stone-900">{formatMoney(c.total_due_paise)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs font-semibold text-stone-500">
        {window} ({c.day_breakdown.length} days)
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {c.day_breakdown.map((d) => (
          <span
            key={d.date}
            title={`${formatDateLong(d.date)} · rate ${formatMoney(d.rate_paise)} · base ${formatMoney(d.base_paise)}, OT ${formatMoney(d.ot_paise)}`}
            className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] text-stone-600"
          >
            {formatDateShort(d.date).slice(0, 6)} {STATUS_LETTER[d.status] ?? d.status}
            {d.ot_paise > 0 && <span className="font-semibold text-emerald-700"> +{formatMoney(d.ot_paise)}</span>}
            {d.is_late_entry && <span className="text-amber-600">*</span>}
          </span>
        ))}
      </div>

      {row.unmarkedDates.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Marked P/H/A but unexplained: {row.unmarkedDates.map((d) => formatDateShort(d)).join(', ')} — add notes on the roll call before paying out.
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
        <T label="Carry in" value={formatMoney(c.carry_paise)} />
        <T label="Earned" value={formatMoney(c.earned_paise + c.adjustments_paise)} hint={c.ot_paise > 0 ? `incl OT ${formatMoney(c.ot_paise)}` : undefined} />
        <T label="Salary paid" value={formatMoney(c.salary_paid_paise)} tone={c.salary_paid_paise > 0 ? 'amber' : 'default'} />
        <T label="Upad recovery" value={formatMoney(c.chalu_recovery_paise + c.moto_recovery_paise)} />
        <T label="Payable" value={formatMoney(c.payable_paise)} strong />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {(
          [
            ['chalu', 'Chalu Upad', c.chalu_balance_paise, c.chalu_after_paise, 'chalu_recovery_paise'],
            ['moto', 'Main Upad', c.moto_balance_paise, c.moto_after_paise, 'moto_recovery_paise'],
          ] as const
        ).map(([, label, opening, after, key]) => (
          <div key={key} className="rounded-lg border border-stone-200 p-3">
            <div className="mb-2 font-bold text-stone-800">{label}</div>
            <div className="mb-2 flex flex-wrap gap-x-3 text-xs text-stone-600">
              <span>
                Opening bal: <span className="font-semibold">{formatMoney(opening)}</span>
              </span>
              <span>
                After actions: <span className={after < 0 ? 'font-bold text-rose-700' : 'font-bold text-stone-800'}>{formatMoney(after)}</span>
              </span>
            </div>
            <Field label="Recover from this month" hint="amount you take back today">
              <Input
                inputMode="decimal"
                placeholder="0"
                value={inputs[key] === undefined ? '' : paiseToInput(inputs[key] ?? 0)}
                onChange={(e) => onInput({ [key]: parseMoneyInput(e.target.value) } as ScreenInputs)}
              />
            </Field>
          </div>
        ))}
        <div className="rounded-lg border border-stone-200 p-3">
          <div className="mb-2 font-bold text-stone-800">This payout</div>
          <div className="space-y-2">
            <Field label="Salary paid now">
              <Input
                inputMode="decimal"
                placeholder="0"
                value={inputs.salary_paid_paise === undefined ? '' : paiseToInput(inputs.salary_paid_paise ?? 0)}
                onChange={(e) => onInput({ salary_paid_paise: parseMoneyInput(e.target.value) })}
              />
            </Field>
            <Field label="New upad given" hint="landed in Chalu">
              <Input
                inputMode="decimal"
                placeholder="0"
                value={inputs.new_upad_given_paise === undefined ? '' : paiseToInput(inputs.new_upad_given_paise ?? 0)}
                onChange={(e) => onInput({ new_upad_given_paise: parseMoneyInput(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-3 text-sm">
        <div className="flex flex-col gap-0.5">
          {lateCount > 0 && (
            <span className="text-xs font-medium text-amber-700">
              {lateCount} old unsettled day{lateCount > 1 ? 's' : ''} before your past payout ({formatDateShort(ctx.paidUpToDate)}) pulled in — marked * above.
            </span>
          )}
          {deductionLeftover > 0 && (
            <span className="text-xs font-medium text-amber-700">
              Deduction overflow {formatMoney(deductionLeftover)} will be saved as a write-off if the engine allowed it; check the total if it refused.
            </span>
          )}
        </div>
        <div>
          Cash in hand after payout: <span className="font-bold text-emerald-800">{formatMoney(c.cash_to_hand_over_paise)}</span>
          <span className="ml-2 text-xs text-stone-500">(carry out {formatMoney(c.closing_carry_paise)})</span>
        </div>
      </div>
    </Card>
  )
}

function T({ label, value, hint, strong, tone }: { label: string; value: string; hint?: string; strong?: boolean; tone?: 'amber' | 'default' }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`font-semibold ${strong ? 'text-stone-900' : tone === 'amber' ? 'text-amber-700' : 'text-stone-800'}`}>{value}</div>
      {hint && <div className="text-[11px] text-stone-500">{hint}</div>}
    </div>
  )
}
