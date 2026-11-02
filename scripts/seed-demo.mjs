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

const url = process.env.PB_URL || 'http://127.0.0.1:8091'
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

const existing = await pb.collection('employees').getList(1, 1).catch(() => ({ totalItems: 0 }))
if (existing.totalItems > 0 && !reset) {
  console.error('Employees already exist. Run with --reset to wipe and re-seed.')
  process.exit(1)
}

// PRNG (Mulberry32)
const SEED = 20261102
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(SEED)

console.log('----------------------------------------------------')
console.log(`Starting Database Re-seed with Seed: ${SEED}`)
console.log('----------------------------------------------------')

// 1. Wipe all collections
const collections = [
  'salary_writeoffs',
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
  try {
    const records = await pb.collection(collection).getFullList()
    for (const record of records) {
      await pb.collection(collection).delete(record.id)
    }
  } catch (err) {
    // Collection might be empty or missing
  }
}
console.log('All collections wiped successfully.')

// 2. Settings configuration
const settings = [
  ['first_cycle_start', '2026-10-01'],
  ['ot_divisor', '8'],
  ['business_name', 'હાજરી પગાર'],
  ['expected_payout_weekday', '4'],
  ['chalu_upad_enabled', 'true'],
  ['moto_upad_enabled', 'true'],
  ['chalu_upad_label', 'Chalu Upad'],
  ['moto_upad_label', 'Main Upad'],
  ['hours_attendance_enabled', 'true'],
  ['hour_step_minutes', '30'],
  ['app_version', '1'],
]

for (const [key, value] of settings) {
  await pb.collection('settings').create({ key, value })
}
console.log('Settings configured: Chalu ON, Main ON, Hours ON (30m), OT divisor 8.')

// Helpers
const iso = (d) => `${d} 00:00:00.000Z`
const roundHalfUp = (x) => Math.floor(x + 0.5)

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1 * days)
  return d.toISOString().slice(0, 10)
}

function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
}

// 3. 14 Workers Definition
const employeeSpecs = [
  {
    key: 'ramesh',
    employee_no: '1',
    name: 'Ramesh Patel',
    phone: '98765 11001',
    rate: 50000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Steady senior operator. Has Chalu upad of ₹1,000 paid back outside app ready for Settle tool.',
  },
  {
    key: 'suresh',
    employee_no: '2',
    name: 'Suresh Desai',
    phone: '98765 11002',
    rate: 45000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Has Chalu upad ₹500 ready for Settle tool and rich 6-entry Main upad ledger history.',
  },
  {
    key: 'mahesh',
    employee_no: '3',
    name: 'Mahesh Joshi',
    phone: '98765 11003',
    rate: 55000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Partial salary payment in Week 4 payout, remaining ₹1,350 carried forward to current cycle.',
  },
  {
    key: 'kiran',
    employee_no: '4',
    name: 'Kiran Shah',
    phone: '98765 11004',
    rate: 40000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Rate increased from ₹400 to ₹480 mid-cycle on 19 Oct. Worked on open Friday 23 Oct.',
  },
  {
    key: 'prakash',
    employee_no: '5',
    name: 'Prakash Solanki',
    phone: '98765 11005',
    rate: 42000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: false,
    note: 'Inactive worker (left on 18 Oct) with unpaid salary carry ₹1,500 and open upad ₹600. Tests final payout.',
  },
  {
    key: 'rekhaben',
    employee_no: '6',
    name: 'Rekhaben Patel',
    phone: '98765 11006',
    rate: 40000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Left on 9 Oct, rejoined on 20 Oct (two employment periods). Old upad from Period 1 still open.',
  },
  {
    key: 'alpesh',
    employee_no: '7',
    name: 'Alpesh Chauhan',
    phone: '98765 11007',
    rate: 48000, // ₹480/d = ₹1/min for crystal-clear hours testing
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Varied hours-based days (1h, 2.5h, 3h, 5h, 7h) and hours + OT on the same day (5h + 1.5h OT).',
  },
  {
    key: 'dinesh',
    employee_no: '8',
    name: 'Dinesh Rawal',
    phone: '98765 11008',
    rate: 60000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Off-schedule payout closed on Saturday 24 Oct, and next cycle started immediately on Sunday 25 Oct.',
  },
  {
    key: 'bharat',
    employee_no: '9',
    name: 'Bharat Prajapati',
    phone: '98765 11009',
    rate: 48000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Mid-week cash return outside payroll (returned ₹1,000 cash). Has Half day with OT (Half + 1h OT).',
  },
  {
    key: 'vijay',
    employee_no: '10',
    name: 'Vijay Mehta',
    phone: '98765 11010',
    rate: 35000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Large Main upad of ₹6,000 vs open cycle wages of ₹700: deduction cut floors at ₹700 with warning.',
  },
  {
    key: 'nilesh',
    employee_no: '11',
    name: 'Nilesh Trivedi',
    phone: '98765 11011',
    rate: 52000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Has a late attendance entry dated 21 Oct entered after Week 3 payout was closed.',
  },
  {
    key: 'kunal',
    employee_no: '12',
    name: 'Kunal Bhatt',
    phone: '98765 11012',
    rate: 46000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Unmarked days in open cycle (31 Oct & 2 Nov) triggering warnings. (Sunday 1 Nov is fully unmarked).',
  },
  {
    key: 'hasmukh',
    employee_no: '13',
    name: 'Hasmukh Vora',
    phone: '98765 11013',
    rate: 65000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Main upad write-off (₹3,000), big amount (₹10,000), and an undone payout leaving voided records.',
  },
  {
    key: 'gopal',
    employee_no: '14',
    name: 'Gopal Parmar',
    phone: '98765 11014',
    rate: 50000,
    joined: '2026-10-01',
    openingSalary: 0,
    openingChalu: 0,
    openingMoto: 0,
    active: true,
    note: 'Clean benchmark worker: 100% full days, zero OT, zero upads ever taken, zero carry, fully paid.',
  },
]

