/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_996418814")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_996418814")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX idx_payout_runs_date ON payout_runs (payout_date)"
    ]
  }, collection)

  return app.save(collection)
})
