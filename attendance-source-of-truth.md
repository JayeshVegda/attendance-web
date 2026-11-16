# Attendance & Payroll: Source of Truth

> Kapil Products. Desktop only. English only. Single user, no login.
> This file is the ONLY spec. If code, a prompt or a screenshot disagrees with it, this file wins.
> If something is not written here, do not guess. Ask the owner.

---

## 0. How to read this file

| Marker | Meaning |
|---|---|
| **LOCKED** | Stated by the owner. Do not change |
| **DERIVED** | Follows mathematically from locked rules |
| **OPEN** | Not decided. Ask before building |

---

## 1. Principles (apply to every line of code)

| # | Principle |
|---|---|
| P1 | **One upad per worker.** No second bucket, no category, no "chalu / main / moto" in UI, code or DB |
| P2 | **No separate payout page.** Payout lives inside the Cycle Register tab |
| P3 | **No fixed closing day.** No Friday logic, no weekday logic. A cycle closes only when the owner presses Payout |
| P4 | **Daily rate.** Pay is a rate per day per worker, never a monthly salary |
| P5 | **Integer paise** for all money. Never floats. Convert to rupees only for display |
| P6 | **One pure calc module** (`attendance-calc.ts`) used by every screen, service and test. No screen does its own maths |
| P7 | **Nothing hardcoded.** Shift hours, OT multiplier, company name come from Settings. No magic numbers (480, 8, 30, 1.5, Friday) in code |
| P8 | **Adj is salary-only.** It never touches upad |
| P9 | **Deduct is typed by the owner.** Never automatic |
| P10 | **Never delete financial rows.** Void with an audit trail |
| P11 | **Desktop, English, single user.** No mobile layout, no translation layer, no roles |

---

## 2. Glossary

| Term | Meaning |
|---|---|
| Worker | An employee paid a daily rate |
| Rate | Worker's daily rate in paise (`daily_rate_paise`) |
| Shift hours | Hours in one full day. Setting, default 8 |
| OT multiplier | Multiplier on the hourly rate for overtime. Setting, default 1.0 |
| Hourly rate | `rate / shift_hours` |
| Earned | Sum of day earnings in the worker's open days |
| Adj | Salary adjustment, +/-, with optional note. Salary only |
| Upad | Advance money the worker owes the owner |
| Deduct | Amount of upad recovered from this payout. Typed by owner |
| Give Upad | New advance handed over in this payout. Typed by owner |
| Repay | Worker returns upad money in cash (outside payout). Written immediately |
| Carry | Signed leftover from the previous payout. **Positive** = unpaid salary owed to worker. **Negative** = overpaid, reduces next To Pay |
| To Pay (calculated) | `Carry + Earned + Adj - Deduct + Give Upad`. May be negative |
| Typed | The amount the owner actually pays, typed in the To Pay box |
| Done | Row is ready for payout (green). Set by typing in To Pay |
| Open days | Days from `paid_up_to + 1` through today (today included) |
| Cycle | A worker's open days. Starts the day after their last payout, ends when paid |
| Payout run | One press of the Payout button. Closes all done rows |
| Boundary | `paid_up_to`: the last date already settled for a worker |

---

## 3. Settings (all dynamic)

| Key | Type | Default | Used by |
|---|---|---|---|
| `shift_hours` | number > 0 | 8 | Custom-hour pay, OT pay, hour pickers |
| `ot_multiplier` | number >= 0 | 1.0 | OT pay |
| `company_name` | text | "Kapil Products" | Headers, printouts |

Rules:
- Settings are read once through a settings hook and passed into calc functions as **parameters**. The calc module never reads the DB or globals.
- Changing a setting recalculates all **open** (unpaid) figures immediately.
- Closed statements are frozen snapshots. They never change after a setting change.
- Saving settings must not break layout. No hardcoded file paths (especially Windows paths) anywhere.

---

## 4. Data model

One clean PocketBase migration. Reseed demo data (13 workers, some attendance, some upad).

### 4.1 `employees`
| Field | Type | Notes |
|---|---|---|
| name | text | required |
| phone | text | |
| role | text | |
| daily_rate_paise | int | required |
| status | `active` / `inactive` | inactive workers are hidden from the Cycle Register and Roll Call |
| opening_upad_paise | int | starting upad balance, default 0 |
| opening_carry_paise | int | signed, starting carry, default 0 |
| paid_up_to | date (nullable) | boundary. Null = nothing settled yet, open days start from `joined_on` |
| joined_on | date | days before it are not shown |

