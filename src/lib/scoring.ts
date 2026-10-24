/**
 * Contest scoring engine — mirrors the SQL `contest_standings` function
 * exactly so the client can preview/validate standings and unit tests can
 * verify the documented rules.
 *
 * ICPC mode:
 *   rank by solved DESC → penalty ASC → last-accept-minute ASC → name ASC.
 *   Penalty = Σ over SOLVED problems of (accept minute + max(wrongAttempts-1, 0) ×
 *   penaltyMinutes). Wrong submissions on unsolved problems add nothing.
 *
 * Points mode:
 *   rank by score DESC (sum of points over solved) → penalty ASC →
 *   last-accept-minute ASC → name ASC.
 */

export interface StandingProblemInput {
  code: string;
  solved: boolean;
  attempts: number;
  solveTimeMinutes?: number | null;
  points?: number | null;
}

export interface StandingParticipantInput {
  label: string;
  teamId?: string | null;
  studentId?: string | null;
  problems: StandingProblemInput[];
}

export interface StandingRowResult {
  rank: number;
  label: string;
  teamId: string | null;
  studentId: string | null;
  solved: number;
  score: number;
  penalty: number;
  lastSolve: number;
  problems: StandingProblemInput[];
}

export type ScoringMode = "icpc" | "points";

export function problemPenalty(
  p: StandingProblemInput,
  penaltyMinutes: number,
): number {
  if (!p.solved) return 0;
  const accept = p.solveTimeMinutes ?? 0;
  const wrong = Math.max((p.attempts ?? 1) - 1, 0);
  return accept + wrong * penaltyMinutes;
}

export function computeStandings(
  participants: StandingParticipantInput[],
  mode: ScoringMode,
  penaltyMinutes: number,
): StandingRowResult[] {
  const rows = participants.map((participant) => {
    const solved = participant.problems.filter((p) => p.solved).length;
    const penalty = participant.problems.reduce(
      (sum, p) => sum + problemPenalty(p, penaltyMinutes),
      0,
    );
    const score = participant.problems
      .filter((p) => p.solved)
      .reduce((sum, p) => sum + (p.points ?? 0), 0);
    const lastSolve = participant.problems
      .filter((p) => p.solved)
      .reduce((max, p) => Math.max(max, p.solveTimeMinutes ?? 0), 0);
    return {
      rank: 0,
      label: participant.label,
      teamId: participant.teamId ?? null,
      studentId: participant.studentId ?? null,
      solved,
      score,
      penalty,
      lastSolve,
      problems: participant.problems,
    };
  });

  rows.sort((a, b) => {
    if (mode === "icpc") {
      if (b.solved !== a.solved) return b.solved - a.solved;
    } else {
      if (b.score !== a.score) return b.score - a.score;
    }
    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
    if (a.lastSolve !== b.lastSolve) return a.lastSolve - b.lastSolve;
    return a.label.localeCompare(b.label);
  });

  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  return rows;
}

/** Validates a manually entered problem result row. Returns error text or null. */
export function validateProblemResult(p: {
  code: string;
  solved: boolean;
  attempts: number;
  solveTimeMinutes?: number | null;
}): string | null {
  if (!p.code?.trim()) return "Problem code is required";
  if (!Number.isInteger(p.attempts) || p.attempts < 0) return `Invalid attempts for ${p.code}`;
  if (p.solved && (p.solveTimeMinutes == null || p.solveTimeMinutes < 0)) {
    return `Solved problem ${p.code} requires a non-negative solve time`;
  }
  if (!p.solved && p.attempts === 0) return `${p.code}: unsolved problems need at least 0 attempts`;
  return null;
}
