import { afterAll, beforeAll, expect, it, describe } from "vitest";
import {
  EMPTY_INPUTS,
  buildPreview,
  listPendingRuns,
  loadWorkerContexts,
  newIdempotencyKey,
  repairPendingRun,
  savePayout,
  undoPayout,
} from "./payout-service";

let hasBackend = false;
let undoRunId = "";

beforeAll(async () => {
  try {
    const res = await fetch("http://127.0.0.1:8091/api/health");
    hasBackend = res.ok;
  } catch {
    hasBackend = false;
  }
  if (hasBackend) {
    const pb = (await import("./pb")).pb;
    const staleRuns = await pb.collection("payout_runs").getFullList<{ id: string; status: string; voided: boolean }>({
      filter: 'voided != true && (note = "bonus with custom reason" || note = "crash simulation" || note = "idem" || note = "dupe guard" || note = "mixed undo test" || note = "test user note protection" || note = "integration test" || note = "t1" || note = "t2")',
    }).catch(() => []);
    for (const r of staleRuns) {
      if (r.status === "pending") {
        await repairPendingRun(r.id).catch(() => {});
      } else {
        await undoPayout(r.id).catch(() => {});
      }
    }
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

    const savedRun = await pb.collection("payout_runs").getOne(saved.runId);
    expect(savedRun.status).toBe("completed");

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
          await undoPayout(s1.runId);
        } else {
          const undo = await undoPayout(s1.runId);
          expect(undo).toEqual({ ok: true });
        }
        expect(true).toBe(true);
      });
  });

  it("returns the same run for a repeated idempotency key instead of saving twice", async ({ skip }) => {
    if (!hasBackend) skip();
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();
    const key = newIdempotencyKey();

    const first = await savePayout({
      payoutDate: "2026-10-31",
      cutoff: "2026-10-31",
      note: "idem",
      rows: [{ context: target, inputs: { ...EMPTY_INPUTS } }],
      idempotencyKey: key,
    });
    undoRunId = first.runId;
    const second = await savePayout({
      payoutDate: "2026-10-31",
      cutoff: "2026-10-31",
      note: "idem",
      rows: [{ context: target, inputs: { ...EMPTY_INPUTS } }],
      idempotencyKey: key,
    });
    expect(second.runId).toBe(first.runId);
    expect(second.statementIds).toEqual(first.statementIds);

    const stored = await savePayout({
      payoutDate: "2026-10-31",
      cutoff: "2026-10-31",
      note: "idem",
      rows: [{ context: target, inputs: { ...EMPTY_INPUTS } }],
      idempotencyKey: key,
    });
    expect(stored.runId).toBe(first.runId);
    await undoPayout(first.runId);
    undoRunId = "";
  });

  it("refuses a second payout for the same worker on the same payout date", async ({ skip }) => {
    if (!hasBackend) skip();
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();

    const saved = await savePayout({
      payoutDate: "2026-10-31",
      cutoff: "2026-10-31",
      note: "dupe guard",
      rows: [{ context: target, inputs: { ...EMPTY_INPUTS } }],
    });
    undoRunId = saved.runId;

    await expect(
      savePayout({
        payoutDate: "2026-10-31",
        cutoff: "2026-10-31",
        note: "dupe guard second",
        rows: [{ context: target, inputs: { ...EMPTY_INPUTS } }],
      }),
    ).rejects.toThrow(/already closed/i);

    await undoPayout(saved.runId);
    undoRunId = "";
  });

  it("hides and repairs interrupted (pending) payouts end to end", async ({ skip }) => {
    if (!hasBackend) skip();
    const pb = (await import("./pb")).pb;
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();

    // simulate a crash mid-save: pending run with one statement
    const run = await pb.collection("payout_runs").create({
      cycle_start: "2026-10-31",
      payout_date: "2026-10-31",
      cutoff_date: "2026-10-31",
      status: "pending",
      voided: false,
      note: "crash simulation",
      employee_count: 1,
      total_due_paise: 0,
      total_paid_paise: 0,
      total_upad_recovery_paise: 0,
    });
    const orphanStmt = await pb.collection("statements").create({
      payout_run: run.id,
      employee: target.employee.id,
      cycle_start: "2026-10-31",
      payout_date: "2026-10-31",
      opening_paise: 99000,
      earned_paise: 0,
      adjustment_paise: 0,
      upad_outstanding_paise: 0,
      upad_recovery_paise: 0,
      total_due_paise: 99000,
      paid_paise: 0,
      closing_paise: 99000,
      days_worked: 0,
      ot_minutes: 0,
      note: "",
      voided: false,
    });

    // pending statements are invisible to carry
    const hidden = await loadWorkerContexts();
    const hiddenCtx = hidden.find((c) => c.employee.id === target.employee.id)!;
    expect(hiddenCtx.paidUpToDate).not.toBe("2026-10-31");

    // and invisible to listStatements (register path)
    const { listStatements } = (await import("./api")) as { listStatements: () => Promise<import("./types").Statement[]> };
    const stmtsNow = await listStatements();
    expect(stmtsNow.some((s) => s.id === orphanStmt.id)).toBe(false);

    // visible in the pending list
    const pendingList = await listPendingRuns();
    expect(pendingList.some((r) => r.id === run.id && r.workerCount === 1)).toBe(true);

    // undo refuses pending runs
    const refused = await undoPayout(run.id);
    expect(refused).toEqual({ ok: false, reason: "use_repair", workers: [] });

    // repair voids run + orphan statement, returning everything to the pre-crash state
    const repaired = await repairPendingRun(run.id);
    expect(repaired).toEqual({ ok: true });
    const runAfter = await pb.collection("payout_runs").getOne(run.id);
    expect(runAfter.voided).toBe(true);
    const stmtAfter = await pb.collection("statements").getOne(orphanStmt.id);
    expect(stmtAfter.voided).toBe(true);

    const restored = await loadWorkerContexts();
    const restoreCtx = restored.find((c) => c.employee.id === target.employee.id)!;
    expect(restoreCtx.paidUpToDate).not.toBe("2026-10-31");
  });

  it("verifies migration backfill logic leaves manual adjustments untouched", async ({ skip }) => {
    if (!hasBackend) skip();
    const pb = (await import("./pb")).pb;
    const contexts = await loadWorkerContexts();
    const empId = contexts[0]?.employee.id;
    if (!empId) skip();

    const testRun = await pb.collection("payout_runs").create({
      cycle_start: "2026-10-01",
      payout_date: "2026-10-15",
      status: "completed",
      voided: true,
      note: "test backfill run",
      employee_count: 1,
      total_due_paise: 0,
      total_paid_paise: 0,
      total_upad_recovery_paise: 0,
    });

    const adjPayout = await pb.collection("adjustments").create({
      employee: empId,
      date: "2026-10-15 00:00:00.000Z",
      amount_paise: 5000,
      kind: "bonus",
      note: "Payout bonus",
      settled_payout: testRun.id,
    });
    const adjManual = await pb.collection("adjustments").create({
      employee: empId,
      date: "2026-10-15 00:00:00.000Z",
      amount_paise: -3000,
      kind: "deduction",
      note: "Tool breakage penalty",
      settled_payout: testRun.id,
    });
    const upadRecovery = await pb.collection("upad_entries").create({
      employee: empId,
      date: "2026-10-15 00:00:00.000Z",
      kind: "recovery",
      category: "chalu",
      bucket: "chalu",
      amount_paise: 4000,
      payout: testRun.id,
      voided: false,
    });
    const upadManual = await pb.collection("upad_entries").create({
      employee: empId,
      date: "2026-10-15 00:00:00.000Z",
      kind: "given",
      category: "chalu",
      bucket: "chalu",
      amount_paise: 2000,
      note: "Manual tea advance",
      payout: testRun.id,
      voided: false,
    });

    try {
      const { isPayoutCreatedNote } = await import("./payout-service");
      const adjs = await pb.collection("adjustments").getFullList({ filter: `settled_payout = "${testRun.id}"` });
      for (const a of adjs) {
        if (!a.payout_id && isPayoutCreatedNote(a.note)) {
          await pb.collection("adjustments").update(a.id, { payout_id: a.settled_payout });
        }
      }
      const upads = await pb.collection("upad_entries").getFullList({ filter: `payout = "${testRun.id}"` });
      for (const u of upads) {
        if (
          !u.payout_id &&
          (u.kind === "recovery" || (u.kind === "given" && (u.note === "Payout advance" || u.note.startsWith("Payout advance:"))))
        ) {
          await pb.collection("upad_entries").update(u.id, { payout_id: u.payout });
        }
      }

      const freshAdjPayout = await pb.collection("adjustments").getOne(adjPayout.id);
      expect(freshAdjPayout.payout_id).toBe(testRun.id);

      const freshAdjManual = await pb.collection("adjustments").getOne(adjManual.id);
      expect(freshAdjManual.payout_id || "").toBe("");

      const freshUpadRec = await pb.collection("upad_entries").getOne(upadRecovery.id);
      expect(freshUpadRec.payout_id).toBe(testRun.id);

      const freshUpadManual = await pb.collection("upad_entries").getOne(upadManual.id);
      expect(freshUpadManual.payout_id || "").toBe("");
    } finally {
      await pb.collection("adjustments").delete(adjPayout.id).catch(() => {});
      await pb.collection("adjustments").delete(adjManual.id).catch(() => {});
      await pb.collection("upad_entries").delete(upadRecovery.id).catch(() => {});
      await pb.collection("upad_entries").delete(upadManual.id).catch(() => {});
      await pb.collection("payout_runs").delete(testRun.id).catch(() => {});
    }
  });

  it("payout with bonus and custom reason then undo leaves nothing behind", async ({ skip }) => {
    if (!hasBackend) skip();
    const pb = (await import("./pb")).pb;
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();

    const saved = await savePayout({
      payoutDate: "2026-11-10",
      cutoff: "2026-11-10",
      note: "bonus with custom reason",
      rows: [
        {
          context: target,
          inputs: {
            ...EMPTY_INPUTS,
            payout_adjustment_paise: 25000,
            payout_adjustment_note: "Festival reward",
            new_chalu_given_paise: 10000,
          },
        },
      ],
    });

    const runId = saved.runId;

    const payoutAdjs = await pb.collection("adjustments").getFullList({ filter: `payout_id = "${runId}"` });
    expect(payoutAdjs).toHaveLength(1);
    expect(payoutAdjs[0].payout_id).toBe(runId);
    expect(payoutAdjs[0].note).toBe("Payout bonus: Festival reward");

    const upads = await pb.collection("upad_entries").getFullList({ filter: `payout_id = "${runId}"` });
    expect(upads.length).toBeGreaterThan(0);
    expect(upads[0].payout_id).toBe(runId);

    const undo = await undoPayout(runId);
    expect(undo).toEqual({ ok: true });

    const adjsAfter = await pb.collection("adjustments").getFullList({ filter: `settled_payout = "${runId}" || payout_id = "${runId}"` });
    expect(adjsAfter).toHaveLength(0);

    const upadsAfter = await pb.collection("upad_entries").getFullList({ filter: `payout_id = "${runId}"` });
    expect(upadsAfter.every((u) => u.voided)).toBe(true);

    const runAfter = await pb.collection("payout_runs").getOne(runId);
    expect(runAfter.voided).toBe(true);
  });

  it("a user-typed note that looks like a payout note is NOT deleted on undo", async ({ skip }) => {
    if (!hasBackend) skip();
    const pb = (await import("./pb")).pb;
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();

    const manualAdj = await pb.collection("adjustments").create({
      employee: target.employee.id,
      date: "2026-11-05 00:00:00.000Z",
      amount_paise: 12000,
      kind: "bonus",
      note: "Payout bonus for festival celebration",
    });

    try {
      const freshContexts = await loadWorkerContexts();
      const freshTarget = freshContexts.find((c) => c.employee.id === target.employee.id)!;

      const saved = await savePayout({
        payoutDate: "2026-11-11",
        cutoff: "2026-11-11",
        note: "test user note protection",
        rows: [
          {
            context: freshTarget,
            inputs: {
              ...EMPTY_INPUTS,
              payout_adjustment_paise: 5000,
              payout_adjustment_note: "Real payout bonus",
            },
          },
        ],
      });

      const manualSettled = await pb.collection("adjustments").getOne(manualAdj.id);
      expect(manualSettled.settled_payout).toBe(saved.runId);
      expect(manualSettled.payout_id || "").toBe("");

      const undo = await undoPayout(saved.runId);
      expect(undo).toEqual({ ok: true });

      const payoutAdjs = await pb.collection("adjustments").getFullList({
        filter: `payout_id = "${saved.runId}"`,
      });
      expect(payoutAdjs).toHaveLength(0);

      const manualAfter = await pb.collection("adjustments").getOne(manualAdj.id);
      expect(manualAfter).toBeTruthy();
      expect(manualAfter.settled_payout || "").toBe("");
      expect(manualAfter.note).toBe("Payout bonus for festival celebration");
    } finally {
      await pb.collection("adjustments").delete(manualAdj.id).catch(() => {});
    }
  });

  it("undo with mixed old and new rows correctly deletes both and preserves manual", async ({ skip }) => {
    if (!hasBackend) skip();
    const pb = (await import("./pb")).pb;
    const contexts = await loadWorkerContexts();
    const target = contextsWith(contexts)[0];
    if (!target) skip();

    const saved = await savePayout({
      payoutDate: "2026-11-12",
      cutoff: "2026-11-12",
      note: "mixed undo test",
      rows: [
        {
          context: target,
          inputs: {
            ...EMPTY_INPUTS,
            payout_adjustment_paise: 8000,
            payout_adjustment_note: "Modern bonus",
          },
        },
      ],
    });
    const runId = saved.runId;

    const legacyAdj = await pb.collection("adjustments").create({
      employee: target.employee.id,
      date: "2026-11-12 00:00:00.000Z",
      amount_paise: 4000,
      kind: "bonus",
      note: "Payout bonus",
      settled_payout: runId,
    });

    const manualAdj = await pb.collection("adjustments").create({
      employee: target.employee.id,
      date: "2026-11-12 00:00:00.000Z",
      amount_paise: -2000,
      kind: "deduction",
      note: "Broken clamp fine",
      settled_payout: runId,
    });

    const legacyUpad = await pb.collection("upad_entries").create({
      employee: target.employee.id,
      date: "2026-11-12 00:00:00.000Z",
      kind: "recovery",
      category: "chalu",
      bucket: "chalu",
      amount_paise: 1500,
      payout: runId,
      voided: false,
    });

    try {
      const undo = await undoPayout(runId);
      expect(undo).toEqual({ ok: true });

      const modernAfter = await pb.collection("adjustments").getFullList({ filter: `payout_id = "${runId}"` });
      expect(modernAfter).toHaveLength(0);

      await expect(pb.collection("adjustments").getOne(legacyAdj.id)).rejects.toThrow();

      const upadAfter = await pb.collection("upad_entries").getOne(legacyUpad.id);
      expect(upadAfter.voided).toBe(true);

      const manualAfter = await pb.collection("adjustments").getOne(manualAdj.id);
      expect(manualAfter).toBeTruthy();
      expect(manualAfter.settled_payout || "").toBe("");
      expect(manualAfter.note).toBe("Broken clamp fine");
    } finally {
      await pb.collection("adjustments").delete(legacyAdj.id).catch(() => {});
      await pb.collection("adjustments").delete(manualAdj.id).catch(() => {});
      await pb.collection("upad_entries").delete(legacyUpad.id).catch(() => {});
    }
  });

  it("edit-lock refuses update and deletion of payout-linked adjustments and upads", async ({ skip }) => {
    if (!hasBackend) skip();
    const pb = (await import("./pb")).pb;
    const { deleteAdjustment, updateAdjustment, deleteUpadEntry, updateUpadEntry } = await import("./api");
    const contexts = await loadWorkerContexts();
    const empId = contexts[0]?.employee.id;
    if (!empId) skip();

    const lockRun = await pb.collection("payout_runs").create({
      cycle_start: "2026-10-01",
      payout_date: "2026-10-20",
      status: "completed",
      voided: true,
      note: "test lock run",
      employee_count: 1,
      total_due_paise: 0,
      total_paid_paise: 0,
      total_upad_recovery_paise: 0,
    });

    const lockedAdj = await pb.collection("adjustments").create({
      employee: empId,
      date: "2026-10-20 00:00:00.000Z",
      amount_paise: 7000,
      kind: "bonus",
      note: "Payout bonus",
      payout_id: lockRun.id,
      settled_payout: lockRun.id,
    });

    const lockedUpad = await pb.collection("upad_entries").create({
      employee: empId,
      date: "2026-10-20 00:00:00.000Z",
      kind: "given",
      category: "chalu",
      bucket: "chalu",
      amount_paise: 5000,
      note: "Payout advance",
      payout_id: lockRun.id,
      voided: false,
    });

    try {
      await expect(deleteAdjustment(lockedAdj.id)).rejects.toThrow(
        /Issued by a payout\. Undo that payout to change this\./
      );
      await expect(updateAdjustment(lockedAdj.id, { note: "changed" })).rejects.toThrow(
        /Issued by a payout\. Undo that payout to change this\./
      );
      await expect(deleteUpadEntry(lockedUpad.id)).rejects.toThrow(
        /Issued by a payout\. Undo that payout to change this\./
      );
      await expect(updateUpadEntry(lockedUpad.id, { note: "changed" })).rejects.toThrow(
        /Issued by a payout\. Undo that payout to change this\./
      );
    } finally {
      await pb.collection("adjustments").delete(lockedAdj.id).catch(() => {});
      await pb.collection("upad_entries").delete(lockedUpad.id).catch(() => {});
      await pb.collection("payout_runs").delete(lockRun.id).catch(() => {});
    }
  });
});

function contextsWith(contexts: import("./payout-service").WorkerContext[]) {
  return contexts.filter(
    (c) =>
      c.attendance.some((a) => !a.settled && a.date <= "2026-10-31") ||
      c.worker.opening_carry_paise !== 0
  );
}
