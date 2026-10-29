import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  Coins,
  History,
  Pencil,
  Phone,
  Plus,
  Power,
  RotateCcw,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import {
  addRate,
  listAttendance,
  listEmployees,
  listPayments,
  listPeriods,
  listRates,
  listStatements,
  listUpadEntries,
  setEmployeeActive,
  updateEmployee,
} from '../lib/api'
import { addDays, formatDateLong, formatDateShort, todayKey, weekdayShort } from '../lib/dates'
import { formatHours, formatMoney, paiseToInput, parseMoneyInput } from '../lib/money'
import { dayPayPaise, getRateForDate, latestStatementByEmployee, upadBalanceForEmployee } from '../lib/payroll'
import type { Employee } from '../lib/types'
import { UpadModal } from '../components/UpadModal'
import { useToast } from '../components/Toast'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  Stat,
  Tabs,
  Textarea,
} from '../components/ui'

type Tab = 'salary' | 'attendance' | 'upad' | 'profile'

const STATUS_TONE = {
  full: 'green',
  half: 'amber',
  absent: 'red',
} as const

export default function EmployeeDetailPage({
  employeeId,
  onNavigate,
}: {
  employeeId: string
  onNavigate: (path: string) => void
}) {
  const [tab, setTab] = useState<Tab>('salary')
  const [editOpen, setEditOpen] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [upadOpen, setUpadOpen] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState(false)
  const toast = useToast()
  const queryClient = useQueryClient()

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const ratesQuery = useQuery({ queryKey: ['rates'], queryFn: listRates })
  const periodsQuery = useQuery({ queryKey: ['periods'], queryFn: listPeriods })
  const statementsQuery = useQuery({ queryKey: ['statements'], queryFn: listStatements })
  const upadQuery = useQuery({ queryKey: ['upad'], queryFn: () => listUpadEntries() })
  const paymentsQuery = useQuery({ queryKey: ['payments'], queryFn: listPayments })
  const attendanceQuery = useQuery({
    queryKey: ['employee-attendance', employeeId],
    queryFn: () => listAttendance(addDays(todayKey(), -90), todayKey()),
  })

  const employee = employeesQuery.data?.find((entry) => entry.id === employeeId)
  const rates = useMemo(
    () => (ratesQuery.data ?? []).filter((rate) => rate.employee === employeeId),
    [ratesQuery.data, employeeId],
  )
  const periods = useMemo(
    () => (periodsQuery.data ?? []).filter((period) => period.employee === employeeId),
    [periodsQuery.data, employeeId],
  )
  const statements = useMemo(
    () => (statementsQuery.data ?? []).filter((statement) => statement.employee === employeeId),
    [statementsQuery.data, employeeId],
  )
  const upadEntries = useMemo(
    () => (upadQuery.data ?? []).filter((entry) => entry.employee === employeeId),
    [upadQuery.data, employeeId],
  )
  const payments = useMemo(
    () => (paymentsQuery.data ?? []).filter((payment) => payment.employee === employeeId),
    [paymentsQuery.data, employeeId],
  )
  const attendance = useMemo(
    () => (attendanceQuery.data ?? []).filter((entry) => entry.employee === employeeId),
    [attendanceQuery.data, employeeId],
  )

  const latestStatement = useMemo(
    () => (employee ? latestStatementByEmployee(statements).get(employee.id) : undefined),
    [employee, statements],
  )

  const toggleMutation = useMutation({
    mutationFn: () => setEmployeeActive(employeeId, !employee?.active),
    onSuccess: () => {
      toast(employee?.active ? 'Employee deactivated' : 'Employee reactivated')
      setConfirmToggle(false)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['periods'] })
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Could not update employee', 'error'),
  })

  if (employeesQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-28 text-sm font-semibold text-stone-500">
        <Spinner className="h-6 w-6" />
        <span>Loading employee details…</span>
      </div>
    )
  }

  if (!employee) {
    return (
      <Card className="p-8">
        <EmptyState
          icon={<ArrowLeft className="h-7 w-7 text-stone-400" />}
          title="Employee Not Found"
          description="This employee record was not found in the local database."
          action={<Button onClick={() => onNavigate('employees')}>Back to Employees</Button>}
        />
      </Card>
    )
  }

  const today = todayKey()
  const currentRate = getRateForDate(employee, rates, today)
  const salaryDue = latestStatement?.closing_paise ?? employee.opening_salary_paise ?? 0
  const upadBalance = upadBalanceForEmployee(employee, upadEntries, today)
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount_paise, 0)
  const presentDays = attendance.reduce(
    (sum, entry) => sum + (entry.status === 'full' ? 1 : entry.status === 'half' ? 0.5 : 0),
    0,
  )
  const otMinutes = attendance.reduce((sum, entry) => sum + (entry.ot_minutes || 0), 0)

  return (
    <div>
      <button
        type="button"
        onClick={() => onNavigate('employees')}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-stone-500 hover:text-teal-700 transition"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All Employees
      </button>

      {/* Top Hero Banner */}
      <Card className="mb-5 overflow-hidden shadow-md">
        <div className="bg-gradient-to-r from-[#0b1f1a] via-[#10322c] to-[#16473f] px-6 py-6 text-white">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl ring-4 ring-white/10 shadow-lg">
                <Avatar name={employee.name} size="lg" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-black tracking-tight">{employee.name}</h1>
                  <Badge
                    tone={employee.active ? 'green' : 'neutral'}
                    className="bg-white/10 text-white ring-1 ring-white/20"
                    dot
                  >
                    {employee.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-teal-100/70 font-medium">
                  <span>Worker #{employee.employee_no}</span>
                  {employee.phone && (
                    <>
                      <span>•</span>
                      <a
                        href={`tel:${employee.phone}`}
                        className="inline-flex items-center gap-1 hover:text-white transition"
                      >
                        <Phone className="h-3 w-3" />
                        <span>{employee.phone}</span>
                      </a>
                    </>
                  )}
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    Joined {formatDateLong(employee.joined_on || employee.created)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => setRateOpen(true)}
              >
                <TrendingUp className="h-4 w-4" />
                <span>Adjust Rate</span>
              </Button>
              <Button
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => setUpadOpen(true)}
              >
                <Coins className="h-4 w-4" />
                <span>Give Upad</span>
              </Button>
              <Button
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-4 w-4" />
                <span>Edit Info</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-4 bg-stone-50/50">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Current Wage Rate
            </div>
            <div className="mt-1 text-xl font-black text-stone-900 tabular-nums">
              {formatMoney(currentRate)}
              <span className="text-xs font-semibold text-stone-400"> / day</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Salary Due
            </div>
            <div
              className={clsx(
                'mt-1 text-xl font-black tabular-nums',
                salaryDue > 0 ? 'text-amber-700' : 'text-stone-900',
              )}
            >
              {formatMoney(salaryDue, { showZero: true })}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Upad Outstanding
            </div>
            <div
              className={clsx(
                'mt-1 text-xl font-black tabular-nums',
                upadBalance > 0 ? 'text-rose-600' : 'text-stone-900',
              )}
            >
              {formatMoney(upadBalance, { showZero: true })}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Total Paid All-Time
            </div>
            <div className="mt-1 text-xl font-black text-teal-700 tabular-nums">
              {formatMoney(totalPaid, { showZero: true })}
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs Switcher */}
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={(val) => setTab(val as Tab)}
          options={[
            { id: 'salary', label: 'Salary & Statements', icon: <Wallet className="h-3.5 w-3.5" /> },
            { id: 'attendance', label: 'Attendance Log', icon: <CalendarDays className="h-3.5 w-3.5" /> },
            { id: 'upad', label: 'Upad & Rates', icon: <Coins className="h-3.5 w-3.5" /> },
            { id: 'profile', label: 'Profile & Actions', icon: <User className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>

      {/* TAB: Salary */}
      {tab === 'salary' && (
        <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
          <Card className="overflow-hidden">
            <div className="border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
              <div className="text-sm font-extrabold text-stone-900">Salary Statements</div>
              <div className="text-xs text-stone-500">
                Every settled payout cycle statement for this employee.
              </div>
            </div>
            {statements.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-stone-50 text-left text-[10px] font-extrabold uppercase tracking-wider text-stone-500 border-b border-stone-200">
                    <tr>
                      <th className="px-4 py-2.5">Payout Date</th>
                      <th className="px-4 py-2.5 text-right">Opening Baki</th>
                      <th className="px-4 py-2.5 text-right">Earned</th>
                      <th className="px-4 py-2.5 text-right">Adjust</th>
                      <th className="px-4 py-2.5 text-right">Upad Rec.</th>
                      <th className="px-4 py-2.5 text-right">Total Due</th>
                      <th className="px-4 py-2.5 text-right">Paid</th>
                      <th className="px-4 py-2.5 text-right">Closing Carry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {statements.map((statement) => (
                      <tr key={statement.id} className="hover:bg-stone-50/70 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-extrabold text-stone-900">
                            {formatDateShort(statement.payout_date)}
                          </div>
                          <div className="text-[10px] text-stone-400">
                            {statement.days_worked} days
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600 text-xs">
                          {formatMoney(statement.opening_paise, { showZero: true })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-800 text-xs font-bold">
                          {formatMoney(statement.earned_paise, { showZero: true })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-stone-600 text-xs">
                          {formatMoney(statement.adjustment_paise, { showZero: true })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-700 text-xs font-bold">
                          {formatMoney(statement.upad_recovery_paise, { showZero: true })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-extrabold text-stone-900">
                          {formatMoney(statement.total_due_paise, { showZero: true })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-black text-emerald-700">
                          {formatMoney(statement.paid_paise, { showZero: true })}
                        </td>
                        <td
                          className={clsx(
                            'px-4 py-3 text-right tabular-nums font-extrabold text-xs',
                            statement.closing_paise > 0 ? 'text-amber-700' : 'text-stone-300',
                          )}
                        >
                          {formatMoney(statement.closing_paise, { showZero: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8">
                <EmptyState
                  icon={<Wallet className="h-7 w-7 text-stone-400" />}
                  title="No Payout Statements Yet"
                  description="Statements appear here once a payout cycle is closed."
                />
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Current Unpaid Balance
              </div>
              <div
                className={clsx(
                  'mt-1.5 text-2xl font-black tabular-nums',
                  salaryDue > 0 ? 'text-amber-700' : 'text-stone-900',
                )}
              >
                {formatMoney(salaryDue, { showZero: true })}
              </div>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {latestStatement
                  ? `Carried over from the ${formatDateShort(latestStatement.payout_date)} settlement.`
                  : 'Opening balance. No payout cycle has been closed yet.'}
              </p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Last 90 Days Activity
                </div>
                <CalendarDays className="h-4 w-4 text-stone-400" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-stone-50 p-3">
                  <div className="text-xl font-black text-stone-900 tabular-nums">
                    {presentDays}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-stone-400">Days Worked</div>
                </div>
                <div className="rounded-xl bg-teal-50 p-3">
                  <div className="text-xl font-black text-teal-800 tabular-nums">
                    {formatHours(otMinutes)}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-teal-700">Overtime</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB: Attendance */}
      {tab === 'attendance' && (
        <Card className="overflow-hidden">
          <div className="border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
            <div className="text-sm font-extrabold text-stone-900">Recent Attendance History</div>
            <div className="text-xs text-stone-500">
              Last 90 days. Daily marks, overtime hours, and pay calculated per day.
            </div>
          </div>
          {attendance.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-stone-50 text-left text-[10px] font-extrabold uppercase tracking-wider text-stone-500 border-b border-stone-200">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">OT</th>
                    <th className="px-4 py-2.5 text-right">Day Rate</th>
                    <th className="px-4 py-2.5 text-right">Day Pay</th>
                    <th className="px-4 py-2.5">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {attendance.map((entry) => {
                    const rate = getRateForDate(employee, rates, entry.date)
                    return (
                      <tr key={entry.id} className="hover:bg-stone-50/70 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-extrabold text-stone-900">
                            {formatDateShort(entry.date)}
                          </div>
                          <div className="text-[10px] text-stone-400">{weekdayShort(entry.date)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[entry.status]} dot className="capitalize">
                            {entry.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs font-semibold text-stone-700">
                          {entry.ot_minutes ? formatHours(entry.ot_minutes) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs text-stone-500">
                          {formatMoney(rate)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs font-black text-stone-900">
                          {formatMoney(dayPayPaise(entry.status, entry.ot_minutes || 0, rate))}
                        </td>
                        <td className="max-w-[14rem] truncate px-4 py-3 text-xs text-stone-500">
                          {entry.note || '—'}
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
                icon={<CalendarDays className="h-7 w-7 text-stone-400" />}
                title="No Attendance In Last 90 Days"
                description="Mark attendance from the Attendance page to see daily activity here."
              />
            </div>
          )}
        </Card>
      )}

      {/* TAB: Upad & Rates */}
      {tab === 'upad' && (
        <div className="grid gap-5 xl:grid-cols-2">
          {/* Upad Transactions */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
              <div>
                <div className="text-sm font-extrabold text-stone-900">Upad Transactions</div>
                <div className="text-xs text-stone-500">Advances, cash returns, and recoveries.</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setUpadOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Give Upad
              </Button>
            </div>
            {upadEntries.length ? (
              <div className="divide-y divide-stone-100 max-h-[30rem] overflow-y-auto">
                {upadEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50 transition"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            entry.kind === 'given'
                              ? 'amber'
                              : entry.kind === 'returned'
                                ? 'blue'
                                : entry.kind === 'writeoff'
                                  ? 'neutral'
                                  : 'green'
                          }
                          dot
                        >
                          {entry.kind === 'returned' ? 'Cash returned' : entry.kind}
                        </Badge>
                        <span
                          className={clsx(
                            'text-sm font-black tabular-nums',
                            entry.kind === 'given' ? 'text-rose-600' : 'text-emerald-700',
                          )}
                        >
                          {entry.kind === 'given' ? '+' : '−'}
                          {formatMoney(entry.amount_paise)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-stone-400">
                        {formatDateShort(entry.date)} ·{' '}
                        {entry.category === 'extra' ? 'Extra' : 'Regular'}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-300">
                        {entry.statement ? 'payout' : 'manual'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8">
                <EmptyState
                  icon={<Coins className="h-7 w-7 text-stone-400" />}
                  title="No Upad Entries"
                  description="Advances and repayments will appear here."
                />
              </div>
            )}
          </Card>

          {/* Rate History */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
              <div>
                <div className="text-sm font-extrabold text-stone-900">Wage Rate History</div>
                <div className="text-xs text-stone-500">
                  Each rate applies from its effective date.
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setRateOpen(true)}>
                <TrendingUp className="h-3.5 w-3.5" /> Adjust Rate
              </Button>
            </div>
            <div className="divide-y divide-stone-100 max-h-[30rem] overflow-y-auto">
              {[...rates].reverse().map((rate) => (
                <div
                  key={rate.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition"
                >
                  <div>
                    <div className="text-sm font-black text-stone-900 tabular-nums">
                      {formatMoney(rate.daily_rate_paise)} / day
                    </div>
                    <div className="text-xs text-stone-400">
                      Effective from {formatDateLong(rate.effective_from)}
                      {rate.note ? ` · ${rate.note}` : ''}
                    </div>
                  </div>
                  {rate.effective_from.slice(0, 10) <= today &&
                    rate.id === rates[rates.length - 1]?.id && (
                      <Badge tone="green" dot>
                        Current
                      </Badge>
                    )}
                </div>
              ))}
              {!rates.length && (
                <div className="p-8">
                  <EmptyState icon={<TrendingUp className="h-7 w-7 text-stone-400" />} title="No Rate History" />
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* TAB: Profile */}
      {tab === 'profile' && (
        <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
          <Card className="p-5">
            <div className="text-sm font-extrabold text-stone-900">Employment Periods</div>
            <div className="mt-3 divide-y divide-stone-100">
              {periods.map((period) => (
                <div key={period.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-bold text-stone-800">
                      {formatDateLong(period.start_date)} →{' '}
                      {period.end_date ? formatDateLong(period.end_date) : 'Present'}
                    </div>
                    {period.note && <div className="text-xs text-stone-400">{period.note}</div>}
                  </div>
                  {!period.end_date && (
                    <Badge tone="green" dot>
                      Active Period
                    </Badge>
                  )}
                </div>
              ))}
              {!periods.length && (
                <div className="py-4 text-sm text-stone-400">No employment periods recorded.</div>
              )}
            </div>

            {employee.notes && (
              <div className="mt-6 border-t border-stone-100 pt-4">
                <div className="text-sm font-extrabold text-stone-900">Internal Notes</div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-stone-600 bg-stone-50 p-3 rounded-xl border border-stone-200">
                  {employee.notes}
                </p>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-sm font-extrabold text-stone-900">Employment Status</div>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">
              Deactivation keeps all historical attendance, payouts, and upad records intact. Reactivation resumes active duty with a new period starting today.
            </p>

            <Button
              variant={employee.active ? 'danger' : 'emerald'}
              className="mt-4 w-full"
              onClick={() => setConfirmToggle(true)}
            >
              {employee.active ? <Power className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
              <span>{employee.active ? 'Deactivate Employee' : 'Reactivate Employee'}</span>
            </Button>

            <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500 space-y-1">
              <div>
                Opening Salary Due: <span className="font-bold text-stone-800">{formatMoney(employee.opening_salary_paise)}</span>
              </div>
              <div>
                Opening Upad Owed: <span className="font-bold text-stone-800">{formatMoney(employee.opening_upad_paise)}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Modal */}
      <EditEmployeeModal
        key={`edit-${employee.updated}`}
        open={editOpen}
        employee={employee}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['employees'] })
          setEditOpen(false)
        }}
      />

      {/* Rate Change Modal */}
      <RateModal
        key={`rate-${currentRate}`}
        open={rateOpen}
        employee={employee}
        currentRate={currentRate}
        onClose={() => setRateOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['rates'] })
          queryClient.invalidateQueries({ queryKey: ['employees'] })
          setRateOpen(false)
        }}
      />

      {/* Upad Modal */}
      <UpadModal
        open={upadOpen}
        onClose={() => setUpadOpen(false)}
        employees={[employee]}
        defaultEmployeeId={employee.id}
      />

      {/* Confirm Deactivation Dialog */}
      <ConfirmDialog
        open={confirmToggle}
        onClose={() => setConfirmToggle(false)}
        onConfirm={() => toggleMutation.mutate()}
        title={employee.active ? 'Deactivate Employee?' : 'Reactivate Employee?'}
        message={
          employee.active
            ? `${employee.name} will be marked inactive and today will close the current employment period. All attendance, salary, and upad history is preserved.`
            : `${employee.name} will become active again and a new employment period starts today.`
        }
        confirmLabel={employee.active ? 'Deactivate' : 'Reactivate'}
        tone={employee.active ? 'danger' : 'primary'}
        loading={toggleMutation.isPending}
      />
    </div>
  )
}

function EditEmployeeModal({
  open,
  employee,
  onClose,
  onSaved,
}: {
  open: boolean
  employee: Employee
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(employee.name)
  const [employeeNo, setEmployeeNo] = useState(employee.employee_no)
  const [phone, setPhone] = useState(employee.phone)
  const [openingSalary, setOpeningSalary] = useState(paiseToInput(employee.opening_salary_paise))
  const [openingUpad, setOpeningUpad] = useState(paiseToInput(employee.opening_upad_paise))
  const [notes, setNotes] = useState(employee.notes)
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: () =>
      updateEmployee(employee.id, {
        name: name.trim(),
        employee_no: employeeNo.trim(),
        phone: phone.trim(),
        opening_salary_paise: parseMoneyInput(openingSalary),
        opening_upad_paise: parseMoneyInput(openingUpad),
        notes,
      }),
    onSuccess: () => {
      toast('Employee profile updated')
      onSaved()
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Could not update employee', 'error'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Employee Profile"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            Save Changes
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Full Name" className="sm:col-span-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Employee Number">
          <Input value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} />
        </Field>
        <Field label="Phone Number">
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </Field>
        <Field
          label="Opening Salary Due (₹)"
          hint="Only applies before the first closed payout statement."
        >
          <Input
            inputMode="decimal"
            value={openingSalary}
            onChange={(event) => setOpeningSalary(event.target.value)}
          />
        </Field>
        <Field
          label="Opening Upad Balance (₹)"
          hint="Only applies before any upad entries exist."
        >
          <Input
            inputMode="decimal"
            value={openingUpad}
            onChange={(event) => setOpeningUpad(event.target.value)}
          />
        </Field>
        <Field label="Internal Notes" className="sm:col-span-2">
          <Textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}

function RateModal({
  open,
  employee,
  currentRate,
  onClose,
  onSaved,
}: {
  open: boolean
  employee: Employee
  currentRate: number
  onClose: () => void
  onSaved: () => void
}) {
  const [rate, setRate] = useState(paiseToInput(currentRate))
  const [effectiveFrom, setEffectiveFrom] = useState(todayKey())
  const [note, setNote] = useState('')
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: () =>
      addRate({
        employeeId: employee.id,
        effectiveFrom,
        ratePaise: parseMoneyInput(rate),
        note,
      }),
    onSuccess: () => {
      toast('Wage rate updated')
      onSaved()
    },
    onError: (error) => toast(error instanceof Error ? error.message : 'Could not update rate', 'error'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust Daily Wage Rate"
      description="The new rate applies from the effective date forward. Past attendance records keep their previous rate."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={parseMoneyInput(rate) <= 0}
          >
            Save Rate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="New Daily Rate (₹)">
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Effective From Date">
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Reason / Note" hint="Optional (e.g. annual increment, promotion)">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. annual wage revision"
          />
        </Field>
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
          Current Active Rate:{' '}
          <span className="font-extrabold text-stone-900">{formatMoney(currentRate)} / day</span>
        </div>
      </div>
    </Modal>
  )
}
