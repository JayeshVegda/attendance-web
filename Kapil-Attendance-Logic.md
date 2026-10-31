# Kapil's Attendance System — Plain-Language Logic

This file explains, in everyday words, **how the factory's attendance, salary, upad and payout system works**.

It is the plain-words companion to `Attendance and Payout Rules Spec.md` — that spec is the exact rule book. If anything here and there ever sound different, **the spec wins**; tell Kapil and this file gets fixed.

Money talk here uses ₹ examples; inside the app amounts are kept exactly to the paise, and rounding only happens for showing.

---

## 1. The Big Idea

- Workers are paid **per day**, not per month. Every worker has a **daily rate** (e.g. ₹500).
- Every rupee is tracked in a **ledger per worker**. Nothing is ever lost.
- Unpaid salary **carries forward** automatically to the next payout.
- **Upad** (advance) is a running ledger: money given, returned, recovered from salary, or forgiven — all with dates.
- At every payout the owner sees both the **final cash figure** *and* what's inside it (carry + days + OT + bonus − recoveries). No black boxes.
- The owner types every decision amount. The app never moves money on its own.

---

## 2. When Does a Worker Get Paid? (paid-up-to dates)

There are **no fixed weekly cycles**. This is the most important change from the old way:

- Every worker has a **paid-up-to** date — the last day whose work has already been settled.
- A **payout** can be on **any day** the owner chooses: usual Thursday, but any day works.
- A payout settles each worker's work from **the day after his paid-up-to** through the **cutoff**.
- The **cutoff** is the last day counted. Default: include the payout day itself (if the worker came). The owner may exclude it.
  - Example: Abdul asked Monday evening for his salary *including* Monday → counted.
  - Example: Shreyansh asked Saturday for last week's salary → Saturday's own work *not* counted; cutoff Friday.
- Workers not picked keep their cycle open — their next payout simply covers a longer stretch.
- Usual rhythm is Thursday payout → Friday holiday → Saturday starts a fresh stretch. That's just habit, not a rule.

So a worker's "cycle" is whatever days sit between his last settlement and today's cutoff.

---

## 3. Attendance, Days and OT

Each day a worker is marked:

Status | Pay | Notes
---|---|---
**Full** | 100% of daily rate | Present all day
**Half** | 50% of daily rate | Present part of the day
**Absent** | ₹0 | Still recorded as proof
**Unmarked** | ₹0 | Will be **flagged** on the payout screen (see below)

- A normal day = **8 paid hours** (factory hours: 9–6 with 1-hr lunch).
- **OT pay = daily rate ÷ 8 × OT hours**, counted only on days present.
  - ₹500/day + 60 min OT = ₹62.50, kept exact — not rounded away.
- **Friday is usually a holiday**, but if the factory runs on a Friday and a worker comes, it counts as a normal worked day. There is no special holiday setting.
- A day with **nobody marked** = a **closed day**. Nobody earns; no warning shown.
- If **some** workers are marked on a day and one worker isn't:
  - The payout screen flags him — e.g. **"Kiran: 2 days unmarked"**.
  - The owner can still run the payout after seeing the warning. It's a flag, not a block.
- Days before a worker's **joining date**, outside his **employment periods**, or after he left = ignored completely.

---

## 4. Workers, Rates, Joining and Leaving

- A worker holds: name, **joining date**, active/inactive, **daily rate**, and **opening balances** (salary owed from before, Chalu Upad, Moto Upad) entered when he's created. Openings act like normal entries.
- **Rate changes** are by effective date: Suresh = ₹400/day until 11 Oct, ₹450 from 12 Oct. Past days stay at their old rate. Full rate history is kept.
- **Employment periods** handle breaks:
  - Rekhaben's period ends 9 Oct, a new period starts 20 Oct → 10–19 Oct earn nothing, automatically.
  - Leaving = the period's **end date** is set (marking inactive closes it). No separate "leaving date".
- A **future joiner** (e.g. joining 2 Nov) stays in the list but appears in no payout before that date.
- An **inactive worker** disappears from daily roll-call, but his history and balances stay in reports.

---

## 5. Upad — the Two Buckets

**Upad = money given before it's earned.** It always comes out of future salary unless returned or forgiven.

Each worker tracks **two separate buckets**, each never less than zero:

Bucket | What it is
---|---
**Chalu Upad** | Small running advances (₹100–₹500 type). Frequent.
**Moto Upad (Main Upad)** | Big advances of ₹1,000+, running over months.

Every upad entry has a date, bucket, amount and optional note. Four kinds:

Entry | Effect
---|---
**Given** | Balance up. Money handed over — on any day, and also inside a payout.
**Returned** | Balance down. Worker hands back **his own cash** (not from salary). Owner picks the bucket.
**Recovery** | Balance down. Taken out of salary during a payout.
**Write-off** | Balance down. Forgiven on purpose.

### Hard rules

1. **Can't go negative.** Returned / Recovery / Write-off can never exceed the bucket's balance. The app refuses, not adjusts.
2. **No silent shifting.** The owner types the Chalu amount and the Moto amount. The app never moves money between buckets.
3. **Default bucket for recovery = Chalu.** Moto recovery happens only if the worker asks.
4. Chalu itemised: e.g. Ramesh takes ₹200 Sun, ₹600 Mon, ₹200 Wed → shows as three items = ₹1,100 total for the week, plus any older Chalu balance.
5. What isn't recovered **carries forward**: e.g. Chalu ₹1,000, no recovery this week → next +₹200 makes ₹1,100 → recover ₹600 leaves ₹500.

---

## 6. Bonus / Damage / Other Adjustments

Adjustments are dated entries they aren't upad and aren't attendance. They count in whichever payout contains their date.

