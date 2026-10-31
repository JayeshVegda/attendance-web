# Attendance and Payout Rules Spec

Oct 31, 2026 · @zay

## Purpose and principles

This spec defines how the factory's attendance, salary, upad and payout system must work. Workers are paid per day, every rupee is tracked in a per-worker ledger, and nothing is ever lost.

- Pay is per day, not per month. Each worker has a daily rate.
- A payout can be on any day the owner chooses, usually Thursday, for all workers or selected ones.
- Unpaid salary carries forward automatically into the next cycle.
- Upad (advance) is a long ledger that goes up and down: money given, money returned, money recovered from salary.
- The owner always sees how much cash to hand over and exactly what is inside that amount.
- The owner decides every recovery amount. The app never moves money between upad buckets silently.
- Money is stored in paise and rounded only for display.

## Terms

| Term | Meaning |
| --- | --- |
| Paid-up-to date | The last date whose work has been settled for a worker. Tracked per worker. |
| Cycle | For one worker, the days from the day after his paid-up-to date through the payout cutoff. No fixed weekday; it can be 10 to 12 days or more. |
| Payout | One settlement on a chosen date, for all workers or selected ones. |
| Cutoff | The last day of work counted in a payout. Default is the payout date itself; the owner can exclude it. |
| Earned | Pay for days worked plus OT in the cycle. |
| Carry | Salary still owed to the worker from earlier payouts. |
| Adjustment | A bonus, reimbursement or deduction that is not upad. |
| Chalu Upad | Small running advances, for example ₹100 to ₹500 on a day. Usually recovered from that week's pay, but not always. |
| Moto Upad | Big advances of ₹1,000 or more, running over months. English label: Main Upad. |
| Given | Upad handed to the worker. Balance goes up. |
| Returned | The worker hands back his own cash, not from salary. Balance goes down. |
| Recovery | Upad taken out of salary at a payout. Balance goes down. |
| Write-off | Upad forgiven on purpose. Balance goes down. |
| Payable | Salary the worker is owed after recovery. |
| Cash to hand over | Payable plus any new upad given at the payout. |

## Workers, rates and employment periods

- A worker record holds name, joining date, active flag and daily rate. Opening balances (salary owed, Chalu Upad, Moto Upad) are entered when the worker is created, and behave exactly like normal entries. The app started on 1 Oct 2026.
- Daily rate changes apply from a chosen effective date. Old days keep the old rate. Every rate change is kept in a history.
- Example: Suresh is ₹400 per day until 11 Oct and ₹450 from 12 Oct. Days before 12 Oct pay ₹400, days from 12 Oct pay ₹450.
- Employment periods: each worker has one or more periods with a start date and an end date. Days outside any period earn nothing.
- A break ends the current period; rejoining starts a new one. Example: Rekhaben has a period ending 9 Oct and a new period starting 20 Oct, so 10 to 19 Oct earn nothing.
- The last working day is the end date of the last period. Marking a worker inactive closes the period; no separate leaving date is needed.
- A future joiner (for example joining 2 Nov) does not appear in any payout before that date.
- Inactive workers disappear from the daily roll-call, but their history and balances stay in reports.

## Attendance and earnings

Each day a worker is marked Full, Half or Absent, with an optional note.

| Status | Pay |
| --- | --- |
| Full | 100% of the daily rate |
| Half | 50% of the daily rate |
| Absent | Nothing. The day is still recorded as proof. |
| Unmarked | Nothing, and flagged (see closed days below) |

- A normal day is 8 paid hours (factory 8 to 6 with a 1-hour break).
- OT pay = daily rate ÷ 8 × OT hours. It counts only on a day the worker is present, Full or Half. Example: ₹500 per day, 60 minutes of OT = ₹62.50, kept exact.
- Friday is usually a holiday. If the factory runs on a holiday and a worker is present, it counts as a normal day in his cycle. There is no holiday setting.
- Closed day: if nobody is marked on a day, the app treats it as closed. Nobody earns anything and no warning is shown.
- If some workers are marked on a day and others are not, the unmarked workers are flagged on the payout screen with a message such as "Kiran: 2 days unmarked". The owner can still run the payout after confirming.
- The payout day's own work counts when the worker is marked present: Full pays in full, Half pays half, Absent pays nothing.
- Days before the worker's joining date, outside his employment periods or after he left are ignored.

