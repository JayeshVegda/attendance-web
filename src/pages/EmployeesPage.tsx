import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2, Users } from 'lucide-react'
import clsx from 'clsx'
import {
  createEmployee,
  deleteEmployee,
  latestStatement,
  loadAppData,
  updateEmployee,
} from '../lib/attendance-service'
import {
  calcDayEarnings,
  calcUpadBalance,
  formatMoney,
  paiseToInput,
  parseMoneyInput,
} from '../lib/attendance-calc'
import { dateKey, todayKey } from '../lib/dates'
import { tx, useLanguage } from '../lib/i18n'
import type { Employee } from '../lib/types'
import { Avatar, Modal } from '../components/ui'

type WorkerForm = {
  name: string
  phone: string
  role: string
  rate: string
  upad: string
  carry: string
  joined: string
  status: 'active' | 'inactive'
}

const emptyForm = (): WorkerForm => ({
  name: '',
  phone: '',
  role: '',
  rate: '',
  upad: '0',
  carry: '0',
  joined: todayKey(),
  status: 'active',
})

export default function EmployeesPage() {
  useLanguage()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['attendance-data'], queryFn: loadAppData })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState<WorkerForm>(emptyForm())
  const [deleteConfirm, setDeleteConfirm] = useState<Employee | null>(null)

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['attendance-data'] })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const name = form.name.trim()
      if (!name) throw new Error('Worker name is required.')

      const payload = {
        name,
        phone: form.phone.trim(),
        role: form.role.trim(),
        daily_rate_paise: parseMoneyInput(form.rate),
        opening_upad_paise: parseMoneyInput(form.upad),
        opening_carry_paise: parseMoneyInput(form.carry),
        joined_on: `${form.joined || todayKey()} 00:00:00.000Z`,
        status: form.status,
      }

      if (editing) {
        return updateEmployee(editing.id, payload)
      }
      return createEmployee(payload)
    },
    onSuccess: () => {
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void refresh()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEmployee(id),
    onSuccess: () => {
      setDeleteConfirm(null)
      void refresh()
    },
  })

  const statusToggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      updateEmployee(id, { status }),
    onSuccess: refresh,
  })

  if (query.isLoading) {
    return <div role="status" aria-live="polite" className="p-8 text-center text-xs font-semibold text-stone-500">{tx("Loading worker roster…")}</div>
  }
  if (query.isError || !query.data) {
    return <div role="alert" aria-live="assertive" className="p-4 text-xs font-bold text-rose-700">{tx('Could not load worker data from database.')}</div>
  }

  const { employees, attendance, upad, statements, runs, settings } = query.data

  const rows = employees
    .filter((w) => statusFilter === 'all' || w.status === statusFilter)
    .filter((w) => `${w.name} ${w.role} ${w.phone}`.toLowerCase().includes(search.toLowerCase()))
    .map((worker) => {
      const workerUpad = upad.filter((e) => e.employee === worker.id && !e.voided)
      const currentUpad = calcUpadBalance(worker.opening_upad_paise, workerUpad)

      const lastStmt = latestStatement(statements, worker.id, runs)
      const carry = lastStmt ? lastStmt.closing_paise : worker.opening_carry_paise ?? 0
      const boundary = worker.paid_up_to ? worker.paid_up_to.slice(0, 10) : ''
      const openAttendance = attendance.filter(
        (a) => a.employee === worker.id && !a.settled_payout && (!boundary || dateKey(a.date) > boundary),
      )
      const openDaysCount = openAttendance.length
      const openEarnings = openAttendance.reduce(
        (sum, a) =>
          sum +
          calcDayEarnings(a, worker.daily_rate_paise, settings.shift_hours, settings.ot_multiplier).earned_paise,
        0,
      )

      // Can delete only if zero attendance and zero upad
      const totalAttCount = attendance.filter((a) => a.employee === worker.id).length
      const totalUpadCount = upad.filter((e) => e.employee === worker.id).length
      const canDelete = totalAttCount === 0 && totalUpadCount === 0

      return {
        worker,
        currentUpad,
        carry,
        openDaysCount,
        openEarnings,
        canDelete,
      }
    })

  function openEdit(worker?: Employee) {
    setEditing(worker ?? null)
    setFormOpen(true)
    if (worker) {
      setForm({
        name: worker.name,
        phone: worker.phone || '',
        role: worker.role || '',
        rate: paiseToInput(worker.daily_rate_paise),
        upad: paiseToInput(worker.opening_upad_paise),
        carry: paiseToInput(worker.opening_carry_paise),
        joined: worker.joined_on ? dateKey(worker.joined_on) : todayKey(),
        status: worker.status,
      })
    } else {
      setForm(emptyForm())
    }
  }

  const activeCount = employees.filter((w) => w.status === 'active').length
  const inactiveCount = employees.filter((w) => w.status === 'inactive').length

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{tx('Workers')}</h1>
      {/* Top Header & Search Bar */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-48 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={tx('Search workers')}
              placeholder={tx("Search name, role, phone…")}
              className="h-8 w-full rounded-lg border border-stone-200 bg-stone-50 pl-8 pr-2.5 text-xs font-medium outline-none transition focus:border-stone-900 focus:bg-white"
            />
          </div>

          <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-semibold text-stone-600">
            {(['active', 'all', 'inactive'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-[11px] capitalize transition cursor-pointer',
                  statusFilter === f
                    ? 'bg-white font-bold text-stone-900 shadow-2xs'
                    : 'hover:text-stone-900',
                )}
              >
                {tx(f)} ({f === 'active' ? activeCount : f === 'inactive' ? inactiveCount : employees.length})
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => openEdit()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-800 active:scale-[0.96] cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          {tx("Add Worker")}
        </button>
      </div>

      {/* Scannable Compact Worker Table */}
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table aria-label={tx('Workers')} className="w-full text-left text-xs">
            <caption className="sr-only">{tx('Workers')}</caption>
            <thead className="border-b border-stone-200 bg-stone-50/95 text-[11px] font-semibold text-stone-600">
              <tr>
                <th className="px-3.5 py-2.5">{tx("Worker")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{tx("Rate / day")}</th>
                <th className="px-3 py-2.5 text-center font-semibold">{tx("Status")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{tx("Upad Balance")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{tx("Signed Carry")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{tx("This Cycle")}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{tx("Action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map(({ worker, currentUpad, carry, openDaysCount, openEarnings, canDelete }) => (
                <tr
                  key={worker.id}
                  className={clsx(
                    'transition hover:bg-stone-50/70',
                    worker.status === 'inactive' && 'bg-stone-50/40 opacity-60',
                  )}
                >
                  <td className="px-3.5 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={worker.name} size="sm" />
                      <div>
                        <div className="font-bold text-stone-900">{worker.name}</div>
                        <div className="text-[10px] text-stone-400">
                          {tx(worker.role || 'Worker')} {worker.phone ? `· ${worker.phone}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-2 text-right font-black tabular-nums text-stone-800">
                    {formatMoney(worker.daily_rate_paise)}
                  </td>

                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() =>
                        statusToggleMutation.mutate({
                          id: worker.id,
                          status: worker.status === 'active' ? 'inactive' : 'active',
                        })
                      }
                      title={`${tx('Click to switch to')} ${tx(worker.status === 'active' ? 'inactive' : 'active')}`}
                      className={clsx(
                        'inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase transition',
                        worker.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20 hover:bg-emerald-100'
                          : 'bg-stone-200 text-stone-600 hover:bg-stone-300',
                      )}
                    >
                      {tx(worker.status)}
                    </button>
                  </td>

                  <td className="px-3 py-2 text-right font-black tabular-nums">
                    <span className={currentUpad > 0 ? 'text-rose-800' : 'text-stone-400'}>
                      {formatMoney(currentUpad)}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-right font-black tabular-nums">
                    {carry > 0 ? (
                      <span className="text-amber-800">+{formatMoney(carry)}</span>
                    ) : carry < 0 ? (
                      <span className="text-rose-700">−{formatMoney(Math.abs(carry))}</span>
                    ) : (
                      <span className="text-stone-400">₹0</span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="font-bold text-emerald-800">{openDaysCount}d</span>{' '}
                    <span className="text-[10px] text-stone-400">({formatMoney(openEarnings)})</span>
                  </td>

                  <td className="px-3 py-2 text-right space-x-1.5">
                    <button
                      type="button"
                      onClick={() => openEdit(worker)}
                      className="rounded border border-stone-200 bg-white px-2 py-1 text-[11px] font-bold text-stone-700 shadow-xs hover:border-stone-300 hover:bg-stone-50"
                    >
                      {tx("Edit")}
                    </button>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(worker)}
                        title={tx("Delete worker (only permitted with 0 attendance and 0 upad)")}
                        className="rounded border border-stone-200 bg-white p-1 text-stone-400 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-stone-400">
                    {tx("No workers match this search.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Add Worker Modal */}
      {formOpen && (
        <Modal
          open
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          title={editing ? `${tx('Edit')}: ${editing.name}` : tx('Add New Worker')}
        >
          <div className="space-y-3 text-xs">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="text-[10px] font-bold text-stone-700">
                {tx("Full Name (required)")}
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={tx("e.g. Ramesh Patel")}
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Role")}
                <input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="e.g. Tailor, Master, Helper"
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2.5 text-xs outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Phone")}
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g. 98765 43210"
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2.5 text-xs outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Daily Rate (₹)")}
                <input
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="e.g. 500"
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Opening Upad (₹)")}
                <input
                  inputMode="decimal"
                  value={form.upad}
                  onChange={(e) => setForm({ ...form, upad: e.target.value })}
                  placeholder="0"
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Opening Salary Carry (₹, signed)")}
                <input
                  inputMode="decimal"
                  value={form.carry}
                  onChange={(e) => setForm({ ...form, carry: e.target.value })}
                  placeholder="0"
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Joined Date")}
                <input
                  type="date"
                  value={form.joined}
                  onChange={(e) => setForm({ ...form, joined: e.target.value })}
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 px-2 text-xs font-bold outline-none focus:border-emerald-600"
                />
              </label>

              <label className="text-[10px] font-bold text-stone-700">
                {tx("Status")}
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })}
                  className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 bg-white px-2 text-xs font-bold outline-none"
                >
                  <option value="active">{tx("Active")}</option>
                  <option value="inactive">{tx("Inactive")}</option>
                </select>
              </label>
            </div>

            {saveMutation.isError && (
              <p role="alert" aria-live="assertive" className="text-xs font-bold text-rose-700">
                {saveMutation.error.message}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2 border-t border-stone-100 pt-3">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-50"
              >
                {tx("Cancel")}
              </button>
              <button
                type="button"
                disabled={saveMutation.isPending || !form.name.trim()}
                onClick={() => saveMutation.mutate()}
                className="rounded-lg bg-emerald-700 px-4 py-1.5 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {saveMutation.isPending ? tx('Saving…') : tx('Save Worker')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <Modal
          open
          onClose={() => setDeleteConfirm(null)}
          title={`${tx('Delete')} ${deleteConfirm.name}?`}
        >
          <div className="space-y-3 text-xs">
            <p className="text-stone-600">
              {tx("Are you sure you want to delete")} <b>{deleteConfirm.name}</b>{tx("? This worker has no recorded attendance or Upad transactions.")}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 font-bold text-stone-700 hover:bg-stone-50"
              >
                {tx("Cancel")}
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                className="rounded-lg bg-rose-700 px-4 py-1.5 font-black text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
