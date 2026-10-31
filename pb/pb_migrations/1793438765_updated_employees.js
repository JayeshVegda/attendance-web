/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3735627160")

  // remove field
  collection.fields.removeById("number3850087167")

  // add field
  collection.fields.addAt(10, new Field({
    "help": "",
    "hidden": false,
    "id": "d_opening_date",
    "max": "",
    "min": "",
    "name": "opening_date",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "date"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "help": "",
    "hidden": false,
    "id": "n_opening_chalu_paise",
    "max": null,
    "min": null,
    "name": "opening_chalu_paise",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "n_opening_moto_paise",
    "max": null,
    "min": null,
    "name": "opening_moto_paise",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3735627160")

  // add field
  collection.fields.addAt(7, new Field({
    "help": "",
    "hidden": false,
    "id": "number3850087167",
    "max": null,
    "min": null,
    "name": "opening_upad_paise",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // remove field
  collection.fields.removeById("d_opening_date")

  // remove field
  collection.fields.removeById("n_opening_chalu_paise")

  // remove field
  collection.fields.removeById("n_opening_moto_paise")

  return app.save(collection)
})
