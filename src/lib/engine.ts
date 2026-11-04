import { addDays, dateKey, parseDate } from "./dates";

export type Paise = number;
export type Bucket = "chalu" | "moto";
export type DayStatus = "full" | "half" | "absent" | "hours" | "";
export type AdjustmentKind = "bonus" | "reimbursement" | "deduction";
export type UpadKind = "given" | "returned" | "recovery" | "writeoff";
export const DEFAULT_FULL_DAY_MINUTES = 480;
export type EngineError =
  | { code: "chalu_recovery_exceeds_balance"; amount: Paise }
  | { code: "moto_recovery_exceeds_balance"; amount: Paise }
  | { code: "recovery_exceeds_due"; amount: Paise }
  | { code: "salary_paid_out_of_range"; amount: Paise }
  | { code: "new_upad_negative"; amount: Paise };

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
  worked_minutes?: number;
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
  bucket?: Bucket;
  kind: UpadKind;
  amount_paise: Paise;
  note?: string;
  voided?: boolean;
};

export type WorkerRef = {
  id: string;
  opening_carry_paise: Paise;
  opening_upad_paise?: Paise;
  opening_chalu_paise?: Paise;
  opening_moto_paise?: Paise;
  opening_date: string;
  daily_rate_paise?: Paise;
};

export type PayoutInputs = {
  upad_deduction_paise?: Paise;
  chalu_recovery_paise?: Paise;
  moto_recovery_paise?: Paise;
  salary_paid_paise: Paise;
  new_upad_bucket?: Bucket;
  new_upad_given_paise?: Paise;
  new_chalu_given_paise?: Paise;
  new_moto_given_paise?: Paise;
  payout_adjustment_paise?: Paise;
  payout_adjustment_note?: string;
};

export type DayBreakdownRow = {
  date: string;
  status: DayStatus;
  worked_minutes?: number;
  days_worked: number;
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
  new_chalu_given_paise?: Paise;
  new_moto_given_paise?: Paise;
  payout_adjustment_paise?: Paise;
  cash_to_hand_over_paise: Paise;
  closing_carry_paise: Paise;
  chalu_after_paise: Paise;
  moto_after_paise: Paise;
  day_breakdown: DayBreakdownRow[];
  days_worked: number;
  late_entry_count: number;
  warnings: EngineWarning[];
};

export function roundHalfUp(x: number): Paise {
  return Math.floor(x + 0.5);
}

export function normalizeAttendance(
  status: DayStatus,
  worked_minutes?: number,
  ot_minutes?: number,
  step_minutes: number = 30,
  full_day_minutes: number = DEFAULT_FULL_DAY_MINUTES
): { status: DayStatus; worked_minutes: number; ot_minutes: number } {
  const cleanOt = Math.max(0, ot_minutes ?? 0);
  if (!status || status === "absent") {
    return { status: status === "" ? "" : "absent", worked_minutes: 0, ot_minutes: cleanOt };
  }
  if (status === "full") {
    return { status: "full", worked_minutes: 0, ot_minutes: cleanOt };
  }
  if (status === "half") {
    return { status: "half", worked_minutes: 0, ot_minutes: cleanOt };
  }
  // status === "hours"
  let wm = Math.max(0, worked_minutes ?? 0);
  if (wm <= 0) {
    return { status: "absent", worked_minutes: 0, ot_minutes: cleanOt };
  }
  const halfMin = Math.round(full_day_minutes / 2);
  if (wm === halfMin) {
    return { status: "half", worked_minutes: 0, ot_minutes: cleanOt };
  }
  if (wm >= full_day_minutes) {
    return { status: "full", worked_minutes: 0, ot_minutes: cleanOt };
  }
  const step = step_minutes > 0 ? step_minutes : 30;
  const rem = wm % step;
  if (rem !== 0) {
    wm = Math.round(wm / step) * step;
    if (wm <= 0) return { status: "absent", worked_minutes: 0, ot_minutes: cleanOt };
    if (wm === halfMin) return { status: "half", worked_minutes: 0, ot_minutes: cleanOt };
    if (wm >= full_day_minutes) return { status: "full", worked_minutes: 0, ot_minutes: cleanOt };
  }
  return { status: "hours", worked_minutes: wm, ot_minutes: cleanOt };
}