- **Bonus** (e.g. ₹1,000 Diwali) — adds to amount due.
- **Reimbursement** (e.g. ₹300 travel) — adds.
- **Deduction** (e.g. ₹500 tool damage) — subtracts.

If a deduction is bigger than what's due (say due ₹300, damage ₹500):
- Payable floors at **₹0** and a warning shows the **leftover (₹200)**.
- The owner decides what to do with the leftover — record it as a **Moto Upad given** entry or ignore it.
- There is **no negative carry** and the app changes nothing on its own.

---

## 7. What a Payout Does (the money recipe)

For each included worker:

**Payable** = Carry + Earned (days + OT) + Adjustments − Chalu recovery − Moto recovery

**Cash to hand over** = Payable + any new upad Given at the payout

Rules inside that recipe:

- The **total recovery** cannot exceed Carry + Earned + Adjustments → Payable never below ₹0. Recovery **can** come out of the carry, not just this cycle's earnings.
- Salary paid can never exceed Payable. To give more, the owner records a **new upad Given** entry — e.g. Abdul gets ₹7,000 salary plus a fresh ₹3,000 Moto Upad → hand over ₹10,000 in one visit.
- **Closing carry = Payable − salary paid.** Leftover paise stay in carry.
- A worker with **zero attendance** but carry or upad to settle still appears in the payout (e.g. Nilesh, carry ₹1,000 → Payable ₹1,000).
- Every statement shows the full working: carry, earned (with OT), adjustments, Chalu taken itemised, Moto balance, each recovery, new upad given, cash to hand over, cash paid, closing carry, and both upad balances after the payout.
- One payout = one **run** with all workers' statements, saveable, viewable, printable, undoable.

---

## 8. Leaving a Worker — Final Settlement Order

1. **Offset:** do the normal recovery first — upad taken out of the unpaid salary. (Owed ₹1,000, upad ₹400 → recover ₹400, Payable ₹600.)
2. **Pay** the remaining salary, or leave it as carry.
3. If the owner forgives the unpaid salary, record it as **one salary write-off entry**.
4. Any upad still left after the offset → **separate write-off per bucket**. (He owes ₹1,500 upad, I owed him ₹1,000 → recover ₹1,000, then write off ₹500.)

Salary write-off and upad write-off are **never combined into one entry** — the paperwork stays readable years later.

---

## 9. Fixing Mistakes

- **Attendance forgotten on a paid day?** Add it later. It's **not lost** — it shows in that worker's *next* payout marked as a **late entry** with its original date.
- **Upad Given / Returned** can be added with an earlier date; the ledger re-applies in date order and refuses if any balance would dip below zero.
- **Undo a payout:** restores statements, upad entries and the settled days exactly. Undo works only on a worker's *latest* payout — if he already has a newer one, the app refuses and says which worker blocks it. Nothing is ever hard-deleted.
- Every correction leaves a visible trail.

---

## 10. Quick Worked Examples (from the real test cases)

1. **Ramesh** — ₹500/day. 7 regular days + 1 Friday day + 60 min OT + ₹1,000 bonus. Earned = 3,500 + 500 + 62.50 = **₹4,062.50**; due **₹5,062.50**.
2. **Suresh** — ₹400 till 11 Oct, ₹450 from 12 Oct. Days are paid at whichever rate was in force.
3. **Moto recovery** — Due ₹6,000, he asks ₹2,000 kept against Moto → Payable ₹4,000, Moto −₹2,000.
4. **Partial pay** — Due ₹5,000, paid ₹2,000 → closing carry ₹3,000.
5. **Chalu carried** — ₹900 unpaid, +₹200 next week = ₹1,100, recover ₹600 → ₹500 left.
6. **Both buckets** — Chalu ₹500, Moto ₹5,000, due ₹3,900; recover ₹300 Chalu + ₹2,000 Moto → cash ₹1,600; buckets after: ₹200 and ₹3,000.
7. **Reshma returns cash** — Due ₹7,000 paid in full; Moto ₹2,000; she hands back ₹2,000 of her own cash → Returned entry, Moto ₹0, salary unchanged.
8. **Abdul, off-cycle** — Monday payout includes Monday's work; ₹3,000 new Moto given → hand over ₹10,000.
9. **Deduction too big** — Due ₹300, damage ₹500 → Payable ₹0, warning shows ₹200 leftover for the owner to decide.
10. **Leave settlement** — Owed ₹1,000, upad ₹1,500 → recover ₹1,000, then write off ₹500 upad as its own entry.

---

## 11. Words the App Uses

Word | Plain meaning
---|---
**Paid-up-to** | Last date already settled for that worker
**Cycle** | That worker's stretch from the day after paid-up-to to the cutoff
**Cutoff** | Last day of work counted in a payout
**Earned** | Days-at-rate + OT in this cycle
**Carry** | Salary still owed from earlier
**Adjustment** | Bonus / reimbursement / deduction (not upad)
**Chalu Upad** | Small running advance bucket
**Moto Upad** | Big long-running advance bucket (Main Upad)
**Given / Returned / Recovery / Write-off** | Upad ledger actions (up / down / from-salary / forgiven)
**Payable** | What the worker is finally owed
**Cash to hand over** | Payable + any new upad given at the payout
**Statement** | One worker's full breakdown for one payout
**Run** | One payout session covering all chosen workers

---

## 12. Backup and Where It Lives

The whole book (workers, attendance, upad ledger, payouts) is one folder:

**`C:\Site_imp\attendance-web\pb\pb_data`**

To back up: close the app, copy that folder to a pendrive. Done.

---

*Last updated: 31 Oct 2026 — aligned with `Attendance and Payout Rules Spec.md`.*
