/**
 * Transparent, rules-based team matching. Scores are explainable and surfaced
 * to users with their reasons — no black-box score.
 */

export interface MatchingProfile {
  id: string;
  name: string;
  preferredLanguage?: string | null;
  availability: string[];
  experience?: "none" | "beginner" | "intermediate" | "advanced" | null;
  academicYear?: string | null;
}

export interface MatchResult {
  score: number; // 0–100
  reasons: string[];
}

const EXPERIENCE_ORDER = ["none", "beginner", "intermediate", "advanced"] as const;

function experienceDistance(
  a: MatchingProfile["experience"],
  b: MatchingProfile["experience"],
): number {
  if (!a || !b) return 2; // unknown → neutral distance
  return Math.abs(EXPERIENCE_ORDER.indexOf(a) - EXPERIENCE_ORDER.indexOf(b));
}

export function matchScore(me: MatchingProfile, other: MatchingProfile): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  if (me.preferredLanguage && other.preferredLanguage && me.preferredLanguage === other.preferredLanguage) {
    score += 40;
    reasons.push(`Same preferred language (${me.preferredLanguage})`);
  }

  const overlap = me.availability.filter((a) => other.availability.includes(a));
  if (me.availability.length > 0 && other.availability.length > 0) {
    const ratio = overlap.length / Math.max(new Set([...me.availability, ...other.availability]).size, 1);
    const points = Math.round(ratio * 40);
    score += points;
    if (overlap.length > 0) {
      reasons.push(`Overlapping availability: ${overlap.slice(0, 3).join(", ")}`);
    }
  }

  const dist = experienceDistance(me.experience, other.experience);
  const expPoints = Math.max(0, 20 - dist * 7);
  score += expPoints;
  if (dist <= 1) reasons.push("Similar experience level");

  if (me.academicYear && other.academicYear && me.academicYear === other.academicYear) {
    score += 5;
    reasons.push(`Same academic year (${me.academicYear})`);
  }

  return { score: Math.min(score, 100), reasons };
}

/** Ranks candidates for a student (excluding the student themself). */
export function rankMatches(
  me: MatchingProfile,
  others: MatchingProfile[],
  limit = 10,
): (MatchingProfile & { match: MatchResult })[] {
  return others
    .filter((o) => o.id !== me.id)
    .map((o) => ({ ...o, match: matchScore(me, o) }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit);
}

/** Suggests incomplete teams for a student based on team preferences. */
export function suggestTeams(
  me: MatchingProfile,
  teams: { id: string; name: string; preferredLanguages: string[]; availability: string[]; missing: number }[],
  limit = 10,
): { team: (typeof teams)[number]; score: number; reasons: string[] }[] {
  return teams
    .map((team) => {
      const reasons: string[] = [];
      let score = 0;
      if (me.preferredLanguage && team.preferredLanguages.includes(me.preferredLanguage)) {
        score += 50;
        reasons.push(`Team prefers ${me.preferredLanguage}`);
      }
      const overlap = me.availability.filter((a) => team.availability.includes(a));
      if (overlap.length > 0) {
        score += Math.min(overlap.length * 10, 40);
        reasons.push(`Shared availability: ${overlap.slice(0, 3).join(", ")}`);
      }
      score += Math.min(team.missing * 5, 10);
      return { team, score, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
