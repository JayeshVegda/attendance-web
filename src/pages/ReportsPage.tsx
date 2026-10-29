import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Printer,
  Users,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getSettings,
  listEmployees,
  listRuns,
  listStatements,
  listUpadEntries,
} from '../lib/api'
import { dateKey, formatDateLong, formatDateRange, monthLabel, monthKey } from '../lib/dates'
import { formatHours, formatMoney } from '../lib/money'
import { latestStatementByEmployee, upadBalanceForEmployee } from '../lib/payroll'
import type { Employee, PayoutRun, Statement } from '../lib/types'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '../components/ui'

export default function ReportsPage({
  runId,
  onNavigate,
}: {
  runId?: string
  onNavigate: (path: string) => void
}) {
  const [selectedId, setSelectedId] = useState(runId || '')

  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const statementsQuery = useQuery({ queryKey: ['statements'], queryFn: listStatements })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const upadQuery = useQuery({ queryKey: ['upad'], queryFn: () => listUpadEntries() })
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const runs = useMemo(
    () =>
      [...(runsQuery.data ?? [])].sort((a, b) =>
        dateKey(b.payout_date).localeCompare(dateKey(a.payout_date)),
      ),
    [runsQuery.data],
  )
  const employees = employeesQuery.data ?? []
  const statements = statementsQuery.data ?? []

  useEffect(() => {
    if (runId) setSelectedId(runId)
  }, [runId])

  useEffect(() => {
    if (!selectedId && runs.length) setSelectedId(runs[0].id)
  }, [selectedId, runs])

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  )

  const selectedRun = runs.find((run) => run.id === selectedId) ?? runs[0]
  const selectedStatements = selectedRun
    ? statements.filter((statement) => statement.payout_run === selectedRun.id)
    : []

  const latestBalances = useMemo(
    () => latestStatementByEmployee(statements),
    [statements],
  )

  const overview = useMemo(() => {
    const totalEarned = statements.reduce((sum, statement) => sum + statement.earned_paise, 0)
    const totalPaid = statements.reduce((sum, statement) => sum + statement.paid_paise, 0)
    const totalRecovery = statements.reduce(
      (sum, statement) => sum + statement.upad_recovery_paise,
      0,
    )
    const salaryDue = employees.reduce(
      (sum, employee) =>
        sum +
        (latestBalances.get(employee.id)?.closing_paise ?? employee.opening_salary_paise ?? 0),
      0,
    )
    const upadDue = employees.reduce(
      (sum, employee) => sum + upadBalanceForEmployee(employee, upadQuery.data ?? []),
      0,
    )
    return { totalEarned, totalPaid, totalRecovery, salaryDue, upadDue }
  }, [statements, employees, latestBalances, upadQuery.data])

  const monthly = useMemo(() => {
    const groups = new Map<
      string,
      {
        month: string
        runs: number
        employees: number
        due: number
        paid: number
        recovery: number
      }
    >()
    for (const run of runs) {
      const key = monthKey(run.payout_date)
      const group = groups.get(key) ?? {
        month: key,
        runs: 0,
        employees: 0,
        due: 0,
        paid: 0,
        recovery: 0,
      }
      group.runs += 1
      group.employees += run.employee_count
      group.due += run.total_due_paise
      group.paid += run.total_paid_paise
      group.recovery += run.total_upad_recovery_paise
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month))
  }, [runs])

  if (runsQuery.isLoading || statementsQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-28 text-sm font-semibold text-stone-500">
        <Spinner className="h-6 w-6" />
        <span>Loading payroll reports & statements…</span>
      </div>
    )
  }

  const businessName = settingsQuery.data?.business_name || 'હાજરી પગાર'

  return (
    <div>
      <PageHeader
        eyebrow="Financial History & Statements"
        title="Reports & Payslips"
        description="Historical payout registers, monthly wage summaries, and printable settlement sheets."
        actions={
          <Button variant="secondary" onClick={() => onNavigate('attendance')}>
            <Wallet className="h-4 w-4" />
            <span>Open Attendance & Payout</span>
          </Button>
        }
      />

      {/* Overview Stat Cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Closed Payouts"
          value={runs.length}
          hint="Completed cycles"
          icon={<FileText className="h-5 w-5" />}
          tone="teal"
        />
        <Stat
          label="Total Salary Earned"
          value={formatMoney(overview.totalEarned)}
          hint="Across all statements"
          tone="default"
        />
        <Stat
          label="Total Paid Out"
          value={formatMoney(overview.totalPaid)}
          hint="Disbursed cash & bank"
          tone="green"
          icon={<Wallet className="h-5 w-5" />}
        />
        <Stat
          label="Unpaid Salary Carry"
          value={formatMoney(overview.salaryDue)}
          hint="Current unpaid balances"
          tone="amber"
        />
        <Stat
          label="Upad Outstanding"
          value={formatMoney(overview.upadDue)}
          hint="Total active advances"
          tone="red"
        />
      </div>

      {!runs.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<BarChart3 className="h-8 w-8 text-stone-400" />}
            title="No Payouts Closed Yet"
            description="Close your first payout cycle from the Attendance & Payout page to generate reports and printable employee statements."
            action={
              <Button onClick={() => onNavigate('attendance')}>
                Go to Attendance & Payout
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[22rem_1fr]">
          {/* Left: Payouts List & Monthly Summaries */}
          <div className="space-y-4 no-print">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
                <div className="text-sm font-extrabold text-stone-900">Payout History</div>
                <Badge tone="neutral">{runs.length} runs</Badge>
              </div>
              <div className="max-h-[28rem] overflow-y-auto divide-y divide-stone-100">
                {runs.map((run) => {
                  const active = selectedRun?.id === run.id
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedId(run.id)}
                      className={clsx(
                        'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-all',
                        active
                          ? 'bg-teal-500/10 text-stone-900 border-l-4 border-l-teal-600 font-medium'
                          : 'hover:bg-stone-50 text-stone-700',
                      )}
                    >
                      <div>
                        <div className="text-sm font-extrabold text-stone-900">
                          {formatDateLong(run.payout_date)}
                        </div>
                        <div className="mt-0.5 text-xs text-stone-400">
                          {run.employee_count} workers · {formatDateRange(run.cycle_start, run.payout_date)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-black text-teal-700 tabular-nums">
                          {formatMoney(run.total_paid_paise)}
                        </div>
                        <div className="text-[10px] text-stone-400">paid</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-stone-200/80 px-4 py-3 bg-stone-50/60">
                <div className="text-sm font-extrabold text-stone-900">Monthly Aggregates</div>
                <div className="text-xs text-stone-500">Totals grouped by payout month.</div>
              </div>
              <div className="divide-y divide-stone-100">
                {monthly.map((month) => (
                  <div key={month.month} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-stone-900">
                        {monthLabel(month.month)}
                      </div>
                      <Badge tone="neutral">
                        {month.runs} payout{month.runs === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-xl bg-stone-50 p-2">
                        <div className="text-[10px] font-bold uppercase text-stone-400">Earned Due</div>
                        <div className="font-extrabold text-stone-800 tabular-nums">
                          {formatMoney(month.due)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-2">
                        <div className="text-[10px] font-bold uppercase text-emerald-700">Paid</div>
                        <div className="font-extrabold text-emerald-800 tabular-nums">
                          {formatMoney(month.paid)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-2">
                        <div className="text-[10px] font-bold uppercase text-amber-700">Upad Rec.</div>
                        <div className="font-extrabold text-amber-800 tabular-nums">
                          {formatMoney(month.recovery)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Right: Selected Run Statement & Printable Slip */}
          {selectedRun && (
            <Card className="print-area overflow-hidden shadow-md">
              {/* Statement Header */}
              <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 sm:flex-row sm:items-start sm:justify-between bg-stone-50/40">
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-700">
                    Salary Statement & Voucher
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-stone-900">{businessName}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <CalendarDays className="h-3.5 w-3.5 text-stone-400" />
                      Cycle: {formatDateRange(selectedRun.cycle_start, selectedRun.payout_date)}
                    </span>
                    <span>•</span>
                    <span className="font-semibold">
                      Settled On: {formatDateLong(selectedRun.payout_date)}
                    </span>
                    <span>•</span>
                    <Badge tone="green" dot>
                      Closed & Paid
                    </Badge>
                  </div>
                  {selectedRun.note && (
                    <div className="mt-2 text-xs italic text-stone-500">
                      Note: "{selectedRun.note}"
                    </div>
                  )}
                </div>

                <div className="flex gap-2 no-print">
                  <Button variant="secondary" size="sm" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" />
                    <span>Print Sheet</span>
                  </Button>
                </div>
              </div>

              {/* Run Metrics Bar */}
              <div className="grid grid-cols-2 gap-3 border-b border-stone-200 bg-stone-50/80 px-6 py-4 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    Workers Paid
                  </div>
                  <div className="mt-1 text-xl font-black text-stone-900">
                    {selectedRun.employee_count}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    Gross Due
                  </div>
                  <div className="mt-1 text-xl font-black text-stone-900 tabular-nums">
                    {formatMoney(selectedRun.total_due_paise)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Total Paid Now
                  </div>
                  <div className="mt-1 text-xl font-black text-emerald-800 tabular-nums">
                    {formatMoney(selectedRun.total_paid_paise)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                    Upad Recovered
                  </div>
                  <div className="mt-1 text-xl font-black text-amber-800 tabular-nums">
                    {formatMoney(selectedRun.total_upad_recovery_paise)}
                  </div>
                </div>
              </div>

              {/* Statements Table */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="bg-stone-50 text-left text-[10px] font-extrabold uppercase tracking-wider text-stone-500 border-b border-stone-200">
                    <tr>
                      <th className="px-5 py-3">Employee</th>
                      <th className="px-3 py-3 text-center">Days / OT</th>
                      <th className="px-3 py-3 text-right">Opening Baki</th>
                      <th className="px-3 py-3 text-right">Salary Earned</th>
                      <th className="px-3 py-3 text-right">Adjust</th>
                      <th className="px-3 py-3 text-right">Upad Recovery</th>
                      <th className="px-3 py-3 text-right">Total Due</th>
                      <th className="px-3 py-3 text-right">Paid Amount</th>
                      <th className="px-4 py-3 text-right">Closing Carry</th>
                      <th className="px-5 py-3 text-center hidden print:table-cell">Worker Sign</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {selectedStatements.map((statement) => {
                      const employee = employeeMap.get(statement.employee)
                      return (
                        <tr key={statement.id} className="hover:bg-stone-50/70 transition-colors">
                          <td className="px-5 py-3">
                            <div className="font-extrabold text-stone-900">
                              {employee?.name ?? statement.employee}
                            </div>
                            <div className="text-[10px] text-stone-400">
                              {employee ? `#${employee.employee_no}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center text-xs font-semibold tabular-nums text-stone-600">
                            <div>{statement.days_worked} d</div>
                            {statement.ot_minutes > 0 && (
                              <div className="text-[10px] text-teal-700">
                                +{formatHours(statement.ot_minutes)} OT
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-xs font-semibold text-stone-600">
                            {formatMoney(statement.opening_paise, { showZero: true })}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-stone-900">
                            {formatMoney(statement.earned_paise, { showZero: true })}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-xs font-semibold text-stone-600">
                            {formatMoney(statement.adjustment_paise, { showZero: true })}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-xs font-semibold text-amber-700">
                            {statement.upad_recovery_paise > 0
                              ? `-${formatMoney(statement.upad_recovery_paise)}`
                              : '—'}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-xs font-extrabold text-stone-900">
                            {formatMoney(statement.total_due_paise, { showZero: true })}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-xs font-black text-emerald-700">
                            {formatMoney(statement.paid_paise, { showZero: true })}
                          </td>
                          <td
                            className={clsx(
                              'px-4 py-3 text-right tabular-nums text-xs font-extrabold',
                              statement.closing_paise > 0 ? 'text-amber-700' : 'text-stone-400',
                            )}
                          >
                            {formatMoney(statement.closing_paise, { showZero: true })}
                          </td>
                          <td className="px-5 py-3 text-center hidden print:table-cell border-b border-stone-200">
                            <div className="h-6 w-20 border-b border-stone-400 mx-auto" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-stone-300 bg-stone-100 font-black text-stone-900">
                      <td className="px-5 py-3 text-xs uppercase tracking-wider text-stone-700">
                        Total
                      </td>
                      <td className="px-3 py-3 text-center text-xs tabular-nums">
                        {selectedStatements.reduce((sum, row) => sum + row.days_worked, 0)} d
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-stone-700">
                        {formatMoney(
                          selectedStatements.reduce((sum, row) => sum + row.opening_paise, 0),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-stone-900">
                        {formatMoney(
                          selectedStatements.reduce((sum, row) => sum + row.earned_paise, 0),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-stone-700">
                        {formatMoney(
                          selectedStatements.reduce((sum, row) => sum + row.adjustment_paise, 0),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-amber-800">
                        {formatMoney(
                          selectedStatements.reduce(
                            (sum, row) => sum + row.upad_recovery_paise,
                            0,
                          ),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-stone-950">
                        {formatMoney(
                          selectedStatements.reduce((sum, row) => sum + row.total_due_paise, 0),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-emerald-800">
                        {formatMoney(
                          selectedStatements.reduce((sum, row) => sum + row.paid_paise, 0),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-amber-800">
                        {formatMoney(
                          selectedStatements.reduce((sum, row) => sum + row.closing_paise, 0),
                          { showZero: true },
                        )}
                      </td>
                      <td className="px-5 py-3 hidden print:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Signatures section for print */}
              <div className="hidden print:grid grid-cols-3 gap-8 px-8 pt-12 pb-6 mt-8 border-t border-stone-300 text-xs text-stone-600">
                <div className="border-t border-stone-400 pt-2 text-center">
                  <div className="font-bold">Prepared By</div>
                  <div className="text-[10px] text-stone-400">Accountant / Supervisor</div>
                </div>
                <div className="border-t border-stone-400 pt-2 text-center">
                  <div className="font-bold">Checked & Verified</div>
                  <div className="text-[10px] text-stone-400">Internal Audit</div>
                </div>
                <div className="border-t border-stone-400 pt-2 text-center">
                  <div className="font-bold">Authorized Signatory</div>
                  <div className="text-[10px] text-stone-400">Owner / Manager</div>
                </div>
              </div>

              <div className="border-t border-stone-200 px-6 py-3 text-xs text-stone-400 no-print">
                Calculation: Opening + Earned + Adjustments − Upad Recovery = Total Due. Total Due − Paid = Carried Forward.
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
