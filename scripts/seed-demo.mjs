import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import PocketBase from 'pocketbase'

const root = resolve(import.meta.dirname, '..')
const envPath = join(root, '.env.local')

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || match[1].startsWith('#')) continue
    process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, '')
  }
}

const url = process.env.PB_URL || 'http://127.0.0.1:8090'
const email = process.env.PB_ADMIN_EMAIL
const password = process.env.PB_ADMIN_PASSWORD
const reset = process.argv.includes('--reset')

if (!email || !password) {
  console.error('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD in .env.local.')
  process.exit(1)
}

const pb = new PocketBase(url)
pb.autoCancellation(false)
await pb.collection('_superusers').authWithPassword(email, password)

const existing = await pb.collection('employees').getList(1, 1)
if (existing.totalItems > 0 && !reset) {
  console.error('Employees already exist. Run with --reset to replace all demo data.')
  process.exit(1)
}

const collections = [
  'audit_log',
  'upad_entries',
  'salary_payments',
  'statements',
  'payout_runs',
  'adjustments',
  'attendance',
  'employment_periods',
  'rate_history',
  'employees',
  'settings',
]

for (const collection of collections) {
  const records = await pb.collection(collection).getFullList()
  for (const record of records) await pb.collection(collection).delete(record.id)
}

const settings = [
  ['first_cycle_start', '2026-10-01'],
  ['ot_divisor', '8'],
  ['business_name', 'હાજરી પગાર'],
  ['expected_payout_weekday', '4'],
  ['app_version', '1'],
]

for (const [key, value] of settings) {
  await pb.collection('settings').create({ key, value })
}

const iso = (date) => `${date} 00:00:00.000Z`
const day = (date) => date.slice(0, 10)
const friday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5

const employeeSpecs = [
  {
    key: 'ramesh',
    employee_no: '1',
    name: 'Ramesh Patel',
    phone: '98765 11001',
    rate: 50000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Steady attendance, overtime and a festival bonus.',
  },
  {
    key: 'suresh',
    employee_no: '2',
    name: 'Suresh Desai',
    phone: '98765 11002',
    rate: 40000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Rate changed from ₹400 to ₹450 on 12 Oct.',
  },
  {
    key: 'mahesh',
    employee_no: '3',
    name: 'Mahesh Joshi',
    phone: '98765 11003',
    rate: 50000,
    joined: '2026-10-12',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Joined mid-cycle.',
  },
  {
    key: 'kiran',
    employee_no: '4',
    name: 'Kiran Shah',
    phone: '98765 11004',
    rate: 40000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Absences, deductions, partial payment and upad.',
  },
  {
    key: 'vijay',
    employee_no: '5',
    name: 'Vijay Mehta',
    phone: '98765 11005',
    rate: 45000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 100000,
    active: true,
    note: 'Large opening upad with repeated advances and recoveries.',
  },
  {
    key: 'prakash',
    employee_no: '6',
    name: 'Prakash Solanki',
    phone: '98765 11006',
    rate: 40000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: false,
    note: 'Left mid-month with unpaid salary and upad.',
  },
  {
    key: 'rekhaben',
    employee_no: '7',
    name: 'Rekhaben Patel',
    phone: '98765 11007',
    rate: 40000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Took a break and rejoined on 20 Oct.',
  },
  {
    key: 'alpesh',
    employee_no: '8',
    name: 'Alpesh Chauhan',
    phone: '98765 11008',
    rate: 50000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Simple employee with no upad or carry.',
  },
  {
    key: 'nilesh',
    employee_no: '9',
    name: 'Nilesh Trivedi',
    phone: '98765 11009',
    rate: 45000,
    joined: '2026-10-01',
    openingSalary: 100000,
    openingUpad: 50000,
    active: true,
    note: 'Opening salary carry and no attendance in the open cycle.',
  },
  {
    key: 'dinesh',
    employee_no: '10',
    name: 'Dinesh Rawal',
    phone: '98765 11010',
    rate: 55000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Friday work, heavy overtime and a rate change.',
  },
  {
    key: 'bharat',
    employee_no: '11',
    name: 'Bharat Prajapati',
    phone: '98765 11011',
    rate: 50000,
    joined: '2026-09-15',
    openingSalary: 250000,
    openingUpad: 100000,
    active: true,
    note: 'Opening salary and upad carried into October.',
  },
  {
    key: 'kunal',
    employee_no: '12',
    name: 'Kunal Bhatt',
    phone: '98765 11012',
    rate: 40000,
    joined: '2026-11-02',
    openingSalary: 0,
    openingUpad: 0,
    active: true,
    note: 'Future joiner, excluded from the October payout.',
  },
]

