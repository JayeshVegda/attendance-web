import { describe, expect, it } from "vitest";
import {
  computePayout,
  dayEarnings,
  PayoutInputs,
  RateRow,
  upadBalance,
  UpadRow,
  unmarkedDaysFor,
  WorkerRef,
} from "./engine";

const RATE_500: RateRow[] = [{ effective_from: "2026-09-01", daily_rate_paise: 50000 }];
const RATE_UP: RateRow[] = [
  { effective_from: "2026-09-01", daily_rate_paise: 40000 },
  { effective_from: "2026-10-12", daily_rate_paise: 45000 },
];
const FULL_PERIOD = [{ start_date: "2026-08-01", end_date: "" }];

const worker = (over: Partial<WorkerRef> = {}): WorkerRef => ({
  id: "w1",
  opening_carry_paise: 0,
  opening_chalu_paise: 0,
  opening_moto_paise: 0,
  opening_date: "2026-10-01",
  ...over,
});

function att(
  date: string,
  status: "full" | "half" | "absent",
  ot_minutes = 0,
  employee = "w1",
  settled = false
) {
  return { id: `a-${employee}-${date}-${ot_minutes}`, employee, date, status, ot_minutes, settled };
}

function adj(
  date: string,
  kind: "bonus" | "reimbursement" | "deduction",
  amount_paise: number,
  employee = "w1",
  settled = false
) {
  return { id: `j-${employee}-${date}-${kind}-${amount_paise}`, employee, date, kind, amount_paise, settled };
}

function upad(
  date: string,
  bucket: "chalu" | "moto",
  kind: "given" | "returned" | "recovery" | "writeoff",
  amount_paise: number,
  employee = "w1"
): UpadRow {
  return { id: `u-${employee}-${date}-${kind}-${bucket}-${amount_paise}`, employee, date, bucket, kind, amount_paise, voided: false };
}

const noInputs: PayoutInputs = {
  chalu_recovery_paise: 0,
  moto_recovery_paise: 0,
  salary_paid_paise: 0,
  new_upad_bucket: "chalu",
  new_upad_given_paise: 0,
};

function run(
  wk: WorkerRef,
  cutoff: string,
  rates: RateRow[] = RATE_500,
  periods = FULL_PERIOD,
  rows: ReturnType<typeof att>[] = [],
  adjustments: ReturnType<typeof adj>[] = [],
  entries: UpadRow[] = [],
  inputs: Partial<PayoutInputs> = {},
  paidUpTo = ""
) {
  return computePayout(
    wk,
    paidUpTo,
    cutoff,
    rates,
    periods,
    rows,
    adjustments,
    entries,
    { ...noInputs, ...inputs }
  );
}

describe("dayEarnings", () => {
  it("case 21 — half day + 1h OT = 250 + 62.50", () => {
    const e = dayEarnings("half", 60, 50000);
    expect(e.base_paise).toBe(25000);
    expect(e.ot_paise).toBe(6250);
    expect(e.total_paise).toBe(31250);
  });

  it("case 22 — absent ignores OT, pays nothing", () => {
    const e = dayEarnings("absent", 240, 50000);
    expect(e.total_paise).toBe(0);
  });
});

