import { describe, expect, it } from "vitest";
import {
  diffReminderSchedules,
  generateReminderSchedule,
  isReminderEligible,
  reminderDedupeKey,
  reminderRecipients,
} from "@/lib/reminders";

const NOW = new Date("2026-10-23T12:00:00Z");
const DUE = new Date("2026-10-30T18:00:00Z"); // 7 days + 6 hours ahead

describe("generateReminderSchedule", () => {
  it("creates advance reminders for each configured offset", () => {
    const plan = generateReminderSchedule(DUE, [7, 3, 1], false, NOW);
    expect(plan.map((r) => r.kind)).toEqual(["advance", "advance", "advance"]);
    expect(plan.map((r) => r.offsetDays).sort((a, b) => a - b)).toEqual([1, 3, 7]);
  });

  it("adds the deadline reminder when enabled", () => {
    const plan = generateReminderSchedule(DUE, [3], true, NOW);
    expect(plan).toHaveLength(2);
    expect(plan.find((r) => r.kind === "deadline")!.remindAt.toISOString()).toBe(DUE.toISOString());
  });

  it("skips offsets that are already in the past", () => {
    // deadline in 2 days: the 7-day and 3-day offsets have passed
    const soon = new Date(NOW.getTime() + 2 * 86_400_000);
    const plan = generateReminderSchedule(soon, [7, 3, 1], false, NOW);
    expect(plan.map((r) => r.offsetDays)).toEqual([1]);
  });

  it("never schedules the deadline reminder for a past deadline", () => {
    const past = new Date(NOW.getTime() - 86_400_000);
    expect(generateReminderSchedule(past, [1], true, NOW)).toHaveLength(0);
  });
});

describe("diffReminderSchedules (deadline change)", () => {
  it("cancels obsolete reminders and creates the missing ones", () => {
    const current = [
      { id: "r1", kind: "advance" as const, offsetDays: 7, remindAt: NOW, status: "scheduled" as const },
      { id: "r2", kind: "advance" as const, offsetDays: 3, remindAt: NOW, status: "scheduled" as const },
      { id: "r3", kind: "deadline" as const, offsetDays: 0, remindAt: NOW, status: "sent" as const },
    ];
    const desired = generateReminderSchedule(
      new Date(NOW.getTime() + 5 * 86_400_000),
      [3, 1],
      true,
      NOW,
    );
    const { toCancel, toCreate } = diffReminderSchedules(current, desired);
    expect(toCancel.map((r) => r.id)).toEqual(["r1"]); // 7-day no longer possible
    expect(toCancel.map((r) => r.id)).not.toContain("r3"); // sent reminders preserved
    // 3-day already scheduled (kept), so only the 1-day advance + deadline are new
    expect(toCreate.map((r) => r.offsetDays)).toEqual([1, 0]);
  });

  it("does not recreate reminders that are already scheduled", () => {
    const desired = generateReminderSchedule(DUE, [7], false, NOW);
    const current = [
      { id: "r1", kind: "advance" as const, offsetDays: 7, remindAt: desired[0]!.remindAt, status: "scheduled" as const },
    ];
    const { toCancel, toCreate } = diffReminderSchedules(current, desired);
    expect(toCancel).toHaveLength(0);
    expect(toCreate).toHaveLength(0);
  });
});

describe("reminder eligibility and idempotency", () => {
  it("excludes students who already submitted", () => {
    expect(isReminderEligible(true)).toBe(false);
    expect(isReminderEligible(false)).toBe(true);
  });

  it("produces stable dedupe keys", () => {
    expect(reminderDedupeKey("r1", "u1")).toBe(reminderDedupeKey("r1", "u1"));
    expect(reminderDedupeKey("r1", "u1")).not.toBe(reminderDedupeKey("r2", "u1"));
  });
});

describe("reminderRecipients", () => {
  const students = ["s1", "s2"];
  const teams = [
    { id: "t1", leaderId: "s1", memberIds: ["s1", "s2", "s3"] },
    { id: "t2", leaderId: "s4", memberIds: ["s4"] },
  ];

  it("targets all students for individual assignments", () => {
    expect(reminderRecipients({ mode: "individual", reminderTarget: "all", students, teams }).sort()).toEqual(["s1", "s2"]);
  });

  it("targets all team members for team assignments by default", () => {
    expect(reminderRecipients({ mode: "team", reminderTarget: "all", students, teams }).sort()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("targets only leaders when configured", () => {
    expect(reminderRecipients({ mode: "team", reminderTarget: "leader", students, teams }).sort()).toEqual(["s1", "s4"]);
  });
});
