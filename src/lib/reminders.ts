/**
 * Reminder schedule generation — mirrors the SQL trigger
 * `regenerate_assignment_reminders`. Pure functions, unit-tested.
 */

export interface ReminderPlanRow {
  kind: "advance" | "deadline";
  offsetDays: number;
  remindAt: Date;
}

export interface ReminderStateRow extends ReminderPlanRow {
  id: string;
  status: "scheduled" | "processing" | "sent" | "cancelled" | "failed";
}

/** Generates the desired reminder schedule for a deadline. Past offsets are skipped. */
export function generateReminderSchedule(
  dueAt: Date,
  offsetsDays: number[],
  sendAtDeadline: boolean,
  now: Date = new Date(),
): ReminderPlanRow[] {
  const rows: ReminderPlanRow[] = [];
  const uniqueOffsets = [...new Set(offsetsDays)].filter((d) => Number.isInteger(d) && d >= 0).sort((a, b) => b - a);
  for (const offset of uniqueOffsets) {
    const remindAt = new Date(dueAt.getTime() - offset * 86_400_000);
    if (remindAt > now) {
      rows.push({ kind: "advance", offsetDays: offset, remindAt });
    }
  }
  if (sendAtDeadline && dueAt > now) {
    rows.push({ kind: "deadline", offsetDays: 0, remindAt: dueAt });
  }
  return rows;
}

/** Diffs current vs desired schedules: what to cancel and what to create. */
export function diffReminderSchedules(
  current: ReminderStateRow[],
  desired: ReminderPlanRow[],
): { toCancel: ReminderStateRow[]; toCreate: ReminderPlanRow[] } {
  const pending = current.filter((r) => r.status === "scheduled");
  const key = (r: { kind: string; offsetDays: number }) => `${r.kind}:${r.offsetDays}`;
  const desiredKeys = new Set(desired.map(key));
  const currentKeys = new Set(pending.map(key));
  return {
    toCancel: pending.filter((r) => !desiredKeys.has(key(r))),
    toCreate: desired.filter((r) => !currentKeys.has(key(r))),
  };
}

/** A student is eligible for a reminder unless they already submitted. */
export function isReminderEligible(hasSubmitted: boolean): boolean {
  return !hasSubmitted;
}

/** Idempotency key used by the delivery pipeline (DB enforces uniqueness). */
export function reminderDedupeKey(reminderId: string, recipientId: string): string {
  return `rem-${reminderId}-${recipientId}`;
}

/** Recipients for a reminder given assignment mode and target policy. */
export function reminderRecipients(args: {
  mode: "individual" | "team";
  reminderTarget: "all" | "leader";
  students: string[];
  teams: { id: string; leaderId: string; memberIds: string[] }[];
}): string[] {
  if (args.mode === "individual") return [...args.students];
  if (args.reminderTarget === "leader") return args.teams.map((t) => t.leaderId).filter(Boolean);
  return [...new Set(args.teams.flatMap((t) => t.memberIds))];
}
