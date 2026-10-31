/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2471705857")

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
  const collection = app.findCollectionByNameOrId("pbc_2471705857")

  // remove field
  collection.fields.removeById("relation2652963397")

  return app.save(collection)
})
