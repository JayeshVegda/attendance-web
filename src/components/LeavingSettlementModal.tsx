import React, { useState, useMemo } from 'react'
import { AlertTriangle, UserMinus } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal, Button, Field, Input } from './ui'
import { formatMoney, rupeesToPaise, paiseToInput } from '../lib/money'
import { todayKey } from '../lib/dates'
import { createUpadEntry, setEmployeeActive, createSalaryWriteoff } from '../lib/api'
import { useToast } from './Toast'
import type { Employee } from '../lib/types'

export type LeavingSettlementData = {
  employee: Employee
  grossSalaryDuePaise: number
  upadBalancePaise: number
  cycleStart?: string
  carryPaise?: number
  earnedPaise?: number
  adjustmentPaise?: number
}

export function LeavingSettlementModal({
  open,
  onClose,
  data,
}: {
  open: boolean
  onClose: () => void
  data: LeavingSettlementData | null
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [actualPaidInput, setActualPaidInput] = useState<string>('')
  const [date, setDate] = useState<string>(todayKey())
  const [reason, setReason] = useState<string>('Left company')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Step 1: Offset upad against salary
  // grossDue = carry + earned + adjustment
  // offsetUpad = min(upadBalance, grossDue)
  // salaryRemainder = grossDue - offsetUpad
  // upadRemainder = upadBalance - offsetUpad
  //
  // Step 2: User enters actual salary cash paid (0 <= paid <= salaryRemainder)
  // Step 3:
  // salaryWriteoff = salaryRemainder - actualPaid
  // upadWriteoff = upadRemainder
  const calculations = useMemo(() => {
    if (!data) return null
    const grossDue = Math.max(0, data.grossSalaryDuePaise)
    const upad = Math.max(0, data.upadBalancePaise)

    const offsetUpad = Math.min(upad, grossDue)
    const salaryRemainder = Math.max(0, grossDue - offsetUpad)
    const upadRemainder = Math.max(0, upad - offsetUpad)

    const parsedPaid = actualPaidInput.trim() === '' ? salaryRemainder : rupeesToPaise(actualPaidInput)
    const clampedPaid = Math.max(0, Math.min(salaryRemainder, parsedPaid))

    const salaryWriteoffPaise = Math.max(0, salaryRemainder - clampedPaid)
    const upadWriteoffPaise = upadRemainder

    return {
      grossDue,
      upad,
      offsetUpad,
      salaryRemainder,
      upadRemainder,
      actualPaidPaise: clampedPaid,
      salaryWriteoffPaise,
      upadWriteoffPaise,
    }
  }, [data, actualPaidInput])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!data || !calculations) return
      setErrorMsg(null)

      const formattedDate = date.includes(' ') ? date : `${date} 12:00:00.000Z`

      // 1. Post offset upad recovery
      if (calculations.offsetUpad > 0) {
        await createUpadEntry({
          employeeId: data.employee.id,
          date: formattedDate,
          amountPaise: calculations.offsetUpad,
          kind: 'recovery',
          category: 'regular',
          note: `Leaving settlement recovery: offset against salary`,
        })
      }

      // 2. Write off unpaid salary remainder (separate entry)
      if (calculations.salaryWriteoffPaise > 0) {
        await createSalaryWriteoff({
          worker: data.employee.id,
          date: formattedDate,
          amount_paise: calculations.salaryWriteoffPaise,
          note: `Leaving settlement salary write-off: ${reason}`,
        })
      }

      // 3. Write off remaining upad (separate entry)
      if (calculations.upadWriteoffPaise > 0) {
        await createUpadEntry({
          employeeId: data.employee.id,
          date: formattedDate,
          amountPaise: calculations.upadWriteoffPaise,
          kind: 'writeoff',
          category: 'regular',
          note: `Leaving settlement upad write-off: ${reason}`,
        })
      }

      // 4. Mark worker inactive
      await setEmployeeActive(data.employee.id, false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      toast(`Final leaving settlement completed for ${data?.employee.name}`, 'success')
      onClose()
    },
    onError: (err: Error) => {
      setErrorMsg(err.message || 'Settlement failed')
    },
  })

  if (!data || !calculations) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Leaving-Worker Settlement: ${data.employee.name}`}
      description="Offset upad, specify cash paid, and log separate write-offs"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-rose-700 hover:bg-rose-800 font-bold"
          >
            {mutation.isPending ? 'Finalizing...' : 'Confirm Leaving Settlement'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 font-medium">
            {errorMsg}
          </div>
        )}

        {/* 3-Step Breakdown card */}
        <div className="space-y-3">
          {/* Step 1: Upad Offset */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3.5 text-xs space-y-1.5">
            <div className="font-bold text-stone-900 uppercase text-[11px] tracking-wide">
              Step 1: Offset Upad Against Salary
            </div>
            <div className="flex justify-between text-stone-600">
              <span>Gross Salary Due (Carry + Wages + Adj):</span>
              <strong className="text-stone-900">{formatMoney(calculations.grossDue)}</strong>
            </div>
            <div className="flex justify-between text-stone-600">
              <span>Outstanding Upad Balance:</span>
              <strong className="text-amber-900">{formatMoney(calculations.upad)}</strong>
            </div>
            <div className="flex justify-between border-t border-stone-200/80 pt-1 text-emerald-800 font-bold">
              <span>Upad Offset (Recovered from salary):</span>
              <span>−{formatMoney(calculations.offsetUpad)}</span>
            </div>
            <div className="flex justify-between text-stone-700 font-semibold">
              <span>Remaining Salary After Offset:</span>
              <span>{formatMoney(calculations.salaryRemainder)}</span>
            </div>
          </div>

          {/* Step 2: Actual Cash Paid */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2 text-xs">
            <div className="font-bold text-emerald-950 uppercase text-[11px] tracking-wide">
              Step 2: Enter Actual Salary Cash Paid Out
            </div>
            <Field label="Cash Paid to Worker (₹)" hint={`Max payable: ${formatMoney(calculations.salaryRemainder)}`}>
              <Input
                type="number"
                min="0"
                max={paiseToInput(calculations.salaryRemainder)}
                step="any"
                placeholder={paiseToInput(calculations.salaryRemainder)}
                value={actualPaidInput}
                onChange={(e) => setActualPaidInput(e.target.value)}
              />
            </Field>
          </div>

          {/* Step 3: Separate Write-offs Summary */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-xs space-y-1.5">
            <div className="font-bold text-rose-950 uppercase text-[11px] tracking-wide">
              Step 3: Separate Write-Offs (Never Combined)
            </div>
            <div className="flex justify-between text-rose-900">
              <span>Unpaid Salary Remainder Write-off:</span>
              <strong className="font-black tabular-nums">{formatMoney(calculations.salaryWriteoffPaise)}</strong>
            </div>
            <div className="flex justify-between text-rose-900">
              <span>Remaining Upad Write-off:</span>
              <strong className="font-black tabular-nums">{formatMoney(calculations.upadWriteoffPaise)}</strong>
            </div>
            <p className="text-[11px] text-rose-700/90 pt-1 border-t border-rose-200/70">
              Separate ledger entries will be created for each write-off, and the worker will be marked inactive.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Field label="Settlement Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Settlement Reason">
              <Input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  )
}