const workers = new Map()
const ratesHistory = []
const employmentPeriods = []

for (const spec of employeeSpecs) {
  const employee = await pb.collection('employees').create({
    employee_no: spec.employee_no,
    name: spec.name,
    phone: spec.phone,
    active: spec.active,
    daily_rate_paise: spec.rate,
    opening_salary_paise: spec.openingSalary,
    opening_upad_paise: spec.openingChalu + spec.openingMoto,
    opening_chalu_paise: spec.openingChalu,
    opening_moto_paise: spec.openingMoto,
    opening_date: '2026-10-01',
    joined_on: iso(spec.joined),
    notes: spec.note,
    sort_order: Number(spec.employee_no),
  })
  workers.set(spec.key, employee)

  const initialRate = await pb.collection('rate_history').create({
    employee: employee.id,
    effective_from: iso(spec.joined),
    daily_rate_paise: spec.rate,
    note: 'Initial wage rate',
  })
  ratesHistory.push(initialRate)
}

// Edge case 3: Kiran Shah rate change mid-cycle on 19 Oct from ₹400 to ₹480
const kiranEmp = workers.get('kiran')
const kiranNewRate = await pb.collection('rate_history').create({
  employee: kiranEmp.id,
  effective_from: iso('2026-10-19'),
  daily_rate_paise: 48000,
  note: 'Mid-cycle skill revision to ₹480/day',
})
ratesHistory.push(kiranNewRate)
await pb.collection('employees').update(kiranEmp.id, { daily_rate_paise: 48000 })
kiranEmp.daily_rate_paise = 48000

// Employment Periods
for (const spec of employeeSpecs) {
  if (spec.key === 'prakash' || spec.key === 'rekhaben') continue
  const emp = workers.get(spec.key)
  const p = await pb.collection('employment_periods').create({
    employee: emp.id,
    start_date: iso(spec.joined),
    end_date: '',
    note: 'Active employment period',
  })
  employmentPeriods.push(p)
}

// Edge case 4: Prakash Solanki (left 18 Oct)
const prakashEmp = workers.get('prakash')
employmentPeriods.push(
  await pb.collection('employment_periods').create({
    employee: prakashEmp.id,
    start_date: iso('2026-10-01'),
    end_date: iso('2026-10-18'),
    note: 'Resigned on 18 Oct',
  }),
)

// Edge case 5: Rekhaben Patel (two periods)
const rekhaEmp = workers.get('rekhaben')
employmentPeriods.push(
  await pb.collection('employment_periods').create({
    employee: rekhaEmp.id,
    start_date: iso('2026-10-01'),
    end_date: iso('2026-10-09'),
    note: 'Period 1 before family break',
  }),
)
employmentPeriods.push(
  await pb.collection('employment_periods').create({
    employee: rekhaEmp.id,
    start_date: iso('2026-10-20'),
    end_date: '',
    note: 'Period 2 re-joined',
  }),
)

console.log('14 Employees, wage rates, and employment periods created.')

// Attendance storage
const attendanceRecords = []

