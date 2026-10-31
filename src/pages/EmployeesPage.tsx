import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  HandCoins,
  Phone,
  Plus,
  Search,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import {
  createEmployee,
  getPayrollData,
  listEmployees,
  listRates,
  listStatements,
  listUpadEntries,
} from '../lib/api'
import { otDivisor } from '../lib/cycle'
import { addDays, formatDateLong, formatDateShort, todayKey } from '../lib/dates'
import { formatMoney, parseMoneyInput } from '../lib/money'
import { dayPayPaise, getRateForDate, latestStatementByEmployee, upadBalanceForEmployee, upadBreakdownForEmployee } from '../lib/payroll'
import { UpadModal } from '../components/UpadModal'
import { useToast } from '../components/Toast'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Spinner,
  Stat,
  Tabs,
  Textarea,
} from '../components/ui'

type Filter = 'active' | 'inactive' | 'all'

export default function EmployeesPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [upadTargetId, setUpadTargetId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const ratesQuery = useQuery({ queryKey: ['rates'], queryFn: listRates })
  const statementsQuery = useQuery({ queryKey: ['statements'], queryFn: listStatements })
  const upadQuery = useQuery({ queryKey: ['upad'], queryFn: () => listUpadEntries() })
  const today = todayKey()
  const cycleStart = useMemo(() => addDays(today, -30), [today])
  const payrollQuery = useQuery({ queryKey: ['payroll', cycleStart, today], queryFn: () => getPayrollData(cycleStart, today) })
  const divisor = otDivisor(payrollQuery.data?.settings)

  const employees = employeesQuery.data ?? []
  const latestStatements = useMemo(
    () => latestStatementByEmployee(statementsQuery.data ?? []),
    [statementsQuery.data],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return employees.filter((employee) => {
      if (filter === 'active' && !employee.active) return false
      if (filter === 'inactive' && employee.active) return false
      if (!term) return true
      return (
        employee.name.toLowerCase().includes(term) ||
        employee.employee_no.toLowerCase().includes(term) ||
        employee.phone.toLowerCase().includes(term)
      )
    })
  }, [employees, filter, search])

  const totals = useMemo(() => {
    // Exclude future joiners from active staff count and wage bill
    const currentlyActive = employees.filter((employee) => employee.active && (!employee.joined_on || employee.joined_on <= today))
    const totalCarryAll = employees.reduce(
      (sum, employee) => sum + (latestStatements.get(employee.id)?.closing_paise ?? employee.opening_salary_paise ?? 0),
      0,
    )
    const totalCarryActive = currentlyActive.reduce(
      (sum, employee) => sum + (latestStatements.get(employee.id)?.closing_paise ?? employee.opening_salary_paise ?? 0),
      0,
    )
    const totalUpadAll = employees.reduce(
      (sum, employee) => sum + upadBalanceForEmployee(employee, upadQuery.data ?? []),
      0,
    )
    const totalUpadActive = currentlyActive.reduce(
      (sum, employee) => sum + upadBalanceForEmployee(employee, upadQuery.data ?? []),
      0,
    )

    return {
      active: currentlyActive.length,
      totalCount: employees.length,
      dailyWage: currentlyActive.reduce((sum, employee) => sum + employee.daily_rate_paise, 0),
      salaryDue: totalCarryAll,
      salaryDueActive: totalCarryActive,
      upad: totalUpadAll,
      upadActive: totalUpadActive,
    }
  }, [employees, latestStatements, upadQuery.data, today])

  const loading = employeesQuery.isLoading || ratesQuery.isLoading

  return (
    <div>
      <PageHeader
        eyebrow="Team Management"
        title="Employees"
        description="Daily wage rates, joining dates, unpaid balances, and upad advances. History is preserved permanently."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            <span>Add Employee</span>
          </Button>
        }
      />

      {/* KPI Stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Active Staff"
          value={totals.active}
          hint={`${totals.totalCount} staff records (${totals.totalCount - totals.active} inactive/future)`}
          icon={<Users className="h-5 w-5" />}
          tone="teal"
        />
        <Stat
          label="Daily Wage Bill"
          value={formatMoney(totals.dailyWage)}
          hint={`Sum of current ${totals.active} active rates`}
          icon={<Wallet className="h-5 w-5" />}
        />
        <Stat
          label="Salary Due"
          value={formatMoney(totals.salaryDue)}
          hint={`Active: ${formatMoney(totals.salaryDueActive)} · Inactive: ${formatMoney(totals.salaryDue - totals.salaryDueActive)}`}
          tone="amber"
        />
        <Stat
          label="Upad Outstanding"
          value={formatMoney(totals.upad)}
          hint={`Active: ${formatMoney(totals.upadActive)} · Inactive: ${formatMoney(totals.upad - totals.upadActive)}`}
          tone="red"
          icon={<HandCoins className="h-5 w-5" />}
        />
      </div>

      {/* Toolbar */}
      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={filter}
            onChange={(val) => setFilter(val as Filter)}
            options={[
              { id: 'active', label: 'Active', count: totals.active },
              { id: 'inactive', label: 'Inactive', count: totals.totalCount - totals.active },
              { id: 'all', label: 'All Records', count: totals.totalCount },
            ]}
          />

          <div className="w-full sm:w-72">
            <SearchInput
              placeholder="Search by name, #ID, phone…"
              value={search}
              onChange={setSearch}
            />
          </div>
        </div>
      </Card>

      {employeesQuery.isError ? (
        <Card className="p-8">
          <EmptyState
            title="Could not load employees"
            description="Check the local database connection."
            action={<Button onClick={() => employeesQuery.refetch()}>Retry</Button>}
          />
        </Card>
      ) : loading ? (
        <Card className="p-16">
          <div className="flex flex-col items-center justify-center gap-2 text-sm font-semibold text-stone-500">
            <Spinner className="h-6 w-6" />
            <span>Loading employees…</span>
          </div>
        </Card>
      ) : !filtered.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<Users className="h-7 w-7 text-stone-400" />}
            title={
              search
                ? 'No matching employees'
                : filter === 'inactive'
                  ? 'No inactive employees'
                  : 'No employees yet'
            }
            description={
              search
                ? 'Try a different search term or employee ID.'
                : 'Add your first employee to begin tracking attendance and wages.'
            }
            action={
              !search && filter !== 'inactive' ? (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4" /> Add employee
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-2xs">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-stone-50 border-b border-stone-200 text-stone-600 font-extrabold uppercase text-[10px] tracking-wider select-none">
              <tr>
                <th className="py-2.5 px-3">Worker</th>
                <th className="py-2.5 px-2.5">Status</th>
                <th className="py-2.5 px-2.5 text-right">Wage Rate</th>
                <th className="py-2.5 px-2.5 text-right">Unsettled Owed</th>
                <th className="py-2.5 px-2.5 text-right text-stone-500">Chalu Upad</th>
                <th className="py-2.5 px-2.5 text-right text-stone-500">Main Upad</th>
                <th className="py-2.5 px-2.5 text-right">Total Upad</th>
                <th className="py-2.5 px-2.5">Contact</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 font-medium">
              {filtered.map((employee) => {
                const latest = latestStatements.get(employee.id)
                const carry = latest?.closing_paise ?? employee.opening_salary_paise ?? 0
                const employeeAttendance =
                  payrollQuery.data?.attendance?.filter(
                    (a) => a.employee === employee.id && !a.settled_payout,
                  ) ?? []
                let earnedCycle = 0
                for (const a of employeeAttendance) {
                  const r = getRateForDate(employee, ratesQuery.data ?? [], a.date)
                  earnedCycle += dayPayPaise(a.status, a.ot_minutes || 0, r, divisor)
                }
                const employeeAdjustments =
                  payrollQuery.data?.adjustments?.filter(
                    (adj) => adj.employee === employee.id && !adj.settled_payout,
                  ) ?? []
                const adjustmentCycle = employeeAdjustments.reduce(
                  (sum, adj) => sum + (adj.amount_paise || 0),
                  0,
                )
                const owedNow = carry + earnedCycle + adjustmentCycle

                const upadBreakdown = upadBreakdownForEmployee(employee, upadQuery.data ?? [])
                const upadTotal = upadBreakdown.chaluPaise + upadBreakdown.motoPaise

                return (
                  <tr
                    key={employee.id}
                    className={`hover:bg-stone-50/80 transition-colors ${
                      !employee.active ? 'opacity-60 bg-stone-50/30' : ''
                    }`}
                  >
                    {/* 1. Worker */}
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => onNavigate(`employees/${employee.id}`)}
                        className="flex items-center gap-2.5 text-left group"
                      >
                        <Avatar name={employee.name} size="sm" />
                        <div>
                          <div className="font-extrabold text-stone-900 group-hover:text-emerald-700 transition">
                            {employee.name}
                          </div>
                          <div className="text-[10px] text-stone-400">
                            #{employee.employee_no}
                            {employee.joined_on && (
                              <span> · Joined {formatDateShort(employee.joined_on)}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    </td>

                    {/* 2. Status */}
                    <td className="py-2 px-2.5">
                      <Badge tone={employee.active ? 'green' : 'neutral'} dot>
                        {employee.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>

                    {/* 3. Wage Rate */}
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-stone-900">
                      {formatMoney(employee.daily_rate_paise)}
                      <span className="text-[10px] text-stone-400 font-normal">/d</span>
                    </td>

                    {/* 4. Unsettled Owed */}
                    <td className="py-2 px-2.5 text-right tabular-nums">
                      <span
                        className={`font-black ${owedNow > 0 ? 'text-amber-800' : 'text-stone-700'}`}
                      >
                        {formatMoney(owedNow, { showZero: true })}
                      </span>
                      {carry > 0 && (
                        <div className="text-[9px] text-stone-400">Carry: {formatMoney(carry)}</div>
                      )}
                    </td>

                    {/* 5. Chalu Upad */}
                    <td className="py-2 px-2.5 text-right tabular-nums text-stone-600">
                      {upadBreakdown.chaluPaise > 0 ? (
                        <span className="font-semibold text-amber-900">
                          {formatMoney(upadBreakdown.chaluPaise)}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>

                    {/* 6. Main Upad */}
                    <td className="py-2 px-2.5 text-right tabular-nums text-stone-600">
                      {upadBreakdown.motoPaise > 0 ? (
                        <span className="font-semibold text-purple-900">
                          {formatMoney(upadBreakdown.motoPaise)}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>

                    {/* 7. Total Upad */}
                    <td className="py-2 px-2.5 text-right tabular-nums">
                      <span
                        className={`font-black ${upadTotal > 0 ? 'text-rose-700' : 'text-stone-400'}`}
                      >
                        {formatMoney(upadTotal, { showZero: true })}
                      </span>
                    </td>

                    {/* 8. Contact */}
                    <td className="py-2 px-2.5 text-stone-600 whitespace-nowrap">
                      {employee.phone ? (
                        <a
                          href={`tel:${employee.phone}`}
                          className="inline-flex items-center gap-1 hover:text-emerald-700 transition"
                          title="Call employee"
                        >
                          <Phone className="h-3 w-3 text-stone-400" />
                          <span>{employee.phone}</span>
                        </a>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>

                    {/* 9. Actions */}
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setUpadTargetId(employee.id)}
                          className="rounded-lg border border-stone-200 bg-stone-50 hover:bg-amber-50 hover:border-amber-300 px-2 py-1 text-xs font-bold text-amber-800 transition"
                          title="Give upad or record cash return"
                        >
                          + Upad
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigate(`payout?worker=${employee.id}`)}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900 transition"
                          title="Open payout screen"
                        >
                          Pay
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigate(`employees/${employee.id}`)}
                          className="rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 px-2 py-1 text-xs font-bold text-stone-700 transition"
                          title="View full profile and history"
                        >
                          View →
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Employee Modal */}
      <AddEmployeeModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          queryClient.invalidateQueries({ queryKey: ['employees'] })
          queryClient.invalidateQueries({ queryKey: ['rates'] })
          queryClient.invalidateQueries({ queryKey: ['periods'] })
          setAddOpen(false)
          onNavigate(`employees/${id}`)
        }}
      />

      {/* Quick Upad Modal for single employee */}
      {upadTargetId && (
        <UpadModal
          open
          onClose={() => setUpadTargetId(null)}
          employees={employees}
          defaultEmployeeId={upadTargetId}
        />
      )}
    </div>
  )
}

function AddEmployeeModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [employeeNo, setEmployeeNo] = useState('')
  const [phone, setPhone] = useState('')
  const [rate, setRate] = useState('450')
  const [joinedOn, setJoinedOn] = useState(todayKey())
  const [openingSalary, setOpeningSalary] = useState('')
  const [openingChalu, setOpeningChalu] = useState('')
  const [openingMoto, setOpeningMoto] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: () =>
      createEmployee({
        name,
        employeeNo: employeeNo || undefined,
        phone,
        ratePaise: parseMoneyInput(rate),
        joinedOn,
        openingSalaryPaise: parseMoneyInput(openingSalary),
        openingChaluPaise: parseMoneyInput(openingChalu),
        openingMotoPaise: parseMoneyInput(openingMoto),
        openingDate: joinedOn,
        notes,
      }),
    onSuccess: (employee) => {
      toast(`${employee.name} added successfully`)
      setName('')
      setEmployeeNo('')
      setPhone('')
      setRate('450')
      setJoinedOn(todayKey())
      setOpeningSalary('')
      setOpeningChalu('')
      setOpeningMoto('')
      setNotes('')
      onCreated(employee.id)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not add employee'),
  })

  function submit() {
    setError('')
    if (!name.trim()) return setError('Enter the employee name.')
    if (parseMoneyInput(rate) <= 0) return setError('Enter a daily wage rate greater than zero.')
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add New Employee"
      description="Create employee profile with initial daily rate and optional opening balances."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Add Employee
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Full Name" className="sm:col-span-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Ramesh Patel"
              autoFocus
            />
          </Field>
          <Field label="Employee Number" hint="Leave blank to auto-assign next number.">
            <Input
              value={employeeNo}
              onChange={(event) => setEmployeeNo(event.target.value)}
              placeholder="Auto-generated"
            />
          </Field>
          <Field label="Phone Number">
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="e.g. 98250 12345"
            />
          </Field>
          <Field label="Daily Wage Rate (₹)">
            <Input
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              placeholder="450"
            />
          </Field>
          <Field label="Joined On Date">
            <Input
              type="date"
              value={joinedOn}
              onChange={(event) => setJoinedOn(event.target.value)}
            />
          </Field>
          <Field label="Opening Salary Due (₹)" hint="Unpaid carryover balance if migrating.">
            <Input
              inputMode="decimal"
              value={openingSalary}
              onChange={(event) => setOpeningSalary(event.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Opening Chalu Upad (₹)" hint="Small running advance owed.">
            <Input
              inputMode="decimal"
              value={openingChalu}
              onChange={(event) => setOpeningChalu(event.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Opening Main Upad (₹)" hint="Large/long-term advance owed.">
            <Input
              inputMode="decimal"
              value={openingMoto}
              onChange={(event) => setOpeningMoto(event.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <Field label="Internal Notes" hint="Optional notes (role, machine, skills)">
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Senior machine operator, shift A"
          />
        </Field>

        <div className="rounded-2xl border border-teal-200 bg-teal-50/80 px-4 py-3 text-xs leading-relaxed text-teal-900">
          A rate record and employment period will be created automatically starting from the joined date.
        </div>

        {error && <div className="text-xs font-bold text-rose-600">{error}</div>}
      </div>
    </Modal>
  )
}
