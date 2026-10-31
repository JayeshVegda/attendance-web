# GAPS.md — Code Today vs. the Spec (Attendance and Payout Rules Spec + Agent Build Guide)

Owner document: `Attendance and Payout Rules Spec.md` (source of truth) + `Kapil-Agent-Build-Guide.md` (how to build).
Read Oct 31, 2026. Stack confirmed in code: React + Vite + Tailwind, embedded PocketBase (`pb\pb_data`), vitest present.

## What already matches the spec (keep / reuse)

| Area | Where | Status |
| --- | --- | --- |
| Money in integer paise everywhere | `lib/money.ts` (`rupeesToPaise`, `paiseToRupees`, `formatMoney` with en-IN grouping, paise shown when non-zero) | Matches |
| Dates as plain `YYYY-MM-DD` (`dateKey`, `addDays`, weekday helpers incl. Gujarati) | `lib/dates.ts` | Matches |
| Rate effective-date lookup (rate per day from history) | `lib/payroll.ts: getRateForDate` | Matches |
| Employment periods exist (start/end dates, auto close on deactivate, reopen on reactivate) | `lib/api.ts: setEmployeeActive`, periods collection | Matches |
| Upad kinds given / returned / recovery / writeoff exist with statement link | types + api | Matches partially (see bucket gaps) |
| Statements keep per-worker figures per run; runs keep totals | `createPayout` | Shape ok, fields to extend |
| Half/Full/Absent semantics, OT only on present day | `dayPayPaise` | Matches (absent pays OT today — bug vs spec: "OT ignored, pay ₹0". Actually spec case 22 says ignore; current code pays OT on absent: `dayPayPaise('absent', 240)` = 20000) |
| Cutoff "include or exclude the day" spirit | today's `payoutDate` end-filter | Partial (see cycles gap) |

## Gap 1 — Fixed global cycles instead of per-worker paid-up-to (biggest change)

- **Spec:** each worker has a paid-up-to date; payout covers the day after it through the cutoff; no fixed weekday; workers can be paid on different days; unselected workers just carry longer spans.
- **Code:** `lib/cycle.ts` derives ONE global `cycleStart` for everyone from the last closed run (`payout_date + 1`) or `first_cycle_start` setting. `computeCycleRows` filters attendance/adjustments by this one global window for all workers.
- **Fix:** per-worker `from_date` = `to_date` of his latest statement (else `opening_date`); window is per worker. Keep a `first_cycle_start` fallback as each worker's initial paid-up-to anchor (`opening_date`).

## Gap 2 — Silent Chalu↔Moto shifting (spec violation, two places)

- `lib/payroll.ts: upadBreakdownForEmployee` (lines 94–101): if `regular < 0` it spills into `extra` and vice versa.
- `lib/api.ts: createPayout` (lines 433–452): recovery is auto-split — regular first, remainder pushed to extra.
- **Spec:** buckets NEVER auto-shift. Over-bucket recovery must be **refused**, never clamped, never moved.
- **Fix:** remove both behaviours entirely. Validate each bucket amount against its own balance; refuse with a message.

## Gap 3 — Buckets named regular/extra; only ONE opening and ONE recovery input

- **Spec:** buckets are **Chalu Upad** (small) and **Main Upad** (owner decision Oct 31: display name for big bucket is "Main Upad" instead of "Moto Upad"; internal key stays `moto`). Owner enters SEPARATE Chalu recovery and Main recovery amounts. Opening balances exist for both buckets.
- **Code:** employee holds a single `opening_upad_paise`; payout input has a single `recoveryPaise` (`PayoutInputRow`); UI has one recovery box.
- **Fix:** migrate `regular`→`chalu`, `extra`→`moto` (data + types + labels); add `opening_chalu_paise` + `opening_moto_paise`; two recovery inputs; UI labels "Chalu Upad" / "Moto Upad (Main Upad)".

## Gap 4 — No "cash to hand over" / new upad given at a payout

