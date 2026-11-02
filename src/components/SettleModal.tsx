import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, ShieldCheck, UserCheck } from 'lucide-react'
import clsx from 'clsx'
import { settleUpadBalance, type WorkerBalanceDetail } from '../lib/api'
import { formatMoney, paiseToInput, rupeesToPaise } from '../lib/money'
import { todayKey, formatDateShort } from '../lib/dates'
import { useToast } from './Toast'
import { Button, Field, Input, Modal } from './ui'

export type SettleTarget =
  | {
      mode: 'single'
      workerId: string
      workerName: string
      workerNo: string
      bucket: 'chalu' | 'moto'
      balancePaise: number
    }
  | {
      mode: 'bulk'
      bucket: 'chalu' | 'moto'
      workers: WorkerBalanceDetail[]
      onSuccessAll?: () => void
    }

export function SettleModal({
  target,
  onClose,
}: {
  target: SettleTarget | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  // Single mode state
  const isSingle = target?.mode === 'single'
  const [kind, setKind] = useState<'returned' | 'writeoff'>('returned')
  const [amountInput, setAmountInput] = useState(() =>
    isSingle && target ? paiseToInput(target.balancePaise) : '',
  )
  const [date, setDate] = useState(() => todayKey())
  const [note, setNote] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Bulk mode state: workerId -> kind
  const [bulkKinds, setBulkKinds] = useState<Record<string, 'returned' | 'writeoff'>>({})

  // Reset or initialize on open
  const bucketLabel = target?.bucket === 'chalu' ? 'Chalu Upad' : 'Main Upad'

  const singleMutation = useMutation({
    mutationFn: async () => {
      if (!target || target.mode !== 'single') return
      setErrorMsg(null)
      const amtPaise = rupeesToPaise(Number.parseFloat(amountInput) || 0)
      if (amtPaise <= 0) {
        throw new Error('Please enter a valid amount greater than ₹0')
      }
      if (amtPaise > target.balancePaise) {
        throw new Error(`Amount cannot exceed current outstanding balance of ${formatMoney(target.balancePaise)}`)
      }
      const idempotencyKey = `settle-${target.workerId}-${target.bucket}-${Date.now()}`
      return await settleUpadBalance({
        employeeId: target.workerId,
        bucket: target.bucket,
        kind,
        amountPaise: amtPaise,
        date,
        note: note.trim() || undefined,
        idempotencyKey,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast(
        kind === 'writeoff'
          ? `Balance written off successfully`
          : `Cash repayment recorded successfully`,
      )
      onClose()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Could not settle upad balance'
      setErrorMsg(msg)
      toast(msg, 'error')
    },
  })

  const bulkMutation = useMutation({
    mutationFn: async () => {
      if (!target || target.mode !== 'bulk') return
      setErrorMsg(null)
      for (const w of target.workers) {
        const chosenKind = bulkKinds[w.id] ?? 'returned'
        const idempotencyKey = `bulk-settle-${w.id}-${target.bucket}-${Date.now()}`
        await settleUpadBalance({
          employeeId: w.id,
          bucket: target.bucket,
          kind: chosenKind,
          amountPaise: w.balance_paise,
          date,
          note: chosenKind === 'writeoff' ? 'Bulk write-off' : 'Bulk cash repayment',
          idempotencyKey,
        })
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast(`All ${target?.mode === 'bulk' ? target.workers.length : 0} worker balances settled`)
      if (target?.mode === 'bulk' && target.onSuccessAll) {
        target.onSuccessAll()
      }
      onClose()
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Error settling balances'
      setErrorMsg(msg)
      toast(msg, 'error')
    },
  })

  if (!target) return null

  if (target.mode === 'single') {
    return (
      <Modal
        open={Boolean(target)}
        onClose={onClose}
        title={`Settle ${bucketLabel}`}
        description={`${target.workerName} (#${target.workerNo}) · Current Balance: ${formatMoney(target.balancePaise)}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={singleMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => singleMutation.mutate()}
              loading={singleMutation.isPending}
              disabled={singleMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Confirm Settlement</span>
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* Settle Reason Mode */}
          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              How was this balance cleared?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('returned')}
                className={clsx(
                  'rounded-xl border p-3 text-left transition select-none cursor-pointer',
                  kind === 'returned'
                    ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-600/20 text-emerald-950 font-bold'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300',
                )}
              >
                <div className="text-xs font-black">He paid it back (રોકડા પાછા)</div>
                <div className="text-[11px] text-stone-500 font-normal mt-0.5">
                  Worker repaid cash directly in hand
                </div>
              </button>

              <button
                type="button"
                onClick={() => setKind('writeoff')}
                className={clsx(
                  'rounded-xl border p-3 text-left transition select-none cursor-pointer',
                  kind === 'writeoff'
                    ? 'border-amber-600 bg-amber-50/80 ring-2 ring-amber-600/20 text-amber-950 font-bold'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300',
                )}
              >
                <div className="text-xs font-black">Write off (માંડવાળ)</div>
                <div className="text-[11px] text-stone-500 font-normal mt-0.5">
                  Forgiven / company loss, clear ledger
                </div>
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount to Settle (₹)" hint={`Max: ${formatMoney(target.balancePaise)}`}>
              <Input
                type="number"
                min="1"
                step="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                autoFocus
              />
            </Field>

            <Field label="Settlement Date" hint="Ledger order replayed from this date">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Note / Reference" hint="Optional explanation for accounting">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'writeoff' ? 'e.g. Left job / forgiven' : 'e.g. Paid in cash'}
            />
          </Field>

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-[11px] text-stone-600 leading-relaxed">
            <strong className="text-stone-800">Chronological Safety:</strong> The system verifies that recording this settlement on {formatDateShort(date)} will never cause the worker&apos;s running balance to dip below zero at any point in history. Past frozen salary statements are never modified.
          </div>
        </div>
      </Modal>
    )
  }

  // Bulk Mode
  const totalBulkPaise = target.workers.reduce((sum, w) => sum + w.balance_paise, 0)

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`Settle All Outstanding ${bucketLabel} Balances`}
      description={`Total: ${formatMoney(totalBulkPaise)} across ${target.workers.length} worker(s). Choose settlement type for each worker.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={bulkMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => bulkMutation.mutate()}
            loading={bulkMutation.isPending}
            disabled={bulkMutation.isPending}
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Confirm & Settle All ({target.workers.length})</span>
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        )}

        <div className="flex items-center justify-between border-b border-stone-200 pb-2">
          <span className="text-xs font-bold text-stone-600">Settlement Date:</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-bold text-stone-800"
          />
        </div>

        {/* Worker Table */}
        <div className="max-h-72 overflow-y-auto rounded-xl border border-stone-200 divide-y divide-stone-100">
          {target.workers.map((w) => {
            const currentKind = bulkKinds[w.id] ?? 'returned'
            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-3 p-2.5 hover:bg-stone-50 transition"
              >
                <div>
                  <div className="text-xs font-bold text-stone-900">
                    {w.name} <span className="font-normal text-stone-400">#{w.employee_no}</span>
                    {!w.active && (
                      <span className="ml-1.5 text-[10px] text-stone-400 uppercase font-semibold">
                        (Inactive)
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-black text-amber-700">
                    {formatMoney(w.balance_paise)}
                  </div>
                </div>

                {/* Kind Toggle */}
                <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setBulkKinds((prev) => ({ ...prev, [w.id]: 'returned' }))}
                    className={clsx(
                      'px-2.5 py-1 rounded-md transition select-none cursor-pointer',
                      currentKind === 'returned'
                        ? 'bg-white text-emerald-800 shadow-2xs font-bold'
                        : 'text-stone-600 hover:text-stone-900',
                    )}
                  >
                    Paid back
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkKinds((prev) => ({ ...prev, [w.id]: 'writeoff' }))}
                    className={clsx(
                      'px-2.5 py-1 rounded-md transition select-none cursor-pointer',
                      currentKind === 'writeoff'
                        ? 'bg-white text-amber-800 shadow-2xs font-bold'
                        : 'text-stone-600 hover:text-stone-900',
                    )}
                  >
                    Write off
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-[11px] text-stone-600 leading-relaxed">
          Settling all balances will record individual settlement entries with chronological balance replay verification. After settlement, you will be able to safely turn off this advance bucket.
        </div>
      </div>
    </Modal>
  )
}
