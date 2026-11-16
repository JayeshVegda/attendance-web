# Attendance module implementation audit

Audit date: 2026-11-08

## Scope reviewed

Reviewed the React interface, PocketBase migration and live local records, shared payroll calculations, payout and unlock service, demo seeding, and browser behavior against the requested rebuild specification.

## Findings and changes

- Attendance has two tabs: daily Roll Call and Cycle Register. The tabs support arrow-key navigation and expose their selected state and panel relationship.
- Cycle dates are derived from each worker's `paid_up_to` boundary. The register shows the earliest active worker boundary through today; individual pre-boundary days are locked. The day-grid no longer truncates a long manual cycle at 366 days.
- Cycle Register rows include a visible serial number; Upad and Upad Deduct columns use red headers, Give Upad uses blue, and the To Pay field uses a gray focus state. The Workers table is limited to the requested roster fields plus worker actions.
- Payroll uses integer paise and the shared pure module at `/home/arch/project/attendance-web/src/lib/attendance-calc.ts`. Settlement now applies the written difference rule for typed amounts above or below the calculated amount, including a negative calculated amount.
- A browser payout run settled only its one completed worker. The other worker records remained open. Unlock with a required reason voided the payout records, restored the worker's previous boundary and attendance, and wrote an audit record.
- Settings changes persisted without breaking the page layout. The test changed shift hours to 9, confirmed the saved value and page geometry, then restored demo settings.
- Added a skip link, page headings, live status announcements, table captions, and a spoken label for the cycle selector. The visible controls on all five routes were checked in the browser for accessible names.
- The app launcher binds both Vite and PocketBase to `127.0.0.1`; no hosted service is required.
- The single migration drops existing attendance-domain and obsolete application collections before creating the ten final collections, so an existing local schema does not collide with the rebuild.

## Verification

- `pnpm build`: passed.
- `PB_TEST_URL=http://127.0.0.1:8091 pnpm test`: 3 test files passed, 24 tests passed.
- `git diff --check`: passed.
- The implementation scan for removed routes, duplicate calculation files, and retired payroll terms returned no matches in `/home/arch/project/attendance-web/src`, `/home/arch/project/attendance-web/pb/pb_migrations`, `/home/arch/project/attendance-web/scripts`, and `/home/arch/project/attendance-web/index.html`.
- Browser checks confirmed that all five pages render under the shared main landmark and navigation, expose a page heading and skip link, and contain no visible unnamed form controls. The Cycle Register keyboard tab interaction was also exercised.
- PocketBase and the local app both returned HTTP 200.

The static accessibility scanner reports 36 source-level findings. Its file-by-file analysis cannot see shared landmarks provided by the app shell or implicit labels supplied by the reusable `Field` wrapper; runtime checks of the composed pages verified those structures and names. This is a scanner limitation, not a claim of formal WCAG certification.

## Demo state

The disposable demo database was reset after the browser workflows. It contains 13 workers, 13 cycle drafts, 22 attendance records, 5 Upad entries, 1 holiday, and no payout runs, statements, or salary payments.

## Platform limitation

PocketBase REST writes are separate requests rather than one cross-request database transaction. The payout service performs compensating rollback and its integration test exercises a failure after a worker has been processed; a database process failure during the rollback itself cannot be made atomic through the current REST-only setup.
