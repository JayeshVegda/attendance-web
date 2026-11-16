import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Coins, History, Plus, Search, Users, X } from 'lucide-react'
import clsx from 'clsx'
import { addUpadEntry, loadAppData } from '../lib/attendance-service'
import { calcUpadBalance, formatMoney, parseMoneyInput } from '../lib/attendance-calc'
import { dateKey, formatDateShort, todayKey } from '../lib/dates'
import type { Employee, UpadEntry } from '../lib/types'
import { Avatar, Modal } from '../components/ui'
import { tx, useLanguage } from '../lib/i18n'

export default function UpadPage() {
  useLanguage()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['attendance-data'], queryFn: loadAppData })

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'owing' | 'clear'>('all')
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)
  const [quickModalWorkerId, setQuickModalWorkerId] = useState<string | null>(null)

  function refresh() {
    return qc.invalidateQueries({ queryKey: ['attendance-data'] })
  }

  if (query.isLoading) {
    return <div role="status" aria-live="polite" className="p-8 text-center text-xs font-semibold text-stone-500">{tx("Loading Upad records…")}</div>
  }
  if (query.isError || !query.data) {
    return <div role="alert" aria-live="assertive" className="p-4 text-xs font-bold text-rose-700">{tx('Could not load Upad ledger from PocketBase.')}</div>
  }

  const { employees, upad } = query.data

  const workerRows = employees
    .map((worker) => {
      const workerEntries = upad.filter((e) => e.employee === worker.id && !e.voided)
      const balance = calcUpadBalance(worker.opening_upad_paise, workerEntries)
      const lastEntry = workerEntries.sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))[0]
      return { worker, balance, lastEntry, entriesCount: workerEntries.length }
    })
    .sort((a, b) => b.balance - a.balance)
    .filter(({ worker, balance }) => {
      const matchSearch = `${worker.name} ${worker.role} ${worker.phone}`.toLowerCase().includes(search.toLowerCase())
      const matchFilter = filter === 'all' || (filter === 'owing' ? balance > 0 : balance <= 0)
      return matchSearch && matchFilter
    })

  const totalOutstanding = employees.reduce((sum, worker) => {
    return sum + calcUpadBalance(worker.opening_upad_paise, upad.filter((e) => e.employee === worker.id && !e.voided))
  }, 0)

  const owingWorkersCount = employees.filter((worker) => {
    return calcUpadBalance(worker.opening_upad_paise, upad.filter((e) => e.employee === worker.id && !e.voided)) > 0
  }).length

  const currentMonthPrefix = todayKey().slice(0, 7)
  const monthGives = upad
    .filter((e) => !e.voided && e.kind === 'give' && dateKey(e.date).startsWith(currentMonthPrefix))
    .reduce((sum, e) => sum + e.amount_paise, 0)
  const monthRepays = upad
    .filter((e) => !e.voided && e.kind === 'repay' && dateKey(e.date).startsWith(currentMonthPrefix))
    .reduce((sum, e) => sum + e.amount_paise, 0)

  // Recent activity across all workers
  const recentMovements = upad
    .filter((e) => !e.voided)
    .sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || b.id.localeCompare(a.id))
    .slice(0, 10)

  const selectedWorker = employees.find((w) => w.id === selectedWorkerId)

  return (
    <div className="space-y-3.5">
      <h1 className="sr-only">{tx('Upad')}</h1>
      {/* Metric Cards Header */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
            <Coins className="h-3.5 w-3.5 text-rose-600" /> {tx("Upad Balance")}
          </div>
          <div className="mt-1 text-base font-black tabular-nums text-rose-800">
            {formatMoney(totalOutstanding)}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">{tx("Total balance owed")}</div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
            <Users className="h-3.5 w-3.5 text-amber-600" /> {tx("Workers with Balance")}
          </div>
          <div className="mt-1 text-base font-black tabular-nums text-stone-900">
            {owingWorkersCount} / {employees.length}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">{tx("Workers with an Upad balance")}</div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
            <ArrowUpRight className="h-3.5 w-3.5 text-sky-600" /> {tx("Upad Given This Month")}
          </div>
          <div className="mt-1 text-base font-black tabular-nums text-sky-900">
            {formatMoney(monthGives)}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">{tx("Cash given")}</div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
          <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" /> {tx("Cash Returned This Month")}
          </div>
          <div className="mt-1 text-base font-black tabular-nums text-emerald-900">
            {formatMoney(monthRepays)}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">{tx("Cash repayments")}</div>
        </div>
      </div>

      {/* Worker list: search, balance filters, and ledger access */}
      <div className="grid gap-3.5 xl:grid-cols-[1fr_320px]">
        {/* Workers List Table */}
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xs">
          <div className="flex flex-col gap-2.5 border-b border-stone-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-2.5">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={tx('Search workers')}
                  placeholder={tx("Search workers by name or role…")}
                  className="h-8 w-full rounded-lg border border-stone-200 bg-stone-50 pl-8 pr-2.5 text-xs font-medium outline-none transition focus:border-stone-900 focus:bg-white"
                />
              </div>

              <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-0.5 text-xs font-semibold text-stone-600">
                {(['all', 'owing', 'clear'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={clsx(
                      'rounded-md px-2.5 py-1 text-[11px] capitalize transition cursor-pointer',
                      filter === f ? 'bg-white font-bold text-stone-900 shadow-2xs' : 'hover:text-stone-900',
                    )}
                  >
                    {f === 'all' ? tx('All') : f === 'owing' ? tx('Owing') : tx('Zero')}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setQuickModalWorkerId(employees[0]?.id ?? '')}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-sky-800 active:scale-[0.96] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              {tx("New Entry")}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table aria-label={tx('Workers with Balance')} className="w-full text-left text-xs">
              <caption className="sr-only">{tx('Workers with Balance')}</caption>
              <thead className="border-b border-stone-200 bg-stone-50/95 text-[11px] font-semibold text-stone-600">
                <tr>
                  <th className="px-3.5 py-2.5">{tx("Worker")}</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">{tx("Upad Balance")}</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">{tx("Opening Upad")}</th>
                  <th className="px-3.5 py-2.5 font-semibold">{tx("Latest Movement")}</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">{tx("Action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {workerRows.map(({ worker, balance, lastEntry, entriesCount }) => (
                  <tr
                    key={worker.id}
                    onClick={() => setSelectedWorkerId(worker.id)}
                    className="cursor-pointer transition hover:bg-sky-50/50"
                  >
                    <td className="px-3.5 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={worker.name} size="sm" />
                        <div>
                          <div className="font-bold text-stone-900 hover:text-sky-800">{worker.name}</div>
                          <div className="text-[10px] text-stone-400">
                            {tx(worker.role || 'Worker')} {worker.phone ? `· ${worker.phone}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={clsx(
                          'font-black tabular-nums',
                          balance > 0 ? 'text-rose-800' : 'text-stone-400',
                        )}
                      >
                        {formatMoney(balance)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-500">
                      {formatMoney(worker.opening_upad_paise)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-stone-500">
                      {lastEntry ? (
                        <div className="flex items-center gap-1">
                          <span
                            className={clsx(
                              'font-bold',
                              lastEntry.kind === 'give'
                                ? 'text-sky-700'
                                : lastEntry.kind === 'deduct'
                                  ? 'text-rose-700'
                                  : 'text-emerald-700',
                            )}
                          >
                            {tx(lastEntry.kind === 'give' ? 'Give Upad' : lastEntry.kind === 'deduct' ? 'Upad Deduct' : 'Cash Return')}
                          </span>
                          <span>{formatMoney(lastEntry.amount_paise)}</span>
                          <span className="text-[10px] text-stone-400">({formatDateShort(lastEntry.date)})</span>
                        </div>
                      ) : (
                        <span className="text-stone-400">{tx("No entries")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedWorkerId(worker.id)
                        }}
                        className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-bold text-sky-800 shadow-xs hover:border-sky-300 hover:bg-sky-50"
                      >
                        {tx('Ledger')} ({entriesCount})
                      </button>
                    </td>
                  </tr>
                ))}
                {!workerRows.length && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-xs text-stone-400">
                      {tx("No workers match this search.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Overview Sidebar: Who took how much on which day */}
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xs">
          <div className="border-b border-stone-100 bg-stone-50/50 px-3.5 py-2.5">
            <h2 className="flex items-center gap-1.5 text-xs font-black text-stone-900">
              <History className="h-3.5 w-3.5 text-stone-500" />
              {tx("Recent Movements")}
            </h2>
            <p className="text-[10px] text-stone-400">{tx("Who took how much, and on which day")}</p>
          </div>

          <div className="divide-y divide-stone-100 overflow-y-auto max-h-[500px]">
            {recentMovements.length ? (
              recentMovements.map((entry) => {
                const worker = employees.find((w) => w.id === entry.employee)
                return (
                  <div key={entry.id} className="flex items-center justify-between p-2.5 text-xs hover:bg-stone-50/60">
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-stone-900 truncate">{worker?.name || 'Worker'}</div>
                      <div className="text-[10px] text-stone-400">
                        {formatDateShort(entry.date)} ·{' '}
                        {entry.note ||
                          (entry.kind === 'give'
                            ? tx('Advance')
                            : entry.kind === 'deduct'
                              ? tx('Upad Deduct')
                              : tx('Cash Repay'))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={clsx(
                          'font-black tabular-nums',
                          entry.kind === 'give'
                            ? 'text-sky-800'
                            : entry.kind === 'deduct'
                              ? 'text-rose-800'
                              : 'text-emerald-800',
                        )}
                      >
                        {entry.kind === 'give' ? '+' : '−'}
                        {formatMoney(entry.amount_paise)}
                      </div>
                      <div className="text-[9px] font-bold text-stone-400 capitalize">{tx(entry.kind)}</div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="p-6 text-center text-xs text-stone-400">{tx("No Upad movements recorded yet.")}</div>
            )}
          </div>
        </div>
      </div>

      {/* Worker Ledger Modal (Section 10.3 + Section 13 O1) */}
      {selectedWorker && (
        <WorkerLedgerModal
          worker={selectedWorker}
          upad={upad.filter((e) => e.employee === selectedWorker.id && !e.voided)}
          onClose={() => setSelectedWorkerId(null)}
          onSave={async (kind, amount, note) => {
            await addUpadEntry({
              employee: selectedWorker.id,
              date: todayKey(),
              kind,
              amount_paise: amount,
              note,
            })
            void refresh()
          }}
        />
      )}

      {/* Quick New Entry Modal */}
      {quickModalWorkerId && (
        <QuickUpadModal
          employees={employees}
          initialWorkerId={quickModalWorkerId}
          onClose={() => setQuickModalWorkerId(null)}
          onSave={async (workerId, kind, amount, note) => {
            await addUpadEntry({
              employee: workerId,
              date: todayKey(),
              kind,
              amount_paise: amount,
              note,
            })
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function WorkerLedgerModal({
  worker,
  upad,
  onClose,
  onSave,
}: {
  worker: Employee
  upad: UpadEntry[]
  onClose: () => void
  onSave: (kind: 'give' | 'deduct' | 'repay', amount: number, note: string) => Promise<void>
}) {
  const [kind, setKind] = useState<'give' | 'deduct' | 'repay'>('give')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ordered = upad.slice().sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || a.id.localeCompare(b.id))
  let running = worker.opening_upad_paise
  const ledger = ordered.map((entry) => {
    running += entry.kind === 'give' ? entry.amount_paise : -entry.amount_paise
    return { entry, balance: running }
  }).reverse()

  const currentBalance = calcUpadBalance(worker.opening_upad_paise, ordered)

  async function handleAddEntry() {
    const val = parseMoneyInput(amount)
    if (val <= 0) return
    setBusy(true)
    setError('')
    try {
      await onSave(kind, val, note)
      setAmount('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record entry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`${worker.name} — ${tx('Upad Ledger')}`}>
      <div className="space-y-3.5 text-xs">
        {/* Header Summary */}
        <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-3">
          <div>
            <div className="text-[10px] font-bold text-stone-500">{tx("Opening Balance")}</div>
            <div className="font-bold tabular-nums text-stone-800">{formatMoney(worker.opening_upad_paise)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold text-stone-500">{tx("Current Outstanding")}</div>
            <div className="text-base font-black tabular-nums text-rose-800">{formatMoney(currentBalance)}</div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            {(['give', 'deduct', 'repay'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={clsx(
                  'rounded-lg px-2.5 py-1 text-[11px] font-black transition',
                  kind === k
                    ? k === 'give'
                      ? 'bg-sky-700 text-white shadow-xs'
                      : k === 'deduct'
                        ? 'bg-rose-700 text-white shadow-xs'
                        : 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50',
                )}
              >
                {tx(k === 'give' ? 'Give Advance' : k === 'deduct' ? 'Upad Deduct' : 'Cash Return')}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[10px] font-bold text-stone-700">
              {tx("Amount (₹)")}
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="₹0.00"
                className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-sm font-bold outline-none focus:border-sky-600"
              />
            </label>
            <label className="text-[10px] font-bold text-stone-700">
              {tx("Note (optional)")}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={tx("e.g. Festival advance")}
                className="mt-0.5 h-8 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-xs outline-none focus:border-sky-600"
              />
            </label>
          </div>

          {error && <p role="alert" aria-live="assertive" className="mt-2 text-xs font-bold text-rose-700">{error}</p>}

          <button
            type="button"
            disabled={!parseMoneyInput(amount) || busy}
            onClick={() => void handleAddEntry()}
            className="mt-2.5 w-full rounded-lg bg-sky-700 py-1.5 text-xs font-black text-white shadow-xs hover:bg-sky-800 disabled:opacity-50"
          >
            {busy ? tx('Saving…') : tx('Record Entry')}
          </button>
        </div>

        {/* Ledger Table */}
        <div>
          <div className="mb-1 text-[10px] font-black uppercase text-stone-500">{tx("Transaction History")}</div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
            {ledger.length ? (
              ledger.map(({ entry, balance }) => (
                <div key={entry.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div>
                    <div className="font-bold text-stone-900">
                      {entry.note ||
                        (entry.kind === 'give'
                          ? 'Advance given'
                          : entry.kind === 'deduct'
                            ? 'Upad Deduct'
                            : 'Cash returned')}
                    </div>
                    <div className="text-[10px] text-stone-400">
                      {formatDateShort(entry.date)} {entry.payout_id ? '· Payout settlement' : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={clsx(
                        'font-black tabular-nums',
                        entry.kind === 'give' ? 'text-sky-800' : 'text-stone-800',
                      )}
                    >
                      {entry.kind === 'give' ? '+' : '−'}
                      {formatMoney(entry.amount_paise)}
                    </div>
                    <div className="text-[9px] text-stone-400">Balance {formatMoney(balance)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-xs text-stone-400">{tx("No transaction entries yet.")}</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function QuickUpadModal({
  employees,
  initialWorkerId,
  onClose,
  onSave,
}: {
  employees: Employee[]
  initialWorkerId: string
  onClose: () => void
  onSave: (workerId: string, kind: 'give' | 'deduct' | 'repay', amount: number, note: string) => Promise<void>
}) {
  const [workerId, setWorkerId] = useState(initialWorkerId)
  const [kind, setKind] = useState<'give' | 'deduct' | 'repay'>('give')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <Modal open onClose={onClose} title={tx('Record Upad Transaction')}>
      <div className="space-y-3 text-xs">
        <label className="block text-[10px] font-bold text-stone-700">
          {tx("Worker")}
          <select
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            className="mt-1 h-8 w-full rounded-lg border border-stone-300 bg-white px-2 text-xs font-bold outline-none"
          >
            {employees.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.role || 'Worker'})
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-1.5">
          {(['give', 'deduct', 'repay'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={clsx(
                'flex-1 rounded-lg py-1.5 text-center text-[11px] font-black transition',
                kind === k
                  ? k === 'give'
                    ? 'bg-sky-700 text-white shadow-xs'
                    : k === 'deduct'
                      ? 'bg-rose-700 text-white shadow-xs'
                      : 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
              )}
            >
          {tx(k === 'give' ? 'Give Advance' : k === 'deduct' ? 'Upad Deduct' : 'Cash Return')}
            </button>
          ))}
        </div>

        <label className="block text-[10px] font-bold text-stone-700">
          {tx("Amount (₹)")}
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="₹0.00"
            className="mt-1 h-9 w-full rounded-lg border border-stone-300 bg-white px-3 text-base font-bold outline-none focus:border-sky-600"
          />
        </label>

        <label className="block text-[10px] font-bold text-stone-700">
          {tx("Note (optional)")}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tx("e.g. Festival advance")}
            className="mt-1 h-8 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-xs outline-none focus:border-sky-600"
          />
        </label>

        {error && <p role="alert" aria-live="assertive" className="text-xs font-bold text-rose-700">{error}</p>}

        <button
          type="button"
          disabled={!workerId || !parseMoneyInput(amount) || busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await onSave(workerId, kind, parseMoneyInput(amount), note)
              onClose()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to save.')
            } finally {
              setBusy(false)
            }
          }}
          className="mt-2 w-full rounded-lg bg-sky-700 p-2 text-xs font-black text-white shadow-xs hover:bg-sky-800 disabled:opacity-50"
        >
          {busy ? tx('Saving…') : tx('Save Transaction')}
        </button>
      </div>
    </Modal>
  )
}
