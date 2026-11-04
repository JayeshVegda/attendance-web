import React, { useMemo } from 'react'
import { X, HandCoins } from 'lucide-react'
import { Modal, Button } from './ui'
import { formatMoney } from '../lib/money'
import { formatDateShort } from '../lib/dates'
import { getWorkerUpadLedger, type UpadRow } from '../lib/engine'
import type { Employee, UpadEntry } from '../lib/types'

export function UpadHistoryModal({
  open,
  onClose,
  employee,
  upadEntries = [],
}: {
  open: boolean
  onClose: () => void
  employee: Employee | null
  upadEntries: UpadEntry[]
}) {
  if (!employee) return null

  const workerEntries = useMemo(
    () => upadEntries.filter((u) => u.employee === employee.id && !u.voided),
    [upadEntries, employee.id],
  )

  const ledger = useMemo(() => {
    const rows: UpadRow[] = workerEntries.map((u) => ({
      id: u.id,
      employee: u.employee,
      date: u.date.slice(0, 10),
      kind: u.kind,
      amount_paise: u.amount_paise,
      note: u.note,
      voided: u.voided,
    }))
    return getWorkerUpadLedger(rows, employee.opening_upad_paise ?? 0)
  }, [workerEntries, employee.opening_upad_paise])

  const currentBalance = ledger.length > 0 ? ledger[ledger.length - 1].balance_paise : (employee.opening_upad_paise ?? 0)

  function badgeForKind(kind: string) {
    switch (kind) {
      case 'given':
        return <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 uppercase">Given (+)</span>
      case 'recovery':
        return <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-900 uppercase">Deducted (−)</span>
      case 'returned':
        return <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-900 uppercase">Returned (−)</span>
      case 'writeoff':
        return <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-900 uppercase">Written Off (−)</span>
      default:
        return <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-700 uppercase">{kind}</span>
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Upad History: ${employee.name}`}
      description="Dated advance, recovery, return and write-off ledger"
    >
      <div className="space-y-4">
        {/* Balance Card */}
        <div className="flex items-center justify-between rounded-xl bg-amber-50/80 border border-amber-200/80 p-3.5">
          <span className="text-xs font-semibold text-amber-900">Current Outstanding Upad</span>
          <span className="text-xl font-black text-amber-950 tabular-nums">{formatMoney(currentBalance)}</span>
        </div>

        {/* Ledger Table */}
        <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-stone-200">
          <table className="w-full text-xs">
            <thead className="bg-stone-50 text-[10px] uppercase font-bold text-stone-500 border-b border-stone-200 sticky top-0">
              <tr>
                <th className="px-3.5 py-2.5 text-left">Date</th>
                <th className="px-3.5 py-2.5 text-left">Transaction</th>
                <th className="px-3.5 py-2.5 text-right">Amount</th>
                <th className="px-3.5 py-2.5 text-right">Running Balance</th>
                <th className="px-3.5 py-2.5 text-left">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-stone-400">
                    No upad entries recorded for this worker.
                  </td>
                </tr>
              ) : (
                ledger.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-stone-50/80 transition-colors">
                    <td className="px-3.5 py-2.5 font-medium text-stone-700 whitespace-nowrap">
                      {item.date ? formatDateShort(item.date) : 'Opening'}
                    </td>
                    <td className="px-3.5 py-2.5">{badgeForKind(item.kind)}</td>
                    <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-stone-900">
                      {formatMoney(item.amount_paise)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-black tabular-nums text-amber-900">
                      {formatMoney(item.balance_paise)}
                    </td>
                    <td className="px-3.5 py-2.5 text-stone-500 truncate max-w-[12rem]">
                      {item.note || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}
