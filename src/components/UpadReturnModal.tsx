import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Banknote } from 'lucide-react'
import { Modal, Button, Field, Input } from './ui'
import { createUpadEntry } from '../lib/api'
import { todayKey } from '../lib/dates'
import { formatMoney, rupeesToPaise } from '../lib/money'
import { useToast } from './Toast'
import type { Employee } from '../lib/types'

export function UpadReturnModal({
  open,
  onClose,
  employee,
  currentUpadPaise = 0,
}: {
  open: boolean
  onClose: () => void
  employee: Employee | null
  currentUpadPaise: number
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [amountInput, setAmountInput] = useState('')
  const [date, setDate] = useState(() => todayKey())
  const [note, setNote] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      if (!employee) return
      setErrorMsg(null)
      const amtPaise = rupeesToPaise(Number.parseFloat(amountInput) || 0)
      if (amtPaise <= 0) {
        throw new Error('Please enter a valid amount greater than ₹0')
      }
      if (amtPaise > currentUpadPaise) {
        throw new Error(`Amount cannot exceed the current balance of ${formatMoney(currentUpadPaise)}`)
      }

      await createUpadEntry({
        employeeId: employee.id,
        date: date.includes(' ') ? date : `${date} 12:00:00.000Z`,
        amountPaise: amtPaise,
        kind: 'returned',
        category: 'regular',
        note: note.trim() || 'Worker cash return',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      toast(`Recorded cash return of ₹${amountInput} for ${employee?.name}`, 'success')
      onClose()
      setAmountInput('')
      setNote('')
    },
    onError: (err: Error) => {
      setErrorMsg(err.message || 'Failed to record cash return')
    },
  })

  if (!employee) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Record Upad Returned"
      description={`Cash handed back by ${employee.name}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amountInput}
            className="bg-sky-700 hover:bg-sky-800 font-bold"
          >
            {mutation.isPending ? 'Saving...' : 'Save Cash Return'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-sky-50/80 border border-sky-200/70 p-3 flex justify-between items-center text-xs">
          <span className="text-sky-900 font-semibold">Current Upad Balance</span>
          <span className="text-base font-bold text-sky-950 tabular-nums">{formatMoney(currentUpadPaise)}</span>
        </div>

        {errorMsg && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 font-medium">
            {errorMsg}
          </div>
        )}

        <div className="space-y-3 text-xs">
          <Field label="Amount Returned (₹)" hint="Cash received from the worker">
            <Input
              type="number"
              min="1"
              step="any"
              placeholder="0"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              autoFocus
            />
          </Field>

          <Field label="Date Received">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>

          <Field label="Note (Optional)">
            <Input
              type="text"
              placeholder="e.g. Returned extra festival cash"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