### 4.2 `attendance`
| Field | Type | Notes |
|---|---|---|
| employee | relation | |
| date | `YYYY-MM-DD` | |
| status | `full` / `half` / `absent` / `hours` | |
| worked_minutes | int | used only when status = `hours` |
| ot_minutes | int | forced 0 when status = `absent` |
| notes | text | |
| settled_payout | relation (nullable) | set on payout, cleared on unlock |

Unique index: `(employee, date)`. No row = day not marked (shows "-", earns 0).

### 4.3 `upad_entries` (the single upad ledger)
| Field | Type | Notes |
|---|---|---|
| employee | relation | |
| date | date | |
| kind | `give` / `deduct` / `repay` | nothing else |
| amount_paise | int > 0 | |
| note | text | |
| payout_id | relation (nullable) | set for entries created by a payout |
| voided | bool | default false |

### 4.4 `cycle_drafts` (one open draft per worker)
| Field | Type | Notes |
|---|---|---|
| employee | relation, **unique** | one draft per worker, not keyed by dates |
| adj_paise | int | signed, default 0 |
| adj_note | text | optional |
| deduct_paise | int >= 0 | default 0 |
| give_upad_paise | int >= 0 | default 0 |
| typed_paise | int (nullable) | owner's actual payment. Null = not typed |
| is_done | bool | true when typed_paise is set |

### 4.5 `payout_runs`
`run_date`, `status` (`pending` / `completed`), `total_paid_paise`, `voided`.

### 4.6 `statements` (frozen, one per worker per run)
`payout_run`, `employee`, `start_date`, `end_date`, `carry_in`, `earned`, `adjustment`, `upad_deduct`, `upad_give`, `calculated`, `paid`, `carry_out` (signed), `voided`.

### 4.7 `salary_payments`
`payout_run`, `employee`, `amount_paise`, `voided`.

### 4.8 `holidays`
`date` (unique), `note`.

### 4.9 `cycle_audits`
`payout_run`, `action` (`unlock`), `reason` (required), `user`, `created_at`, `snapshot` (JSON of everything voided).

### 4.10 `settings`
`shift_hours`, `ot_multiplier`, `company_name`.

---

## 5. Calculation rules (all in `attendance-calc.ts`)

All functions are pure. Inputs in, numbers out. Every function that needs shift hours or multiplier receives them as arguments.

### 5.1 Day earnings
`calcDayEarnings(attendance, ratePaise, shiftHours, otMultiplier)`

| Status | Base | OT |
|---|---|---|
| `full` | rate | `round(rate / shiftHours x otMultiplier x otHours)` |
| `half` | exactly `rate / 2` (rounded once) | same |
| `hours` | `round(rate / shiftHours x workedHours)` | same |
| `absent` | 0 | **0 (OT blocked and cleared)** |
| no record | 0 | 0 |

- Round **once per component** (base, OT). Never round intermediate values.
- Hours and minutes: stored as minutes, so `workedHours = worked_minutes / 60`.
- Day total = base + OT. Return base, OT, total and effective days.

### 5.2 Holidays
| Case | Result |
|---|---|
| Holiday, worker has no record | Off, pays 0 |
| Holiday, worker marked Present/Half/Hours | Paid normally by status |
| A paid holiday | The owner marks everyone Present. There is no `is_paid` flag |

Holidays are toggled manually from the day column header. No weekday auto-detect.

### 5.3 Earned
`Earned = sum of day totals for open days (paid_up_to + 1 .. today)`.

### 5.4 Upad balance
`Upad balance = opening_upad + sum(give) - sum(deduct) - sum(repay)`, ignoring voided entries.

`Upad after (preview) = Upad before - Deduct + Give Upad`. **Adj is not an input.**

### 5.5 To Pay (calculated)
`To Pay = Carry + Earned + Adj - Deduct + Give Upad`. May be negative.

### 5.6 Settlement
`calcPayoutSettlement(calculated, typed)`

| Case | carry_out |
|---|---|
| typed = calculated | 0 |
| typed < calculated | `calculated - typed` (positive, unpaid salary) |
| typed > calculated | `calculated - typed` (**negative**, overpaid) |

- Overpay does **not** create an upad entry. It becomes a negative carry and is deducted from the next cycle's To Pay.
- `typed` is the cash actually handed over (>= 0).

