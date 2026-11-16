function dropAttendanceCollections(app) {
  for (const name of [
    'cycle_audits',
    'salary_writeoffs',
    'adjustments',
    'salary_payments',
    'statements',
    'cycle_drafts',
    'upad_entries',
    'attendance',
    'payout_runs',
    'audit_log',
    'employment_periods',
    'rate_history',
    'settings',
    'holidays',
    'users',
    'employees',
  ]) {
    let collection
    try {
      collection = app.findCollectionByNameOrId(name)
    } catch {
      // A clean database has no records to delete for this optional legacy collection.
      continue
    }
    app.delete(collection)
  }
}

migrate((app) => {
  // Demo and existing application data are disposable; clear collisions before recreating the schema.
  dropAttendanceCollections(app)

  const open = { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' }
  const employees = new Collection({
    type: 'base', name: 'employees', ...open,
    fields: [
      { name: 'name', type: 'text', required: true, max: 120 },
      { name: 'phone', type: 'text', max: 40 },
      { name: 'role', type: 'text', max: 80 },
      { name: 'daily_rate_paise', type: 'number', required: true, onlyInt: true, min: 0 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'inactive'] },
      { name: 'opening_upad_paise', type: 'number', onlyInt: true, min: 0 },
      { name: 'opening_carry_paise', type: 'number', onlyInt: true },
      { name: 'paid_up_to', type: 'date' },
      { name: 'joined_on', type: 'date', required: true },
    ],
    indexes: ['CREATE INDEX idx_employees_status ON employees (status)', 'CREATE INDEX idx_employees_name ON employees (name)'],
  })
  app.save(employees)

  const runs = new Collection({
    type: 'base', name: 'payout_runs', ...open,
    fields: [
      { name: 'run_date', type: 'date', required: true },
      { name: 'total_paid_paise', type: 'number', onlyInt: true, min: 0 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'completed'] },
      { name: 'voided', type: 'bool' },
    ],
    indexes: ['CREATE INDEX idx_payout_runs_date ON payout_runs (run_date)'],
  })
  app.save(runs)

  const attendance = new Collection({
    type: 'base', name: 'attendance', ...open,
    fields: [
      { name: 'employee', type: 'relation', required: true, maxSelect: 1, collectionId: employees.id, cascadeDelete: false },
      { name: 'date', type: 'date', required: true },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['full', 'half', 'absent', 'hours'] },
      { name: 'worked_minutes', type: 'number', onlyInt: true, min: 0 },
      { name: 'ot_minutes', type: 'number', onlyInt: true, min: 0 },
      { name: 'notes', type: 'text', max: 1000 },
      { name: 'settled_payout', type: 'relation', maxSelect: 1, collectionId: runs.id, cascadeDelete: false },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_attendance_employee_date ON attendance (employee, date)',
      'CREATE INDEX idx_attendance_settled ON attendance (settled_payout)',
    ],
  })
  app.save(attendance)

  const upad = new Collection({
    type: 'base', name: 'upad_entries', ...open,
    fields: [
      { name: 'employee', type: 'relation', required: true, maxSelect: 1, collectionId: employees.id, cascadeDelete: false },
      { name: 'date', type: 'date', required: true },
      { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['give', 'deduct', 'repay'] },
      { name: 'amount_paise', type: 'number', required: true, onlyInt: true, min: 1 },
      { name: 'note', type: 'text', max: 1000 },
      { name: 'payout_id', type: 'relation', maxSelect: 1, collectionId: runs.id, cascadeDelete: false },
      { name: 'voided', type: 'bool' },
    ],
    indexes: ['CREATE INDEX idx_upad_employee_date ON upad_entries (employee, date)', 'CREATE INDEX idx_upad_payout ON upad_entries (payout_id)'],
  })
  app.save(upad)

  const drafts = new Collection({
    type: 'base', name: 'cycle_drafts', ...open,
    fields: [
      { name: 'employee', type: 'relation', required: true, maxSelect: 1, collectionId: employees.id, cascadeDelete: false },
      { name: 'adj_paise', type: 'number', onlyInt: true },
      { name: 'adj_note', type: 'text', max: 500 },
      { name: 'deduct_paise', type: 'number', onlyInt: true, min: 0 },
      { name: 'give_upad_paise', type: 'number', onlyInt: true, min: 0 },
      { name: 'typed_paise', type: 'number', onlyInt: true, min: 0 },
      { name: 'is_done', type: 'bool' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_cycle_drafts_employee ON cycle_drafts (employee)'],
  })
  app.save(drafts)

  const statements = new Collection({
    type: 'base', name: 'statements', ...open,
    fields: [
      { name: 'payout_run', type: 'relation', required: true, maxSelect: 1, collectionId: runs.id, cascadeDelete: false },
      { name: 'employee', type: 'relation', required: true, maxSelect: 1, collectionId: employees.id, cascadeDelete: false },
      { name: 'start_date', type: 'date', required: true },
      { name: 'end_date', type: 'date', required: true },
      { name: 'opening_paise', type: 'number', onlyInt: true },
      { name: 'earned_paise', type: 'number', onlyInt: true },
      { name: 'adjustment_paise', type: 'number', onlyInt: true },
      { name: 'upad_deduct_paise', type: 'number', onlyInt: true },
      { name: 'upad_give_paise', type: 'number', onlyInt: true },
      { name: 'calculated_paise', type: 'number', onlyInt: true },
      { name: 'paid_paise', type: 'number', onlyInt: true },
      { name: 'closing_paise', type: 'number', onlyInt: true },
      { name: 'voided', type: 'bool' },
    ],
    indexes: ['CREATE INDEX idx_statements_run ON statements (payout_run)', 'CREATE INDEX idx_statements_employee ON statements (employee, end_date)'],
  })
  app.save(statements)

  const payments = new Collection({
    type: 'base', name: 'salary_payments', ...open,
    fields: [
      { name: 'payout_run', type: 'relation', required: true, maxSelect: 1, collectionId: runs.id, cascadeDelete: false },
      { name: 'employee', type: 'relation', required: true, maxSelect: 1, collectionId: employees.id, cascadeDelete: false },
      { name: 'amount_paise', type: 'number', onlyInt: true, min: 0 },
      { name: 'voided', type: 'bool' },
    ],
    indexes: ['CREATE INDEX idx_salary_payments_run ON salary_payments (payout_run)', 'CREATE INDEX idx_salary_payments_employee ON salary_payments (employee)'],
  })
  app.save(payments)

  const holidays = new Collection({
    type: 'base', name: 'holidays', ...open,
    fields: [{ name: 'date', type: 'date', required: true }, { name: 'note', type: 'text', max: 500 }],
    indexes: ['CREATE UNIQUE INDEX idx_holidays_date ON holidays (date)'],
  })
  app.save(holidays)

  const audits = new Collection({
    type: 'base', name: 'cycle_audits', ...open,
    fields: [
      { name: 'payout_run', type: 'relation', required: true, maxSelect: 1, collectionId: runs.id, cascadeDelete: false },
      { name: 'action', type: 'text', required: true, max: 40 },
      { name: 'unlocked_by', type: 'text', required: true, max: 120 },
      { name: 'unlocked_at', type: 'date', required: true },
      { name: 'reason', type: 'text', required: true, max: 1000 },
      { name: 'snapshot', type: 'json', required: true, maxSize: 2000000 },
    ],
    indexes: ['CREATE INDEX idx_cycle_audits_run ON cycle_audits (payout_run, unlocked_at)'],
  })
  app.save(audits)

  const settings = new Collection({
    type: 'base', name: 'settings', ...open,
    fields: [
      { name: 'shift_hours', type: 'number', required: true, min: 1, max: 24 },
      { name: 'ot_multiplier', type: 'number', required: true, min: 0, max: 10 },
      { name: 'company_name', type: 'text', max: 160 },
      { name: 'language', type: 'select', required: true, maxSelect: 1, values: ['en', 'gu'] },
    ],
  })
  app.save(settings)
}, dropAttendanceCollections)
