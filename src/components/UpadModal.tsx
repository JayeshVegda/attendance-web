import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Coins, HandCoins, Info, Wallet } from 'lucide-react'
import { createAdjustment, createUpadEntry, listUpadEntries } from '../lib/api'
import { todayKey } from '../lib/dates'
import { formatMoney, parseMoneyInput } from '../lib/money'
import { upadBreakdownForEmployee } from '../lib/payroll'
import type { Employee, UpadCategory, UpadKind } from '../lib/types'
import { useToast } from './Toast'
import { Button, Field, Input, Modal, Select } from './ui'

export type ModalKind = UpadKind | 'jama'

const PRESET_AMOUNTS = [500, 1000, 2000, 3000, 5000]

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
  const [kind, setKind] = useState<ModalKind>(defaultKind === 'recovery' ? 'given' : defaultKind)
  const [category, setCategory] = useState<UpadCategory>(defaultCategory)
  const [date, setDate] = useState(todayKey())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const toast = useToast()
  const queryClient = useQueryClient()

  const upadQuery = useQuery({ queryKey: ['upad'], queryFn: () => listUpadEntries(), enabled: open })

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

  const employee = employees.find((entry) => entry.id === employeeId)

  const employeeUpad = useMemo(() => {
    if (!employee || !upadQuery.data) return { chalu: 0, moto: 0, total: 0 }
    const bd = upadBreakdownForEmployee(employee, upadQuery.data)
    return { chalu: bd.chaluPaise, moto: bd.motoPaise, total: bd.chaluPaise + bd.motoPaise }
  }, [employee, upadQuery.data])

  const inputPaise = useMemo(() => parseMoneyInput(amount), [amount])

  // Detect excess return if returning cash
  const isReturn = kind === 'returned'
  const isJama = kind === 'jama'
  const isWriteoff = kind === 'writeoff'
  const excessJamaPaise = isReturn && inputPaise > employeeUpad.total ? inputPaise - employeeUpad.total : 0

  const mutation = useMutation({
    mutationFn: async () => {
      const paise = parseMoneyInput(amount)
      if (!employeeId) throw new Error('Choose an employee.')
      if (paise <= 0) throw new Error('Enter an amount greater than zero.')

      if (isJama) {
        // Direct cash jama (deposit with owner to receive in next salary)
        await createAdjustment({
          employeeId,
          date,
          amountPaise: paise,
          kind: 'bonus',
          note: `Cash Jama (Deposit) - ${note.trim() || 'To be paid in next salary'}`,
        })
        return { type: 'jama', paise, excess: 0 }
      }

      if (isReturn) {
        const upadToClear = Math.min(paise, employeeUpad.total)
        const excess = Math.max(0, paise - employeeUpad.total)

        if (upadToClear > 0) {
          // Clear matching bucket or prioritize Chalu then Moto
          if (category === 'moto') {
            const motoClear = Math.min(upadToClear, employeeUpad.moto)
            const remainingChaluClear = upadToClear - motoClear
            if (motoClear > 0) {
              await createUpadEntry({
                employeeId,
                date,
                kind: 'returned',
                category: 'moto',
                amountPaise: motoClear,
                note: note.trim() || 'Cash returned',
              })
            }
            if (remainingChaluClear > 0) {
              await createUpadEntry({
                employeeId,
                date,
                kind: 'returned',
                category: 'chalu',
                amountPaise: remainingChaluClear,
                note: note.trim() || 'Cash returned',
              })
            }
          } else {
            const chaluClear = Math.min(upadToClear, employeeUpad.chalu)
            const remainingMotoClear = upadToClear - chaluClear
            if (chaluClear > 0) {
              await createUpadEntry({
                employeeId,
                date,
                kind: 'returned',
                category: 'chalu',
                amountPaise: chaluClear,
                note: note.trim() || 'Cash returned',
              })
            }
            if (remainingMotoClear > 0) {
              await createUpadEntry({
                employeeId,
                date,
                kind: 'returned',
                category: 'moto',
                amountPaise: remainingMotoClear,
                note: note.trim() || 'Cash returned',
              })
            }
          }
        }

        // If returned amount exceeds total upad, record remaining as Jama (Salary Credit)
        if (excess > 0) {
          await createAdjustment({
            employeeId,
            date,
            amountPaise: excess,
            kind: 'bonus',
            note: `Cash Jama (Deposit) - excess returned cash (${formatMoney(excess)} to be paid in next salary)`,
          })
        }

        return { type: 'returned', paise, excess }
      }

      // Normal given or writeoff
      await createUpadEntry({
        employeeId,
        date,
        kind: kind as UpadKind,
        category,
        amountPaise: paise,
        note: note.trim(),
      })

      return { type: kind, paise, excess: 0 }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['payout-contexts'] })
      queryClient.invalidateQueries({ queryKey: ['employee-attendance'] })
      queryClient.invalidateQueries({ queryKey: ['employee-adjustments'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })

      if (res.type === 'jama') {
        toast(`₹${res.paise / 100} Jama (Deposit) recorded. Will be paid in next salary.`)
      } else if (res.type === 'returned' && res.excess > 0) {
        toast(
          `Upad cleared! Excess ₹${res.excess / 100} recorded as Jama (to be paid in next salary).`,
        )
      } else if (res.type === 'returned') {
        toast(`₹${res.paise / 100} cash return recorded. Upad balance reduced.`)
      } else if (res.type === 'writeoff') {
        toast('Upad write-off recorded.')
      } else {
        toast(`₹${res.paise / 100} upad advance recorded.`)
      }
      onClose()
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Could not save record', 'error'),
  })

  function submit() {
    setError('')
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isJama
          ? 'Record Worker Deposit / Jama (જમા)'
          : isReturn
            ? 'Record Cash Returned (રોકડ પરત)'
            : isWriteoff
              ? 'Write Off Upad'
              : 'Give Upad Advance (ઉપાડ આપ્યો)'
      }
      description={
        isJama
          ? 'Worker handed cash to keep as deposit. This will automatically be paid back to him in his next salary payout!'
          : isReturn
            ? 'Worker hands cash back to repay advance. If he gives more than he owes, the remaining cash becomes Jama for next week!'
            : isWriteoff
              ? 'Clear an unrecoverable advance that will not be repaid.'
              : 'Money given to an employee outside weekly salary. Outstanding until recovered.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {isJama ? 'Save Jama Record' : isReturn ? 'Save Return & Clear' : 'Save Record'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Worker balance reminder pill */}
        {employee && (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-stone-900">
                {employee.name} (#{employee.employee_no})
              </span>
              <span className="text-stone-500 font-medium">Rate: {formatMoney(employee.daily_rate_paise)}/d</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-stone-600">
              <span>
                Chalu Upad: <strong className="text-amber-800">{formatMoney(employeeUpad.chalu)}</strong>
              </span>
              <span>·</span>
              <span>
                Main Upad: <strong className="text-purple-800">{formatMoney(employeeUpad.moto)}</strong>
              </span>
              <span>·</span>
              <span>
                Total Loan:{' '}
                <strong className={employeeUpad.total > 0 ? 'text-rose-700' : 'text-stone-700'}>
                  {formatMoney(employeeUpad.total)}
                </strong>
              </span>
            </div>
          </div>
        )}

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

          <Field label="Transaction Action" className="sm:col-span-2">
            <Select value={kind} onChange={(event) => setKind(event.target.value as ModalKind)}>
              <option value="given">💸 Give Upad Advance (ઉપાડ આપ્યો)</option>
              <option value="returned">💵 Cash Returned by Worker (રોકડા પરત)</option>
              <option value="jama">📥 Deposit / Jama (જમા - Pay in Next Salary)</option>
              <option value="writeoff">Write Off</option>
            </Select>
          </Field>

          {!isJama && (
            <Field label="Upad Bucket" hint="Chalu = running daily advance. Main = large loan.">
              <Select
                value={category === 'regular' ? 'chalu' : category === 'extra' ? 'moto' : category}
                onChange={(event) => setCategory(event.target.value as UpadCategory)}
              >
                <option value="chalu">Chalu Upad (ચાલુ)</option>
                <option value="moto">Main Upad (મોટો)</option>
              </Select>
            </Field>
          )}

          <Field label="Amount (₹)" className={isJama ? 'sm:col-span-2' : ''}>
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase text-stone-400 mr-1">Quick:</span>
          {PRESET_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setAmount(String(amt))}
              className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-bold text-stone-700 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-900 transition"
            >
              ₹{amt.toLocaleString('en-IN')}
            </button>
          ))}
          {isReturn && employeeUpad.total > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(employeeUpad.total / 100))}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-extrabold text-amber-900 hover:bg-amber-100 transition"
              title="Fill exact full loan amount to clear"
            >
              Clear All ({formatMoney(employeeUpad.total)})
            </button>
          )}
        </div>

        {/* Informative Banner when returning excess money (Jama) */}
        {excessJamaPaise > 0 && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-3 text-xs text-emerald-950 space-y-1">
            <div className="font-extrabold flex items-center gap-1.5 text-emerald-900">
              <Info className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>Excess Return: Automatic Jama (Deposit)</span>
            </div>
            <div className="leading-relaxed">
              Worker owed <strong>{formatMoney(employeeUpad.total)}</strong>. Paying{' '}
              <strong>{formatMoney(inputPaise)}</strong> clears his entire loan balance.
            </div>
            <div className="rounded-lg bg-white/70 border border-emerald-200 p-2 font-bold text-emerald-900">
              ✨ The remaining <strong>{formatMoney(excessJamaPaise)}</strong> will be credited as{' '}
              <strong>Jama (જમા)</strong> and automatically added to {employee?.name}’s next salary payout!
            </div>
          </div>
        )}

        {isJama && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900">
            <strong>Worker Deposit:</strong> This ₹{amount || '0'} will be credited directly to {employee?.name}’s
            account and paid out in the next weekly salary payout.
          </div>
        )}

        <Field label="Note / Remarks" hint="Optional">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              isJama
                ? 'e.g. deposited cash, pay back next week'
                : isReturn
                  ? 'e.g. cash handed over at counter'
                  : 'e.g. advance for family / medical'
            }
          />
        </Field>

        {error && <div className="text-xs font-bold text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}
