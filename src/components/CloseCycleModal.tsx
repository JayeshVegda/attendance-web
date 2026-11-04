import React from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { Modal, Button } from './ui'
import { formatDateShort } from '../lib/dates'
import { formatMoney } from '../lib/money'

export type UndoneWorkerSummary = {
  id: string
  name: string
  fullDuePaise: number
}

export function CloseCycleModal({
  open,
  onClose,
  cycleStart,
  latestPaidDate,
  nextCycleStart,
  doneCount,
  undoneWorkers = [],
  totalPaidPaise,
  totalDeductPaise,
  isClosing = false,
  onConfirmClose,
}: {
  open: boolean
  onClose: () => void
  cycleStart: string
  latestPaidDate: string
  nextCycleStart: string
  doneCount: number
  undoneWorkers: UndoneWorkerSummary[]
  totalPaidPaise: number
  totalDeductPaise: number
  isClosing?: boolean
  onConfirmClose: () => void
}) {
  const hasUndone = undoneWorkers.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Close Attendance Cycle"
      description={`Cycle: ${formatDateShort(cycleStart)} – ${formatDateShort(latestPaidDate)}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isClosing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirmClose}
            disabled={isClosing || (doneCount === 0 && !hasUndone)}
            className="bg-emerald-700 hover:bg-emerald-800 font-bold"
          >
            {isClosing ? 'Closing Cycle...' : 'Confirm & Close Cycle'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Cycle Overview Stats */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-stone-500 font-medium">Workers Paid (Done)</span>
            <div className="text-lg font-black text-emerald-700 mt-0.5">{doneCount}</div>
            <div className="text-[11px] text-stone-500 mt-1">Total Paid: {formatMoney(totalPaidPaise)}</div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-stone-500 font-medium">Next Cycle Starts On</span>
            <div className="text-lg font-black text-stone-900 mt-0.5">{formatDateShort(nextCycleStart)}</div>
            <div className="text-[11px] text-stone-500 mt-1">Day after latest paid date ({formatDateShort(latestPaidDate)})</div>
          </div>
        </div>

        {/* Warning if any rows are undone */}
        {hasUndone && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
              <div>
                <strong className="font-bold text-amber-950 block">
                  {undoneWorkers.length} Worker{undoneWorkers.length > 1 ? 's' : ''} Not Marked Paid
                </strong>
                <p className="text-amber-900 mt-0.5">
                  Their full salary due will cleanly carry forward to the next cycle. Any typed draft deductions or advances will be discarded.
                </p>
                <div className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-white/80 p-2 border border-amber-200 space-y-1">
                  {undoneWorkers.map((w) => (
                    <div key={w.id} className="flex justify-between items-center text-[11px] text-stone-800">
                      <span className="font-semibold">{w.name}</span>
                      <span className="font-bold tabular-nums text-amber-900">Carry: {formatMoney(w.fullDuePaise)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