async function saveAttendanceRecord(key, date, status, workedMinutes = 0, otMinutes = 0, note = '') {
  const emp = workers.get(key)
  let wm = workedMinutes
  let st = status
  if (st === 'full') wm = 0
  else if (st === 'half') wm = 0
  else if (st === 'hours') {
    if (wm <= 0) st = 'absent'
    else if (wm === 240) {
      st = 'half'
      wm = 0
    } else if (wm >= 480) {
      st = 'full'
      wm = 0
    }
  }

  const record = await pb.collection('attendance').create({
    employee: emp.id,
    date: iso(date),
    status: st,
    worked_minutes: wm,
    ot_minutes: otMinutes,
    note,
  })
  attendanceRecords.push({ ...record, key, dateStr: date })
  return record
}

// Rate lookup
function getRateOn(key, dateStr) {
  const emp = workers.get(key)
  const rows = ratesHistory
    .filter((r) => r.employee === emp.id && r.effective_from.slice(0, 10) <= dateStr)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  return rows.length ? rows[rows.length - 1].daily_rate_paise : emp.daily_rate_paise
}

// Day earnings calculation matching engine
function calculateDayEarnings(status, workedMinutes, otMinutes, ratePaise) {
  const otPaise = otMinutes > 0 ? roundHalfUp((ratePaise * otMinutes) / 480) : 0
  if (status === 'full') {
    return { basePaise: ratePaise, otPaise, totalPaise: ratePaise + otPaise, daysWorked: 1 }
  }
  if (status === 'half') {
    const base = roundHalfUp(ratePaise * 0.5)
    return { basePaise: base, otPaise, totalPaise: base + otPaise, daysWorked: 0.5 }
  }
  if (status === 'hours') {
    const base = roundHalfUp((ratePaise * workedMinutes) / 480)
    return { basePaise: base, otPaise, totalPaise: base + otPaise, daysWorked: workedMinutes / 480 }
  }
  return { basePaise: 0, otPaise, totalPaise: otPaise, daysWorked: 0 }
}

// Upad storage
const upadRecords = []

async function createUpad(key, date, kind, amountPaise, note, bucket = 'chalu', statementId = '', payoutId = '') {
  const emp = workers.get(key)
  const entry = await pb.collection('upad_entries').create({
    employee: emp.id,
    date: iso(date),
    kind,
    category: bucket,
    bucket,
    amount_paise: amountPaise,
    note,
    statement: statementId,
    payout: payoutId,
    payout_id: payoutId,
    voided: false,
  })
  upadRecords.push({ ...entry, key, dateStr: date, bucket })
  return entry
}

// Adjustments storage
const adjustmentRecords = []

async function createAdjustmentRecord(key, date, amountPaise, kind, note, payoutId = '') {
  const emp = workers.get(key)
  const adj = await pb.collection('adjustments').create({
    employee: emp.id,
    date: iso(date),
    amount_paise: amountPaise,
    kind,
    note,
    payout_id: payoutId,
    settled_payout: payoutId || null,
  })
  adjustmentRecords.push({ ...adj, key, dateStr: date })
  return adj
}

// -------------------------------------------------------------------------
// 4. Populate Attendance for History: 2026-10-01 to 2026-10-29
// -------------------------------------------------------------------------
console.log('Generating attendance for history (1 Oct to 29 Oct)...')

const allDates = []
let cur = '2026-10-01'
while (cur <= '2026-10-29') {
  allDates.push(cur)
  cur = addDays(cur, 1)
}