### 5.7 Carry in
`carry_in` = last non-voided statement's `carry_out` for that worker, else `opening_carry_paise`.

### 5.8 Warnings (warn only, never block)
| Condition | Warning |
|---|---|
| Deduct > Earned + Carry | "Deduct exceeds earnings" |
| Deduct > Upad balance | "Deduct exceeds upad balance" |
| typed > calculated | "Overpaid Rs X, will be deducted next cycle" |
| Calculated < 0 | "Worker owes money this cycle" |

---

## 6. Cycle logic

1. Each worker has an independent boundary `paid_up_to`.
2. Open days = `paid_up_to + 1` through **today (today included)**. If null, from `joined_on`.
3. After a payout for a worker: `paid_up_to = payout date (today)`. A new cycle starts automatically (next day onwards).
4. Workers may have different cycle lengths (7, 10, 12 days or more). Nothing assumes weekly.
5. Unpaid workers keep their days, draft and carry. Their cycle simply grows.
6. In the table, days before a worker's own boundary show greyed and locked.
7. No fixed closing day. No Friday, no weekday, no `cycle_start_day`.

---

## 7. Row state machine (Cycle Register)

| State | Trigger | Look |
|---|---|---|
| Untouched | No inputs, no typed | White |
| Editing | Adj, Deduct or Give has a value | Light yellow |
| Done | typed_paise set (blur or Enter on To Pay) | Green + check |
| Done with carry | Done and carry_out != 0 | Green + amber chip ("Carry Rs X" or "Overpaid Rs X") |
| Idle | No work in cycle, no balance, no carry | Grey |
| Closed | Viewing a closed run | Grey + lock |

Transitions:
- Typing a value in To Pay and leaving the field (blur) or pressing Enter: `is_done = true`.
- Clearing the field: `is_done = false`, `typed_paise = null`.
- **If a done row's attendance, Adj, Deduct or Give changes: it returns to not done automatically**, and the typed value is cleared.
- Focused To Pay field shows a greyish background.

---

## 8. Payout algorithm

Triggered by "Payout (n)" where n = number of done rows (button disabled at 0).

1. Confirm dialog: totals for To Pay, Deduct, Give, new carry, cash required.
2. Create `payout_runs` with `status = pending`.
3. For each done row (only these):
   1. Write the `statements` row (frozen numbers: carry_in, earned, adjustment, upad_deduct, upad_give, calculated, paid, carry_out).
   2. Write `salary_payments` (amount = typed).
   3. If Deduct > 0: `upad_entries` kind `deduct`, `payout_id = run`.
   4. If Give > 0: `upad_entries` kind `give`, `payout_id = run`.
   5. Set `paid_up_to = today`.
   6. Set `settled_payout = run` on the worker's attendance in the window.
   7. Delete the worker's draft (a fresh empty one is created when needed).
4. Update the run to `completed` with the total paid.
5. **Recoverable:** if any write fails, roll back everything created in this run and remove the pending run. A pending run left by a crash is detected and repaired on next load.
6. Not-done rows are untouched.

---

## 9. Unlock algorithm

Available on closed cycles (Cycle Register closed view and Report).

1. Reason is **required**.
2. **Only the latest non-voided run of each affected worker** can be unlocked. If a worker has a newer non-voided run, throw: "Cannot unlock: [Worker] has a newer payout on [date]. Unlock that first."
3. Write `cycle_audits` (run, reason, user, time, full snapshot JSON).
4. **Void, never delete:** the run, its statements, salary payments and linked upad entries (`voided = true`).
5. Clear `settled_payout` on the affected attendance.
6. Move each worker's `paid_up_to` back to the day before their statement's `start_date`.
7. Carry in for the reopened cycle returns to its pre-payout value automatically, because voided statements are ignored.

---

## 10. Screens

### 10.1 Attendance page: two tabs only

#### Tab A: Today's Roll Call
| Item | Spec |
|---|---|
| Header | Date (default today, can change), marked count (e.g. "7 / 13"), Search, "Mark All Present", "Clear Today" |
| Row | Avatar, name, number, rate/day, worked days and amount in current cycle, upad balance |
| Pills | Compact and small: **P**, **H**, **A**, **Hrs**, **OT 1-4 / +OT** |
| Hrs | Opens a small input for worked hours |
| OT | Disabled and cleared when A (Absent) is selected |
| + Upad | Opens the single Upad popup (Give / Return) |
| Inactive workers | Greyed, controls disabled |

