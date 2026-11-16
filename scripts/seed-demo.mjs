import PocketBase from 'pocketbase'

const url = process.env.PB_URL || 'http://127.0.0.1:8091'
const reset = process.argv.includes('--reset')
const pb = new PocketBase(url)
pb.autoCancellation(false)

const existing = await pb.collection('employees').getList(1, 1).catch(() => ({ totalItems: 0 }))
if (existing.totalItems && !reset) {
  console.error('Workers already exist. Pass --reset to replace the disposable demo data.')
  process.exit(1)
}

if (reset) {
  for (const collection of ['cycle_audits', 'attendance', 'upad_entries', 'cycle_drafts', 'salary_payments', 'statements', 'payout_runs', 'holidays', 'employees', 'settings']) {
    const records = await pb.collection(collection).getFullList().catch(() => [])
    for (const record of records) await pb.collection(collection).delete(record.id)
  }
}

const today = new Date()
const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const day = (offset) => { const value = new Date(today); value.setDate(value.getDate() + offset); return key(value) }
const asDate = (value) => `${value} 00:00:00.000Z`

await pb.collection('settings').create({ shift_hours: 8, ot_multiplier: 1, company_name: 'Kapil Products', language: 'en' })

const people = [
  ['Ramesh Patel', 'Tailor', 50000, 400000, 20000],
  ['Suresh Desai', 'Master', 45000, 700000, 30000],
  ['Mahesh Joshi', 'Helper', 55000, 0, 0],
  ['Kiran Shah', 'Tailor', 48000, 125000, 0],
  ['Prakash Solanki', 'Helper', 42000, 60000, 150000],
  ['Rekhaben Patel', 'Tailor', 40000, 0, 0],
  ['Alpesh Chauhan', 'Operator', 60000, 250000, 0],
  ['Dinesh Rawal', 'Master', 52000, 0, 0],
  ['Nilesh Parmar', 'Helper', 38000, 0, 0],
  ['Bhavna Patel', 'Tailor', 46000, 80000, 0],
  ['Jignesh Mehta', 'Operator', 56000, 0, 0],
  ['Pooja Shah', 'Helper', 41000, 50000, 0],
  ['Vijay Rathod', 'Tailor', 49000, 0, 50000],
]

const workers = []
for (let index = 0; index < people.length; index += 1) {
  const [name, role, dailyRate, openingUpad, openingCarry] = people[index]
  workers.push(await pb.collection('employees').create({
    name, role, phone: `98765 ${String(11001 + index).slice(-5)}`,
    daily_rate_paise: dailyRate, status: index === 4 ? 'inactive' : 'active',
    opening_upad_paise: openingUpad, opening_carry_paise: openingCarry,
    paid_up_to: asDate(day(index % 3 === 0 ? -5 : index % 3 === 1 ? -3 : -1)),
    joined_on: asDate(day(-120)),
  }))
}

for (let index = 0; index < workers.length; index += 1) {
  const employee = workers[index]
  await pb.collection('cycle_drafts').create({
    employee: employee.id,
    adj_paise: 0,
    adj_note: '',
    deduct_paise: 0,
    give_upad_paise: 0,
    typed_paise: null,
    is_done: false,
  })
  const boundary = index % 3 === 0 ? -5 : index % 3 === 1 ? -3 : -1
  for (let offset = boundary + 1; offset < 0; offset += 1) {
    if ((index + offset) % 5 === 0) continue
    const status = (index + Math.abs(offset)) % 8 === 0 ? 'half' : (index + Math.abs(offset)) % 7 === 0 ? 'hours' : 'full'
    await pb.collection('attendance').create({
      employee: employee.id, date: asDate(day(offset)), status,
      worked_minutes: status === 'hours' ? 180 : 0,
      ot_minutes: status === 'absent' ? 0 : (index % 4 === 0 ? 60 : 0),
      notes: '', settled_payout: '',
    })
  }
}

for (const [index, amount] of [[0, 50000], [1, 125000], [3, 75000], [9, 45000]]) {
  await pb.collection('upad_entries').create({
    employee: workers[index].id, date: asDate(day(-4)), kind: 'give', amount_paise: amount,
    note: 'Demo advance', payout_id: '', voided: false,
  })
}
await pb.collection('upad_entries').create({
  employee: workers[1].id, date: asDate(day(-2)), kind: 'repay', amount_paise: 25000,
  note: 'Demo cash return', payout_id: '', voided: false,
})
await pb.collection('holidays').create({ date: asDate(day(-2)), note: 'Demo holiday' })

console.log(`Seeded ${workers.length} workers, recent attendance records, Upad ledger entries, one manual holiday, and local settings at ${url}.`)