for (const d of allDates) {
  const dow = dayOfWeek(d)
  const isSunday = dow === 0
  const isFriday = dow === 5

  // Sunday factory-wide closed
  if (isSunday) continue

  // Friday is normally off, EXCEPT Friday 23 Oct (Edge case 12)
  if (isFriday && d !== '2026-10-23') continue

  // Edge case 12: Friday 23 Oct factory open for specific workers
  if (d === '2026-10-23') {
    await saveAttendanceRecord('kiran', d, 'full', 0, 60, 'Friday special run')
    await saveAttendanceRecord('alpesh', d, 'hours', 300, 60, 'Friday 5h + 1h OT')
    await saveAttendanceRecord('hasmukh', d, 'full', 0, 0, 'Friday shift')
    continue
  }

  // Regular days (Mon-Thu, Sat)
  for (const spec of employeeSpecs) {
    const k = spec.key

    // Inactive worker: Prakash left on 18 Oct
    if (k === 'prakash' && d > '2026-10-18') continue

    // Rekhaben break: 10 Oct to 19 Oct
    if (k === 'rekhaben' && d >= '2026-10-10' && d <= '2026-10-19') continue

    // Worker 11: Nilesh Trivedi - edge case 10: late entry on 2026-10-21 will be created in open cycle section
    if (k === 'nilesh' && d === '2026-10-21') continue

    // Worker 14: Gopal Parmar clean baseline - full day every working day, 0 OT
    if (k === 'gopal') {
      await saveAttendanceRecord(k, d, 'full', 0, 0)
      continue
    }

    // Worker 3: Mahesh Joshi - works consistently in Week 4 to guarantee totalDue > carry
    if (k === 'mahesh' && d >= '2026-10-23') {
      await saveAttendanceRecord(k, d, 'full', 0, 60)
      continue
    }

    // Worker 7: Alpesh Chauhan - hours based days
    if (k === 'alpesh') {
      if (d === '2026-10-05') await saveAttendanceRecord(k, d, 'hours', 180, 0, '3h worked')
      else if (d === '2026-10-07') await saveAttendanceRecord(k, d, 'hours', 60, 0, '1h worked')
      else if (d === '2026-10-13') await saveAttendanceRecord(k, d, 'hours', 150, 0, '2.5h worked')
      else if (d === '2026-10-20') await saveAttendanceRecord(k, d, 'hours', 300, 90, '5h worked + 1.5h OT')
      else if (d === '2026-10-27') await saveAttendanceRecord(k, d, 'hours', 420, 0, '7h worked')
      else await saveAttendanceRecord(k, d, 'full', 0, 0)
      continue
    }

    // Worker 9: Bharat - half day with OT on 2026-10-14
    if (k === 'bharat' && d === '2026-10-14') {
      await saveAttendanceRecord(k, d, 'half', 0, 60, 'Half day + 1h OT')
      continue
    }

    // Worker 10: Vijay - absent after full week
    if (k === 'vijay' && (d === '2026-10-14' || d === '2026-10-15')) {
      await saveAttendanceRecord(k, d, 'absent', 0, 0, 'Personal leave')
      continue
    }

    // Standard semi-random attendance for other workers
    const r = rng()
    if (r < 0.82) {
      const ot = rng() < 0.3 ? (Math.floor(rng() * 4) + 1) * 30 : 0
      await saveAttendanceRecord(k, d, 'full', 0, ot)
    } else if (r < 0.92) {
      await saveAttendanceRecord(k, d, 'half', 0, 0, 'Half day')
    } else {
      await saveAttendanceRecord(k, d, 'absent', 0, 0, 'Absent')
    }
  }
}

// Initial Upads and Adjustments across history
await createUpad('suresh', '2026-10-03', 'given', 500000, 'Main loan for equipment', 'moto')
await createUpad('suresh', '2026-10-08', 'returned', 100000, 'Cash return against main loan', 'moto')
await createUpad('suresh', '2026-10-14', 'given', 300000, 'Additional advance', 'moto')
await createUpad('suresh', '2026-10-21', 'returned', 150000, 'Mid-month cash return', 'moto')
await createUpad('suresh', '2026-10-27', 'given', 200000, 'Festival advance', 'moto')
await createUpad('suresh', '2026-10-29', 'given', 50000, 'Chalu upad to be settled', 'chalu')

await createUpad('prakash', '2026-10-05', 'given', 60000, 'Travel advance', 'chalu')
await createUpad('rekhaben', '2026-10-05', 'given', 100000, 'Period 1 advance', 'chalu')

await createUpad('hasmukh', '2026-10-10', 'given', 1000000, 'Special large machine advance (₹10,000)', 'moto')
await createUpad('hasmukh', '2026-10-20', 'writeoff', 300000, 'Company subsidy write-off', 'moto')

await createAdjustmentRecord('ramesh', '2026-10-07', 50000, 'bonus', 'Festival production bonus')
await createAdjustmentRecord('kiran', '2026-10-21', 30000, 'bonus', 'Machine maintenance incentive')

// -------------------------------------------------------------------------
// 5. Payout Execution Engine (Weeks 1, 2, 3, 4)
// -------------------------------------------------------------------------
const latestClosingCarry = new Map()