const people = new Map()
const rateRows = []
const periodRows = []

for (const spec of employeeSpecs) {
  const employee = await pb.collection('employees').create({
    employee_no: spec.employee_no,
    name: spec.name,
    phone: spec.phone,
    active: spec.active,
    daily_rate_paise: spec.rate,
    opening_salary_paise: spec.openingSalary,
    opening_upad_paise: spec.openingUpad,
    opening_chalu_paise: spec.openingChalu ?? spec.openingUpad ?? 0,
    opening_moto_paise: spec.openingMoto ?? 0,
    opening_date: spec.openingDate || '2026-09-30',
    joined_on: iso(spec.joined),
    notes: spec.note,
    sort_order: Number(spec.employee_no),
  })
  people.set(spec.key, employee)

  const rate = await pb.collection('rate_history').create({
    employee: employee.id,
    effective_from: iso(spec.joined),
    daily_rate_paise: spec.rate,
    note: 'Opening rate',
  })
  rateRows.push(rate)
}

async function addRate(key, effectiveFrom, ratePaise, note) {
  const employee = people.get(key)
  const rate = await pb.collection('rate_history').create({
    employee: employee.id,
    effective_from: iso(effectiveFrom),
    daily_rate_paise: ratePaise,
    note,
  })
  rateRows.push(rate)
  await pb.collection('employees').update(employee.id, { daily_rate_paise: ratePaise })
}

await addRate('suresh', '2026-10-12', 45000, 'Rate increased mid-cycle')
await addRate('dinesh', '2026-10-19', 60000, 'Rate increased after review')

async function addPeriod(key, startDate, endDate, note) {
  const employee = people.get(key)
  const period = await pb.collection('employment_periods').create({
    employee: employee.id,
    start_date: iso(startDate),
    end_date: endDate ? iso(endDate) : '',
    note,
  })
  periodRows.push(period)
}

for (const spec of employeeSpecs) {
  if (spec.key === 'prakash') continue
  if (spec.key === 'rekhaben') continue
  await addPeriod(spec.key, spec.joined, '', 'Opening period')
}
await addPeriod('prakash', '2026-10-01', '2026-10-18', 'Left mid-month')
await addPeriod('rekhaben', '2026-10-01', '2026-10-09', 'Break from work')
await addPeriod('rekhaben', '2026-10-20', '', 'Rejoined')

const attendanceRows = []

function workDates(start, end) {
  const dates = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10)
    if (!friday(date)) dates.push(date)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function fullDays(dates) {
  return new Map(dates.map((date) => [date, { status: 'full', ot: 0, note: '' }]))
}

function setStatus(days, date, status, ot = 0, note = '') {
  days.set(date, { status, ot, note })
}

function addFriday(days, date, ot = 0, note = 'Friday work') {
  days.set(date, { status: 'full', ot, note })
}

async function saveDays(key, days, maxDate, minDate) {
  const employee = people.get(key)
  for (const [date, entry] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (maxDate && date > maxDate) continue
    if (minDate && date < minDate) continue
    if (date < day(employee.joined_on)) continue
    const record = await pb.collection('attendance').create({
      employee: employee.id,
      date: iso(date),
      status: entry.status,
      ot_minutes: entry.ot,
      note: entry.note,
    })
    attendanceRows.push(record)
  }
}

