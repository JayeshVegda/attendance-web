import { addDays, dateKey, parseDate } from "./dates";

export type Paise = number;
export type Bucket = "chalu" | "moto";
export type DayStatus = "full" | "half" | "absent" | "";
export type AdjustmentKind = "bonus" | "reimbursement" | "deduction";
export type UpadKind = "given" | "returned" | "recovery" | "writeoff";
export type EngineError =
  | { code: "chalu_recovery_exceeds_balance"; amount: Paise }
  | { code: "moto_recovery_exceeds_balance"; amount: Paise }
  | { code: "recovery_exceeds_due"; amount: Paise }
  | { code: "salary_paid_out_of_range"; amount: Paise };

export type EngineWarning =
  | { code: "deduction_exceeds_due"; leftover_paise: Paise }
  | { code: "late_entries"; count: number }
  | { code: "unmarked_days"; dates: string[] };

export type RateRow = { effective_from: string; daily_rate_paise: Paise };
export type PeriodRow = { start_date: string; end_date: string | "" };
export type AttendanceRow = {
  id: string;
  employee: string;
  date: string;
  status: DayStatus;
  ot_minutes: number;
  settled: boolean;
};
export type AdjustmentRow = {
  id: string;
  employee: string;
  date: string;
  kind: AdjustmentKind;
  amount_paise: Paise;
  settled: boolean;
};
export type UpadRow = {
  id: string;
  employee: string;
  date: string;
  bucket: Bucket;
  kind: UpadKind;
  amount_paise: Paise;
  voided?: boolean;
};

export type WorkerRef = {
  id: string;
  opening_carry_paise: Paise;
  opening_chalu_paise: Paise;
  opening_moto_paise: Paise;
  opening_date: string;
};

export type PayoutInputs = {
  chalu_recovery_paise: Paise;
  moto_recovery_paise: Paise;
  salary_paid_paise: Paise;
  new_upad_bucket: Bucket;
  new_upad_given_paise: Paise;
};

export type DayBreakdownRow = {
  date: string;
  status: DayStatus;
  ot_minutes: number;
  rate_paise: Paise;
  base_paise: Paise;
  ot_paise: Paise;
  total_paise: Paise;
  is_late_entry: boolean;
};

export type PayoutComputation = {
  worker_id: string;
  from_date: string;
  cutoff: string;
  carry_paise: Paise;
  earned_paise: Paise;
  ot_paise: Paise;
  adjustments_paise: Paise;
  total_due_paise: Paise;
  chalu_balance_paise: Paise;
  moto_balance_paise: Paise;
  chalu_recovery_paise: Paise;
  moto_recovery_paise: Paise;
  salary_paid_paise: Paise;
  payable_paise: Paise;
  new_upad_bucket: Bucket;
  new_upad_given_paise: Paise;
  cash_to_hand_over_paise: Paise;
  closing_carry_paise: Paise;
  chalu_after_paise: Paise;
  moto_after_paise: Paise;
  day_breakdown: DayBreakdownRow[];
  late_entry_count: number;
  warnings: EngineWarning[];
};

export function roundHalfUp(x: number): Paise {
  return Math.floor(x + 0.5);
}

export function dayEarnings(
  status: DayStatus,
  ot_minutes: number,
  rate_paise: Paise
): { base_paise: Paise; ot_paise: Paise; total_paise: Paise } {
  if (status !== "full" && status !== "half") {
    return { base_paise: 0, ot_paise: 0, total_paise: 0 };
  }
  const base =
    status === "full" ? rate_paise : roundHalfUp(rate_paise / 2);
  const ot =
    ot_minutes > 0 ? roundHalfUp((rate_paise * ot_minutes) / 480) : 0;
  return { base_paise: base, ot_paise: ot, total_paise: base + ot };
}

export function rateOn(rates: RateRow[], date: string): Paise | undefined {
  let best: RateRow | undefined;
  for (const r of rates) {
    if (r.effective_from <= date && (!best || r.effective_from > best.effective_from)) {
      best = r;
    }
  }
  return best ? best.daily_rate_paise : undefined;
}

export function inAnyPeriod(periods: PeriodRow[], date: string): boolean {
  if (periods.length === 0) return true;
  return periods.some(
    (p) =>
      date >= p.start_date && (!p.end_date || date <= p.end_date)
  );
}