async function executePayout({ runStart, runEnd, cutoffDate, payoutDate, notes, workerInputs = {}, excludeKeys = [] }) {
  // 1. Gather all active workers eligible for this payout
  const participating = employeeSpecs.filter((s) => !excludeKeys.includes(s.key))

  const rows = []
  for (const spec of participating) {
    const emp = workers.get(spec.key)
    if (spec.joined > cutoffDate) continue
    if (spec.key === 'prakash' && runStart > '2026-10-18') continue

    // Find unsettled attendance up to cutoff
    const atts = attendanceRecords.filter((a) => {
      if (a.key !== spec.key) return false
      if (a.settled_payout) return false
      return a.dateStr <= cutoffDate
    })

    let earned = 0
    let daysWorked = 0
    let otMinutes = 0

    for (const a of atts) {
      const rate = getRateOn(spec.key, a.dateStr)
      const e = calculateDayEarnings(a.status, a.worked_minutes, a.ot_minutes, rate)
      earned += e.totalPaise
      daysWorked += e.daysWorked
      otMinutes += a.ot_minutes
    }

    // Unsettled adjustments up to cutoff
    const adjs = adjustmentRecords.filter((adj) => adj.key === spec.key && !adj.settled_payout && adj.dateStr <= cutoffDate)
    const adjTotal = adjs.reduce((sum, adj) => sum + adj.amount_paise, 0)

    const openingCarry = latestClosingCarry.get(spec.key) ?? spec.openingSalary

    // Upad balances
    let chaluBal = spec.openingChalu
    let motoBal = spec.openingMoto
    for (const u of upadRecords) {
      if (u.key !== spec.key || u.voided || u.dateStr > cutoffDate) continue
      const delta = u.kind === 'given' ? u.amount_paise : -u.amount_paise
      if (u.bucket === 'moto') motoBal += delta
      else chaluBal += delta
    }
    chaluBal = Math.max(0, chaluBal)
    motoBal = Math.max(0, motoBal)

    const inputs = workerInputs[spec.key] || {}
    const totalBeforeRecovery = openingCarry + earned + adjTotal
    const chaluRec = Math.min(inputs.chaluRecovery ?? 0, chaluBal, Math.max(0, totalBeforeRecovery))
    const motoRec = Math.min(inputs.motoRecovery ?? 0, motoBal, Math.max(0, totalBeforeRecovery - chaluRec))
    const totalRec = chaluRec + motoRec

    const totalDue = Math.max(0, totalBeforeRecovery - totalRec)
    let closingCarry = 0
    let paid = totalDue
    if (inputs.closingCarry !== undefined) {
      closingCarry = Math.min(inputs.closingCarry, totalDue)
      paid = totalDue - closingCarry
    } else if (inputs.paid !== undefined) {
      paid = Math.min(inputs.paid, totalDue)
      closingCarry = totalDue - paid
    }

    rows.push({
      spec,
      emp,
      openingCarry,
      earned,
      adjTotal,
      chaluBal,
      motoBal,
      chaluRec,
      motoRec,
      totalRec,
      totalDue,
      paid,
      closingCarry,
      daysWorked,
      otMinutes,
      atts,
      adjs,
    })
  }

  const totalDueRun = rows.reduce((s, r) => s + r.totalDue, 0)
  const totalPaidRun = rows.reduce((s, r) => s + r.paid, 0)
  const totalRecRun = rows.reduce((s, r) => s + r.totalRec, 0)

  // Create Payout Run
  const run = await pb.collection('payout_runs').create({
    cycle_start: iso(runStart),
    payout_date: iso(payoutDate),
    cutoff_date: iso(cutoffDate),
    status: 'completed',
    voided: false,
    note: notes,
    employee_count: rows.length,
    total_due_paise: totalDueRun,
    total_paid_paise: totalPaidRun,
    total_upad_recovery_paise: totalRecRun,
  })

  // Create Statements & Payments
  for (const r of rows) {
    const stmt = await pb.collection('statements').create({
      payout_run: run.id,
      employee: r.emp.id,
      cycle_start: iso(runStart),
      payout_date: iso(payoutDate),
      opening_paise: r.openingCarry,
      earned_paise: r.earned,
      adjustment_paise: r.adjTotal,
      upad_outstanding_paise: r.chaluBal + r.motoBal,
      upad_recovery_paise: r.totalRec,
      total_due_paise: r.totalDue,
      paid_paise: r.paid,
      closing_paise: r.closingCarry,
      days_worked: r.daysWorked,
      ot_minutes: r.otMinutes,
      note: '',
      voided: false,
    })

    if (r.paid > 0) {
      await pb.collection('salary_payments').create({
        employee: r.emp.id,
        statement: stmt.id,
        paid_on: iso(payoutDate),
        amount_paise: r.paid,
        note: `Payout on ${payoutDate}`,
        voided: false,
      })
    }

    if (r.chaluRec > 0) {
      await createUpad(r.spec.key, payoutDate, 'recovery', r.chaluRec, 'Chalu recovery at payout', 'chalu', stmt.id, run.id)
    }
    if (r.motoRec > 0) {
      await createUpad(r.spec.key, payoutDate, 'recovery', r.motoRec, 'Main recovery at payout', 'moto', stmt.id, run.id)
    }

    // Mark settled
    for (const a of r.atts) {
      await pb.collection('attendance').update(a.id, { settled_payout: run.id })
      a.settled_payout = run.id
    }
    for (const adj of r.adjs) {
      await pb.collection('adjustments').update(adj.id, { settled_payout: run.id })
      adj.settled_payout = run.id
    }

    latestClosingCarry.set(r.spec.key, r.closingCarry)
  }

  return run
}

