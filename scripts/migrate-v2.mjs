import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`${k}=(.*)`)) || [])[1]?.trim()
const BASE = 'http://127.0.0.1:8091'
const ADMIN_EMAIL = get('PB_ADMIN_EMAIL')
const ADMIN_PASSWORD = get('PB_ADMIN_PASSWORD')

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

async function listAll(collection, filter = '') {
  const out = []
  let page = 1
  for (;;) {
    const res = await api('GET', `/api/collections/${collection}/records?page=${page}&perPage=200${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`)
    out.push(...res.items)
    if (res.items.length < 200) break
    page++
  }
  return out
}

const patchRec = (collection, id, body) => api('PATCH', `/api/collections/${collection}/records/${id}`, body)
const getCollection = (name) => api('GET', `/api/collections/${name}`)
const patchCollection = (name, body) => api('PATCH', `/api/collections/${name}`, body)

function addOrUpdateField(fields, f) {
  const i = fields.findIndex((x) => x.name === f.name)
  if (i >= 0) fields[i] = { ...fields[i], ...f }
  else fields.push(f)
}

function numField(name) {
  return {
    name,
    type: 'number',
    presentable: false,
    system: false,
    required: false,
    hidden: false,
    unique: false,
    id: `n_${name}`,
    options: { min: null, max: null, onlyInt: true },
  }
}
function boolField(name) {
  return {
    name,
    type: 'bool',
    system: false,
    required: false,
    presentable: false,
    hidden: false,
    unique: false,
    id: `b_${name}`,
    options: {},
  }
}
function dateField(name) {
  return {
    name,
    type: 'date',
    system: false,
    required: false,
    presentable: false,
    hidden: false,
    unique: false,
    id: `d_${name}`,
    options: { min: '', max: '' },
  }
}
function textField(name) {
  return {
    name,
    type: 'text',
    system: false,
    required: false,
    presentable: false,
    hidden: false,
    unique: false,
    id: `t_${name}`,
    options: { min: null, max: null, pattern: '' },
  }
}
function relationField(name, collectionId) {
  return {
    name,
    type: 'relation',
    system: false,
    required: false,
    presentable: false,
    hidden: false,
    unique: false,
    id: `r_${name}`,
    options: { collectionId, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: null },
  }
}

async function main() {
  const auth = await api('POST', '/api/collections/_superusers/auth-with-password', {
    identity: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  token = auth.token
  console.log('authenticated as superuser')

  const runs = await getCollection('payout_runs')
  const runsId = runs.id
  const empCol = await getCollection('employees')
  const upadCol = await getCollection('upad_entries')
  const attCol = await getCollection('attendance')
  const adjCol = await getCollection('adjustments')
  const stmtCol = await getCollection('statements')
  const payCol = await getCollection('salary_payments')

  patchCollection('employees', {
    fields: (() => {
      const f = empCol.fields.filter((x) => x.name !== 'opening_upad_paise')
      addOrUpdateField(f, dateField('opening_date'))
      addOrUpdateField(f, numField('opening_chalu_paise'))
      addOrUpdateField(f, numField('opening_moto_paise'))
      return f
    })(),
  })
  console.log('employees schema updated (opening_upad_paise removed, opening_date/chalu/moto added)')

  patchCollection('attendance', {
    fields: (() => {
      const f = [...attCol.fields]
      addOrUpdateField(f, relationField('settled_payout', runsId))
      return f
    })(),
  })
  console.log('attendance schema updated (settled_payout added)')

  patchCollection('adjustments', {
    fields: (() => {
      const f = [...adjCol.fields]
      addOrUpdateField(f, {
        name: 'kind',
        type: 'select',
        system: false,
        required: false,
        presentable: false,
        hidden: false,
        unique: false,
        id: 's_kind',
        options: { maxSelect: 1, values: ['bonus', 'reimbursement', 'deduction'] },
      })
      addOrUpdateField(f, relationField('settled_payout', runsId))
      return f
    })(),
  })
  console.log('adjustments schema updated (kind + settled_payout added)')

  patchCollection('upad_entries', {
    fields: (() => {
      const f = upadCol.fields.filter((x) => x.name !== 'statement')
      addOrUpdateField(f, relationField('payout', runsId))
      addOrUpdateField(f, boolField('voided'))
      return f
    })(),
  })
  console.log('upad_entries schema updated (statement -> payout relation, voided added)')

  patchCollection('payout_runs', {
    fields: (() => {
      const f = runs.fields
      addOrUpdateField(f, dateField('cutoff_date'))
      addOrUpdateField(f, boolField('voided'))
      return f
    })(),
  })
  console.log('payout_runs schema updated (cutoff_date + voided added)')

  patchCollection('statements', {
    fields: (() => {
      const f = [...stmtCol.fields]
      addOrUpdateField(f, boolField('voided'))
      return f
    })(),
  })
  console.log('statements schema updated (voided added)')

  patchCollection('salary_payments', {
    fields: (() => {
      const f = [...payCol.fields]
      addOrUpdateField(f, boolField('voided'))
      return f
    })(),
  })
  console.log('salary_payments schema updated (voided added)')

  const writeoffsOld = await api('GET', `/api/collections/salary_writeoffs`).catch(() => null)
  if (!writeoffsOld) {
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
        { name: 'worker', type: 'relation', required: true, system: false, presentable: false, hidden: false, unique: false, options: { collectionId: empCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: null } },
        relationField('payout', runsId),
        dateField('date'),
        numField('amount_paise'),
        textField('note'),
        boolField('voided'),
      ],
    })
    console.log('salary_writeoffs collection created')
  } else {
    console.log('salary_writeoffs already exists, skipped')
  }

  const upads = await listAll('upad_entries')
  let remapped = 0
  for (const u of upads) {
    const body = {}
    if (u.category === 'regular') body.category = 'chalu'
    if (u.category === 'extra') body.category = 'moto'
    if (u.statement && !u.payout) {
      const stmt = await api('GET', `/api/collections/statements/records/${u.statement}`).catch(() => null)
      if (stmt?.payout) body.payout = stmt.payout
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

  console.log('migration complete')
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message)
  process.exit(1)
})