export function upadBalance(
  rows: UpadRow[],
  bucket: Bucket,
  opening_paise: Paise,
  as_of?: string
): Paise {
  let sum = opening_paise;
  for (const row of rows) {
    if (row.voided || row.bucket !== bucket) continue;
    if (as_of && row.date > as_of) continue;
    if (row.kind === "given") sum += row.amount_paise;
    else if (row.kind === "returned" || row.kind === "recovery" || row.kind === "writeoff") sum -= row.amount_paise;
  }
  return sum;
}

export function chaluLedger(
  rows: UpadRow[],
  opening_paise: Paise,
  as_of?: string
): { date: string; bucket: Bucket; kind: UpadKind; amount_paise: Paise; balance_paise: Paise }[] {
  const sorted = rows
    .filter((r) => !r.voided && r.bucket === "chalu" && (!as_of || r.date <= as_of))
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
  let balance = opening_paise;
  const out: { date: string; bucket: Bucket; kind: UpadKind; amount_paise: Paise; balance_paise: Paise }[] = [
    { date: "", bucket: "chalu", kind: "given", amount_paise: opening_paise, balance_paise: opening_paise }
  ];
  for (const r of sorted) {
    if (r.kind === "given") balance += r.amount_paise;
    else balance -= r.amount_paise;
    out.push({ date: r.date, bucket: r.bucket, kind: r.kind, amount_paise: r.amount_paise, balance_paise: balance });
  }
  return out;
}

export function workerFromDate(
  worker: WorkerRef,
  paid_up_to: string | ""
): string {
  return paid_up_to ? addDays(paid_up_to, 1) : worker.opening_date;
}

function adjustmentSigned(row: AdjustmentRow): Paise {
  if (row.kind === "deduction") return -Math.abs(row.amount_paise);
  return row.amount_paise;
}

export function unmarkedDaysFor(
  worker: WorkerRef,
  paid_up_to: string | "",
  cutoff: string,
  periods: PeriodRow[],
  own_attendance: AttendanceRow[],
  all_attendance: AttendanceRow[]
): string[] {
  const from = workerFromDate(worker, paid_up_to);
  const ownByDate = new Map(own_attendance.map((r) => [r.date, r]));
  const othersByDate = new Map<string, number>();
  for (const r of all_attendance) {
    if (!r.status) continue;
    othersByDate.set(r.date, (othersByDate.get(r.date) ?? 0) + 1);
  }
  const dates: string[] = [];
  let d = from;
  while (d <= cutoff) {
    if (
      inAnyPeriod(periods, d) &&
      !ownByDate.has(d) &&
      (othersByDate.get(d) ?? 0) > 0
    ) {
      dates.push(d);
    }
    d = addDays(d, 1);
  }
  return dates;
}

