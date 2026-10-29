import PocketBase from 'pocketbase'

const url = process.env.PB_URL || 'http://127.0.0.1:8090'
const email = process.env.PB_ADMIN_EMAIL
const password = process.env.PB_ADMIN_PASSWORD

if (!email || !password) {
  console.error('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (see .env.local.example).')
  process.exit(1)
}

const pb = new PocketBase(url)
pb.autoCancellation(false)

await pb.collection('_superusers').authWithPassword(email, password)

const rates = [400, 400, 500, 400, 500, 400, 450, 400, 400, 400, 400, 400, 400, 400, 450, 400]
const existing = await pb.collection('employees').getFullList({ sort: 'sort_order' })
const existingNos = new Set(existing.map((employee) => employee.employee_no))

for (let index = 0; index < rates.length; index += 1) {
  const employeeNo = String(index + 1)
  if (existingNos.has(employeeNo)) continue

  const employee = await pb.collection('employees').create({
    employee_no: employeeNo,
    name: `Employee ${employeeNo}`,
    active: true,
    daily_rate_paise: rates[index] * 100,
    opening_salary_paise: 0,
    opening_upad_paise: 0,
    joined_on: '2026-10-01',
    notes: 'Rename this placeholder to the real employee name.',
    sort_order: index + 1,
  })

  await pb.collection('rate_history').create({
    employee: employee.id,
    effective_from: '2026-10-01',
    daily_rate_paise: rates[index] * 100,
    note: 'Opening rate',
  })

  await pb.collection('employment_periods').create({
    employee: employee.id,
    start_date: '2026-10-01',
    note: 'Opening period',
  })
}

const count = await pb.collection('employees').getList(1, 1)
console.log(`Employees ready: ${count.totalItems}`)
