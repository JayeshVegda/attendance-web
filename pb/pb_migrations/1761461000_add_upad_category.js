/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('upad_entries')
    collection.fields.add(
      new TextField({
        name: 'category',
        max: 20,
      }),
    )
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('upad_entries')
    const field = collection.fields.getByName('category')
    if (field) collection.fields.remove(field.id)
    app.save(collection)
  },
)
