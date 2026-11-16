# Kapil Products Attendance

Offline attendance, salary, and Upad tracking for one local work PC. The browser app is built with React and Vite; PocketBase stores the local records at `/home/arch/project/attendance-web/pb/pb_data`.

## Run locally

From `/home/arch/project/attendance-web`:

```bash
pnpm install
pnpm start
```

The launcher runs PocketBase on `127.0.0.1:8091` and Vite on `127.0.0.1:5173`. For separate processes, use `pnpm pb` and `pnpm dev` in two terminals. No hosted service or login is used.

## Core workflow

- Mark daily attendance from **Attendance → Today's Roll Call**. Full, half, absent, custom hours, and overtime use the configured shift settings. Holidays are marked manually.
- Use **Attendance → Cycle Register** to review each worker's open date range, edit salary Adj, Upad Deduct, and Give Upad, then enter the actual amount to pay.
- Select **Payout** to close only completed rows. Each worker has their own `paid_up_to` boundary, so unfinished workers keep their open days.
- A closed run can be unlocked with a required reason. The action and state snapshot are recorded in the local audit collection.
- Use **Workers**, **Upad**, **Reports**, and **Settings** for worker records, the single Upad ledger, day-by-day history, and company/pay calculation settings.

## Calculation rules

All stored money is integer paise. `/home/arch/project/attendance-web/src/lib/attendance-calc.ts` is the single pure calculation module. Salary adjustments affect salary only; Upad entries affect the Upad balance only. The shift length and overtime multiplier come from Settings.

## Demo data

The demo seed replaces the local collections with 13 workers, recent attendance, a few Upad entries, and a manual holiday:

```bash
pnpm seed:demo
```

This is destructive and is intended for development. Do not run it if you need to retain the current local data.

## Checks

```bash
pnpm test
pnpm build
```

The default test suite runs without PocketBase. The optional service integration test runs only when `PB_TEST_URL` is set to a disposable local database.
