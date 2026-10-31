# Kapil Attendance App — Build Guide for the Coding Agent

You are building (or fixing) the attendance, salary, upad and payout logic for a factory app. This file tells you what to build, in what order, and how to check it. The business rules are in the companion file `Attendance and Payout Rules Spec` (the owner's document). If this guide and the spec ever disagree, stop and ask the owner. Do not guess.

The owner is not a programmer. Explain your work in plain words. Ask before anything destructive.

---

## 0. Read this first

1. **Look at the existing code before writing anything.** The app is `attendance-web`: a React frontend with embedded PocketBase (SQLite in `pb\pb_data`), packaged as a Windows 10 desktop `.exe`. Follow the patterns already in the codebase (folder layout, how collections and hooks are written, how the UI calls the backend).
2. **Write a short gap list** (`GAPS.md`) comparing what the code does today with this guide. Show it to the owner before big changes.
3. **Back up `C:\Site_imp\attendance-web\pb\pb_data` before any migration.** Never delete or reset the owner's data without asking.
4. Known things in the old design that this guide REPLACES (check whether the code does them, and remove them):
   - Fixed Thursday-to-Thursday cycles. Replace with per-worker "paid-up-to" dates (section 3).
   - Upad recovery capped by "what he earned this cycle". The correct cap is carry + earned + adjustments (section 5).
   - Automatic shifting of recovery from the regular bucket to the extra bucket (the demo seed script did this). The app must NEVER shift between buckets by itself.
   - Names "regular" and "extra" upad. Rename to **Chalu Upad** and **Moto Upad (Main Upad)**.
   - Any negative carry or negative upad balance. Not allowed.

---

## 1. Core rules in one page

- Pay is per day. Each worker has a daily rate with effective dates.
- Statuses: **Full** = 100% of rate, **Half** = 50%, **Absent** = 0.
- OT = rate ÷ 8 × OT hours, only on a day the worker is present (Full or Half). A normal day is 8 paid hours.
- A payout can be on **any date**, for **all or selected** workers. Thursday is only a default suggestion.
- Each worker has a **paid-up-to** date. A payout settles that worker's unsettled work through the **cutoff**. The next cycle starts the day after the cutoff.
- Cutoff default = payout date, including that day's work if the worker is present. The owner may exclude the payout day.
- Unpaid salary carries forward. Carry is never negative.
- Two upad buckets: **Chalu** (small, frequent) and **Moto** (big, long-running). Each balance is always zero or more.
- The owner types every recovery amount. Default bucket for recovery is Chalu. The app never moves amounts between buckets.
- Money is stored as **integer paise**. Round only for display.
- Business dates are plain `YYYY-MM-DD` strings in Asia/Kolkata. Do not store them as timestamps.

---

## 2. Data model

Use integer paise (`*_paise`) for all money fields. Adapt names to the existing codebase where collections already exist. Add migrations; do not drop existing data.

| Collection | Fields | Notes |
| --- | --- | --- |
| `employees` | name, active (bool), opening_salary_paise, opening_chalu_paise, opening_moto_paise, opening_date | Opening balances are entered when the worker is created. `opening_date` is the day before the worker's first counted day (for the original 16 workers: 2026-09-30). |
| `employment_periods` | employee, start_date, end_date (nullable) | A break ends a period; rejoining starts a new one. Marking a worker inactive sets `end_date` on the open period. The first `start_date` is the joining date. |
| `rates` | employee, effective_from, daily_rate_paise | Rate for a date = the latest row with `effective_from <= date`. Keep full history. |
| `attendance` | employee, date, status (`full`/`half`/`absent`), ot_minutes, note, settled_payout (relation, nullable) | Unique on (employee, date). `settled_payout` is set when a payout includes the row. |
| `adjustments` | employee, date, kind (`bonus`/`reimbursement`/`deduction`), amount_paise (always positive), note, settled_payout (nullable) | Deduction subtracts, the others add. |
| `upad_entries` | employee, date, bucket (`chalu`/`moto`), kind (`given`/`returned`/`recovery`/`writeoff`), amount_paise (positive), note, payout (nullable), voided (bool) | The upad ledger. Balances are derived from this, never stored separately. |
| `salary_writeoffs` | employee, date, amount_paise, note, payout (nullable), voided (bool) | For salary the shop forgives when a worker leaves. |
| `payout_runs` | payout_date, cutoff_date, created, voided (bool), totals (json) | One settlement event. |
| `payout_statements` | run, employee, from_date, to_date, carry_in_paise, earned_paise, ot_paise, adjustments_paise, chalu_recovery_paise, moto_recovery_paise, new_upad_bucket, new_upad_given_paise, payable_paise, salary_paid_paise, closing_carry_paise, day_breakdown (json), warnings (json), voided (bool) | The receipt for one worker in one run. Keep it forever. |

Derived values (compute, do not store as the source of truth):

- **Paid-up-to** = `to_date` of the worker's latest non-voided statement, else `opening_date`.
- **Carry** = `closing_carry_paise` of that statement, else `opening_salary_paise`.
- **Upad balance(bucket, asOf)** = opening for the bucket + sum of `given` − sum of `returned`, `recovery`, `writeoff`, over non-voided entries with `date <= asOf`.

---

## 3. Cycles, paid-up-to and cutoff

- There is no global cycle table. A worker's current cycle is: unsettled attendance and adjustments dated `<= cutoff`.
- Use the `settled_payout` marker, not only date ranges. This makes **late entries** work: if the owner adds attendance for a day that is already inside a paid period, the row is unsettled, so the next payout includes it automatically. Label such rows "late entry" in the statement (their date is before the previous `to_date`).
- A payout lets the owner pick: payout date (default today), cutoff mode (**include payout day** default, or **exclude payout day**, meaning cutoff = payout date − 1), and the workers (all, or a selection).
- Workers who are not selected are untouched. Their next payout just covers more days.
- After saving, each included worker's paid-up-to becomes the cutoff.
- Show a worker in the payout list if he has unsettled attendance or adjustments, a carry above zero, or any upad balance above zero. Inactive workers must still appear if any of that is true.

---

## 4. Earnings algorithm

Put all money math in **one pure module** (no database calls inside) so it can be unit-tested. Suggested shape:

```ts
type Paise = number; // integer

function roundHalfUp(x: number): Paise { return Math.floor(x + 0.5); }

function dayEarnings(status, otMinutes, ratePaise) {
  const present = status === 'full' || status === 'half';
  const base = status === 'full' ? ratePaise
             : status === 'half' ? roundHalfUp(ratePaise / 2)
             : 0;
  const ot = present ? roundHalfUp(ratePaise * otMinutes / 480) : 0; // 480 = 8h * 60
  return { base, ot };
}
```

For each unsettled attendance row with `date <= cutoff`:

1. Skip it if the date is outside every employment period of the worker.
2. `rate = rateOn(worker, date)` (rate history by effective date).
3. Add `dayEarnings(...)` to `earned` and `ot`.
4. Record the row in `day_breakdown` (date, status, ot minutes, rate used, amount, late-entry flag).

Check: rate ₹500 (50000 paise), 60 minutes OT → 50000 × 60 / 480 = 6250 paise = ₹62.50.

Adjustments: for unsettled adjustments dated `<= cutoff`, sum bonus and reimbursement as plus, deduction as minus.

---

## 5. Payout calculation algorithm

Inputs per worker, typed by the owner: `chaluRecovery`, `motoRecovery`, `newUpadGiven` (+ `newUpadBucket`, default `moto`), `salaryPaid` (default = payable).

```ts
function computePayout(w, cutoff, payoutDate, input) {
  const carry    = currentCarry(w);
  const earned   = sumBase(rows);          // from section 4
  const ot       = sumOt(rows);
  const adj      = sumAdjustments(adjs);   // signed
  const gross    = carry + earned + ot + adj;
  const available = Math.max(0, gross);

  const warnings = [];
  if (gross < 0) warnings.push({ type: 'deduction_exceeds_due', leftover: -gross });

  const chaluBal = upadBalance(w, 'chalu', payoutDate);
  const motoBal  = upadBalance(w, 'moto',  payoutDate);

  // validation: refuse, never clamp silently
  if (input.chaluRecovery > chaluBal) throw refuse('chalu_recovery_exceeds_balance');
  if (input.motoRecovery  > motoBal)  throw refuse('moto_recovery_exceeds_balance');
  if (input.chaluRecovery + input.motoRecovery > available) throw refuse('recovery_exceeds_due');

  const payable = available - input.chaluRecovery - input.motoRecovery;
  if (input.salaryPaid < 0 || input.salaryPaid > payable) throw refuse('salary_paid_out_of_range');

  const closingCarry = payable - input.salaryPaid;
  const cashToHandOverFull = payable + input.newUpadGiven;
  const cashBeingPaid      = input.salaryPaid + input.newUpadGiven;

  return { carry, earned, ot, adj, available, payable, closingCarry,
           cashToHandOverFull, cashBeingPaid, warnings,
           chaluAfter: chaluBal - input.chaluRecovery + (input.newUpadBucket === 'chalu' ? input.newUpadGiven : 0),
           motoAfter:  motoBal  - input.motoRecovery  + (input.newUpadBucket === 'moto'  ? input.newUpadGiven : 0) };
}
```

Rules to enforce:

- Recovery is checked against `carry + earned + ot + adjustments`, so recovery can come out of carry, not only this cycle's earnings.
- `payable` is never below zero. If a deduction pushes the total below zero, floor at zero and show the `deduction_exceeds_due` warning with the leftover amount. The owner may then add a **Moto Upad given** entry for the leftover, or ignore it. The app does nothing on its own.
- Never allow paid > payable. To give extra money, the owner records a new upad **given** entry.
- Recovery defaults to Chalu in the UI (Chalu box pre-focused, Moto box empty). The owner fills each amount. No automatic split.
- Leftover paise stay in `closingCarry`.

### Saving a payout (one database transaction)

1. Create `payout_runs` (date, cutoff).
2. For each worker: create the `payout_statements` row with all figures, the breakdown and the warnings.
3. Create `upad_entries`: one `recovery` entry per bucket with a non-zero amount, and one `given` entry for `newUpadGiven` (dated the payout date), each linked to the run.
4. Set `settled_payout` on every attendance row and adjustment that was included.
5. Update run totals (due, paid, upad recovered).

If any step fails, roll back everything.

### Undo

- Undo means: mark the run's statements and upad entries `voided`, clear `settled_payout` on the rows it settled, and restore paid-up-to, carry and balances (they are derived, so this is automatic).
- Allow undo only when each affected statement is that worker's **latest** non-voided statement. Otherwise refuse and say which worker blocks it.
- Never hard-delete payout history.

### Leaving workers: final payout order

1. Offset: the owner enters recovery amounts as usual (normal recovery).
2. Pay the remaining salary, or leave it as carry.
3. If the owner chooses, write off the salary remainder as ONE `salary_writeoffs` row.
4. Write off any upad still owed as a separate `writeoff` entry per bucket.

Salary write-off and upad write-off are separate rows. Never combine them.

---

## 6. Upad ledger rules

- `given`: balance up. Any date. Can also be created inside a payout.
- `returned`: the worker hands back his own cash on any date. Balance down. The owner picks the bucket. It is not a salary deduction.
- `recovery`: created only by a payout.
- `writeoff`: balance down, by deliberate action.
- Refuse any `returned`, `recovery` or `writeoff` larger than the bucket's balance on that date. Do not let a balance go negative.
- Entries may be added with an earlier date. Recompute running balances in date order. When adding or editing a backdated entry, validate that no later balance would go below zero.
- The ledger view shows every entry with date, kind, amount, note and the running balance after it.
- The payout screen shows, per worker: this payout's Chalu taken (itemised by day, e.g. Sun ₹200, Mon ₹600, Wed ₹200 = ₹1,000) and older Chalu remaining, plus the Moto balance.

---

## 7. Attendance, closed days and flags

- A day with **nobody** marked is a **closed day**. No pay, no warning.
- If **some** workers are marked on a day and a worker is not, flag that worker: "Kiran: 2 days unmarked". Only count days inside his employment periods and within his unsettled range.
- Flags are warnings. The owner can still run the payout after confirming.
- Put the unmarked-day check in one small function so it is easy to change. The owner may later restrict it to regular working days (see section 11, point 2).
- The payout day's work counts when the worker is marked present. Full pays full, Half pays half, Absent pays nothing.
- A worker with no attendance in the cycle still appears if he has carry or upad to settle.

---

## 8. Screens to build

| Screen | Must have |
| --- | --- |
| Daily roll-call | Workers listed with Full / Half / Absent buttons, OT minutes, note. Marking is quick (the owner does it daily). Inactive workers hidden. |
| Payout screen | Payout date, cutoff mode toggle (include / exclude payout day), worker selection (all or chosen). One row per worker showing: carry, earned (with OT), adjustments, Chalu taken this cycle (itemised) + older Chalu, Moto balance, input boxes for Chalu recovery, Moto recovery, new upad given (+ bucket), salary paid; computed payable, **cash to hand over**, closing carry, and Chalu / Moto balances after. Flags shown inline. Expand a row to see the day-by-day breakdown. |
| Worker timeline | Day by day: attendance, upad taken that day, cash returned that day, payments that day. |
| Upad ledger | Per worker and bucket, with running balance. Forms to add Given and Returned. |
| Adjustments | Add bonus, reimbursement, deduction with date and note. |
| Saved payouts | List of runs, open a run to see statements, print view, undo button. |
| Workers | Minimal. Add worker with opening balances, rate history, employment periods, mark inactive. |

UI rules:

- Language: Gujarati with English labels. Include a setting: Gujarati only / English only / mixed (mixed is the default). Keep all labels in one translation file.
- Upad labels: "Chalu Upad" and "Moto Upad (Main Upad)".
- Show money in rupees with Indian digit grouping (₹1,00,000). Show paise only when non-zero.
- The owner must see, for every worker, how much cash to hand over and what it is made of: carry, earned, adjustments, each recovery, new upad given. Show the working, not just a total.
- Use large, clear controls. This is used on a busy payday by a non-technical person.

---

## 9. Build order

Do these in order. Finish and test each before the next.

1. Read the codebase, write `GAPS.md`, back up the data, show the owner the gap list.
2. Money utilities (paise, rounding, rupee formatting with Indian grouping) and date helpers (`YYYY-MM-DD`, Asia/Kolkata).
3. Pure calculation module (section 4 and 5) with unit tests for all cases in section 10. Do this before touching the database or UI.
4. Schema migrations for the collections in section 2. Migrate existing data safely: map old "regular" to Chalu and "extra" to Moto, and convert old payout data into statements. **Ask the owner before converting any existing payout history.**
5. Ledger services: upad balances, carry, paid-up-to (derived).
6. Payout: preview endpoint, save (transaction), undo.
7. Screens in this order: roll-call, upad ledger and adjustments, payout screen, worker timeline, saved payouts.
8. Flags and warnings (unmarked days, deduction exceeds due, recovery over balance).
9. Translation file and language setting.
10. Fix the demo seed script: remove the automatic Chalu-to-Moto shift.
11. Backup helper (optional): a button that copies `pb_data` to a chosen folder, since the owner backs up by copying the folder to a pendrive.
12. Run the full acceptance checklist (section 12).

---

## 10. Test cases (must all pass as automated tests)

Amounts in rupees here; the code uses paise.

| # | Setup | Expected |
| --- | --- | --- |
| 1 | Rate ₹500. 7 regular days + 1 Friday day + 60 min OT + ₹1,000 bonus, no carry. | Earned ₹4,062.50. Total before recovery ₹5,062.50. |
| 2 | Rate ₹400 until 11 Oct, ₹450 from 12 Oct. | Days up to 11 Oct at ₹400, from 12 Oct at ₹450. |
| 3 | Due ₹6,000. Moto recovery ₹2,000. | Payable ₹4,000. Moto balance down ₹2,000. |
| 4 | Moto ₹1,000 opening + ₹500 given. Recover ₹500. | Moto ₹1,000. |
| 5 | No attendance. Carry ₹1,000. | Appears in payout. Payable ₹1,000. |
| 6 | Due ₹5,000, salary paid ₹2,000. Due ₹1,400, paid ₹500. | Closing carry ₹3,000 and ₹900. |
| 7 | Chalu ₹900, no recovery. Next week +₹200. Then recover ₹600. | ₹900, then ₹1,100, then ₹500. |
| 8 | Chalu ₹500, Moto ₹5,000, due ₹3,900. Recover ₹300 Chalu and ₹2,000 Moto. | Salary payable ₹1,600. Chalu ₹200. Moto ₹3,000. |
| 9 | Due ₹7,000 paid in full. Moto ₹2,000. Worker returns ₹2,000 cash. | Returned entry. Moto ₹0. Payable stays ₹7,000. |
| 10 | Payout Monday, cutoff includes Monday. Carry + work ₹7,000. New Moto given ₹3,000. | Cash to hand over ₹10,000. Moto +₹3,000. |
| 11 | Saturday payout, exclude payout day. Chalu recovery ₹500. | Cutoff is Friday. Paid-up-to Friday. Next payout starts Saturday. |
| 12 | Wednesday: 15 of 16 marked. Another day: nobody marked. | 1 worker flagged. No warning on the empty day. |
| 13 | Due ₹300, deduction ₹500. | Payable ₹0. Warning with leftover ₹200. |
| 14 | Periods end 9 Oct and restart 20 Oct. | Nothing earned 10 to 19 Oct. |
| 15 | A: owed ₹1,000, upad ₹400. B: owed ₹1,000, upad ₹1,500. | A: recover ₹400, payable ₹600. B: recover ₹1,000, then separate write-off of ₹500 upad. |
| 16 | Chalu balance ₹200, owner enters ₹500 recovery. | Refused. |
| 17 | Chalu ₹200 Sun, ₹600 Mon, ₹200 Wed. | Itemised by day, total ₹1,000. |
| 18 | Attendance added for a day already paid. | Included in the next payout as a late entry. |
| 19 | Undo a run where one worker already has a later payout. | Refused, names that worker. |
| 20 | Recovery greater than carry + earned + adjustments. | Refused. |
| 21 | Half day with 60 min OT at ₹500. | Pay ₹250 + ₹62.50 = ₹312.50. |
| 22 | Absent day with OT minutes entered. | OT ignored, pay ₹0. |
| 23 | Worker not selected in a payout. | His data is unchanged; next payout covers the longer stretch. |
| 24 | Paid-up-to after undo. | Back to the earlier statement's `to_date`. |

---

## 11. Points the owner has not fully settled (build the default, keep it easy to change)

1. **Vijay example.** The owner's old file said Vijay had ₹1,000 opening upad, took ₹500 more, and after recovering ₹500 had ₹500 left. The rules give ₹1,000. Build the rules. Test case 4 uses ₹1,000.
2. **Unmarked flag on partial days.** On days only some workers are asked to come (for example a Friday the factory runs), unmarked workers would be flagged. Build as written. If the owner finds it annoying, either mark them Absent or limit the flag to regular working days.
3. **Undo scope.** Undo only works on a worker's latest payout (section 5).
4. **"Convert" Chalu Upad.** Read as "deduct from salary". Moving Chalu into Moto is not built.

---

## 12. Acceptance checklist

- [ ] All 24 automated tests pass.
- [ ] No fixed weekday logic remains for cycles or payouts.
- [ ] No automatic shifting between Chalu and Moto anywhere (including the seed script).
- [ ] No negative balance, carry or payable is possible through the UI or the API.
- [ ] All money stored as integer paise; display rounding only.
- [ ] A payout can be run for a single worker on any date, with or without the payout day's work.
- [ ] Every payout statement shows each component of the cash calculation.
- [ ] The worker timeline shows what was taken and paid on each day.
- [ ] Saved payouts can be viewed and undone (latest only); nothing is hard-deleted.
- [ ] Existing data survived the migration (compare worker count, balances and totals before and after, and show the owner).
- [ ] The app still starts as a Windows 10 desktop `.exe` and the data folder is still `pb\pb_data`.

---

## 13. How to work with the owner

- Ask short, specific questions. One topic at a time.
- Show results with real numbers from his own examples, not abstract descriptions.
- If you find a rule that is unclear or two rules that conflict, stop and ask. Do not invent a rule.
- After each major step, tell him in two or three sentences what now works and what to try.
