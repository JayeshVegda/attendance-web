import React from 'react'
import { Printer, X } from 'lucide-react'
import { Modal, Button } from './ui'
import { formatMoney, formatHours } from '../lib/money'
import { formatDateLong, formatDateShort } from '../lib/dates'
import type { Employee, UpadEntry } from '../lib/types'

export type StatementData = {
  employee: Employee
  cycleStart: string
  payoutDate: string
  daysWorked: number
  otMinutes: number
  openingCarryPaise: number
  earnedPaise: number
  adjustmentPaise: number
  adjustmentNote?: string
  deductPaise: number
  giveUpadPaise: number
  toPayPaise: number
  paidPaise: number
  newCarryPaise: number
  upadBalancePaise: number
  businessName?: string
}

export function StatementModal({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: StatementData | null
}) {
  if (!data) return null

  function handlePrint() {
    window.print()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      printable={true}
      title={`Salary Statement: ${data.employee.name}`}
      description="Official statement voucher"
      footer={
        <div className="flex items-center justify-between w-full no-print">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" onClick={handlePrint} className="flex items-center gap-1.5 font-bold bg-emerald-700 hover:bg-emerald-800">
            <Printer className="h-4 w-4" />
            Print Statement
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Printable Area */}
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-xs print:m-0 print:border-none print:p-0 print:shadow-none">
          <div className="text-center border-b border-stone-200 pb-4">
            <h1 className="text-xl font-black text-stone-900">{data.businessName || 'હાજરી પગાર'}</h1>
            <p className="text-xs uppercase tracking-wider text-stone-500 font-semibold mt-0.5">Salary & Wage Statement</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-stone-500">Worker: </span>
              <strong className="text-stone-900 font-bold text-sm">{data.employee.name}</strong>
              <div className="text-stone-500 mt-0.5">Worker #{data.employee.employee_no || data.employee.id.slice(0, 4)}</div>
            </div>
            <div className="text-right">
              <span className="text-stone-500">Cycle Period: </span>
              <strong className="text-stone-900 font-semibold">{formatDateShort(data.cycleStart)} – {formatDateShort(data.payoutDate)}</strong>
              <div className="text-stone-500 mt-0.5">Paid on: {formatDateLong(data.payoutDate)}</div>
            </div>
          </div>

          {/* Metrics summary */}
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-stone-50 p-3 border border-stone-200 text-center text-xs">
            <div>
              <div className="text-stone-500 font-medium">Days Worked</div>
              <div className="text-sm font-bold text-stone-900 mt-0.5">{data.daysWorked} d</div>
            </div>
            <div>
              <div className="text-stone-500 font-medium">Overtime</div>
              <div className="text-sm font-bold text-stone-900 mt-0.5">{data.otMinutes > 0 ? formatHours(data.otMinutes) : '0h'}</div>
            </div>
            <div>
              <div className="text-stone-500 font-medium">Daily Wage Rate</div>
              <div className="text-sm font-bold text-stone-900 mt-0.5">{formatMoney(data.employee.daily_rate_paise)}/d</div>
            </div>
          </div>

          {/* Breakdown table */}
          <div className="mt-5">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-stone-100">
                <tr>
                  <td className="py-2 text-stone-600">Cycle Wages Earned</td>
                  <td className="py-2 text-right font-bold text-stone-900 tabular-nums">{formatMoney(data.earnedPaise)}</td>
                </tr>
                {data.openingCarryPaise !== 0 && (
                  <tr>
                    <td className="py-2 text-stone-600">Prior Carry Forward</td>
                    <td className="py-2 text-right font-bold text-stone-900 tabular-nums">+{formatMoney(data.openingCarryPaise)}</td>
                  </tr>
                )}
                {data.adjustmentPaise !== 0 && (
                  <tr>
                    <td className="py-2 text-stone-600">
                      Adjustment {data.adjustmentNote ? `(${data.adjustmentNote})` : ''}
                    </td>
                    <td className="py-2 text-right font-bold text-stone-900 tabular-nums">
                      {data.adjustmentPaise > 0 ? `+${formatMoney(data.adjustmentPaise)}` : `-${formatMoney(Math.abs(data.adjustmentPaise))}`}
                    </td>
                  </tr>
                )}
                {data.deductPaise > 0 && (
                  <tr>
                    <td className="py-2 text-amber-800 font-medium">Upad Deduction from Salary</td>
                    <td className="py-2 text-right font-bold text-amber-900 tabular-nums">-{formatMoney(data.deductPaise)}</td>
                  </tr>
                )}
                {data.giveUpadPaise > 0 && (
                  <tr>
                    <td className="py-2 text-sky-800 font-medium">New Upad Cash Given</td>
                    <td className="py-2 text-right font-bold text-sky-900 tabular-nums">+{formatMoney(data.giveUpadPaise)}</td>
                  </tr>
                )}
                <tr className="border-t-2 border-stone-200 font-bold bg-stone-50/60">
                  <td className="py-2.5 text-stone-900">Total Net Payable (To Pay)</td>
                  <td className="py-2.5 text-right text-stone-950 text-sm tabular-nums">{formatMoney(data.toPayPaise)}</td>
                </tr>
                <tr className="border-b border-stone-200">
                  <td className="py-2.5 text-emerald-800 font-bold">Salary Cash Paid Out</td>
                  <td className="py-2.5 text-right font-black text-emerald-900 text-sm tabular-nums">{formatMoney(data.paidPaise)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-stone-600">Remaining Carry to Next Cycle</td>
                  <td className="py-2 text-right font-bold text-stone-800 tabular-nums">{formatMoney(data.newCarryPaise)}</td>
                </tr>
                <tr>
                  <td className="py-2 text-stone-600">Remaining Upad Balance</td>
                  <td className="py-2 text-right font-bold text-amber-900 tabular-nums">{formatMoney(data.upadBalancePaise)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Signatures for print */}
          <div className="mt-12 hidden print:grid grid-cols-2 gap-12 pt-6 border-t border-stone-300 text-xs text-stone-600">
            <div className="border-t border-stone-400 pt-2 text-center">
              Worker Signature
            </div>
            <div className="border-t border-stone-400 pt-2 text-center">
              Authorized Signature
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
