/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const runsCollection = app.findCollectionByNameOrId("payout_runs")
  const runsCollectionId = runsCollection ? runsCollection.id : "pbc_996418814"

  // 1. Add payout_id relation to adjustments
  const adjs = app.findCollectionByNameOrId("adjustments")
  if (!adjs.fields.getByName("payout_id")) {
    adjs.fields.add(new Field({
      "cascadeDelete": false,
      "collectionId": runsCollectionId,
      "help": "",
      "hidden": false,
      "id": "relation_adj_payout",
      "maxSelect": 1,
      "minSelect": 0,
      "name": "payout_id",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "relation"
    }))
    app.save(adjs)
  }

  // 2. Add payout_id relation to upad_entries
  const upads = app.findCollectionByNameOrId("upad_entries")
  if (!upads.fields.getByName("payout_id")) {
    upads.fields.add(new Field({
      "cascadeDelete": false,
      "collectionId": runsCollectionId,
      "help": "",
      "hidden": false,
      "id": "relation_upad_payout",
      "maxSelect": 1,
      "minSelect": 0,
      "name": "payout_id",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "relation"
    }))
    app.save(upads)
  }

  // 3. Backfill adjustments: only rows provably created by a payout
  app.db().newQuery(
    "UPDATE adjustments SET payout_id = settled_payout " +
    "WHERE (settled_payout IS NOT NULL AND settled_payout != '') " +
    "AND (payout_id IS NULL OR payout_id = '') " +
    "AND (" +
    "  note = 'Payout bonus' " +
    "  OR note = 'Payout deduction' " +
    "  OR note LIKE 'Payout bonus:%' " +
    "  OR note LIKE 'Payout deduction:%'" +
    ")"
  ).execute()

  // 4. Backfill upad_entries: only recovery rows or payout advance rows created by a payout
  app.db().newQuery(
    "UPDATE upad_entries SET payout_id = payout " +
    "WHERE (payout IS NOT NULL AND payout != '') " +
    "AND (payout_id IS NULL OR payout_id = '') " +
    "AND (" +
    "  kind = 'recovery' " +
    "  OR (kind = 'given' AND (note = 'Payout advance' OR note LIKE 'Payout advance:%'))" +
    ")"
  ).execute()
}, (app) => {
  const adjs = app.findCollectionByNameOrId("adjustments")
  if (adjs && adjs.fields.getByName("payout_id")) {
    adjs.fields.removeByName("payout_id")
    app.save(adjs)
  }

  const upads = app.findCollectionByNameOrId("upad_entries")
  if (upads && upads.fields.getByName("payout_id")) {
    upads.fields.removeByName("payout_id")
    app.save(upads)
  }
})