describe("spec worked cases", () => {
  it("case 1 — 8 full days + 1h Friday OT + ₹1000 bonus, carry cleared", () => {
    const r = run(worker(), "2026-10-08", RATE_500, FULL_PERIOD, [
      att("2026-10-01", "full"),
      att("2026-10-02", "full"),
      att("2026-10-03", "full"),
      att("2026-10-05", "full"),
      att("2026-10-06", "full"),
      att("2026-10-07", "full"),
      att("2026-10-08", "full", 60),
      att("2026-10-04", "full"),
    ], [adj("2026-10-05", "bonus", 100000)]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.earned_paise).toBe(406250);
    expect(r.result.ot_paise).toBe(6250);
    expect(r.result.total_due_paise).toBe(506250);
    expect(r.result.closing_carry_paise).toBe(506250);
  });

  it("case 2 — rate change mid-window uses per-day rates", () => {
    const r = run(worker({ opening_date: "2026-10-04" }), "2026-10-15", RATE_UP, FULL_PERIOD, [
      att("2026-10-05", "full"),
      att("2026-10-09", "full"),
      att("2026-10-10", "half"),
      att("2026-10-11", "full"),
      att("2026-10-12", "full"),
      att("2026-10-13", "full"),
      att("2026-10-14", "full", 240),
      att("2026-10-15", "full"),
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const rows = r.result.day_breakdown;
    expect(rows.find((b) => b.date === "2026-10-11")?.rate_paise).toBe(40000);
    expect(rows.find((b) => b.date === "2026-10-12")?.rate_paise).toBe(45000);
    expect(rows.find((b) => b.date === "2026-10-14")?.ot_paise).toBe(22500);
  });

  it("case 3 — due 6000, recover 2000 from Moto, payable 4000", () => {
    const carried = worker({ opening_carry_paise: 600000, opening_moto_paise: 200000 });
    const base = run(carried, "2026-10-08");
    if (!base.ok) throw new Error(JSON.stringify(base.errors));
    expect(base.result.total_due_paise).toBe(600000);
    expect(base.result.moto_balance_paise).toBe(200000);
    const withRecovery = run(carried, "2026-10-08", RATE_500, FULL_PERIOD, [], [], [], {
      moto_recovery_paise: 200000,
    });
    if (!withRecovery.ok) throw new Error(JSON.stringify(withRecovery.errors));
    expect(withRecovery.result.payable_paise).toBe(400000);
    expect(withRecovery.result.moto_after_paise).toBe(0);
  });

  it("case 4 — Moto balance 1500 after new given, recover 500", () => {
    const r = run(worker({ opening_carry_paise: 400000, opening_moto_paise: 100000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [
      upad("2026-10-03", "moto", "given", 50000),
    ], { moto_recovery_paise: 50000 });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.moto_balance_paise).toBe(150000);
    expect(r.result.payable_paise).toBe(350000);
    expect(r.result.moto_after_paise).toBe(100000);
  });

  it("case 5 — carry carried forward for weeks, no attendance", () => {
    const r = run(worker({ opening_carry_paise: 100000, opening_date: "2026-10-20" }), "2026-10-28");
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.earned_paise).toBe(0);
    expect(r.result.closing_carry_paise).toBe(100000);
  });

  it("case 6 — salary paid limits closing carry", () => {
    const a = run(worker({ opening_carry_paise: 300000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [], { salary_paid_paise: 300000 });
    if (!a.ok) throw new Error(JSON.stringify(a.errors));
    expect(a.result.closing_carry_paise).toBe(0);
    const b = run(worker({ opening_carry_paise: 300000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [], { salary_paid_paise: 210000 });
    if (!b.ok) throw new Error(JSON.stringify(b.errors));
    expect(b.result.closing_carry_paise).toBe(90000);
  });

  it("case 7 — Chalu over multiple cycles: 900 + 200, recover 600 → 500", () => {
    const r = run(
      worker({ opening_carry_paise: 500000, opening_chalu_paise: 90000 }),
      "2026-10-08",
      RATE_500,
      FULL_PERIOD,
      [],
      [],
      [],
      {
        chalu_recovery_paise: 60000,
        salary_paid_paise: 500000,
        new_upad_bucket: "chalu",
        new_upad_given_paise: 20000,
      }
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.chalu_balance_paise).toBe(90000);
    expect(r.result.chalu_after_paise).toBe(50000);
    expect(r.result.payable_paise).toBe(0);
    expect(r.result.cash_to_hand_over_paise).toBe(20000);
  });

  it("case 8 — split buckets recovered separately, never shifted", () => {
    const r = run(
      worker({ opening_chalu_paise: 50000, opening_moto_paise: 500000 }),
      "2026-10-08",
      RATE_500,
      FULL_PERIOD,
      [
        att("2026-10-01", "full"),
        att("2026-10-02", "full"),
        att("2026-10-03", "full"),
        att("2026-10-05", "full"),
        att("2026-10-06", "full"),
        att("2026-10-07", "full"),
        att("2026-10-08", "full"),
      ],
      [adj("2026-10-05", "bonus", 40000)],
      [],
      { chalu_recovery_paise: 30000, moto_recovery_paise: 200000 }
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.total_due_paise).toBe(390000);
    expect(r.result.chalu_after_paise).toBe(20000);
    expect(r.result.moto_after_paise).toBe(300000);
    expect(r.result.payable_paise).toBe(160000);
  });

  it("case 9 — balance to zero exactly after recovery; paid outside payout does not change payable", () => {
    const entries = [
      upad("2026-10-03", "moto", "given", 200000),
      upad("2026-10-15", "moto", "returned", 100000),
    ];
    expect(upadBalance(entries, "moto", 0, "2026-10-14")).toBe(200000);
    expect(upadBalance(entries, "moto", 0, "2026-10-20")).toBe(100000);
    const r = run(worker({ opening_carry_paise: 500000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [
      upad("2026-10-03", "moto", "given", 200000),
    ], { moto_recovery_paise: 200000, salary_paid_paise: 300000 });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.moto_after_paise).toBe(0);
    expect(r.result.payable_paise).toBe(0);
  });

  it("case 10 — new Moto upad at payout raises cash to hand over", () => {
    const r = run(worker({ opening_carry_paise: 700000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [], {
      salary_paid_paise: 700000,
      new_upad_bucket: "moto",
      new_upad_given_paise: 300000,
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.payable_paise).toBe(0);
    expect(r.result.cash_to_hand_over_paise).toBe(300000);
    expect(r.result.moto_after_paise).toBe(300000);
  });

  it("case 11 — cutoff excludes the payout day, paid-up-to = Friday", () => {
    const r = run(worker({ opening_date: "2026-10-04" }), "2026-10-10", RATE_500, FULL_PERIOD, [
      att("2026-10-04", "full"),
      att("2026-10-10", "full"),
      att("2026-10-11", "full"),
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.day_breakdown).toHaveLength(2);
    expect(r.result.cutoff).toBe("2026-10-10");
    expect(r.result.earned_paise).toBe(100000);
    expect(computePayout(worker({ opening_date: "2026-10-04" }), "2026-10-10", "2026-10-15", RATE_500, FULL_PERIOD, [], [], [], noInputs).ok).toBe(true);
  });

  it("case 12 — unmarked-day flag: someone marked that day", () => {
    const dates = unmarkedDaysFor(
      worker({ opening_date: "2026-10-04" }),
      "",
      "2026-10-11",
      FULL_PERIOD,
      [],
      [att("2026-10-10", "full", 0, "w2")]
    );
    expect(dates).toEqual(["2026-10-10"]);
  });

  it("case 12b — nobody marked → closed day, no flag", () => {
    const dates = unmarkedDaysFor(
      worker({ opening_date: "2026-10-04" }),
      "",
      "2026-10-11",
      FULL_PERIOD,
      [att("2026-10-04", "full"), att("2026-10-10", "full")],
      []
    );
    expect(dates).toEqual([]);
  });

  it("case 13 — deduction bigger than balance floors to zero, warns leftover, refuses recovery/salary", () => {
    const r = run(worker({ opening_carry_paise: 30000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [
      adj("2026-10-05", "deduction", 50000),
    ], [], { salary_paid_paise: 50000, moto_recovery_paise: 10000 });
    if (r.ok) throw new Error("should refuse salary out of range");
    expect(r.errors.map((e) => e.code)).toContain("salary_paid_out_of_range");
    const r2 = run(worker({ opening_carry_paise: 30000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [
      adj("2026-10-05", "deduction", 50000),
    ]);
    if (!r2.ok) throw new Error(JSON.stringify(r2.errors));
    expect(r2.result.payable_paise).toBe(0);
    expect(r2.result.closing_carry_paise).toBe(0);
    expect(r2.result.warnings.map((w) => w.code)).toContain("deduction_exceeds_due");
  });

  it("case 14 — holiday break period: no earnings for days outside periods", () => {
    const periods = [{ start_date: "2026-09-01", end_date: "2026-10-09" }];
    const r = run(worker({ opening_date: "2026-10-01" }), "2026-10-12", RATE_500, periods, [
      att("2026-10-01", "full"),
      att("2026-10-02", "full"),
      att("2026-10-11", "full"),
      att("2026-10-12", "full"),
    ]);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.earned_paise).toBe(100000);
  });

  it("case 15 — leaving worker: motor recovery capped by due; rest is write-off outside payout", () => {
    const a = run(worker({ opening_carry_paise: 100000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [
      upad("2026-10-03", "moto", "given", 40000),
    ], { moto_recovery_paise: 40000 });
    if (!a.ok) throw new Error(JSON.stringify(a.errors));
    expect(a.result.payable_paise).toBe(60000);
    expect(a.result.moto_after_paise).toBe(0);

    const b = run(worker({ opening_carry_paise: 100000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [
      upad("2026-10-03", "moto", "given", 150000),
    ], { moto_recovery_paise: 150000 });
    if (b.ok) throw new Error("should refuse");
    expect(b.errors.map((e) => e.code)).toContain("recovery_exceeds_due");
    const b2 = run(worker({ opening_carry_paise: 100000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [
      upad("2026-10-03", "moto", "given", 150000),
    ], { moto_recovery_paise: 100000 });
    if (!b2.ok) throw new Error(JSON.stringify(b2.errors));
    expect(b2.result.payable_paise).toBe(0);
    expect(b2.result.moto_after_paise).toBe(50000);
  });

  it("case 16 — refuses Chalu recovery larger than Chalu balance (never shifts to Moto)", () => {
    const r = run(worker({ opening_carry_paise: 300000, opening_chalu_paise: 20000, opening_moto_paise: 500000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [], { chalu_recovery_paise: 50000 });
    if (r.ok) throw new Error("should refuse");
    expect(r.errors).toEqual([
      { code: "chalu_recovery_exceeds_balance", amount: 30000 },
    ]);
  });

  it("case 18 — late entry lands in next payout", () => {
    const r = run(
      worker({ opening_carry_paise: 0, opening_date: "2026-10-01" }),
      "2026-10-12",
      RATE_500,
      FULL_PERIOD,
      [
        att("2026-10-01", "full", 0, "w1", true),
        att("2026-10-02", "full", 0, "w1", true),
        att("2026-10-03", "full"),
        att("2026-10-10", "full"),
      ],
      [],
      [],
      {},
      "2026-10-04"
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.result.earned_paise).toBe(100000);
    expect(r.result.late_entry_count).toBe(1);
    expect(r.result.warnings.map((w) => w.code)).toContain("late_entries");
  });

  it("case 20 — refuses recovery above available balance", () => {
    const r = run(worker({ opening_carry_paise: 100000 }), "2026-10-08", RATE_500, FULL_PERIOD, [], [], [
      upad("2026-10-03", "moto", "given", 200000),
    ], { moto_recovery_paise: 150000 });
    if (r.ok) throw new Error("should refuse");
    expect(r.errors.map((e) => e.code)).toContain("recovery_exceeds_due");
  });

  it("case 15 upad writeoff — writeoff reduces owed upad balance", () => {
    const rows: UpadRow[] = [
      upad("2026-10-02", "chalu", "given", 50000),
      upad("2026-10-05", "chalu", "writeoff", 20000),
    ];
    const bal = upadBalance(rows, "chalu", 0);
    expect(bal).toBe(30000);
  });
});