const cycleOneDates = workDates('2026-10-01', '2026-10-08')
{
  const days = fullDays(cycleOneDates)
  setStatus(days, '2026-10-06', 'full', 90, 'Late closing')
  addFriday(days, '2026-10-02', 60)
  await saveDays('ramesh', days)
}
{
  const days = fullDays(cycleOneDates)
  setStatus(days, '2026-10-06', 'half', 0, 'Half day')
  setStatus(days, '2026-10-07', 'absent', 0, 'Absent')
  await saveDays('suresh', days)
}
{
  const days = fullDays(cycleOneDates)
  for (const date of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
    setStatus(days, date, 'absent', 0, 'Absent')
  }
  await saveDays('kiran', days)
}
{
  const days = fullDays(cycleOneDates)
  await saveDays('vijay', days)
}
{
  const days = fullDays(cycleOneDates)
  setStatus(days, '2026-10-07', 'half', 0, 'Half day')
  setStatus(days, '2026-10-08', 'absent', 0, 'Absent')
  await saveDays('prakash', days)
}
{
  const days = fullDays(cycleOneDates)
  addFriday(days, '2026-10-02', 0)
  await saveDays('rekhaben', days)
}
{
  const days = fullDays(cycleOneDates)
  await saveDays('alpesh', days)
}
{
  const days = fullDays(cycleOneDates)
  for (const date of ['2026-10-06', '2026-10-07', '2026-10-08']) {
    setStatus(days, date, 'absent', 0, 'Absent')
  }
  await saveDays('nilesh', days)
}
{
  const days = fullDays(cycleOneDates)
  setStatus(days, '2026-10-01', 'full', 120, 'Overtime')
  setStatus(days, '2026-10-07', 'full', 60, 'Overtime')
  addFriday(days, '2026-10-02', 120)
  await saveDays('dinesh', days)
}
{
  const days = fullDays(cycleOneDates)
  await saveDays('bharat', days)
}

const cycleTwoDates = workDates('2026-10-09', '2026-10-15')
{
  const days = fullDays(cycleTwoDates)
  setStatus(days, '2026-10-13', 'full', 60, 'Overtime')
  await saveDays('ramesh', days)
}
{
  const days = fullDays(cycleTwoDates)
  setStatus(days, '2026-10-12', 'half', 0, 'Half day')
  setStatus(days, '2026-10-15', 'absent', 0, 'Absent')
  await saveDays('suresh', days)
}
{
  const days = fullDays(cycleTwoDates)
  await saveDays('mahesh', days, '2026-10-15')
}
{
  const days = fullDays(cycleTwoDates)
  setStatus(days, '2026-10-13', 'half', 0, 'Half day')
  setStatus(days, '2026-10-14', 'absent', 0, 'Absent')
  setStatus(days, '2026-10-15', 'absent', 0, 'Absent')
  await saveDays('kiran', days)
}
{
  const days = fullDays(cycleTwoDates)
  await saveDays('vijay', days)
}
{
  const days = fullDays(cycleTwoDates)
  await saveDays('prakash', days)
}
{
  const days = fullDays(cycleTwoDates)
  await saveDays('alpesh', days)
}
{
  const days = fullDays(cycleTwoDates)
  await saveDays('nilesh', days)
}
{
  const days = fullDays(cycleTwoDates)
  setStatus(days, '2026-10-15', 'full', 90, 'Overtime')
  await saveDays('dinesh', days)
}
{
  const days = fullDays(cycleTwoDates)
  await saveDays('bharat', days)
}

