/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_996418814")

  // add field
  collection.fields.addAt(9, new Field({
    "help": "",
    "hidden": false,
    "id": "d_cutoff_date",
    "max": "",
    "min": "",
    "name": "cutoff_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "b_voided",
    "name": "voided",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_996418814")

  // remove field
  collection.fields.removeById("d_cutoff_date")

  // remove field
  collection.fields.removeById("b_voided")

  return app.save(collection)
})
