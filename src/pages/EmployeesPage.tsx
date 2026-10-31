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
  listEmployees,
  listRates,
  listStatements,
  listUpadEntries,
} from '../lib/api'
import { formatDateLong, todayKey } from '../lib/dates'
import { formatMoney, parseMoneyInput } from '../lib/money'
import { latestStatementByEmployee, upadBalanceForEmployee } from '../lib/payroll'
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
    const active = employees.filter((employee) => employee.active)
    return {
      active: active.length,
      totalCount: employees.length,
      dailyWage: active.reduce((sum, employee) => sum + employee.daily_rate_paise, 0),
      salaryDue: active.reduce(
        (sum, employee) =>
          sum +
          (latestStatements.get(employee.id)?.closing_paise ?? employee.opening_salary_paise ?? 0),
        0,
      ),
      upad: active.reduce(
        (sum, employee) => sum + upadBalanceForEmployee(employee, upadQuery.data ?? []),
        0,
      ),
    }
  }, [employees, latestStatements, upadQuery.data])

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
          hint={`${totals.totalCount} total staff records`}
          icon={<Users className="h-5 w-5" />}
          tone="teal"
        />
        <Stat
          label="Daily Wage Bill"
          value={formatMoney(totals.dailyWage)}
          hint="Sum of current active rates"
          icon={<Wallet className="h-5 w-5" />}
        />
        <Stat
          label="Salary Due"
          value={formatMoney(totals.salaryDue)}
          hint="Unpaid carry-forward salary"
          tone="amber"
        />
        <Stat
          label="Upad Outstanding"
          value={formatMoney(totals.upad)}
          hint="Advances across active staff"
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
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((employee) => {
            const latest = latestStatements.get(employee.id)
            const salaryDue = latest?.closing_paise ?? employee.opening_salary_paise ?? 0
            const upad = upadBalanceForEmployee(employee, upadQuery.data ?? [])

            return (
              <Card
                key={employee.id}
                className={clsx(
                  'group flex flex-col justify-between p-4 transition-all duration-200 hover:border-teal-400 hover:shadow-md',
                  !employee.active && 'bg-stone-50/70 opacity-75',
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={employee.name} size="md" />
                      <div className="min-w-0">
                        <div className="truncate text-base font-extrabold text-stone-900 group-hover:text-teal-700 transition">
                          {employee.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400">
                          <span className="font-semibold text-stone-500">#{employee.employee_no}</span>
                          {employee.phone && (
                            <>
                              <span>•</span>
                              <a
                                href={`tel:${employee.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 hover:text-teal-600 transition"
                                title="Click to call"
                              >
                                <Phone className="h-3 w-3" />
                                <span>{employee.phone}</span>
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Badge tone={employee.active ? 'green' : 'neutral'} dot>
                      {employee.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  {/* Rate & Balances grid */}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-stone-200/80 bg-stone-50/70 px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                        Daily Wage Rate
                      </div>
                      <div className="mt-0.5 text-sm font-black text-stone-900 tabular-nums">
                        {formatMoney(employee.daily_rate_paise)}/d
                      </div>
                    </div>

                    <div
                      className={clsx(
                        'rounded-xl border px-3 py-2',
                        salaryDue > 0
                          ? 'border-amber-200 bg-amber-50/80'
                          : 'border-stone-200/80 bg-stone-50/70',
                      )}
                    >
                      <div
                        className={clsx(
                          'text-[10px] font-bold uppercase tracking-wider',
                          salaryDue > 0 ? 'text-amber-700' : 'text-stone-400',
                        )}
                      >
                        Salary Due
                      </div>
                      <div
                        className={clsx(
                          'mt-0.5 text-sm font-black tabular-nums',
                          salaryDue > 0 ? 'text-amber-800' : 'text-stone-900',
                        )}
                      >
                        {formatMoney(salaryDue, { showZero: true })}
                      </div>
                    </div>
                  </div>

                  {/* Upad status */}
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-stone-50/60 px-3 py-2 text-xs">
                    <span className="text-stone-500">Upad Balance:</span>
                    <span
                      className={clsx(
                        'font-black tabular-nums',
                        upad > 0 ? 'text-rose-600' : 'text-stone-700',
                      )}
                    >
                      {formatMoney(upad, { showZero: true })}
                    </span>
                  </div>
                </div>

                {/* Card actions footer */}
                <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setUpadTargetId(employee.id)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50 transition"
                  >
                    <HandCoins className="h-3.5 w-3.5" />
                    <span>+ Give Upad</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate(`employees/${employee.id}`)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-50 transition"
                  >
                    <span>View Profile</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Card>
            )
          })}
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