const openDates = workDates('2026-10-16', '2026-10-24')
{
  const days = fullDays(openDates)
  setStatus(days, '2026-10-20', 'absent', 0, 'Personal leave')
  addFriday(days, '2026-10-23', 60)
  await saveDays('ramesh', days)
}
{
  const days = fullDays(openDates)
  setStatus(days, '2026-10-24', 'half', 0, 'Half day')
  await saveDays('suresh', days)
}
{
  const days = fullDays(openDates)
  setStatus(days, '2026-10-21', 'full', 90, 'Overtime')
  await saveDays('mahesh', days)
}
{
  const days = fullDays(openDates)
  for (const date of ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-24']) {
    setStatus(days, date, 'absent', 0, 'Absent')
  }
  await saveDays('kiran', days)
}
{
  const days = fullDays(openDates)
  addFriday(days, '2026-10-23', 0)
  await saveDays('vijay', days)
}
{
  const days = fullDays(openDates)
  await saveDays('prakash', days, '2026-10-18')
}
{
  const days = fullDays(openDates)
  addFriday(days, '2026-10-23', 0)
  await saveDays('rekhaben', days, '2026-10-24', '2026-10-20')
}
{
  const days = fullDays(openDates)
  addFriday(days, '2026-10-23', 0)
  await saveDays('alpesh', days)
}
{
  const days = fullDays(openDates)
  setStatus(days, '2026-10-19', 'full', 120, 'Overtime')
  setStatus(days, '2026-10-24', 'full', 90, 'Overtime')
  addFriday(days, '2026-10-23', 0)
  await saveDays('dinesh', days)
}
{
  const days = fullDays(openDates)
  addFriday(days, '2026-10-23', 0)
  await saveDays('bharat', days)
}

const adjustments = [
  ['kiran', '2026-10-08', -50000, 'Damage deduction'],
  ['bharat', '2026-10-07', 100000, 'Festival bonus'],
  ['dinesh', '2026-10-08', 30000, 'Travel reimbursement'],
  ['ramesh', '2026-10-13', 100000, 'Festival bonus'],
  ['mahesh', '2026-10-13', 50000, 'Festival bonus'],
  ['kiran', '2026-10-14', -20000, 'Late deduction'],
  ['ramesh', '2026-10-20', 100000, 'Diwali bonus'],
  ['dinesh', '2026-10-21', -30000, 'Tool damage'],
  ['mahesh', '2026-10-22', 50000, 'Travel reimbursement'],
]

for (const [key, date, amount, note] of adjustments) {
  await pb.collection('adjustments').create({
    employee: people.get(key).id,
    date: iso(date),
    amount_paise: amount,
    note,
  })
}

const upadRows = []

async function addUpad(key, date, kind, amount, note, category = 'chalu', statement = '') {
  const bucket = category === 'extra' || category === 'moto' ? 'moto' : 'chalu'
  const entry = await pb.collection('upad_entries').create({
    employee: people.get(key).id,
    date: iso(date),
    kind,
    category: bucket,
    bucket,
    amount_paise: amount,
    note,
    statement,
    voided: false,
  })
  upadRows.push({ ...entry, bucket, category: bucket })
  return entry
}

await addUpad('suresh', '2026-10-02', 'given', 30000, 'Medicine advance', 'chalu')
await addUpad('nilesh', '2026-10-03', 'given', 50000, 'Festival advance', 'chalu')
await addUpad('prakash', '2026-10-05', 'given', 40000, 'Travel advance', 'chalu')
await addUpad('kiran', '2026-10-06', 'given', 20000, 'Small advance', 'chalu')
await addUpad('vijay', '2026-10-10', 'given', 30000, 'Festival advance', 'chalu')
await addUpad('suresh', '2026-10-14', 'writeoff', 20000, 'Small balance written off', 'chalu')
await addUpad('vijay', '2026-10-18', 'given', 50000, 'Family emergency', 'moto')
await addUpad('kiran', '2026-10-19', 'given', 30000, 'Advance', 'moto')
await addUpad('mahesh', '2026-10-20', 'given', 20000, 'Advance', 'chalu')
await addUpad('rekhaben', '2026-10-21', 'given', 10000, 'Advance', 'chalu')

function rateForDate(employee, date) {
  const rows = rateRows
    .filter((row) => row.employee === employee.id && day(row.effective_from) <= date)
    .sort((a, b) => day(a.effective_from).localeCompare(day(b.effective_from)))
  return rows.length ? rows[rows.length - 1].daily_rate_paise : employee.daily_rate_paise
}

function paidForStatus(status, rate, ot) {
  const base = status === 'full' ? rate : status === 'half' ? rate * 0.5 : 0
  return Math.round(base) + Math.round((rate * Math.max(0, ot)) / 480)
}

