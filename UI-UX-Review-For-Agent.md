# UI / UX Review for the Coding Agent

Reviewed from 6 screenshots of the current app: Cycle Register (2 views), Today's Roll Call, Employees, Employee Profile, Upad. Companion files: `Attendance and Payout Rules Spec` and `Kapil-Agent-Build-Guide.md`.

How to use this: verify each finding in the code first (a few may be explained by the demo data), fix it, and tell the owner in plain words. Items are ordered by importance. The owner is not technical and uses this on a busy payday, so clarity beats density.

---

## A. Wrong or inconsistent numbers (fix first, owners lose trust over these)

1. **Same facts, different totals on different pages.**
   - Employees page "Salary due ₹4,800" vs Cycle Register "Last Baki ₹6,500". The difference is Prakash (inactive, ₹1,700 carry). Money is still owed to him, so every total must include inactive workers, or the card must say clearly "active staff only".
   - Employees page "Upad outstanding ₹5,000 (active staff)" vs Upad page "Total outstanding ₹5,400". Same cause (Prakash ₹400).
   - Rule: one shared calculation for every total. No page may compute its own.
2. **"Active staff 11" and "Daily wage bill ₹5,150" include a worker who has not joined yet.** The ten workers on the roll call add up to ₹4,750 per day; the extra ₹400 looks like the future joiner (Kunal, joining 2 Nov). The roll call shows Active 10. Exclude workers whose joining date is in the future from active counts and the wage bill.
3. **Roll call header "8 / 10 Marked" is wrong.** Nine of ten workers are marked (8 Present plus Kiran Absent). It seems to count only Present. Count Full, Half and Absent as marked. Check the "Unmarked Today" filter for the same bug (it should list only Nilesh).
4. **"Salary due ₹0" on the Employees cards and the profile header means carry only.** Ramesh is owed ₹2,625 right now (₹2,125 earned this cycle + ₹500 bonus). Show **"Owed now" = carry + earned this cycle + adjustments**, and keep carry as a separate small line.
5. **Check:** the Upad page shows "Given this month ₹5,400" and "Total outstanding ₹5,400". It may be a coincidence with the demo data, but confirm the two cards use different calculations.

## B. Gaps against the spec (workflow-breaking)

6. **One global cycle ("Current Cycle 27 Oct – 31 Oct, last payout closed 26 Oct").** The spec has a paid-up-to date per worker. Needed on the payout screen:
   - payout date picker,
   - toggle "count payout day's work" (default on),
   - worker selection (all or ticked),
   - each row shows that worker's own from-to dates.
   Also add a **"Pay this worker now"** action on the Employees card and the profile, for off-schedule payouts (a worker who missed Thursday and collects on Saturday or Monday).
7. **Only one "Recover Upad" box, one upad pill.** The payout row must show Chalu and Main balances separately and have **two recovery boxes**. Chalu is the default and gets the focus. Each "Max" button fills that bucket's own balance. Refuse (red message, Save disabled) if a bucket amount is larger than its balance or the total is larger than the amount due. Never move amounts between buckets.
8. **No visible way to type partial payment or new upad given at the payout.** Add "Salary paid now" (default = full payable) and "New upad given now" (+ bucket, default Main). Show **Cash to hand over = salary paid + new upad** in large type. The leftover salary is shown as "stays with us ₹X".
9. **Inactive worker row is locked** (Prakash: recovery greyed out, but he is owed ₹1,700 and owes ₹400). Add a **final settlement** flow: recover upad out of the salary first, pay the rest, then separate write-off of salary and write-off of upad. Also add a Write-off action on the Upad page cards (none is visible).
10. **No warnings anywhere.** Show inline flags on the payout row, and a confirmation screen before Save All:
    - unmarked days (Nilesh is unmarked today while 9 others are marked),
    - deduction larger than the amount due,
    - recovery over a balance (blocking, not a warning).
11. **Paid days must be locked, and late entries visible.** Show a lock on settled days. Let the owner go back to earlier dates (read-only for paid days) and add a forgotten day, which then appears in the next payout labelled "late entry". Roll call currently has no previous or next day control.
12. **No Gujarati anywhere on screen.** The spec requires Gujarati with English labels, with a setting for Gujarati only, English only or mixed. Put every label in one translation file.

## C. Easier workflow

13. **The Cycle Register is too wide.** Attendance grid, salary, upad, recovery, summary, payable and Save are all in one row, so Total Payable and Save are off-screen and need horizontal scrolling. Split into two steps:
    - Step 1 "Check attendance": the P/H/A grid for the days, unmarked cells highlighted.
    - Step 2 "Pay": a compact table with Worker, Owed now, Chalu, Main, Chalu recovery, Main recovery, Payable, Cash to hand over, Pay. Expand a row to see days and OT. It must fit a 1366-pixel laptop screen without sideways scrolling.