export function dayEarnings(
  status: DayStatus,
  ot_minutes: number,
  rate_paise: Paise,
  worked_minutes?: number,
  full_day_minutes: number = DEFAULT_FULL_DAY_MINUTES
): { base_paise: Paise; ot_paise: Paise; total_paise: Paise; days_worked: number } {
  const norm = normalizeAttendance(status, worked_minutes, ot_minutes, 30, full_day_minutes);
  const ot = norm.ot_minutes > 0 ? roundHalfUp((rate_paise * norm.ot_minutes) / full_day_minutes) : 0;

  if (norm.status === "full") {
    return { base_paise: rate_paise, ot_paise: ot, total_paise: rate_paise + ot, days_worked: 1 };
  }
  if (norm.status === "half") {
    const base = roundHalfUp(rate_paise / 2);
    return { base_paise: base, ot_paise: ot, total_paise: base + ot, days_worked: 0.5 };
  }
  if (norm.status === "hours") {
    const wm = norm.worked_minutes;
    const base = roundHalfUp((rate_paise * wm) / full_day_minutes);
    const days = wm / full_day_minutes;
    return { base_paise: base, ot_paise: ot, total_paise: base + ot, days_worked: days };
  }
  return { base_paise: 0, ot_paise: 0, total_paise: 0, days_worked: 0 };
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

export function getWorkerUpadBalance(
  rows: UpadRow[],
  opening_paise: Paise = 0,
  as_of?: string
): Paise {
  let sum = opening_paise;
  for (const row of rows) {
    if (row.voided) continue;
    if (as_of && row.date > as_of) continue;
    if (row.kind === "given") sum += row.amount_paise;
    else if (row.kind === "returned" || row.kind === "recovery" || row.kind === "writeoff") {
      sum -= row.amount_paise;
    }
  }
  return sum;
}

export function getWorkerUpadLedger(
  rows: UpadRow[],
  opening_paise: Paise = 0,
  as_of?: string
): { date: string; kind: UpadKind; amount_paise: Paise; balance_paise: Paise; note?: string; id?: string }[] {
  const sorted = rows
    .filter((r) => !r.voided && (!as_of || r.date <= as_of))
    .sort((a, b) => (a.date === b.date ? (a.id || '').localeCompare(b.id || '') : a.date.localeCompare(b.date)));
  let balance = opening_paise;
  const out: { date: string; kind: UpadKind; amount_paise: Paise; balance_paise: Paise; note?: string; id?: string }[] = [];
  if (opening_paise > 0) {
    out.push({ date: "", kind: "given", amount_paise: opening_paise, balance_paise: opening_paise, note: "Opening Balance" });
  }
  for (const r of sorted) {
    if (r.kind === "given") balance += r.amount_paise;
    else balance -= r.amount_paise;
    out.push({ id: r.id, date: r.date, kind: r.kind, amount_paise: r.amount_paise, balance_paise: balance, note: r.note });
  }
  return out;
}

export function calculateDeductCap(upadBalancePaise: Paise, salaryDuePaise: Paise): Paise {
  return Math.min(Math.max(0, upadBalancePaise), Math.max(0, salaryDuePaise));
}

export function calculateToPay(
  carryPaise: Paise,
  earnedPaise: Paise,
  adjustmentPaise: Paise,
  deductPaise: Paise,
  giveUpadPaise: Paise
): Paise {
  return Math.max(0, carryPaise + earnedPaise + adjustmentPaise - deductPaise + giveUpadPaise);
}

export function calculatePaidCap(toPayPaise: Paise): Paise {
  return Math.max(0, toPayPaise);
}

export function calculateNewCarry(toPayPaise: Paise, paidPaise: Paise): Paise {
  return Math.max(0, toPayPaise - paidPaise);
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
    out.push({ date: r.date, bucket: r.bucket ?? "chalu", kind: r.kind, amount_paise: r.amount_paise, balance_paise: balance });
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
  inputs: PayoutInputs,
  options?: {
    chalu_enabled?: boolean;
    moto_enabled?: boolean;
    full_day_minutes?: number;
  }
): { ok: false; errors: EngineError[] } | { ok: true; result: PayoutComputation } {
  const fullDayMinutes = options?.full_day_minutes ?? DEFAULT_FULL_DAY_MINUTES;
  const isChaluOn = options?.chalu_enabled !== false;
  const isMotoOn = options?.moto_enabled !== false;

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
    const rate = rateOn(rates, d) ?? worker.daily_rate_paise ?? 0;
    const e = dayEarnings(row.status, row.ot_minutes, rate, row.worked_minutes, fullDayMinutes);
    ot += e.ot_paise;
    earned += e.total_paise;
    if (e.base_paise || e.ot_paise) {
      breakdown.push({
        date: d,
        status: row.status,
        worked_minutes: row.worked_minutes,
        days_worked: e.days_worked,
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
    const rate = rateOn(rates, r.date) ?? worker.daily_rate_paise ?? 0;
    const e = dayEarnings(r.status, r.ot_minutes, rate, r.worked_minutes, fullDayMinutes);
    ot += e.ot_paise;
    earned += e.total_paise;
    breakdown.push({
      date: r.date,
      status: r.status,
      worked_minutes: r.worked_minutes,
      days_worked: e.days_worked,
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
  const extraAdj = inputs.payout_adjustment_paise ?? 0;
  adjustmentsSum += extraAdj;

  const carry = worker.opening_carry_paise;
  const totalDue = carry + earned + adjustmentsSum;
  const available = Math.max(0, totalDue);

  const effectiveOpeningUpad = worker.opening_upad_paise ?? worker.opening_chalu_paise ?? 0;
  const singleUpadBal = getWorkerUpadBalance(upad_entries, effectiveOpeningUpad, cutoff);

  const chaluBalance = isChaluOn
    ? (worker.opening_upad_paise !== undefined
        ? singleUpadBal
        : upadBalance(upad_entries, "chalu", worker.opening_chalu_paise ?? 0, cutoff))
    : 0;
  const motoBalance = isMotoOn
    ? upadBalance(upad_entries, "moto", worker.opening_moto_paise ?? 0, cutoff)
    : 0;

  const chaluMaxRec = Math.max(0, chaluBalance);
  const motoMaxRec = Math.max(0, motoBalance);

  const actualChaluRec = isChaluOn ? (inputs.chalu_recovery_paise ?? inputs.upad_deduction_paise ?? 0) : 0;
  const actualMotoRec = isMotoOn ? (inputs.moto_recovery_paise ?? 0) : 0;

  const errors: EngineError[] = [];
  if (isChaluOn && (actualChaluRec < 0 || actualChaluRec > chaluMaxRec)) {
    errors.push({
      code: "chalu_recovery_exceeds_balance",
      amount: Math.max(0, actualChaluRec - chaluMaxRec),
    });
  }
  if (isMotoOn && (actualMotoRec < 0 || actualMotoRec > motoMaxRec)) {
    errors.push({
      code: "moto_recovery_exceeds_balance",
      amount: Math.max(0, actualMotoRec - motoMaxRec),
    });
  }
  const totalRecovery = Math.max(0, actualChaluRec) + Math.max(0, actualMotoRec);
  if (totalRecovery > available) {
    errors.push({ code: "recovery_exceeds_due", amount: totalRecovery - available });
  }
  if (inputs.salary_paid_paise < 0 || inputs.salary_paid_paise > available) {
    errors.push({
      code: "salary_paid_out_of_range",
      amount: Math.max(0, inputs.salary_paid_paise - available),
    });
  }

  const rawNewChalu = inputs.new_chalu_given_paise ?? (inputs.new_upad_bucket === "chalu" ? (inputs.new_upad_given_paise ?? 0) : 0);
  const rawNewMoto = inputs.new_moto_given_paise ?? (inputs.new_upad_bucket === "moto" ? (inputs.new_upad_given_paise ?? 0) : 0);
  const newChalu = isChaluOn ? rawNewChalu : 0;
  const newMoto = isMotoOn ? rawNewMoto : 0;

  if (newChalu < 0 || newMoto < 0) {
    errors.push({ code: "new_upad_negative", amount: Math.min(0, newChalu) + Math.min(0, newMoto) });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payable = Math.max(0, totalDue - inputs.salary_paid_paise - totalRecovery);
  const warnings: EngineWarning[] = [];
  if (totalDue < 0) {
    warnings.push({ code: "deduction_exceeds_due", leftover_paise: -totalDue });
  }
  const lateCount = breakdown.filter((b) => b.is_late_entry).length;
  if (lateCount > 0) warnings.push({ code: "late_entries", count: lateCount });

  const totalNewUpad = newChalu + newMoto;
  const chaluAfter = chaluBalance - Math.max(0, actualChaluRec) + newChalu;
  const motoAfter = motoBalance - Math.max(0, actualMotoRec) + newMoto;

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
      chalu_recovery_paise: Math.max(0, actualChaluRec),
      moto_recovery_paise: Math.max(0, actualMotoRec),
      salary_paid_paise: inputs.salary_paid_paise,
      payable_paise: payable,
      new_upad_bucket: isChaluOn ? (inputs.new_upad_bucket ?? "chalu") : "moto",
      new_upad_given_paise: totalNewUpad,
      new_chalu_given_paise: newChalu,
      new_moto_given_paise: newMoto,
      payout_adjustment_paise: extraAdj,
      cash_to_hand_over_paise: payable + totalNewUpad,
      closing_carry_paise: payable,
      chalu_after_paise: chaluAfter,
      moto_after_paise: motoAfter,
      day_breakdown: breakdown,
      days_worked: breakdown.reduce((sum, d) => sum + d.days_worked, 0),
      late_entry_count: lateCount,
      warnings,
    },
  };
}

export function validateLedgerChronology(
  existingRows: UpadRow[],
  opening_paise: Paise,
  bucket: Bucket,
  proposedEntry: {
    id?: string;
    date: string;
    kind: UpadKind;
    amount_paise: Paise;
  }
): { ok: true } | { ok: false; error: string; date: string; running_paise: Paise; amount_paise: Paise } {
  const entries: Array<{ date: string; kind: UpadKind; amount_paise: Paise; isProposed?: boolean }> = [];
  for (const r of existingRows) {
    if (r.voided || r.bucket !== bucket) continue;
    if (proposedEntry.id && r.id === proposedEntry.id) continue;
    entries.push({ date: dateKey(r.date), kind: r.kind, amount_paise: r.amount_paise });
  }
  entries.push({
    date: dateKey(proposedEntry.date),
    kind: proposedEntry.kind,
    amount_paise: proposedEntry.amount_paise,
    isProposed: true,
  });

  const kindPriority: Record<UpadKind, number> = {
    given: 1,
    recovery: 2,
    returned: 3,
    writeoff: 4,
  };
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return kindPriority[a.kind] - kindPriority[b.kind];
  });

  let running = opening_paise;
  for (const entry of entries) {
    if (entry.kind === "given") {
      running += entry.amount_paise;
    } else {
      running -= entry.amount_paise;
    }
    if (running < 0) {
      return {
        ok: false,
        date: entry.date,
        running_paise: running,
        amount_paise: Math.abs(running),
        error: `Refused: settlement would make balance negative on ${entry.date} (₹${(Math.abs(running) / 100).toFixed(2)})`,
      };
    }
  }
  return { ok: true };
}
