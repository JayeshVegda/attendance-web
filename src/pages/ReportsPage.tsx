import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Coins,
  History,
  LockKeyhole,
  Unlock,
  Users,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import { loadAppData, unlockPayout } from '../lib/attendance-service'
import { calcDayEarnings, formatMoney, formatHours } from '../lib/attendance-calc'
import { addDays, dateKey, formatDateRange, formatDateShort, todayKey } from '../lib/dates'
import type { Statement, UpadEntry } from '../lib/types'
import { Modal } from '../components/ui'
import { tx, useLanguage } from '../lib/i18n'

function dayList(start: string, end: string): string[] {
  const result: string[] = []
  for (let day = start; day <= end && result.length < 200; day = addDays(day, 1)) {
    result.push(day)
  }
  return result
}

export default function ReportsPage() {
  useLanguage()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['attendance-data'], queryFn: loadAppData })

  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [unlockModalRunId, setUnlockModalRunId] = useState<string | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  function refresh() {
    return qc.invalidateQueries({ queryKey: ['attendance-data'] })
  }

  const unlockMutation = useMutation({
    mutationFn: () => unlockPayout(unlockModalRunId!, unlockReason, 'Local user'),
    onSuccess: () => {
      setUnlockModalRunId(null)
      setUnlockReason('')
      setErrorMessage('')
      void refresh()
    },
    onError: (err) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to unlock payout run.')
    },
  })

  if (query.isLoading) {
    return <div role="status" aria-live="polite" className="p-8 text-center text-xs font-semibold text-stone-500">{tx("Loading reports…")}</div>
  }
  if (query.isError || !query.data) {
    return <div role="alert" aria-live="assertive" className="p-4 text-xs font-bold text-rose-700">{tx("Could not load reports from database.")}</div>
  }

  const { runs, statements, employees, attendance, upad, settings } = query.data

  // 1. This Month Metrics
  const currentMonth = todayKey().slice(0, 7) // YYYY-MM
  const monthRuns = runs.filter((r) => !r.voided && dateKey(r.run_date).startsWith(currentMonth))
  const monthPaidPaise = monthRuns.reduce((sum, r) => sum + r.total_paid_paise, 0)

  const monthUpad = upad.filter((e) => !e.voided && dateKey(e.date).startsWith(currentMonth))
  const monthUpadGiven = monthUpad.filter((e) => e.kind === 'give').reduce((sum, e) => sum + e.amount_paise, 0)
  const monthUpadDeducted = monthUpad.filter((e) => e.kind === 'deduct').reduce((sum, e) => sum + e.amount_paise, 0)
  const monthUpadReturned = monthUpad.filter((e) => e.kind === 'repay').reduce((sum, e) => sum + e.amount_paise, 0)

  // 2. Selected Run & Statement History
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0]
  const currentStatements = statements.filter((s) => s.payout_run === selectedRun?.id && !s.voided)

  const rangeStart = currentStatements.map((s) => dateKey(s.start_date)).sort()[0]
  const rangeEnd = currentStatements.map((s) => dateKey(s.end_date)).sort().at(-1)
  const days = rangeStart && rangeEnd ? dayList(rangeStart, rangeEnd) : []

  return (
    <div className="space-y-3.5">
      <h1 className="sr-only">{tx('Report')}</h1>
      {/* 10.4 Section 1: This Month Metric Header */}
      <div>
        <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-stone-500">
          {tx('This Month Overview')} ({currentMonth})
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
              <Wallet className="h-3.5 w-3.5 text-emerald-600" /> {tx("Total Paid")}
            </div>
            <div className="mt-1 text-base font-black tabular-nums text-emerald-900">
              {formatMoney(monthPaidPaise)}
            </div>
            <div className="mt-0.5 text-[10px] text-stone-400">{monthRuns.length} {tx('payout runs')}</div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
              <ArrowUpRight className="h-3.5 w-3.5 text-sky-600" /> {tx("Upad Given")}
            </div>
            <div className="mt-1 text-base font-black tabular-nums text-sky-900">
              {formatMoney(monthUpadGiven)}
            </div>
            <div className="mt-0.5 text-[10px] text-stone-400">{tx("Total Upad given")}</div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
              <Coins className="h-3.5 w-3.5 text-rose-600" /> {tx("Upad Deduct")}
            </div>
            <div className="mt-1 text-base font-black tabular-nums text-rose-900">
              {formatMoney(monthUpadDeducted)}
            </div>
            <div className="mt-0.5 text-[10px] text-stone-400">{tx("Deducted from Upad")}</div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-stone-500">
              <ArrowDownLeft className="h-3.5 w-3.5 text-teal-600" /> {tx("Total Returned")}
            </div>
            <div className="mt-1 text-base font-black tabular-nums text-teal-900">
              {formatMoney(monthUpadReturned)}
            </div>
            <div className="mt-0.5 text-[10px] text-stone-400">{tx("Direct cash returns")}</div>
          </div>
        </div>
      </div>

      {/* 10.4 Section 2: Payout Run Selector & Unlock Bar */}
      {!runs.length ? (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-xs text-stone-500 shadow-xs">
          {tx("No historical payout runs recorded yet. Settle an open cycle in the Attendance tab first.")}
        </div>
      ) : (
        <div className="space-y-3.5">
          <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-stone-700">{tx("Select Payout Run:")}</span>
                <select
                  value={selectedRun?.id ?? ''}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-bold text-stone-900 shadow-xs outline-none focus:border-emerald-600 focus:bg-white"
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      🔒 {formatDateShort(r.run_date)} · {formatMoney(r.total_paid_paise)}
                    </option>
                  ))}
                </select>
              </div>

              {rangeStart && rangeEnd && (
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold text-stone-600">
                  {formatDateRange(rangeStart, rangeEnd)} · {currentStatements.length} {tx('statements')}
                </span>
              )}
            </div>

            {selectedRun && (
              <button
                type="button"
                onClick={() => {
                  setUnlockModalRunId(selectedRun.id)
                  setUnlockReason('')
                  setErrorMessage('')
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-black text-amber-900 shadow-xs transition hover:bg-amber-100"
              >
                <Unlock className="h-3.5 w-3.5" />
                {tx("Unlock This Payout")}
              </button>
            )}
          </div>

          {/* 10.4 Section 3: Statement Lines Table */}
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xs">
            <div className="border-b border-stone-100 bg-stone-50/50 px-3.5 py-2">
              <h2 className="text-xs font-black text-stone-900">
                {tx('Worker Statements')} ({currentStatements.length} {tx('settled')})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table aria-label={tx('Worker Statements')} className="w-full text-left text-xs">
                <caption className="sr-only">{tx('Worker Statements')}</caption>
                <thead className="border-b border-stone-200 bg-stone-100 text-[10px] font-black uppercase tracking-wider text-stone-600">
                  <tr>
                    <th className="px-3.5 py-2">{tx("Worker")}</th>
                    <th className="px-3 py-2 text-right">{tx("Carry In")}</th>
                    <th className="px-3 py-2 text-right">{tx("Earned")}</th>
                    <th className="px-3 py-2 text-right">{tx("Adj (Salary)")}</th>
                    <th className="px-3 py-2 text-right text-rose-900">{tx("Upad Deduct")}</th>
                    <th className="px-3 py-2 text-right text-sky-900">{tx("Give Upad")}</th>
                    <th className="px-3 py-2 text-right">{tx("Calculated")}</th>
                    <th className="px-3 py-2 text-right font-black text-emerald-950">{tx("Paid")}</th>
                    <th className="px-3 py-2 text-right font-black">{tx("Carry Out")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {currentStatements.map((stmt) => {
                    const worker = employees.find((e) => e.id === stmt.employee)
                    return (
                      <tr key={stmt.id} className="hover:bg-stone-50/60">
                        <td className="px-3.5 py-2">
                          <div className="font-bold text-stone-900">{worker?.name || stmt.employee}</div>
                          <div className="text-[10px] text-stone-400">
                            {formatDateRange(stmt.start_date, stmt.end_date)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {stmt.opening_paise > 0 ? (
                            <span className="text-amber-800">+{formatMoney(stmt.opening_paise)}</span>
                          ) : stmt.opening_paise < 0 ? (
                            <span className="text-rose-700">−{formatMoney(Math.abs(stmt.opening_paise))}</span>
                          ) : (
                            <span className="text-stone-400">₹0</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-stone-800">
                          {formatMoney(stmt.earned_paise)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {stmt.adjustment_paise > 0 ? (
                            <span className="text-emerald-700">+{formatMoney(stmt.adjustment_paise)}</span>
                          ) : stmt.adjustment_paise < 0 ? (
                            <span className="text-rose-700">−{formatMoney(Math.abs(stmt.adjustment_paise))}</span>
                          ) : (
                            <span className="text-stone-400">₹0</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-800">
                          {stmt.upad_deduct_paise > 0 ? `−${formatMoney(stmt.upad_deduct_paise)}` : '₹0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-sky-800">
                          {stmt.upad_give_paise > 0 ? `+${formatMoney(stmt.upad_give_paise)}` : '₹0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-stone-700">
                          {formatMoney(stmt.calculated_paise)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-black text-emerald-900">
                          {formatMoney(stmt.paid_paise)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-black">
                          {stmt.closing_paise > 0 ? (
                            <span className="text-amber-800">Carry +{formatMoney(stmt.closing_paise)}</span>
                          ) : stmt.closing_paise < 0 ? (
                            <span className="text-amber-800">Overpaid −{formatMoney(Math.abs(stmt.closing_paise))}</span>
                          ) : (
                            <span className="text-emerald-700">₹0 ✓</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 10.4 Section 4: Day-by-Day Cross Matrix Grid */}
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xs">
            <div className="border-b border-stone-100 bg-stone-50/50 px-3.5 py-2">
              <h3 className="text-xs font-black text-stone-900">
                {tx("Day-by-Day Attendance & Upad Cross Grid")}
              </h3>
              <p className="text-[10px] text-stone-400">{tx("Attendance marks and Upad movements for settled days")}</p>
            </div>

            <div className="overflow-x-auto">
              <table aria-label={tx('Day-by-Day Attendance & Upad Cross Grid')} className="w-full border-collapse text-xs">
                <caption className="sr-only">{tx('Day-by-Day Attendance & Upad Cross Grid')}</caption>
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-100 text-[10px] font-black uppercase text-stone-600">
                    <th className="sticky left-0 z-20 min-w-36 bg-stone-100 px-3 py-2 text-left">{tx("Worker")}</th>
                    {days.map((day) => (
                      <th key={day} className="min-w-12 border-l border-stone-200 px-1 py-1 text-center">
                        <div>{Number(day.slice(-2))}</div>
                        <div className="text-[8px] font-medium text-stone-400">{formatDateShort(day).split(' ')[1]}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {currentStatements.map((stmt) => {
                    const worker = employees.find((e) => e.id === stmt.employee)
                    const cycleUpad = upad.filter(
                      (u) =>
                        u.employee === stmt.employee &&
                        dateKey(u.date) >= dateKey(stmt.start_date) &&
                        dateKey(u.date) <= dateKey(stmt.end_date) &&
                        !u.voided,
                    )

                    return (
                      <tr key={stmt.id} className="hover:bg-stone-50/50">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 font-bold text-stone-900 shadow-xs">
                          {worker?.name || stmt.employee}
                        </td>
                        {days.map((day) => {
                          const att = attendance.find(
                            (a) =>
                              a.employee === stmt.employee &&
                              dateKey(a.date) === day &&
                              a.settled_payout === selectedRun?.id,
                          )
                          const dayUpad = cycleUpad.filter((u) => dateKey(u.date) === day)
                          const dayEarn =
                            att && worker
                              ? calcDayEarnings(
                                  att,
                                  worker.daily_rate_paise,
                                  settings.shift_hours,
                                  settings.ot_multiplier,
                                ).earned_paise
                              : 0

                          const label =
                            att?.status === 'full'
                              ? 'P'
                              : att?.status === 'half'
                                ? 'H'
                                : att?.status === 'absent'
                                  ? 'A'
                                  : att?.status === 'hours'
                                    ? `${Math.round(att.worked_minutes / 60)}h`
                                    : '·'

                          return (
                            <td key={day} className="border-l border-stone-200 p-1 text-center">
                              <div
                                className={clsx(
                                  'font-bold',
                                  att?.status === 'full'
                                    ? 'text-emerald-800'
                                    : att?.status === 'half'
                                      ? 'text-amber-800'
                                      : att?.status === 'absent'
                                        ? 'text-rose-700'
                                        : 'text-stone-300',
                                )}
                              >
                                {label}
                              </div>
                              {dayEarn > 0 && (
                                <div className="text-[8px] font-semibold text-stone-400">
                                  {formatMoney(dayEarn)}
                                </div>
                              )}
                              {dayUpad.map((u) => (
                                <div
                                  key={u.id}
                                  className={clsx(
                                    'whitespace-nowrap text-[8px] font-black',
                                    u.kind === 'give' ? 'text-sky-700' : 'text-rose-700',
                                  )}
                                >
                                  {u.kind === 'give' ? '+' : '−'}
                                  {formatMoney(u.amount_paise)}
                                </div>
                              ))}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Audited Unlock Modal (Section 9) */}
      {unlockModalRunId && (
        <Modal
          open
          onClose={() => {
            setUnlockModalRunId(null)
            setUnlockReason('')
            setErrorMessage('')
          }}
          title={tx("Unlock Closed Payout")}
        >
          <div className="space-y-3 text-xs">
            <p className="text-stone-600">
              {tx("Unlocking this payout will void its financial statements, recover employee attendance days, and restore prior cycle boundaries. A reason is strictly required.")}
            </p>

            <label className="block text-[10px] font-bold text-stone-700">
              {tx("Reason for unlocking (required)")}
              <textarea
                autoFocus
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="e.g. Need to adjust Ramesh's custom overtime on 04 Nov"
                className="mt-1 min-h-20 w-full rounded-lg border border-stone-300 p-2 text-xs outline-none focus:border-amber-600"
              />
            </label>

            {errorMessage && (
              <p role="alert" aria-live="assertive" className="text-xs font-bold text-rose-700">
                {errorMessage}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-stone-100 pt-3">
              <button
                type="button"
                onClick={() => setUnlockModalRunId(null)}
                className="rounded-lg border border-stone-200 px-3 py-1.5 font-bold text-stone-700 hover:bg-stone-50"
              >
                {tx("Cancel")}
              </button>
              <button
                type="button"
                disabled={!unlockReason.trim() || unlockMutation.isPending}
                onClick={() => unlockMutation.mutate()}
                className="rounded-lg bg-amber-700 px-4 py-1.5 font-black text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {unlockMutation.isPending ? 'Unlocking…' : 'Confirm Unlock'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