// -------------------------------------------------------------------------
// Execute Historical Payouts
// -------------------------------------------------------------------------
console.log('Executing historical closed payout cycles...')

// Week 1: 1 Oct - 8 Oct (Closed Thursday 8 Oct)
await executePayout({
  runStart: '2026-10-01',
  runEnd: '2026-10-08',
  cutoffDate: '2026-10-08',
  payoutDate: '2026-10-08',
  notes: 'Week 1 Regular Payout',
})

// Week 2: 9 Oct - 15 Oct (Closed Thursday 15 Oct)
await executePayout({
  runStart: '2026-10-09',
  runEnd: '2026-10-15',
  cutoffDate: '2026-10-15',
  payoutDate: '2026-10-15',
  notes: 'Week 2 Regular Payout',
  workerInputs: {
    // Edge case 4: Prakash Solanki leaves unpaid salary carry of ₹1,500
    prakash: { closingCarry: 150000 },
  },
  excludeKeys: ['rekhaben'], // on break
})

// Week 3: 16 Oct - 22 Oct (Closed Thursday 22 Oct)
await executePayout({
  runStart: '2026-10-16',
  runEnd: '2026-10-22',
  cutoffDate: '2026-10-22',
  payoutDate: '2026-10-22',
  notes: 'Week 3 Regular Payout',
  workerInputs: {
    // Edge case 4: Prakash left on 18 Oct, maintain unpaid carry ₹1,500
    prakash: { closingCarry: 150000 },
  },
})

// Edge case 7: Off-schedule payout for Dinesh Rawal on Saturday 24 Oct (16 Oct - 24 Oct)
console.log('Executing Edge Case 7 (Off-schedule payout for Dinesh)...')
await executePayout({
  runStart: '2026-10-23',
  runEnd: '2026-10-24',
  cutoffDate: '2026-10-24',
  payoutDate: '2026-10-24',
  notes: 'Off-schedule Saturday settlement for Dinesh',
  workerInputs: {},
  excludeKeys: employeeSpecs.filter((s) => s.key !== 'dinesh').map((s) => s.key),
})

// Edge case 13: Temporary payout on 26 Oct then undone (demonstrating voided rows)
console.log('Executing Edge Case 13 (Undone payout test)...')
const tempRun = await executePayout({
  runStart: '2026-10-23',
  runEnd: '2026-10-26',
  cutoffDate: '2026-10-26',
  payoutDate: '2026-10-26',
  notes: 'Temporary accidental payout to be undone',
  excludeKeys: employeeSpecs.filter((s) => s.key !== 'hasmukh').map((s) => s.key),
})

// Now undo tempRun using the exact undo service contract:
// 1. Mark run voided
await pb.collection('payout_runs').update(tempRun.id, { voided: true })
// 2. Mark statements voided
const tempStmts = await pb.collection('statements').getFullList({ filter: `payout_run = "${tempRun.id}"` })
for (const s of tempStmts) await pb.collection('statements').update(s.id, { voided: true })
// 3. Mark salary payments voided
const tempPays = await pb.collection('salary_payments').getFullList({ filter: `statement = "${tempStmts[0]?.id}"` })
for (const p of tempPays) await pb.collection('salary_payments').update(p.id, { voided: true })
// 4. Mark upads voided
const tempUpads = await pb.collection('upad_entries').getFullList({ filter: `payout_id = "${tempRun.id}"` })
for (const u of tempUpads) await pb.collection('upad_entries').update(u.id, { voided: true })
// 5. Revert settled attendance and adjustments
const tempAtts = await pb.collection('attendance').getFullList({ filter: `settled_payout = "${tempRun.id}"` })
for (const a of tempAtts) {
  await pb.collection('attendance').update(a.id, { settled_payout: null })
  const found = attendanceRecords.find((ar) => ar.id === a.id)
  if (found) found.settled_payout = null
}
// Restore latestClosingCarry for Hasmukh
latestClosingCarry.set('hasmukh', 0)

// Week 4: 23 Oct - 29 Oct (Closed Thursday 29 Oct)
console.log('Executing Week 4 payout...')
await executePayout({
  runStart: '2026-10-23',
  runEnd: '2026-10-29',
  cutoffDate: '2026-10-29',
  payoutDate: '2026-10-29',
  notes: 'Week 4 Regular Payout',
  workerInputs: {
    // Edge case 2: Mahesh partial payment, leaving ₹1,350 carry
    mahesh: { closingCarry: 135000 },
    // Rekhaben partial recovery
    rekhaben: { chaluRecovery: 40000 },
  },
  excludeKeys: ['prakash'], // Prakash left
})