function upadBreakdown(employee, throughDate) {
  let chalu = employee.opening_chalu_paise ?? employee.opening_upad_paise ?? 0
  let moto = employee.opening_moto_paise ?? 0
  for (const entry of upadRows) {
    if (entry.employee !== employee.id || day(entry.date) > throughDate) continue
    const amount = Math.abs(entry.amount_paise || 0)
    const delta =
      entry.kind === 'given'
        ? amount
        : entry.kind === 'recovery' || entry.kind === 'returned' || entry.kind === 'writeoff'
          ? -amount
          : 0
    if (entry.bucket === 'moto' || entry.category === 'extra' || entry.category === 'moto') moto += delta
    else chalu += delta
  }
  // Spec: Buckets NEVER auto-shift between Chalu and Moto!
  chalu = Math.max(0, Math.round(chalu))
  moto = Math.max(0, Math.round(moto))
  return { chalu, moto, regular: chalu, extra: moto, total: chalu + moto }
}

const latestClosing = new Map()

function computeRows(start, end, inputs) {
  const rows = []
  for (const spec of employeeSpecs) {
    const employee = people.get(spec.key)
    if (day(employee.joined_on) > end) continue
    if (spec.key === 'kunal') continue
    if (spec.key === 'rekhaben' && end === '2026-10-15') continue

    const entries = attendanceRows.filter(
      (record) =>
        record.employee === employee.id && day(record.date) >= start && day(record.date) <= end,
    )
    if (!entries.length && spec.key !== 'nilesh' && spec.key !== 'bharat') continue

    let earned = 0
    let daysWorked = 0
    let otMinutes = 0
    for (const record of entries) {
      earned += paidForStatus(record.status, rateForDate(employee, day(record.date)), record.ot_minutes)
      daysWorked += record.status === 'full' ? 1 : record.status === 'half' ? 0.5 : 0
      otMinutes += record.ot_minutes
    }

    const opening = latestClosing.get(employee.id) ?? employee.opening_salary_paise ?? 0
    const adjustment = adjustments
      .filter(([key, date]) => key === spec.key && date >= start && date <= end)
      .reduce((sum, [, , amount]) => sum + amount, 0)
    const upad = upadBreakdown(employee, end)
    const input = inputs[spec.key] || {}
    const beforeRecovery = opening + earned + adjustment
    const chaluRecovery = Math.min(
      input.chaluRecovery ?? input.recovery ?? 0,
      upad.chalu,
      Math.max(0, beforeRecovery),
    )
    const motoRecovery = Math.min(
      input.motoRecovery ?? 0,
      upad.moto,
      Math.max(0, beforeRecovery - chaluRecovery),
    )
    const recovery = chaluRecovery + motoRecovery
    const due = Math.max(0, beforeRecovery - recovery)
    const paid = Math.max(0, Math.min(input.paid ?? due, due))
    const closing = due - paid

    rows.push({
      employee,
      opening,
      earned,
      adjustment,
      upadOutstanding: upad.total,
      chaluOutstanding: upad.chalu,
      motoOutstanding: upad.moto,
      regularOutstanding: upad.chalu,
      extraOutstanding: upad.moto,
      recovery,
      chaluRecovery,
      motoRecovery,
      regularRecovery: chaluRecovery,
      extraRecovery: motoRecovery,
      due,
      paid,
      closing,
      daysWorked,
      otMinutes,
      note: input.note || '',
    })
  }
  return rows
}