export function computePayout(
  worker: WorkerRef,
  paid_up_to: string | "",
  cutoff: string,
  rates: RateRow[],
  periods: PeriodRow[],
  attendance: AttendanceRow[],
  adjustments: AdjustmentRow[],
  upad_entries: UpadRow[],
  inputs: PayoutInputs
): { ok: false; errors: EngineError[] } | { ok: true; result: PayoutComputation } {
  const from = workerFromDate(worker, paid_up_to);
  const rows = attendance.filter(
    (r) =>
      r.employee === worker.id &&
      !r.settled &&
      r.date <= cutoff &&
      r.date >= from
  );
  const lateRows = attendance.filter(
    (r) => r.employee === worker.id && !r.settled && r.date < from && r.date <= cutoff
  );

  const breakdown: DayBreakdownRow[] = [];
  let earned = 0;
  let ot = 0;
  const byDate = new Map(rows.map((r) => [r.date, r]));
  let d = from;
  while (d <= cutoff) {
    if (!inAnyPeriod(periods, d)) {
      d = addDays(d, 1);
      continue;
    }
    const row = byDate.get(d);
    if (!row || !row.status) {
      d = addDays(d, 1);
      continue;
    }
    const rate = rateOn(rates, d) ?? 0;
    const e = dayEarnings(row.status, row.ot_minutes, rate);
    ot += e.ot_paise;
    earned += e.total_paise;
    if (e.base_paise || e.ot_paise) {
      breakdown.push({
        date: d,
        status: row.status,
        ot_minutes: row.ot_minutes,
        rate_paise: rate,
        base_paise: e.base_paise,
        ot_paise: e.ot_paise,
        total_paise: e.base_paise + e.ot_paise,
        is_late_entry: false,
      });
    }
    d = addDays(d, 1);
  }
  for (const r of lateRows) {
    if (!r.status || !inAnyPeriod(periods, r.date)) continue;
    const rate = rateOn(rates, r.date) ?? 0;
    const e = dayEarnings(r.status, r.ot_minutes, rate);
    ot += e.ot_paise;
    earned += e.total_paise;
    breakdown.push({
      date: r.date,
      status: r.status,
      ot_minutes: r.ot_minutes,
      rate_paise: rate,
      base_paise: e.base_paise,
      ot_paise: e.ot_paise,
      total_paise: e.base_paise + e.ot_paise,
      is_late_entry: true,
    });
  }
  breakdown.sort((a, b) => a.date.localeCompare(b.date));

  const adjs = adjustments.filter(
    (a) => a.employee === worker.id && !a.settled && a.date <= cutoff && a.date >= from
  );
  const lateAdjs = adjustments.filter(
    (a) => a.employee === worker.id && !a.settled && a.date < from && a.date <= cutoff
  );
  let adjustmentsSum = 0;
  for (const a of [...adjs, ...lateAdjs]) adjustmentsSum += adjustmentSigned(a);

  const carry = worker.opening_carry_paise;
  const totalDue = carry + earned + adjustmentsSum;
  const available = Math.max(0, totalDue);

  const chaluBalance = upadBalance(upad_entries, "chalu", worker.opening_chalu_paise, cutoff);
  const motoBalance = upadBalance(upad_entries, "moto", worker.opening_moto_paise, cutoff);

  const chaluMaxRec = Math.max(0, chaluBalance);
  const motoMaxRec = Math.max(0, motoBalance);

  const errors: EngineError[] = [];
  if (inputs.chalu_recovery_paise < 0 || inputs.chalu_recovery_paise > chaluMaxRec) {
    errors.push({
      code: "chalu_recovery_exceeds_balance",
      amount: Math.max(0, inputs.chalu_recovery_paise - chaluMaxRec),
    });
  }
  if (inputs.moto_recovery_paise < 0 || inputs.moto_recovery_paise > motoMaxRec) {
    errors.push({
      code: "moto_recovery_exceeds_balance",
      amount: Math.max(0, inputs.moto_recovery_paise - motoMaxRec),
    });
  }
  const totalRecovery = Math.max(0, inputs.chalu_recovery_paise) + Math.max(0, inputs.moto_recovery_paise);
  if (totalRecovery > available) {
    errors.push({ code: "recovery_exceeds_due", amount: totalRecovery - available });
  }
  if (inputs.salary_paid_paise < 0 || inputs.salary_paid_paise > available) {
    errors.push({
      code: "salary_paid_out_of_range",
      amount: Math.max(0, inputs.salary_paid_paise - available),
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const payable = Math.max(0, totalDue - inputs.salary_paid_paise - totalRecovery);
  const warnings: EngineWarning[] = [];
  if (totalDue < 0) {
    warnings.push({ code: "deduction_exceeds_due", leftover_paise: -totalDue });
  }
  const lateCount = breakdown.filter((b) => b.is_late_entry).length;
  if (lateCount > 0) warnings.push({ code: "late_entries", count: lateCount });

  const newUpad = inputs.new_upad_given_paise;
  const chaluAfter = chaluBalance - Math.max(0, inputs.chalu_recovery_paise) + (inputs.new_upad_bucket === "chalu" ? newUpad : 0);
  const motoAfter = motoBalance - Math.max(0, inputs.moto_recovery_paise) + (inputs.new_upad_bucket === "moto" ? newUpad : 0);

  return {
    ok: true,
    result: {
      worker_id: worker.id,
      from_date: from,
      cutoff,
      carry_paise: carry,
      earned_paise: earned,
      ot_paise: ot,
      adjustments_paise: adjustmentsSum,
      total_due_paise: totalDue,
      chalu_balance_paise: chaluBalance,
      moto_balance_paise: motoBalance,
      chalu_recovery_paise: Math.max(0, inputs.chalu_recovery_paise),
      moto_recovery_paise: Math.max(0, inputs.moto_recovery_paise),
      salary_paid_paise: inputs.salary_paid_paise,
      payable_paise: payable,
      new_upad_bucket: inputs.new_upad_bucket,
      new_upad_given_paise: newUpad,
      cash_to_hand_over_paise: payable + newUpad,
      closing_carry_paise: payable,
      chalu_after_paise: chaluAfter,
      moto_after_paise: motoAfter,
      day_breakdown: breakdown,
      late_entry_count: lateCount,
      warnings,
    },
  };
}