#### Tab B: Cycle Register (salary and payout)
**Top bar**
| Item | Spec |
|---|---|
| Cycle selector | Open cycle shows its date range. Past runs show with a lock icon |
| Drawer cash | Typed manually by owner |
| Total To Pay | Sum of calculated To Pay for all rows |
| Paid so far | Sum of typed amounts on done rows |
| Drawer left | Drawer cash minus Paid so far. Red if negative |
| Search | By worker name |
| Collapse days | Toggles all day columns into one summary column |
| Payout (n) | Closes done rows only. Disabled at 0 |

**Columns (8)**
| # | Column | Behaviour |
|---|---|---|
| 1 | Worker | Number, name, rate/day. Small carry chip under name: "Carry Rs X" (positive) or "Overpaid Rs X" (negative). Hover tooltip: breakdown (unpaid amount, which payout, date). Click name opens Worker Popup |
| 2 | Days | One cell per day plus Today. Tap a cell to pick P / H / A / Custom. Custom takes hours and optional OT, cell shows "3h". Holiday column shows Off (toggle from the header). Days before the worker's boundary are greyed/locked. Collapsed: one summary column (e.g. "3.5d") |
| 3 | Earned | Rs amount, "3d +1h" below |
| 4 | Adj (+/-) | Input, optional note on click. Salary only |
| 5 | Upad (red header) | Current balance with live "-> new balance" preview as Deduct / Give change |
| 6 | Deduct (red header) | Input. Warn-only validation |
| 7 | Give Upad (blue header) | Input |
| 8 | To Pay | **Input.** Grey placeholder = calculated amount. Behaviour in section 7. Under the field: "carry Rs X" when typed < calculated, warning when typed > calculated |

There is **no** Paid column, no row checkbox and no PAYOUT column.

**Layout:** the table fits the page height without an inner scrollbar. Compact rows, small type. If the window is narrower than the table, only a horizontal scroll is allowed.

### 10.2 Worker Popup (click a worker name; 3 editable sections)
| Section | Content |
|---|---|
| 1. Attendance | This cycle's days, editable with the same picker as the table |
| 2. Upad | Balance, last 5-8 ledger entries with running balance, actions **Give**, **Deduct**, **Repay**. Upad-after preview. Repay writes to the ledger immediately. Give and Deduct write to the draft |
| 3. To Pay | Breakdown line: `Carry + Earned +/- Adj - Deduct + Give = To Pay`. Adj and its note live here. The To Pay input with the same done behaviour |

All edits reflect in the table live.

### 10.3 Advances (Upad) page: sidebar page
| Item | Spec |
|---|---|
| List | Compact list of workers, each with balance. Sorted by balance, searchable |
| Click a worker | **Popup** with the full ledger (date, kind, amount, note, running balance) and actions Give / Deduct / Repay |
| Overview | Who took how much, and on which day |
| Pending confirmation | OPEN: confirm popup-from-list is the right reading (see section 13) |

### 10.4 Report
| Section | Content |
|---|---|
| This month | Total paid, total upad given, total upad deducted, total returned |
| History | Past payout runs. Expand a run to see per-worker statements |
| Day-by-day grid | Per worker per day: attendance, upad given, upad deducted |
| Statement lines | Carry in, Earned, Adj (as a salary line), Deduct, Give, Calculated, Paid, Carry out |
| Unlock | Per run, with required reason |

### 10.5 Workers page
Compact, small, scannable. One page, no tab hopping, minimal scrolling.
| Column / info | Notes |
|---|---|
| Name, role, phone | |
| Rate/day | |
| Status | Active / Inactive toggle |
| Upad balance | |
| Carry | Signed |
| This cycle | Days worked and earned |
| Last payout | Date |
| Edit | Small popup: name, phone, role, rate, opening upad, opening carry, joined date |

Delete is allowed only for workers with no attendance and no upad entries.

### 10.4 Settings
`shift_hours`, `ot_multiplier`, `company_name`. Saving must not break layout. No hardcoded paths.

### 10.5 Sidebar
Attendance, Workers, Advances (Upad), Report, Settings. **No "Issue Payout".**

---

## 11. Labels

Use only: **Upad**, **Upad Deduct**, **Give Upad**, **Carry**, **Overpaid**, **To Pay**, **Adj**.
Never show: Chalu, Main, Moto, Loan cut, Recovery, Issue Payout, Pay worker.

