import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const val = (k) => env.split(/\r?\n/).find((l) => l.startsWith(k + '='))?.split('=').slice(1).join('=').trim()
const BASE = 'http://127.0.0.1:8091'
const ADMIN_EMAIL = val('PB_ADMIN_EMAIL')
const ADMIN_PASSWORD = val('PB_ADMIN_PASSWORD')

let token = null
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`)
  }
  return json
}

async function listAll(collection) {
  const out = []
  let page = 1
  for (;;) {
    const res = await api('GET', `/api/collections/${collection}/records?page=${page}&perPage=200`)
    out.push(...res.items)
    if (res.items.length < 200) break
    page++
  }
  return out
}

const patchRec = (collection, id, body) => api('PATCH', `/api/collections/${collection}/records/${id}`, body)
const col = (name) => api('GET', `/api/collections/${name}`)
const patchCol = (name, body) => api('PATCH', `/api/collections/${name}`, body)

function addField(existing, f) {
  if (!existing.some((x) => x.name === f.name)) existing.push(f)
}

function rel(name, collectionId, over = {}) {
  return {
    name,
    type: 'relation',
    required: false,
    collectionId,
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1,
    presentable: false,
    hidden: false,
    ...over,
  }
}

async function main() {
  const auth = await api('POST', '/api/collections/_superusers/auth-with-password', {
    identity: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  token = auth.token
  console.log('authenticated')

  const empCol = await col('employees')
  const runsCol = await col('payout_runs')
  const attCol = await col('attendance')
  const adjCol = await col('adjustments')
  const upadCol = await col('upad_entries')
  const stmtCol = await col('statements')
  const payCol = await col('salary_payments')

  patchCol('employees', {
    fields: (() => {
      const f = empCol.fields.filter((x) => x.name !== 'opening_upad_paise')
      addField(f, { name: 'opening_date', type: 'date', min: '', max: '', required: false, presentable: false, hidden: false })
      addField(f, { name: 'opening_chalu_paise', type: 'number', min: null, max: null, onlyInt: true, required: false, presentable: false, hidden: false })
      addField(f, { name: 'opening_moto_paise', type: 'number', min: null, max: null, onlyInt: true, required: false, presentable: false, hidden: false })
      return f
    })(),
  })
  console.log('employees fixed')

  patchCol('attendance', {
    fields: (() => {
      const f = [...attCol.fields]
      addField(f, rel('settled_payout', runsCol.id))
      return f
    })(),
  })

  patchCol('adjustments', {
    fields: (() => {
      const f = [...adjCol.fields]
      addField(f, { name: 'kind', type: 'select', maxSelect: 1, values: ['bonus', 'reimbursement', 'deduction'], required: false, presentable: false, hidden: false })
      addField(f, rel('settled_payout', runsCol.id))
      return f
    })(),
  })

  patchCol('upad_entries', {
    fields: (() => {
      const f = upadCol.fields.filter((x) => x.name !== 'statement')
      addField(f, rel('payout', runsCol.id))
      addField(f, { name: 'voided', type: 'bool', required: false, presentable: false, hidden: false })
      return f
    })(),
  })

  patchCol('payout_runs', {
    fields: (() => {
      const f = [...runsCol.fields]
      addField(f, { name: 'cutoff_date', type: 'date', min: '', max: '', required: false, presentable: false, hidden: false })
      addField(f, { name: 'voided', type: 'bool', required: false, presentable: false, hidden: false })
      return f
    })(),
  })

  patchCol('statements', {
    fields: (() => {
      const f = [...stmtCol.fields]
      addField(f, { name: 'voided', type: 'bool', required: false, presentable: false, hidden: false })
      return f
    })(),
  })

  patchCol('salary_payments', {
    fields: (() => {
      const f = [...payCol.fields]
      addField(f, { name: 'voided', type: 'bool', required: false, presentable: false, hidden: false })
      return f
    })(),
  })
  console.log('schemas fixed')

  try {
    await api('POST', '/api/collections', {
      name: 'salary_writeoffs',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: null,
      deleteRule: '',
      indexes: [],
      fields: [
        { name: 'worker', type: 'relation', required: true, collectionId: empCol.id, cascadeDelete: true, minSelect: 0, maxSelect: 1, presentable: false, hidden: false },
        rel('payout', runsCol.id),
        { name: 'date', type: 'date', min: '', max: '', required: false, presentable: false, hidden: false },
        { name: 'amount_paise', type: 'number', min: null, max: null, onlyInt: true, required: false, presentable: false, hidden: false },
        { name: 'note', type: 'text', min: 0, max: 200, pattern: '', required: false, presentable: false, hidden: false },
        { name: 'voided', type: 'bool', required: false, presentable: false, hidden: false },
      ],
    })
    console.log('salary_writeoffs created')
  } catch (e) {
    if (String(e).includes('already exists')) console.log('salary_writeoffs exists')
    else throw e
  }

  const upads = await listAll('upad_entries')
  let remapped = 0
  for (const u of upads) {
    const body = {}
    if (u.category === 'regular' || u.category === 'chalu') body.category = 'chalu'
    if (u.category === 'extra' || u.category === 'moto') body.category = 'moto'
    if (u.statement && !u.payout) {
      const stmt = await api('GET', `/api/collections/statements/records/${u.statement}`).catch(() => null)
      if (stmt?.payout_run) body.payout = stmt.payout_run
    }
    if (Object.keys(body).length) {
      await patchRec('upad_entries', u.id, body)
      remapped++
    }
  }
  console.log(`upad_entries remapped: ${remapped}/${upads.length}`)

  const emps = await listAll('employees')
  for (const e of emps) {
    const opening = e.opening_upad_paise ?? 0
    if (e.opening_date == null) {
      await patchRec('employees', e.id, {
        opening_date: e.joined_on ?? '2026-09-30',
        opening_chalu_paise: opening,
        opening_moto_paise: 0,
      })
    }
  }
  console.log(`employees openings migrated: ${emps.length}`)

  const adjs = await listAll('adjustments')
  for (const a of adjs) {
    if (!a.kind) {
      const kind = a.amount_paise < 0 ? 'deduction' : 'bonus'
      await patchRec('adjustments', a.id, {
        kind,
        amount_paise: Math.abs(a.amount_paise),
      })
    }
  }
  console.log(`adjustments kinds migrated: ${adjs.length}`)

  const verify = await col('adjustments')
  const kindField = verify.fields.find((x) => x.name === 'kind')
  if (!kindField || kindField.type !== 'select') throw new Error('kind select field missing after patch')

  console.log('fix migration complete')
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message)
  process.exit(1)
})
