import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Coins,
  HandCoins,
  Plus,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { listEmployees, listUpadEntries } from '../lib/api'
import { dateKey, daysBetweenInclusive, formatDateShort, monthKey, todayKey } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { upadBreakdownForEmployee } from '../lib/payroll'
import type { UpadKind } from '../lib/types'
import { UpadModal } from '../components/UpadModal'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  Spinner,
  Stat,
  Tabs,
} from '../components/ui'

const KIND_LABEL: Record<UpadKind, string> = {
  given: 'Advance Given',
  recovery: 'Salary Deducted',
  returned: 'Cash Returned',
  writeoff: 'Written Off',
}

export default function UpadPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [upadOpen, setUpadOpen] = useState(false)
  const [modalEmployeeId, setModalEmployeeId] = useState<string | undefined>()
  const [modalKind, setModalKind] = useState<UpadKind>('given')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | UpadKind>('all')

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const upadQuery = useQuery({ queryKey: ['upad'], queryFn: () => listUpadEntries() })

  const employees = employeesQuery.data ?? []
  const entries = upadQuery.data ?? []
  const today = todayKey()
  const thisMonth = monthKey(today)

  const balances = useMemo(() => {
    return employees
      .map((employee) => {
        const breakdown = upadBreakdownForEmployee(employee, entries, today)
        const empEntries = entries.filter((entry) => entry.employee === employee.id)
        const sorted = [...empEntries].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))
        const oldestGiven = empEntries
          .filter((e) => e.kind === 'given')
          .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)))[0]
        const openDays = oldestGiven ? Math.max(0, daysBetweenInclusive(oldestGiven.date, today) - 1) : 0
        return {
          employee,
          balance: breakdown.chaluPaise + breakdown.motoPaise,
          chalu: breakdown.chaluPaise,
          moto: breakdown.motoPaise,
          lastEntry: sorted[0],
          oldestGiven,
          openDays,
        }
      })
      .filter((row) => row.balance > 0)
      .sort((a, b) => b.balance - a.balance)
  }, [employees, entries, today])

  const runningBalances = useMemo(() => {
    const sortedAsc = [...entries].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || (a.created ?? '').localeCompare(b.created ?? ''))
    const map = new Map<string, number>()
    const perEmployee = new Map<string, number>()
    for (const e of sortedAsc) {
      const cur = perEmployee.get(e.employee) ?? 0
      const delta = e.kind === 'given' ? e.amount_paise : -e.amount_paise
      const next = Math.max(0, cur + delta)
      perEmployee.set(e.employee, next)
      map.set(e.id, next)
    }
    return map
  }, [entries])

  const totals = useMemo(() => {
    const monthEntries = entries.filter((entry) => dateKey(entry.date).startsWith(thisMonth))
    return {
      outstanding: balances.reduce((sum, row) => sum + row.balance, 0),
      given: monthEntries
        .filter((entry) => entry.kind === 'given')
        .reduce((sum, entry) => sum + entry.amount_paise, 0),
      returned: monthEntries
        .filter((entry) => entry.kind === 'returned')
        .reduce((sum, entry) => sum + entry.amount_paise, 0),
      recovered: monthEntries
        .filter((entry) => entry.kind === 'recovery')
        .reduce((sum, entry) => sum + entry.amount_paise, 0),
      writtenOff: monthEntries
        .filter((entry) => entry.kind === 'writeoff')
        .reduce((sum, entry) => sum + entry.amount_paise, 0),
    }
  }, [balances, entries, thisMonth])

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  )

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase()
    return [...entries]
      .filter((entry) => {
        if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
        if (!term) return true
        const employee = employeeMap.get(entry.employee)
        return (
          employee?.name.toLowerCase().includes(term) ||
          employee?.employee_no.toLowerCase().includes(term) ||
          entry.note.toLowerCase().includes(term)
        )
      })
      .sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))
  }, [entries, kindFilter, search, employeeMap])

  function openModal(employeeId?: string, kind: UpadKind = 'given') {
    setModalEmployeeId(employeeId)
    setModalKind(kind)
    setUpadOpen(true)
  }

  const loading = employeesQuery.isLoading || upadQuery.isLoading

  return (
    <div>
      <PageHeader
        eyebrow="Cash Advances & Recovery"
        title="Upad"
        description="Track cash advances given outside regular payroll, cash handbacks, and salary recoveries."
        actions={
          <>
            <Button variant="secondary" onClick={() => openModal(undefined, 'returned')}>
              <RotateCcw className="h-4 w-4 text-sky-600" />
              <span>Record Cash Return</span>
            </Button>
            <Button onClick={() => openModal(undefined, 'given')}>
              <HandCoins className="h-4 w-4" />
              <span>Give Upad</span>
            </Button>
          </>
        }
      />

      {/* Summary KPI Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Total Outstanding"
          value={formatMoney(totals.outstanding)}
          hint={`${balances.length} workers currently owe`}
          tone="red"
          icon={<Coins className="h-5 w-5" />}
        />
        <Stat
          label="Given This Month"
          value={formatMoney(totals.given)}
          hint="Total new advances"
          tone="amber"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <Stat
          label="Cash Returned"
          value={formatMoney(totals.returned)}
          hint="Handed back in cash"
          tone="blue"
          icon={<RotateCcw className="h-5 w-5" />}
        />
        <Stat
          label="Salary Recovered"
          value={formatMoney(totals.recovered)}
          hint="Deducted at payout"
          tone="green"
          icon={<TrendingDown className="h-5 w-5" />}
        />
        <Stat
          label="Written Off"
          value={formatMoney(totals.writtenOff)}
          hint="Cleared unrecoverable"
          tone="default"
        />
      </div>

      {/* Outstanding Balances By Employee */}
      <Card className="mb-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
          <div>
            <div className="text-sm font-extrabold text-stone-900">Outstanding By Worker</div>
            <div className="text-xs text-stone-500">
              Opening upad + advances minus recoveries and cash returned.
            </div>
          </div>
          <span className="rounded-full bg-stone-200/60 px-2.5 py-0.5 text-xs font-bold text-stone-700">
            {balances.length} workers
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-sm font-semibold text-stone-500">
            <Spinner className="h-6 w-6" />
            <span>Loading upad balances…</span>
          </div>
        ) : !balances.length ? (
          <div className="p-8">
            <EmptyState
              icon={<Coins className="h-7 w-7 text-emerald-500" />}
              title="All Upad Balances Settled"
              description="No employee currently owes any upad advances."
              action={
                <Button variant="secondary" onClick={() => openModal(undefined, 'given')}>
                  Record an advance
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {balances.map(({ employee, balance, chalu, moto, lastEntry, openDays }) => (
              <div
                key={employee.id}
                className="group flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-3.5 shadow-xs transition hover:border-amber-300 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigate(`employees/${employee.id}`)}
                      className="flex min-w-0 items-center gap-2.5 text-left"
                    >
                      <Avatar name={employee.name} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold text-stone-900 group-hover:text-amber-800 transition">
                          {employee.name}
                        </div>
                        <div className="text-[10px] text-stone-400">
                          #{employee.employee_no}
                          {lastEntry ? ` · last ${formatDateShort(lastEntry.date)}` : ''}
                          {!employee.active ? ' · inactive' : ''}
                        </div>
                      </div>
                    </button>
                    <div className="text-right">
                      <div className="text-base font-black text-rose-600 tabular-nums">
                        {formatMoney(balance)}
                      </div>
                      <div className="text-[10px] font-bold text-stone-500">
                        Chalu {formatMoney(chalu)} · Main {formatMoney(moto)}
                      </div>
                    </div>
                  </div>

                  {openDays > 0 && (
                    <div className="mt-2.5 flex items-center justify-between text-[11px]">
                      <span className="text-stone-400 font-medium">Advance age:</span>
                      <span
                        className={clsx(
                          'rounded-md px-1.5 py-0.5 font-bold tabular-nums text-[10px]',
                          openDays >= 14
                            ? 'border border-amber-300 bg-amber-100 text-amber-900'
                            : 'bg-stone-100 text-stone-700',
                        )}
                      >
                        Open for {openDays} days
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-stone-100 pt-2.5">
                  <button
                    type="button"
                    onClick={() => openModal(employee.id, 'returned')}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-50 transition"
                  >
                    + Return Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal(employee.id, 'given')}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-50 transition"
                  >
                    + Give Upad
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal(employee.id, 'writeoff')}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 transition"
                    title="Write off uncollectable upad advance"
                  >
                    Write Off
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Upad Ledger History */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-stone-200/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between bg-stone-50/60">
          <div>
            <div className="text-sm font-extrabold text-stone-900">Upad Transaction Ledger</div>
            <div className="text-xs text-stone-500">
              Audit log of every advance given, cash returned, salary recovered, and written off.
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              className="h-9 w-full py-1 text-xs sm:w-40 font-semibold"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as 'all' | UpadKind)}
            >
              <option value="all">All Transactions</option>
              <option value="given">Advances Given</option>
              <option value="returned">Cash Returned</option>
              <option value="recovery">Salary Recovered</option>
              <option value="writeoff">Written Off</option>
            </Select>

            <div className="w-full sm:w-60">
              <SearchInput
                placeholder="Search worker or note…"
                value={search}
                onChange={setSearch}
              />
            </div>
          </div>
        </div>

        {filteredEntries.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-stone-50 text-left text-[10px] font-extrabold uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <tr>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Type & Bucket</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-right">Running Bal</th>
                  <th className="px-4 py-2.5">Note</th>
                  <th className="px-4 py-2.5">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredEntries.map((entry) => {
                  const employee = employeeMap.get(entry.employee)
                  const positive = entry.kind === 'given'
                  return (
                    <tr key={entry.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="px-4 py-3 text-xs font-semibold text-stone-600">
                        {formatDateShort(entry.date)}
                      </td>
                      <td className="px-4 py-3">
                        {employee ? (
                          <button
                            type="button"
                            onClick={() => onNavigate(`employees/${employee.id}`)}
                            className="text-left group"
                          >
                            <div className="text-[13px] font-extrabold text-stone-900 group-hover:text-teal-700 transition">
                              {employee.name}
                            </div>
                            <div className="text-[10px] text-stone-400">
                              #{employee.employee_no}
                            </div>
                          </button>
                        ) : (
                          <span className="text-stone-400">Unknown</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            tone={
                              entry.kind === 'given'
                                ? 'amber'
                                : entry.kind === 'returned'
                                  ? 'blue'
                                  : entry.kind === 'recovery'
                                    ? 'green'
                                    : 'neutral'
                            }
                            dot
                          >
                            {KIND_LABEL[entry.kind]}
                          </Badge>
                          <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-700">
                            {entry.category === 'extra' || entry.category === 'moto' ? 'Main Upad' : 'Chalu Upad'}
                          </span>
                        </div>
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 text-right text-sm font-black tabular-nums',
                          positive ? 'text-rose-600' : 'text-emerald-700',
                        )}
                      >
                        {positive ? '+' : '−'}
                        {formatMoney(entry.amount_paise)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-stone-800 tabular-nums">
                        {formatMoney(runningBalances.get(entry.id) ?? 0)}
                      </td>
                      <td className="max-w-[18rem] truncate px-4 py-3 text-xs text-stone-600">
                        {entry.note || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {entry.statement ? (
                          <Badge tone="blue">Payout Settled</Badge>
                        ) : (
                          <span className="text-[11px] font-semibold text-stone-400">Manual</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8">
            <EmptyState
              icon={<Users className="h-7 w-7 text-stone-400" />}
              title={search || kindFilter !== 'all' ? 'No matching entries' : 'No upad records yet'}
              description={
                search || kindFilter !== 'all'
                  ? 'Try a different search term or filter.'
                  : 'Record an advance to start the ledger.'
              }
              action={
                !search && kindFilter === 'all' ? (
                  <Button onClick={() => openModal(undefined, 'given')}>Record Upad</Button>
                ) : undefined
              }
            />
          </div>
        )}
      </Card>

      <div className="mt-3 text-xs text-stone-400">
        Note: Cash returned and payout salary recovery both reduce outstanding upad.
      </div>

      <UpadModal
        open={upadOpen}
        onClose={() => setUpadOpen(false)}
        employees={employees}
        defaultEmployeeId={modalEmployeeId}
        defaultKind={modalKind}
      />
    </div>
  )
}