---

## 12. Worked examples (these are the test cases)

| # | Case | Inputs | Result |
|---|---|---|---|
| 1 | Ramesh, shortfall | Earned 2000, upad 4000, Deduct 1000, drawer only allows 800 | Calculated 1000. Typed 800. carry_out **+200**. Upad after **3000** |
| 2 | Overpay | Calculated 1000, typed 1200 | carry_out **-200**. No upad entry. Next cycle To Pay = calculated - 200 |
| 3 | Suresh | Carry 300, Earned 3000, upad 7000, Give 500 | Calculated **3800**. Upad after **7500** |
| 4 | Adj isolation | Earned 2500, upad 5000, Adj +300, Deduct 500 | Calculated 2300. Upad after 4500. No upad entry for Adj |
| 5 | 3h custom day | rate 480, shift 8 | 3 x 60 = **180** |
| 6 | Setting change | rate 800, shift 10, multiplier 1.5, 10h + 2h OT | Hourly 80, OT/h 120. Day = 800 + 240 = **1040** |
| 7 | Holiday | Off with no record / Present on holiday | 0 / paid normally |
| 8 | Absent + OT | Absent with OT hours entered | OT blocked, total 0 |
| 9 | Selective payout | 2 workers, 1 done, press Payout (1) | Done worker paid and boundary moved. Other keeps days and draft |
| 10 | Unlock | Run with reason | Voided, audit row written, boundary restored |
| 11 | Unlock order | Older run while newer exists | Error naming the newer run |
| 12 | Different cycles | Worker A paid_up_to Mon, worker B Thu | Different day ranges in one table |

---

## 13. Open items (ask the owner; do not assume)

| # | Question | Current reading |
|---|---|---|
| O1 | Advances page: worker list where a click opens a popup ledger? | Assumed yes. Needs confirmation |
| O2 | "No open access": no login at all, or a simple password on the app? | Assumed no login. Needs confirmation |
| O3 | Is typed allowed to be negative or must it be >= 0? | Assumed >= 0 |
| O4 | Can attendance be edited on days before a worker's boundary? | Assumed no, locked. Unlock the payout first |

---

## 14. Build rules (how to build it)

1. **Calc module first**, then tests, then service, then UI. UI components contain no maths.
2. **Services** (`attendance-service`, `payout-service`) own all DB writes. Components call services only.
3. **Settings via one hook.** Pass `shiftHours` and `otMultiplier` as arguments.
4. **No magic values:** grep must find no `480`, `isFriday`, `getDay() === 5`, `cycle_start_day`, `ot_divisor`, `chalu`, `moto`, `PayoutScreen`, `#/payout` in source.
5. **Serialise draft writes per worker** (a per-employee promise queue) so rapid typing cannot cause lost updates.
6. **Money inputs** accept rupees, store paise. Display uses one formatter.
7. **Fit-to-page layout** with no nested vertical scrollbar. Compact sizing tokens defined once.
8. **Derive, don't store:** balances, earned and carry-in are derived from ledgers and statements. Only drafts and ledger entries are stored inputs.
9. **Frozen statements:** a closed statement never recalculates.
10. **Every destructive action** is a void with an audit trail. No deletes of financial rows.

---

## 15. Acceptance checklist

- [ ] One upad everywhere. No chalu/moto in UI, code or DB
- [ ] No payout page, no payout route, no "Pay worker" button
- [ ] No Friday or fixed-day logic anywhere
- [ ] Shift hours and OT multiplier come from Settings, and changing them recalculates open figures
- [ ] To Pay input: blur/Enter makes the row green, clearing undoes it
- [ ] Shortfall gives positive carry. Overpay gives negative carry with no upad entry
- [ ] Adj never changes upad
- [ ] Deduct is never automatic
- [ ] Payout (n) closes only green rows, and others keep their days
- [ ] Unlock needs a reason, writes an audit row, voids not deletes, and respects latest-run-only
- [ ] Worker popup has the 3 sections and edits live
- [ ] Days collapse into one summary column
- [ ] Table fits page height with no inner vertical scrollbar
- [ ] Roll Call pills are compact. OT is disabled when Absent
- [ ] Workers page is compact and shows everything at a glance
- [ ] Report shows this month's paid, upad, and history with the day grid
- [ ] All tests in section 12 pass and the build is clean
