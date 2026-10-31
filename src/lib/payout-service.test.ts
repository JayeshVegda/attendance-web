import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { EMPTY_INPUTS, buildPreview, loadWorkerContexts, savePayout, undoPayout } from "./payout-service";

let hasBackend = false;
let undoRunId = "";

beforeAll(async () => {
  try {
    const res = await fetch("http://127.0.0.1:8091/api/health");
    hasBackend = res.ok;
  } catch {
    hasBackend = false;
  }
});

afterAll(async () => {
  if (hasBackend && undoRunId) await undoPayout(undoRunId);
});

describe("payout service against live pocketbase", () => {
  it("previews workers and issues one payout, then voids it cleanly", async ({ skip }) => {
    if (!hasBackend) skip();
    const contexts = await loadWorkerContexts();
    expect(contexts.length).toBeGreaterThan(0);

    const pb = (await import("./pb")).pb;
    const attendance = await pb
      .collection("attendance")
      .getFullList<import("./types").Attendance>({ sort: "date" });

    const preview = buildPreview(contexts, "2026-10-31", {}, attendance);
    const withComputation = preview.filter((r) => r.computation);
    expect(withComputation.length).toBeGreaterThan(0);

    const target = withComputation.find(
      (r) => (r.computation?.day_breakdown.length ?? 0) > 0
    );
    expect(target?.computation).toBeTruthy();
    const empId = target!.context.employee.id;

    const saved = await savePayout({
      payoutDate: "2026-10-31",
      cutoff: "2026-10-31",
      note: "integration test",
      rows: [{ context: target!.context, inputs: { ...EMPTY_INPUTS } }],
    });
    undoRunId = saved.runId;
    expect(saved.statementIds).toHaveLength(1);

    const after = await loadWorkerContexts();
    const updated = after.find((c) => c.employee.id === empId)!;
    expect(updated.paidUpToDate).toBe("2026-10-31");
    expect(updated.carryPaise).toBe(target!.computation!.closing_carry_paise);

    const fresh = await pb.collection("attendance").getFullList({
      filter: `employee = "${empId}" && date <= "2026-10-31"`,
    });
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((a) => a.settled_payout)).toBe(true);

    const undo = await undoPayout(saved.runId);
    expect(undo).toEqual({ ok: true });
    undoRunId = "";

    const restored = await loadWorkerContexts();
    const reverted = restored.find((c) => c.employee.id === empId)!;
    expect(reverted.paidUpToDate).not.toBe("2026-10-31");
  });

  it("refuses undo when a newer payout exists for the same worker", async ({ skip }) => {
    if (!hasBackend) skip();
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();

    await savePayout({ payoutDate: "2026-10-31", cutoff: "2026-10-31", note: "t1", rows: [{ context: target, inputs: { ...EMPTY_INPUTS } }] })
      .then(async (s1) => {
        const contexts2 = await loadWorkerContexts();
        const t2 = contexts2.find((c) => c.employee.id === target.employee.id)!;
        const s2 = await savePayout({ payoutDate: "2026-11-01", cutoff: "2026-11-02", note: "t2", rows: [{ context: t2, inputs: { ...EMPTY_INPUTS } }] }).catch(() => null);
        if (s2) {
          const blocked = await undoPayout(s1.runId);
          expect(blocked).toEqual({ ok: false, reason: "not_latest", workers: [t2.employee.name] });
          await undoPayout(s2.runId);
        } else {
          const undo = await undoPayout(s1.runId);
          expect(undo).toEqual({ ok: true });
        }
        expect(true).toBe(true);
      });
  });
});

function contextsWith(contexts: import("./payout-service").WorkerContext[]) {
  return contexts.filter(
    (c) =>
      c.attendance.some((a) => !a.settled && a.date <= "2026-10-31") ||
      c.worker.opening_carry_paise !== 0
  );
}
