/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const runs = app.findCollectionByNameOrId("payout_runs")

  const hasKey = runs.fields.getByName("idempotency_key")
  if (!hasKey) {
    runs.fields.add(new Field({
      "autogeneratePattern": "",
      "hidden": false,
      "id": "text1743612301",
      "max": 64,
      "min": 0,
      "name": "idempotency_key",
      "pattern": "",
      "presentable": false,
      "primaryKey": false,
      "required": false,
      "system": false,
      "type": "text"
    }))
  }

  const runIndex = "CREATE UNIQUE INDEX idx_payout_runs_idempotency ON payout_runs (idempotency_key) WHERE voided != true"
  const runIndexes = JSON.parse(runs.indexes || "[]")
  if (!runIndexes.includes(runIndex)) runIndexes.push(runIndex)
  runs.indexes = JSON.stringify(runIndexes)
  app.save(runs)

  const stmts = app.findCollectionByNameOrId("statements")

  const stmtIndex = "CREATE UNIQUE INDEX idx_statements_emp_payoutday ON statements (employee, payout_date) WHERE voided != true"
  const stmtIndexes = JSON.parse(stmts.indexes || "[]")
  if (!stmtIndexes.includes(stmtIndex)) stmtIndexes.push(stmtIndex)
  stmts.indexes = JSON.stringify(stmtIndexes)
  app.save(stmts)
}, (app) => {
  const runs = app.findCollectionByNameOrId("payout_runs")
  let runIndexes = JSON.parse(runs.indexes || "[]")
  runIndexes = runIndexes.filter((i) => !i.includes("idx_payout_runs_idempotency"))
  runs.indexes = JSON.stringify(runIndexes)
  runs.fields.removeByName("idempotency_key")
  app.save(runs)

  const stmts = app.findCollectionByNameOrId("statements")
  let stmtIndexes = JSON.parse(stmts.indexes || "[]")
  stmtIndexes = stmtIndexes.filter((i) => !i.includes("idx_statements_emp_payoutday"))
  stmts.indexes = JSON.stringify(stmtIndexes)
  app.save(stmts)
})
