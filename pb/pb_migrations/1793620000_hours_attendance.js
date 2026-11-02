/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2471705857") // attendance

  // add worked_minutes field: min 0, max 480 (one full day)
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "number_worked_minutes",
    "name": "worked_minutes",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number",
    "min": 0,
    "max": 480
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2471705857")
  collection.fields.removeById("number_worked_minutes")
  return app.save(collection)
})