## Cycles and payouts

There are no fixed weekly cycles. Each worker has a paid-up-to date, and a payout can be on any day for everyone or for selected workers.

- Usual pattern: payout on Thursday, Friday holiday, Saturday starts the next cycle. This is only a default suggestion. For a few months Monday was the holiday and payout was on Sunday.
- A payout covers each selected worker's work from the day after his paid-up-to date through the cutoff. After saving, his paid-up-to date becomes the cutoff and the next cycle starts the day after.
- Cutoff is chosen per payout. Default: include the payout date's work if the worker is present. Excluding it is allowed: Shreyansh asked for last week's salary on Saturday after work, so Saturday was not counted. Abdul asked on Monday evening for his salary including Monday, so Monday was counted.
- Workers not selected keep their cycle open. Their next payout simply covers a longer stretch.
- Workers can be paid on different days. Someone who misses Thursday can be paid on Saturday or Monday without disturbing anyone else.
- Unpaid salary is never lost. It carries into the next cycle as the worker's opening carry.
- Every payout is saved with its date, cutoff, the workers included, and one statement per worker. Totals (due, paid, upad recovered) are kept for the whole run.

## Upad ledger

Each worker has two upad balances, Chalu Upad and Moto Upad. Each is always zero or more. Every entry has a date, a bucket, an amount and an optional note, and the ledger shows the running balance after each entry.

| Entry | Effect | Notes |
| --- | --- | --- |
| Given | Balance up | Money handed to the worker, on any day. Can also happen inside a payout. |
| Returned | Balance down | The worker gives his own cash, on any day, not from salary. The owner picks the bucket. |
| Recovery | Balance down | Taken out of salary at a payout. |
| Write-off | Balance down | Forgiven on purpose. |

- Chalu Upad is small and frequent. Example: Ramesh takes ₹200 on Sunday, ₹600 on Monday and ₹200 on Wednesday, so his Chalu Upad for the week is ₹1,000. The payout screen shows this week's amount itemised by day, plus any older Chalu Upad still remaining.
- The owner may recover all, part or none of the Chalu Upad at a payout. What is not recovered carries forward. Example: ₹900 taken, nothing recovered, carried. Next week ₹200 more makes ₹1,100. Recovering ₹600 leaves ₹500.
- Moto Upad is big and long-running, with a full dated history. Example: Reshma took ₹6,000 on 6 Jan, repaid part from salary over a few months, and took more in between. The ledger always shows the true remaining balance.
- Returned, Recovery and Write-off can never be more than the bucket's current balance. The app refuses such an entry instead of making the balance negative.
- Recovery goes against Chalu Upad by default. It goes against Moto Upad only when the worker asks. The owner types the amount for each bucket. The app never shifts an amount from one bucket to the other by itself.

## Payout calculation

The cash to hand over is built from these pieces for each worker:

```latex
\text{Payable} = \text{Carry} + \text{Earned} + \text{Adjustments} - \text{Chalu recovery} - \text{Moto recovery}
```

```latex
\text{Cash to hand over} = \text{Payable} + \text{New upad given at payout}
```

- Earned = days worked at the rate in force on each day, plus OT.
- The owner enters Chalu recovery and Moto recovery. Chalu recovery cannot exceed the Chalu balance. Moto recovery cannot exceed the Moto balance.
- Total recovery cannot exceed Carry + Earned + Adjustments, so Payable never goes below ₹0. Recovery can come out of carry, not only out of this cycle's earnings.
- New upad given at a payout (for example an advance for a holiday) is saved as a Given entry dated that day and is added to the cash handed over.
- The owner enters the cash actually paid. Salary paid cannot exceed Payable.
- Closing carry = Payable − salary paid. It becomes the opening carry of the next cycle. Leftover paise stay in carry.
- To give more than Payable, record the extra as a new upad Given entry. Paying more than the amount due is not allowed, and the balance never goes negative.
- A worker with no attendance in the cycle still appears in the payout if he has carry or upad to settle.
- The payout screen must show every component: carry, earned, OT, adjustments, each recovery, new upad given, cash to hand over, cash paid, closing carry, and the Chalu and Moto balances after the payout.