- **Spec:** `Cash to hand over = Payable + new upad given at the payout`; new upad saves as a `given` entry dated the payout day (Abdul case 10).
- **Code:** payout saves salary payments + recovery entries only. No new-upad-at-payout input exists.

## Gap 5 — Deduction larger than due: silently lost, no warning; no negative-carry rule either way

- **Code:** `computeCycleRows` floors `totalDuePaise = max(0, beforeRecovery - recovery)` — the leftover disappears with no warning (and note: recoveries can currently be clamped silently too, since `upadRecoveryPaise = min(request, ceiling)` instead of refusing).
- **Spec:** warning `deduction_exceeds_due` with the leftover amount; owner then records the leftover as Moto given or ignores it. Recovery clamping must become refusal.
- **Fix:** compute `available = max(0, carry+earned+adj)`; warn with leftover when negative; refuse over-cap recoveries.

## Gap 6 — Employment periods are NOT used in earnings (spec test 14 breaks today)

- **Code:** `computeCycleRows` ignores `employment_periods` entirely when summing attendance. A worker on break (Rekhaben 10–19 Oct) who has old attendance rows in-window would still be paid for them when the global window overlaps break days.
- **Spec:** days outside any period earn nothing.
- **Fix:** earnings step skips attendance dated outside all of the worker's periods; also skip days before joining / after period end.

## Gap 7 — No settled-payout marker → late entries impossible; per-worker range instead of settled range

- **Code:** attendance/adjustments have no `settled_payout` field. Payouts rely on date windows; a forgotten day added later (spec: late entry lands in the NEXT payout) falls before the window and is silently ignored forever.
- **Fix (per build guide data model):** add `settled_payout` (relation) on `attendance` and `adjustments`; unsettled rows dated ≤ cutoff are included next payout and labelled "late entry". Note: today's global-window approach makes backdated rows fully stuck, so this is correctness-critical.

## Gap 8 — Upad entries missing `voided` + payout link via field mismatch; no running-balance ledger validation

- **Code:** `upad_entries` has `statement` (not `payout`), no `voided` flag; adding a backdated Returned/Given does not re-validate that later balances stay ≥ 0.
- **Fix:** add `payout` (nullable) + `voided` (bool); ledger service derives running balances from entries (already derivable) and refuses backdated entries that would push any later balance negative.

## Gap 9 — Undo semantics wrong: hard-delete + no latest-only check

- **Code:** `deletePayout` hard-deletes run + statements + payments + upad entries. No check that each affected worker's statement is his latest.
- **Spec/Build guide:** undo = void the run's statements and upad entries, clear `settled_payout` on settled rows, keep history forever; undo allowed only when every affected worker's statement is his latest non-voided statement, else refuse and name the worker(s).
- **Fix:** replace delete with void-based undo (statements, upad entries, payments, run all get need `voided` flags; runs get `cutoff_date` too — today only `cycle_start` + `payout_date` exist).

## Gap 10 — Missing collection: `salary_writeoffs`

- **Spec:** leaving-worker flow writes off unpaid salary as its OWN entry type (never merged with upad write-offs, case 15).
- **Code:** collection does not exist; no salary write-off flow anywhere.

## Gap 11 — Adjustments lack `kind` (+/-) and `settled_payout`

- **Spec:** adjustments have kind bonus/reimbursement/deduction, amount always positive, settled marker.
- **Code:** single signed `amount_paise`, no kind, no settled marker. Migrate: negative → kind='deduction', positive → ask owner default kind (bonus) or infer 'reimbursement'? → keep amount signed internally only if simpler; guide wants kind+positive. **Decision for default: map negative→deduction; positive rows keep as-is but need a kind — treat positive legacy rows as 'bonus' and let owner edit.**

## Gap 12 — Closed-day + unmarked-day warnings missing (spec cases 12)

