import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HandCoins } from 'lucide-react'
import { createUpadEntry } from '../lib/api'
import { todayKey } from '../lib/dates'
import { formatMoney, parseMoneyInput } from '../lib/money'
import type { Employee, UpadCategory, UpadKind } from '../lib/types'
import { useToast } from './Toast'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'

const KIND_LABEL: Record<UpadKind, string> = {
  given: 'Given / Advance',
  recovery: 'Salary Recovery',
  returned: 'Cash Returned',
  writeoff: 'Write Off',
}

const PRESET_AMOUNTS = [500, 1000, 2000, 5000]

export function UpadModal({
  open,
  onClose,
  employees,
  defaultEmployeeId,
  defaultKind = 'given',
  defaultCategory = 'chalu',
}: {
  open: boolean
  onClose: () => void
  employees: Employee[]
  defaultEmployeeId?: string
  defaultKind?: UpadKind
  defaultCategory?: UpadCategory
}) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId || '')
  const [kind, setKind] = useState<UpadKind>(defaultKind === 'recovery' ? 'given' : defaultKind)
  const [category, setCategory] = useState<UpadCategory>(defaultCategory)
  const [date, setDate] = useState(todayKey())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const toast = useToast()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!open) return
    setEmployeeId(defaultEmployeeId || employees.find((employee) => employee.active)?.id || '')
    setKind(defaultKind === 'recovery' ? 'given' : defaultKind)
    setCategory(defaultCategory)
    setDate(todayKey())
    setAmount('')
    setNote('')
    setError('')
  }, [open, defaultEmployeeId, defaultKind, defaultCategory, employees])

  const mutation = useMutation({
    mutationFn: createUpadEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast(
        kind === 'given'
          ? 'Upad advance recorded'
          : kind === 'returned'
            ? 'Cash return recorded'
            : 'Upad write-off recorded',
      )
      onClose()
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Could not save upad', 'error'),
  })

  function submit() {
    const paise = parseMoneyInput(amount)
    if (!employeeId) return setError('Choose an employee.')
    if (paise <= 0) return setError('Enter an amount greater than zero.')
    mutation.mutate({
      employeeId,
      date,
      kind,
      category,
      amountPaise: paise,
      note: note.trim(),
    })
  }

  const employee = employees.find((entry) => entry.id === employeeId)
  const isReturn = kind === 'returned'
  const isWriteoff = kind === 'writeoff'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReturn ? 'Record Cash Return' : isWriteoff ? 'Write Off Upad' : 'Record Upad (Advance)'}
      description={
        isReturn
          ? 'Cash handed back against an advance. Lowers the worker’s upad balance directly.'
          : isWriteoff
            ? 'Clear an unrecoverable advance that will not be repaid.'
            : 'Money given to an employee outside salary. Stays outstanding until repaid or recovered.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Save Record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs leading-relaxed text-amber-900">
          <div className="flex gap-2">
            <HandCoins className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <span>
              Upad is tracked separately from weekly salary. Recovery against salary occurs during payout settlement.
            </span>
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Employee">
            <Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">Choose employee…</option>
              {employees.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  #{entry.employee_no} · {entry.name}
                  {entry.active ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Transaction Date">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>

          <Field label="Transaction Type">
            <Select value={kind} onChange={(event) => setKind(event.target.value as UpadKind)}>
              <option value="given">Advance Given</option>
              <option value="returned">Cash Returned</option>
              <option value="writeoff">Write Off</option>
            </Select>
          </Field>

          <Field label="Upad Bucket" hint="Chalu Upad = small running advances. Main Upad = large advances.">
            <Select
              value={category === 'regular' ? 'chalu' : category === 'extra' ? 'moto' : category}
              onChange={(event) => setCategory(event.target.value as UpadCategory)}
            >
              <option value="chalu">Chalu Upad (Small advance)</option>
              <option value="moto">Main Upad (Large advance)</option>
            </Select>
          </Field>

          <Field label="Amount (₹)" className="sm:col-span-2">
            <Input
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
            />
          </Field>
        </div>

        {/* Quick Amount Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase text-stone-400">Quick amounts:</span>
          {PRESET_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setAmount(String(amt))}
              className="rounded-xl border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-bold text-stone-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-800 transition"
            >
              ₹{amt.toLocaleString('en-IN')}
            </button>
          ))}
        </div>

        <Field label="Note / Reason" hint="Optional description">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={isReturn ? 'e.g. handed cash at the counter' : 'e.g. medical / travel advance'}
          />
        </Field>

        {employee && (
          <div className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-xs text-stone-600">
            Selected Worker:{' '}
            <span className="font-bold text-stone-900">{employee.name}</span> (Daily rate:{' '}
            <span className="font-bold text-stone-900">{formatMoney(employee.daily_rate_paise)}/d</span>)
          </div>
        )}

        {error && <div className="text-xs font-bold text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}