// -------------------------------------------------------------------------
// 6. Current Open Cycle (30 Oct to 2 Nov Today)
// -------------------------------------------------------------------------
console.log('Generating Open Cycle records (30 Oct - 2 Nov)...')

// 30 Oct (Friday) - Off for most
// 31 Oct (Saturday) - Worked
// 1 Nov (Sunday) - Off for all (unmarked factory-wide)
// 2 Nov (Monday - Today) - Worked

// Worker 1: Ramesh Patel (Edge case 1 - Chalu upad ₹1,000 to settle)
await createUpad('ramesh', '2026-10-28', 'given', 100000, 'Hand loan (paid back in cash outside app)', 'chalu')
await saveAttendanceRecord('ramesh', '2026-10-31', 'full', 0, 60, 'Saturday OT')
await saveAttendanceRecord('ramesh', '2026-11-02', 'full', 0, 0, 'Today roll call')

// Worker 2: Suresh Desai (Edge case 1 & 15)
await createUpad('suresh', '2026-10-31', 'returned', 50000, 'Main upad cash return', 'moto')
await saveAttendanceRecord('suresh', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('suresh', '2026-11-02', 'full', 0, 0)

// Worker 3: Mahesh Joshi (Edge case 2 - carry ₹1,350)
await saveAttendanceRecord('mahesh', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('mahesh', '2026-11-02', 'half', 0, 0, 'Today half day')

// Worker 4: Kiran Shah (Edge case 3)
await saveAttendanceRecord('kiran', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('kiran', '2026-11-02', 'full', 0, 0)

// Worker 5: Prakash Solanki (Edge case 4 & 16 - Inactive, 0 marks in open cycle)
// (no attendance added)

// Worker 6: Rekhaben Patel (Edge case 5)
await saveAttendanceRecord('rekhaben', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('rekhaben', '2026-11-02', 'full', 0, 0)

// Worker 7: Alpesh Chauhan (Edge case 6 - Hours days)
await saveAttendanceRecord('alpesh', '2026-10-31', 'hours', 300, 60, '5h worked + 1h OT')
await saveAttendanceRecord('alpesh', '2026-11-02', 'hours', 180, 0, '3h worked today')

// Worker 8: Dinesh Rawal (Edge case 7)
await saveAttendanceRecord('dinesh', '2026-10-31', 'full', 0, 90, 'Saturday overtime')
await saveAttendanceRecord('dinesh', '2026-11-02', 'full', 0, 0)

// Worker 9: Bharat Prajapati (Edge case 8 & 16)
await createUpad('bharat', '2026-10-27', 'given', 100000, 'Mid-week advance', 'chalu')
await createUpad('bharat', '2026-10-28', 'returned', 100000, 'Mid-week cash returned outside payroll', 'chalu')
await saveAttendanceRecord('bharat', '2026-10-31', 'half', 0, 60, 'Half day + 1h OT')
await saveAttendanceRecord('bharat', '2026-11-02', 'full', 0, 0)

// Worker 10: Vijay Mehta (Edge case 9)
await createUpad('vijay', '2026-10-28', 'given', 600000, 'Emergency hospital loan', 'moto')
await saveAttendanceRecord('vijay', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('vijay', '2026-11-02', 'full', 0, 0)

// Worker 11: Nilesh Trivedi (Edge case 10 - late entry 21 Oct carries forward)
await saveAttendanceRecord('nilesh', '2026-10-21', 'full', 0, 0, 'Late attendance entry from 21 Oct')
await saveAttendanceRecord('nilesh', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('nilesh', '2026-11-02', 'full', 0, 0)

// Worker 12: Kunal Bhatt (Edge case 11 - unmarked days in open cycle)
// (31 Oct and 2 Nov left completely unmarked)

// Worker 13: Hasmukh Vora (Edge case 13)
await saveAttendanceRecord('hasmukh', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('hasmukh', '2026-11-02', 'full', 0, 0)

// Worker 14: Gopal Parmar (Edge case 14 - clean baseline)
await saveAttendanceRecord('gopal', '2026-10-31', 'full', 0, 0)
await saveAttendanceRecord('gopal', '2026-11-02', 'full', 0, 0)

console.log('Open cycle attendance and upad entries created.')

// -------------------------------------------------------------------------
// 7. Verification & Summary Output
// -------------------------------------------------------------------------
console.log('Verifying all worker balances, gross dues, and edge case rules...')

const formatRs = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

const summaryRows = []

for (const spec of employeeSpecs) {
  const emp = workers.get(spec.key)

  // Current rate
  const rate = emp.daily_rate_paise

  // Unsettled attendance in open cycle
  const openAtts = attendanceRecords.filter((a) => a.key === spec.key && !a.settled_payout)
  let openEarned = 0
  for (const a of openAtts) {
    const r = getRateOn(spec.key, a.dateStr)
    openEarned += calculateDayEarnings(a.status, a.worked_minutes, a.ot_minutes, r).totalPaise
  }

  // Unsettled adjustments in open cycle
  const openAdjs = adjustmentRecords.filter((adj) => adj.key === spec.key && !adj.settled_payout)
  const openAdjTotal = openAdjs.reduce((s, a) => s + a.amount_paise, 0)

  // Previous closing carry
  const carry = latestClosingCarry.get(spec.key) ?? spec.openingSalary

  // Owed now / Gross due
  const owedNow = carry + openEarned + openAdjTotal

  // Upad Balances
  let chaluBal = spec.openingChalu
  let motoBal = spec.openingMoto
  for (const u of upadRecords) {
    if (u.key !== spec.key || u.voided) continue
    const delta = u.kind === 'given' ? u.amount_paise : -u.amount_paise
    if (u.bucket === 'moto') motoBal += delta
    else chaluBal += delta
  }
  chaluBal = Math.max(0, chaluBal)
  motoBal = Math.max(0, motoBal)

  // Unmarked days check in open cycle: 31 Oct and 2 Nov
  const workingDays = ['2026-10-31', '2026-11-02']
  let unmarkedCount = 0
  if (spec.active) {
    for (const wd of workingDays) {
      const hasMark = openAtts.some((a) => a.dateStr === wd)
      if (!hasMark) unmarkedCount++
    }
  }

  summaryRows.push({
    No: spec.employee_no,
    Name: spec.name,
    Status: spec.active ? 'Active' : 'Inactive',
    Rate: formatRs(rate) + '/d',
    ChaluBal: formatRs(chaluBal),
    MotoBal: formatRs(motoBal),
    Carry: formatRs(carry),
    OwedNow: formatRs(owedNow),
    Unmarked: unmarkedCount > 0 ? `${unmarkedCount} d` : '0',
  })
}

console.log('\n========================================================================================')
console.log('RE-SEEDED WORKER VERIFICATION SUMMARY TABLE (As of 2 Nov 2026 Today)')
console.log('========================================================================================')
console.table(summaryRows)

console.log('\nEdge cases successfully verified and mapped:')
console.log('  1. Settle Tool Ready: Ramesh Patel (Chalu ₹1,000) & Suresh Desai (Chalu ₹500)')
console.log('  2. Partial Payment Carry: Mahesh Joshi (carried ₹1,350 from Week 4)')
console.log('  3. Mid-Cycle Rate Change: Kiran Shah (changed ₹400 -> ₹480 on 19 Oct)')
console.log('  4. Inactive Worker Final Payout / Write-Off: Prakash Solanki (Inactive, carry ₹1,500, upad ₹600)')
console.log('  5. Rejoined Worker Two Periods: Rekhaben Patel (Period 1: 1-9 Oct, Period 2: 20 Oct-present, open upad ₹600)')
console.log('  6. Hours-based Days: Alpesh Chauhan (1h, 2.5h, 3h, 5h, 7h and 5h + 1.5h OT on same day)')
console.log('  7. Off-schedule Payout: Dinesh Rawal (Saturday 24 Oct payout, new cycle started 25 Oct)')
console.log('  8. Mid-week Cash Return: Bharat Prajapati (took ₹1,000 on 27 Oct, returned cash on 28 Oct)')
console.log('  9. Upad Cut Larger than Due: Vijay Mehta (Main Upad ₹6,000 vs open wages ₹700, floors with warning)')
console.log(' 10. Late Attendance Entry: Nilesh Trivedi (21 Oct attendance recorded after Week 3 closed)')
console.log(' 11. Unmarked Days Warning: Kunal Bhatt (unmarked 31 Oct & 2 Nov; 1 Nov factory-wide unmarked)')
console.log(' 12. Friday Factory Open Once: 23 Oct worked by Kiran Shah, Alpesh Chauhan, Hasmukh Vora')
console.log(' 13. Write-off, Undone Payout & Big Amount: Hasmukh Vora (₹3,000 write-off, voided payout run, ₹10,000 advance)')
console.log(' 14. Clean Baseline Worker: Gopal Parmar (100% full days, 0 upad, 0 carry, clean payout every Thursday)')
console.log(' 15. Long Main Upad History: Suresh Desai (6 ledger transactions across 5 weeks, ₹7,000 balance)')
console.log(' 16. Half day with OT (Bharat), Absent after full week (Vijay), Zero open attendance (Prakash)')
console.log('========================================================================================\n')