- **Code:** no flagging. Spec: nobody marked on a day → closed (silent); some marked + a worker unmarked in unsettled range inside his periods → flag "Kiran: 2 days unmarked" on payout screen; owner can proceed after confirm.
- Also flag: deduction-exceeds-due leftover; recovery over bucket balance (refusal).
- **Fix:** small pure `unmarkedDaysFor` function + inline flags on payout rows.

## Gap 13 — Paid-up-to inclusion rules for listing workers in a payout

- **Code:** `included` = active OR hasActivity; includes future joiners only by `joined_on > end` check. No per-worker unsettled scan; no "show if carry>0 or any upad balance>0 even with no attendance" for inactive workers (partial exists via hasActivity; needs periods + buckets applied).

## Gap 14 — OT divisor configurable, spec fixes it at 8

- **Code:** `ot_divisor` setting feeds `dayPayPaise`. Spec: a normal day is 8 paid hours; OT = rate ÷ 8 × hours. Keep the setting defaulting to 8 but de-emphasize (harmless; spec default intact).
- **Bug found:** `dayPayPaise('absent', 240, ...)` currently PAYS OT on an absent day (test even asserts it). Spec case 22: OT ignored on absent. Fix + test.

## Gap 15 — Ledger/payout UI mapping (screens per guide section 8)

- `AttendancePage.tsx` (135 KB, monolithic): contains roll-call + cycle view + payout + 4 inline modals. Payout portion: single recovery box, no cutoff toggle, no per-worker selection nuance, no component breakdown, no flags. → Rebuild payout screen per guide; keep roll-call fast-tap UX.
- `PayoutPage.tsx` (33 KB) is orphaned (not imported by App.tsx) → delete after rebuild.
- `UpadPage.tsx` + `UpadModal.tsx`: single-bucket semantics, category labels "regular/extra" → rename Chalu/Moto, add running balance column, Given/Returned forms with bucket choice + backdate validation.
- `ReportsPage.tsx`: statement detail lacks full component breakdown (Chalu itemised, cash to hand over) → extend.
- `EmployeeDetailPage.tsx`: periods + rates exist; add Chalu/Moto split display + write-off actions for leaving.
- `EmployeesPage.tsx`: create flow has ONE opening upad → split into Chalu/Moto openings (+ `opening_date`).
- No language setting: Gujarati strings are hard-coded in places; guide wants one translation file + Gujarati/English/mixed setting.

## Gap 16 — Demo seed script must be fixed (known)

- `scripts/seed-demo.mjs` auto-shifts recovery regular→extra (build guide section 9, step 10). Spec-confirmed violation; also maps to new bucket names. Re-seed AFTER schema migration; **ask owner before converting existing payout history** (per guide).

## Existing data migration notes (do safely, ask owner first)

- Map upad `category`: regular→chalu, extra→moto.
- Split employee `opening_upad_paise` → `opening_chalu_paise`. Where does opening upad go — Chalu or Moto? Existing opening values: Vijay ₹1000, Nilesh ₹500, Bharat ₹1000 (opening demo). **Ask owner**; default: Chalu.
- Add `opening_date` per employee (guide says 2026-09-30 for the original 16; backlog: opening_date = joined_on).
- Add fields: `attendance.settled_payout`, `adjustments.settled_payout`, `adjustments.kind`, `upad_entries.payout`, `upad_entries.voided`, `payout_runs.cutoff_date` + `voided`, statements/runs/payments `voided`; new `salary_writeoffs`.
- Historical statements continue to serve as carry source (paid-up-to derives from them), so old payouts remain valid history even before re-marking settled rows. For rows settled by old runs: mark `settled_payout` by date-window overlap during migration.

## Not-yet-answered owner confirmations (from spec "to confirm") — build default, easy to change

1. Vijay balance ambiguity: rules give ₹1,000 (already seeded that way).
2. Unmarked flag on partial-attendance days (like a running Friday): flag as built.
3. Undo applies only to latest payout per worker.
4. "Convert Chalu" = deduct from salary; no bucket-transfer feature.
5. Opening-upad bucket assignment on migration (see above).
