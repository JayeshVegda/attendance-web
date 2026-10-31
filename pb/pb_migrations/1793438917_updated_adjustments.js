/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_530751574")

  // add field
  collection.fields.addAt(5, new Field({
    "help": "",
    "hidden": false,
    "id": "select1002749145",
    "maxSelect": 1,
    "name": "kind",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "bonus",
      "reimbursement",
      "deduction"
    ]
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_996418814",
    "help": "",
    "hidden": false,
    "id": "relation2652963397",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "settled_payout",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_530751574")

  // remove field
  collection.fields.removeById("select1002749145")

  // remove field
  collection.fields.removeById("relation2652963397")

  return app.save(collection)
})
