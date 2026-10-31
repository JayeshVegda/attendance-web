/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1841173577")

  // remove field
  collection.fields.removeById("relation3235598710")

  // add field
  collection.fields.addAt(7, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_996418814",
    "help": "",
    "hidden": false,
    "id": "relation1311680770",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "payout",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "help": "",
    "hidden": false,
    "id": "bool746475061",
    "name": "voided",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1841173577")

  // add field
  collection.fields.addAt(6, new Field({
    "cascadeDelete": false,
    "collectionId": "pbc_1545138371",
    "help": "",
    "hidden": false,
    "id": "relation3235598710",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "statement",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  // remove field
  collection.fields.removeById("relation1311680770")

  // remove field
  collection.fields.removeById("bool746475061")

  return app.save(collection)
})
