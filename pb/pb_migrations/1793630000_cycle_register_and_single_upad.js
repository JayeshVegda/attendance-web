/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const empCollection = app.findCollectionByNameOrId("employees")
  const empId = empCollection ? empCollection.id : "pbc_3735627160"

  // 1. Ensure opening_upad_paise field exists on employees
  if (!empCollection.fields.getByName("opening_upad_paise")) {
    empCollection.fields.add(new Field({
      "name": "opening_upad_paise",
      "type": "number",
      "onlyInt": false,
      "required": false,
    }))
    app.save(empCollection)
  }

  // 2. Merge opening_chalu_paise and opening_moto_paise into opening_upad_paise
  app.db().newQuery(
    "UPDATE employees SET opening_upad_paise = COALESCE(opening_chalu_paise, 0) + COALESCE(opening_moto_paise, 0)"
  ).execute()

  // 3. Normalize upad_entries to single upad
  app.db().newQuery(
    "UPDATE upad_entries SET category = 'regular' WHERE category != 'regular'"
  ).execute()

  // 4. Clean up legacy settings keys
  app.db().newQuery(
    "DELETE FROM settings WHERE key IN ('chalu_upad_enabled', 'moto_upad_enabled', 'chalu_upad_label', 'moto_upad_label')"
  ).execute()

  // 5. Create cycle_drafts collection for staged inputs
  let draftCollection = null
  try {
    draftCollection = app.findCollectionByNameOrId("cycle_drafts")
  } catch (e) {
    draftCollection = null
  }

  if (!draftCollection) {
    draftCollection = new Collection({
      name: "cycle_drafts",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        {
          autogeneratePattern: "[a-z0-9]{15}",
          hidden: false,
          name: "id",
          pattern: "^[a-z0-9]+$",
          presentable: false,
          primaryKey: true,
          required: true,
          system: true,
          type: "text",
        },
        {
          cascadeDelete: true,
          collectionId: empId,
          hidden: false,
          maxSelect: 1,
          minSelect: 0,
          name: "employee",
          presentable: false,
          required: true,
          system: false,
          type: "relation",
        },
        {
          autogeneratePattern: "",
          hidden: false,
          max: 20,
          min: 0,
          name: "cycle_start",
          pattern: "",
          presentable: false,
          required: true,
          system: false,
          type: "text",
        },
        {
          hidden: false,
          name: "deduct_paise",
          onlyInt: true,
          presentable: false,
          required: false,
          system: false,
          type: "number",
        },
        {
          hidden: false,
          name: "give_upad_paise",
          onlyInt: true,
          presentable: false,
          required: false,
          system: false,
          type: "number",
        },
        {
          hidden: false,
          name: "paid_paise",
          onlyInt: true,
          presentable: false,
          required: false,
          system: false,
          type: "number",
        },
        {
          autogeneratePattern: "",
          hidden: false,
          max: 30,
          min: 0,
          name: "paid_date",
          pattern: "",
          presentable: false,
          required: false,
          system: false,
          type: "text",
        },
        {
          autogeneratePattern: "",
          hidden: false,
          max: 30,
          min: 0,
          name: "work_counted_up_to",
          pattern: "",
          presentable: false,
          required: false,
          system: false,
          type: "text",
        },
        {
          hidden: false,
          name: "is_done",
          presentable: false,
          required: false,
          system: false,
          type: "bool",
        },
        {
          autogeneratePattern: "",
          hidden: false,
          max: 500,
          min: 0,
          name: "created_upad_ids",
          pattern: "",
          presentable: false,
          required: false,
          system: false,
          type: "text",
        },
        {
          autogeneratePattern: "",
          hidden: false,
          max: 200,
          min: 0,
          name: "note",
          pattern: "",
          presentable: false,
          required: false,
          system: false,
          type: "text",
        },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_cycle_drafts_emp_cycle ON cycle_drafts (employee, cycle_start)",
      ],
    })

    return app.save(draftCollection)
  }
}, (app) => {
  const collection = app.findCollectionByNameOrId("cycle_drafts")
  if (collection) {
    app.delete(collection)
  }
})