async function seedPayout({ start, end, inputs, note }) {
  const rows = computeRows(start, end, inputs)
  const totalDue = rows.reduce((sum, row) => sum + row.due, 0)
  const totalPaid = rows.reduce((sum, row) => sum + row.paid, 0)
  const totalRecovery = rows.reduce((sum, row) => sum + row.recovery, 0)

  const run = await pb.collection('payout_runs').create({
    cycle_start: iso(start),
    payout_date: iso(end),
    cutoff_date: iso(end),
    status: 'closed',
    note,
    total_due_paise: totalDue,
    total_paid_paise: totalPaid,
    total_upad_recovery_paise: totalRecovery,
    employee_count: rows.length,
    voided: false,
  })

  for (const row of rows) {
    const statement = await pb.collection('statements').create({
      payout_run: run.id,
      employee: row.employee.id,
      cycle_start: iso(start),
      payout_date: iso(end),
      opening_paise: row.opening,
      earned_paise: row.earned,
      adjustment_paise: row.adjustment,
      upad_outstanding_paise: row.upadOutstanding,
      upad_recovery_paise: row.recovery,
      total_due_paise: row.due,
      paid_paise: row.paid,
      closing_paise: row.closing,
      days_worked: row.daysWorked,
      ot_minutes: row.otMinutes,
      note: row.note,
      voided: false,
    })

    if (row.paid > 0) {
      await pb.collection('salary_payments').create({
        employee: row.employee.id,
        statement: statement.id,
        paid_on: iso(end),
        amount_paise: row.paid,
        note: 'Demo payout',
        voided: false,
      })
    }

    if (row.chaluRecovery > 0) {
      await addUpad(
        employeeKey(row.employee.id),
        end,
        'recovery',
        row.chaluRecovery,
        'Recovered in payout (Chalu)',
        'chalu',
        statement.id,
      )
    }
    if (row.motoRecovery > 0) {
      await addUpad(
        employeeKey(row.employee.id),
        end,
        'recovery',
        row.motoRecovery,
        'Recovered in payout (Main)',
        'moto',
        statement.id,
      )
    }

    latestClosing.set(row.employee.id, row.closing)
  }

  // Mark settled_payout on settled attendance rows
  for (const record of attendanceRows) {
    if (day(record.date) >= start && day(record.date) <= end) {
      await pb.collection('attendance').update(record.id, { settled_payout: run.id }).catch(() => {})
    }
  }

  return run
}

function employeeKey(id) {
  for (const [key, employee] of people.entries()) {
    if (employee.id === id) return key
  }
  throw new Error(`Unknown employee ${id}`)
}

const runOne = await seedPayout({
  start: '2026-10-01',
  end: '2026-10-08',
  note: 'Opening cycle with partial payments and upad recovery',
  inputs: {
    kiran: { paid: 50000, note: '₹500 carried forward' },
    vijay: { chaluRecovery: 50000 },
    prakash: { paid: 0, note: 'Unpaid salary carried forward' },
    nilesh: { paid: 150000, note: 'Partial payment' },
    bharat: { chaluRecovery: 50000 },
  },
})

const runTwo = await seedPayout({
  start: '2026-10-09',
  end: '2026-10-15',
  note: 'Second cycle with bonus, write-off and a large carry',
  inputs: {
    kiran: { chaluRecovery: 20000 },
    vijay: { chaluRecovery: 20000 },
    prakash: { paid: 250000, note: 'Part payment' },
    nilesh: { paid: 0, note: 'Unpaid salary carried forward' },
    bharat: { chaluRecovery: 50000 },
  },
})

await addUpad(
  'vijay',
  '2026-10-22',
  'returned',
  10000,
  'Returned part of the Main upad in cash',
  'moto',
)

await pb.collection('audit_log').create({
  action: 'demo.seed',
  entity: 'system',
  entity_id: 'seed-demo',
  details: `Created ${employeeSpecs.length} employees, ${attendanceRows.length} attendance days, 2 closed payouts and an open October cycle.`,
})

console.log('Demo data ready.')
console.log(`Employees: ${employeeSpecs.length}`)
console.log(`Attendance rows: ${attendanceRows.length}`)
console.log(`Closed payouts: ${runOne.payout_date.slice(0, 10)}, ${runTwo.payout_date.slice(0, 10)}`)
console.log('Open cycle starts: 2026-10-16')
console.log('Edge cases included: mid-cycle joining, rate changes, Friday work, overtime, half days, absences, partial payments, unpaid carry, upad advances, recovery, write-off, inactive employee, rejoined employee, opening balances, future joiner.')
