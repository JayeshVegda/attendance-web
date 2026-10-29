# હાજરી પગાર

Offline attendance and payroll for a small team. Everything runs on one Windows PC: no login, no cloud, and no internet connection is required after setup.

## Start the app

Double-click `start-attendance.cmd`.

The launcher builds the frontend, starts the local PocketBase server on `127.0.0.1:8090`, and opens the app in Microsoft Edge app mode. Closing the app window stops the server.

If Edge is installed somewhere unusual, set `EDGE_PATH` to the full path of `msedge.exe`.

## Daily use

- **Attendance**: Saturday to Friday grid. Click a cell to cycle blank → full → half → absent → blank. Right-click or use the pencil for overtime, notes, and exact status. Friday is a holiday by default, but work on Friday is paid.
- **Payout**: review the cycle, set upad recovery and paid amounts, then close the payout. A closed payout creates salary statements and payments for every included employee.
- **Employees**: add employees, rename placeholders, change rates, and maintain employment periods. Employees are deactivated, never deleted.
- **Upad**: track advances separately from salary. Recovery happens while closing a payout.
- **Reports**: view payout history and print employee statements.
- **Settings**: business name, first cycle start, overtime divisor, and usual payout weekday.

## Payroll rules

- Daily pay is based on the rate effective on that date.
- Half day is half pay.
- Absent and unpaid holiday days are unpaid.
- Overtime is `daily rate × overtime minutes ÷ (60 × overtime divisor)`. The default divisor is 8.
- A payout statement is `opening + earned + adjustments − upad recovery − paid = closing`.
- The latest closing balance becomes the next opening balance.
- Upad recovery is capped at both the upad outstanding and the total due.
- Paid amount is capped at the total due.

## Payout cycle

The first cycle starts on `first_cycle_start` (currently `2026-10-01`). After a payout closes, the next cycle begins on the day after that payout date.

The app keeps salary due and upad separate. A mid-cycle payment should be entered as upad unless it is part of a closed payout.

## Data and backup

All data is stored in:

```
pb/pb_data/
```

To back up, close the app and copy the whole `pb_data` folder to a pen drive or another PC. To restore, replace the folder while the app is stopped.

Do not delete `pb/pb_data`.

PocketBase admin: `http://127.0.0.1:8090/_/`. The local admin credentials are in `.env.local`.

## Demo data

To replace all current data with a rich demo set covering partial payments, carry-forward, rate changes, rejoining, overtime, Friday work, upad recovery, write-off, and a future joiner:

```powershell
pnpm seed:demo
```

This is destructive: it clears employees, attendance, payouts, statements, payments, upad, adjustments, settings, and audit entries before seeding. Run it only while reviewing the demo.

## Development

```powershell
pnpm install
pnpm pb        # PocketBase on http://127.0.0.1:8090
pnpm dev       # Vite on http://127.0.0.1:5173
```

Useful checks:

```powershell
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

The production build is written to `pb/pb_public` and served by PocketBase.

## Current limitations

- Employee names are placeholders until the October attendance workbook is reconciled.
- The October import is not implemented yet because the source OCR has missing columns and unreadable names.
- A payout is saved with sequential PocketBase requests. If a request fails, the app attempts a best-effort rollback.
- Only the latest payout can be undone from the Payout screen.
- There is no automatic cloud backup.
