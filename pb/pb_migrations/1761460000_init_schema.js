/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const openRules = {
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
    }

    const employees = new Collection({
      type: 'base',
      name: 'employees',
      ...openRules,
      fields: [
        { name: 'employee_no', type: 'text', required: true, max: 40 },
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'phone', type: 'text', max: 40 },
        { name: 'active', type: 'bool' },
        { name: 'daily_rate_paise', type: 'number', required: true },
        { name: 'opening_salary_paise', type: 'number' },
        { name: 'opening_upad_paise', type: 'number' },
        { name: 'joined_on', type: 'date' },
        { name: 'notes', type: 'text', max: 1000 },
        { name: 'sort_order', type: 'number' },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_employees_employee_no ON employees (employee_no)',
        'CREATE INDEX idx_employees_active ON employees (active)',
      ],
    })
    app.save(employees)

    const rates = new Collection({
      type: 'base',
      name: 'rate_history',
      ...openRules,
      fields: [
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        { name: 'effective_from', type: 'date', required: true },
        { name: 'daily_rate_paise', type: 'number', required: true },
        { name: 'note', type: 'text', max: 500 },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_rates_employee_date ON rate_history (employee, effective_from)',
        'CREATE INDEX idx_rates_employee ON rate_history (employee)',
      ],
    })
    app.save(rates)

    const periods = new Collection({
      type: 'base',
      name: 'employment_periods',
      ...openRules,
      fields: [
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        { name: 'start_date', type: 'date', required: true },
        { name: 'end_date', type: 'date' },
        { name: 'note', type: 'text', max: 500 },
      ],
      indexes: ['CREATE INDEX idx_periods_employee ON employment_periods (employee, start_date)'],
    })
    app.save(periods)

    const attendance = new Collection({
      type: 'base',
      name: 'attendance',
      ...openRules,
      fields: [
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        { name: 'date', type: 'date', required: true },
        { name: 'status', type: 'text', required: true, max: 10 },
        { name: 'ot_minutes', type: 'number' },
        { name: 'note', type: 'text', max: 500 },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_attendance_employee_date ON attendance (employee, date)',
        'CREATE INDEX idx_attendance_date ON attendance (date)',
      ],
    })
    app.save(attendance)

    const adjustments = new Collection({
      type: 'base',
      name: 'adjustments',
      ...openRules,
      fields: [
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        { name: 'date', type: 'date', required: true },
        { name: 'amount_paise', type: 'number', required: true },
        { name: 'note', type: 'text', max: 500 },
      ],
      indexes: ['CREATE INDEX idx_adjustments_employee_date ON adjustments (employee, date)'],
    })
    app.save(adjustments)

    const payoutRuns = new Collection({
      type: 'base',
      name: 'payout_runs',
      ...openRules,
      fields: [
        { name: 'cycle_start', type: 'date', required: true },
        { name: 'payout_date', type: 'date', required: true },
        { name: 'status', type: 'text', required: true, max: 20 },
        { name: 'note', type: 'text', max: 1000 },
        { name: 'total_due_paise', type: 'number' },
        { name: 'total_paid_paise', type: 'number' },
        { name: 'total_upad_recovery_paise', type: 'number' },
        { name: 'employee_count', type: 'number' },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_payout_runs_date ON payout_runs (payout_date)'],
    })
    app.save(payoutRuns)

    const statements = new Collection({
      type: 'base',
      name: 'statements',
      ...openRules,
      fields: [
        {
          name: 'payout_run',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: payoutRuns.id,
          cascadeDelete: false,
        },
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        { name: 'cycle_start', type: 'date', required: true },
        { name: 'payout_date', type: 'date', required: true },
        { name: 'opening_paise', type: 'number' },
        { name: 'earned_paise', type: 'number' },
        { name: 'adjustment_paise', type: 'number' },
        { name: 'upad_outstanding_paise', type: 'number' },
        { name: 'upad_recovery_paise', type: 'number' },
        { name: 'total_due_paise', type: 'number' },
        { name: 'paid_paise', type: 'number' },
        { name: 'closing_paise', type: 'number' },
        { name: 'days_worked', type: 'number' },
        { name: 'ot_minutes', type: 'number' },
        { name: 'note', type: 'text', max: 1000 },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_statements_run_employee ON statements (payout_run, employee)',
        'CREATE INDEX idx_statements_employee_date ON statements (employee, payout_date)',
      ],
    })
    app.save(statements)

    const upad = new Collection({
      type: 'base',
      name: 'upad_entries',
      ...openRules,
      fields: [
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        { name: 'date', type: 'date', required: true },
        { name: 'kind', type: 'text', required: true, max: 20 },
        { name: 'amount_paise', type: 'number', required: true },
        { name: 'note', type: 'text', max: 500 },
        {
          name: 'statement',
          type: 'relation',
          maxSelect: 1,
          collectionId: statements.id,
          cascadeDelete: false,
        },
      ],
      indexes: ['CREATE INDEX idx_upad_employee_date ON upad_entries (employee, date)'],
    })
    app.save(upad)

    const payments = new Collection({
      type: 'base',
      name: 'salary_payments',
      ...openRules,
      fields: [
        {
          name: 'employee',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: employees.id,
          cascadeDelete: false,
        },
        {
          name: 'statement',
          type: 'relation',
          maxSelect: 1,
          collectionId: statements.id,
          cascadeDelete: false,
        },
        { name: 'paid_on', type: 'date', required: true },
        { name: 'amount_paise', type: 'number', required: true },
        { name: 'note', type: 'text', max: 500 },
      ],
      indexes: ['CREATE INDEX idx_payments_employee_date ON salary_payments (employee, paid_on)'],
    })
    app.save(payments)

    const settings = new Collection({
      type: 'base',
      name: 'settings',
      ...openRules,
      fields: [
        { name: 'key', type: 'text', required: true, max: 80 },
        { name: 'value', type: 'text', max: 2000 },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_settings_key ON settings (key)'],
    })
    app.save(settings)

    const audit = new Collection({
      type: 'base',
      name: 'audit_log',
      ...openRules,
      fields: [
        { name: 'action', type: 'text', required: true, max: 80 },
        { name: 'entity', type: 'text', max: 80 },
        { name: 'entity_id', type: 'text', max: 80 },
        { name: 'details', type: 'text', max: 4000 },
      ],
      indexes: [],
    })
    app.save(audit)

    const defaults = [
      ['first_cycle_start', '2026-10-01'],
      ['ot_divisor', '8'],
      ['business_name', 'હાજરી પગાર'],
      ['expected_payout_weekday', '4'],
      ['app_version', '1'],
    ]
    for (const [key, value] of defaults) {
      const record = new Record(settings)
      record.set('key', key)
      record.set('value', value)
      app.save(record)
    }
  },
  (app) => {
    const names = [
      'audit_log',
      'settings',
      'salary_payments',
      'upad_entries',
      'statements',
      'payout_runs',
      'adjustments',
      'attendance',
      'employment_periods',
      'rate_history',
      'employees',
    ]
    for (const name of names) {
      const collection = app.findCollectionByNameOrId(name)
      if (collection) app.delete(collection)
    }
  },
)