## Bonus, reimbursement and deduction

Adjustments are dated entries with a note. They are not upad and not attendance, and they count in the cycle that contains their date.

- Bonus: for example a ₹1,000 Diwali bonus. Adds to the amount due.
- Reimbursement: for example ₹300 of travel cost paid back. Adds to the amount due.
- Deduction: for example ₹500 for tool damage. Subtracts from the amount due.
- If a deduction is larger than what is due, Payable floors at ₹0 and the payout screen shows a warning with the leftover amount (for example ₹200). The owner then records the leftover as Moto Upad given, or ignores it. There is no negative carry, and the app does not change anything silently.

## Leaving workers and write-offs

When a worker leaves, the owner settles his balances at a final payout in this order:

1. Offset: recover upad out of the unpaid salary as a normal recovery. Example: owed ₹1,000, upad ₹400, recover ₹400, Payable becomes ₹600.
2. Pay the remaining salary, or leave it as carry.
3. If the owner chooses to close out unpaid salary, record it as one write-off entry for salary.
4. If upad remains after the offset, record it as a separate write-off entry for each bucket. Example: he owes ₹1,500 and is owed ₹1,000, recover ₹1,000, then write off ₹500.

Salary write-off and upad write-off are never combined into one entry, so the records stay auditable. The worker's history stays in reports after he leaves.

## Corrections

- Late entries: if attendance is forgotten for a day that is already paid, the owner can add it later. It is not lost: it appears in that worker's next payout as a late entry, labelled with its original date.
- Upad Given and Returned entries can be added with an earlier date, and the ledger recalculates running balances in date order.
- A saved payout can be undone or corrected if a wrong amount was entered. Undoing it restores the worker's paid-up-to date, carry and both upad balances exactly as they were before.
- Every correction keeps a visible record, so past figures can always be explained.

## Screens

| Screen | Must show |
| --- | --- |
| Daily roll-call | Workers with Full, Half, Absent, OT minutes and a note. Closed-day logic applies. |
| Payout screen | Payout date, cutoff (include or exclude the payout day), all workers or a selection. One row per worker with every component of the cash calculation, input boxes for Chalu recovery, Moto recovery, new upad given and cash paid, and the balances after the payout. |
| Payout flags | Unmarked days, a deduction larger than the amount due, and a recovery larger than a bucket balance. |
| Worker timeline | Day by day: attendance, upad taken that day, cash returned that day, and what was paid that day. |
| Upad ledger | Per bucket, every entry with date, kind, amount, note and running balance. |
| Saved payouts | Every payout run with its statements, viewable and printable, with an undo option. |

- Labels are in Gujarati with English labels, with a language setting for Gujarati only, English only, or mixed.
- The two upad buckets are labelled "Chalu Upad" and "Moto Upad (Main Upad)".

## Test cases

These come from the owner's real examples. The app must produce exactly these results.