14. **The green button "Paid ₹2,625" looks like something already done.** Name it "Pay ₹2,625" and show "Paid ✓" with an Undo link after saving. Ask for confirmation before "Save All".
15. **Top of the payout screen:** "Cash needed today ₹25,375" in big type, with how many workers are included. Optional: a denomination count (how many ₹500, ₹200, ₹100 notes) so the owner can prepare cash.
16. **The Summary text is cryptic** ("₹2,125 Sal | ₹500 Upad | ₹500 Rem CF", "Last Baki", "Rem CF"). Replace with plain labelled lines on expand: Carry, Earned, OT, Bonus, Fine, Chalu recovered, Main recovered, Payable. Keep shop words like Baki only if the owner prefers (ask him).
17. **Payout reminder.** Thursday 29 Oct passed with no payout (last payout 26 Oct). Show a gentle banner "Last payout was N days ago". This is a reminder, not a rule.
18. **Employee statements** (profile, Salary & Statements tab): add the from-to dates (not only the payout date), cutoff, OT, Chalu and Main recovered separately, new upad given, cash handed over, and a click-through to the day-by-day detail and a print view. Show adjustments with a sign and kind (bonus, fine, reimbursement).
19. **Upad page:** show the running balance in the ledger, ask for the bucket on "Record Cash Return", and show how long an advance has been outstanding (Nilesh's has been open since 3 Oct) so old advances stand out.

## D. Roll call and attendance

20. **Buttons shift sideways between rows** because the OT button changes width ("+ OT", "+1h OT", "+1h 30m OT"). Give the OT slot a fixed width so Present / Half / Absent line up in every row.
21. **"Clear Today" sits next to "Mark All Present" with no confirmation.** Ask first, allow Undo, and block it for settled days.
22. **OT and notes are hidden behind a right-click or a pencil.** Use a visible OT control with minute entry (any number of minutes, such as 45), and make the note field easy to find. Explain the orange dots with a legend on the Cycle Register too.
23. **The "OFF" tag on Friday is a fixed weekday.** The factory sometimes closes Monday instead. Show the tag only when nobody is marked on that day (a closed day), or make the off day a setting. A Friday where people worked must not look like a holiday.
24. **Roll call "+ Upad" icon is a small unlabelled yellow icon.** Add a tooltip or label. It is a good shortcut; keep it.

## E. Visual bugs and polish

25. **The sticky total row covers the last worker (Bharat)** and text shows through it ("+ Upad", "Full salary payable" overlap the totals). Give the footer an opaque background and add bottom space so the last row can scroll fully into view.
26. **Text is very small** in the worker sub-lines and summary strings, and disabled text is very pale. Raise the minimum size and contrast. This is used by a non-technical person on an ordinary monitor.
27. **Two workers share the initials "RP"** (Ramesh Patel, Rekhaben Patel) with similar colours. Add the worker number or distinct colours so rows are not mixed up.
28. **Employees cards show total upad only.** Show Chalu and Main as in the profile and Upad page, so every screen gives the same picture.

## F. What is already good (keep)

- The P / H / A letters plus colour, so meaning does not depend on colour alone.
- Per-row "Max" button idea, the sticky worker column, search by name or number, the "Unmarked Today" filter, and the cycle total row.
- Showing last carry ("Last Baki"), bonus and fine in the summary.
- Employee profile layout: rate, upad split, total paid, and statements in one place.
- Rupee formatting with Indian grouping and paise only when needed.

## G. Acceptance checks for this review

- [ ] One calculation feeds every total; Employees, Cycle Register and Upad page agree to the rupee, including inactive workers.
- [ ] Marked count and Unmarked filter are correct on the roll call.
- [ ] Payout screen shows Chalu and Main separately with two recovery boxes, refusal on over-limit amounts, new upad given, salary paid and cash to hand over.
- [ ] Payout can be run for one worker on any date, with or without the payout day's work.
- [ ] A leaving worker can be settled (offset, pay, separate write-offs) from the screen.
- [ ] Warnings (unmarked, deduction over due) show inline, with a confirmation before Save All.
- [ ] The pay table fits a 1366-pixel screen without sideways scrolling; the last row is fully visible.
- [ ] Settled days are locked; earlier days can be viewed and forgotten days added.
- [ ] Gujarati, English and mixed language setting works on every screen.