| # | Case | Setup | Expected result |
| --- | --- | --- | --- |
| 1 | Ramesh, earnings and bonus | Rate ₹500. 7 regular days, 1 Friday day, 60 min OT, ₹1,000 Diwali bonus, no carry. | Earned ₹4,062.50 (3,500 + 500 + 62.50). Due before recovery ₹5,062.50. |
| 2 | Suresh, rate change | ₹400 per day until 11 Oct, ₹450 from 12 Oct. | Days up to 11 Oct pay ₹400. Days from 12 Oct pay ₹450. |
| 3 | Suresh, Moto recovery | Due ₹6,000. He asks to keep ₹2,000 against Moto Upad. | Payable ₹4,000. Moto balance down by ₹2,000. |
| 4 | Vijay, recovery | Moto Upad ₹1,000 opening plus ₹500 given = ₹1,500. Recover ₹500. | Moto balance ₹1,000. |
| 5 | Nilesh, no attendance | No days worked. Carry ₹1,000. | Appears in the payout. Payable ₹1,000. |
| 6 | Shyam and Kiran, partial pay | Shyam due ₹5,000, paid ₹2,000. Kiran due ₹1,400, paid ₹500. | Closing carry ₹3,000 for Shyam and ₹900 for Kiran. |
| 7 | Chalu carried | ₹900 taken, nothing recovered. Next week ₹200 more. Then recover ₹600. | Balance ₹900, then ₹1,100, then ₹500. |
| 8 | Chalu and Moto together | Chalu ₹500, Moto ₹5,000. Due ₹3,900. Recover ₹300 Chalu and ₹2,000 Moto. | Cash ₹1,600. Chalu ₹200. Moto ₹3,000. |
| 9 | Reshma, cash returned | Salary due ₹7,000, paid in full. Moto balance ₹2,000. She hands back ₹2,000 of her own cash. | Returned entry. Moto balance ₹0. Salary payable unchanged at ₹7,000. |
| 10 | Abdul, off-cycle with new upad | Monday payout, cutoff includes Monday. Carry plus work ₹7,000. New Moto Upad given ₹3,000. | Cash to hand over ₹10,000. Moto balance up by ₹3,000. |
| 11 | Shreyansh, cutoff excludes the day | Saturday payout, Saturday work not counted. Recovers ₹500 Chalu plus a Moto amount he names. | Cutoff is Friday. Paid-up-to date is Friday. Next payout starts from Saturday. |
| 12 | Unmarked warning | Normal working Wednesday: 15 of 16 workers marked. Another day: nobody marked. | One worker flagged on the Wednesday. No warning on the day nobody is marked. |
| 13 | Deduction larger than due | Due ₹300. Tool damage deduction ₹500. | Payable ₹0. Warning shows leftover ₹200. |
| 14 | Break and rejoin | Rekhaben: period ending 9 Oct, new period from 20 Oct. | Nothing earned for 10 to 19 Oct. |
| 15 | Leaving worker | Case A: owed ₹1,000, upad ₹400. Case B: owed ₹1,000, upad ₹1,500. | A: recover ₹400, payable ₹600. B: recover ₹1,000, then write off ₹500 upad as its own entry. |
| 16 | Recovery too large | Chalu balance ₹200. Owner enters ₹500 Chalu recovery. | Entry refused. |
| 17 | Chalu itemised | Ramesh takes ₹200 Sunday, ₹600 Monday, ₹200 Wednesday. | Payout screen shows each day and a ₹1,000 total for the week. |

## Technical notes and points to confirm

- Stack: React frontend with embedded PocketBase (SQLite inside the data folder), one codebase called attendance-web, packaged as a Windows 10 desktop .exe.
- Data folder: C:\\Site\_imp\\attendance-web\\pb\\pb\_data. Backup is done by closing the app and copying this whole folder to a pendrive.
- Money is stored in paise. Display rounding only.
- Language: Gujarati with English labels, with a setting for Gujarati, English or mixed.
- The demo seeding script shifts recovery from Chalu to Moto automatically. That is seed-only behaviour and must not appear in the app.
- To confirm: the original logic file said Vijay had ₹1,000 opening upad, asked for ₹500 more, and after recovering ₹500 had ₹500 left. By the rules above the balance would be ₹1,000. Test case 4 uses ₹1,000.
- To confirm: on a day when only some workers are asked to come (for example a Friday when the factory runs), unmarked workers would be flagged under the closed-day rule. Either mark them Absent, or restrict the flag to regular working days.
- To confirm: undo of a saved payout is assumed to apply to that worker's latest payout only.
- To confirm: "convert" for Chalu Upad is read as deducting it from salary. Moving Chalu Upad into Moto Upad is not part of this spec.
