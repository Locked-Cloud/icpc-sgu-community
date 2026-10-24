/**
 * Codeforces helpers: problem URL parsing, unique problem identity, and
 * accepted-submission deduplication rules.
 */

export interface ParsedProblemUrl {
  source: "codeforces" | "atcoder" | "cses" | "other";
  externalId: string;
  /** true when the URL is a well-formed problem link we can identify uniquely */
  recognized: boolean;
}

export function parseProblemUrl(rawUrl: string): ParsedProblemUrl | null {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return null;

  // https://codeforces.com/problemset/problem/1850/A
  let m = url.match(/^https?:\/\/codeforces\.com\/problemset\/problem\/(\d+)\/([A-Za-z]\d?)/i);
  if (m) return { source: "codeforces", externalId: `${m[1]}${m[2].toUpperCase()}`, recognized: true };

  // https://codeforces.com/contest/1850/problem/A  (also /gym/...)
  m = url.match(/^https?:\/\/codeforces\.com\/(contest|gym)\/(\d+)\/problem\/([A-Za-z]\d?)/i);
  if (m) return { source: "codeforces", externalId: `${m[2]}${m[3].toUpperCase()}`, recognized: true };

  // https://atcoder.jp/contests/abc300/tasks/abc300_a
  m = url.match(/^https?:\/\/atcoder\.jp\/contests\/([a-z0-9_-]+)\/tasks\/([a-z0-9_-]+)/i);
  if (m) return { source: "atcoder", externalId: `${m[1]}_${m[2]}`, recognized: true };

  // https://cses.fi/problemset/task/1068
  m = url.match(/^https?:\/\/cses\.fi\/problemset\/task\/(\d+)/i);
  if (m) return { source: "cses", externalId: m[1]!, recognized: true };

  return { source: "other", externalId: url, recognized: false };
}

export interface CfSubmission {
  id: number;
  creationTimeSeconds: number;
  problem: { contestId?: number; index?: string; name?: string; rating?: number };
  verdict?: string;
}

export interface UniqueSolvedProblem {
  contestId: number;
  index: string;
  name?: string;
  rating?: number;
  firstSolvedAt: number; // creationTimeSeconds of the FIRST accepted submission
}

/**
 * Deduplicates accepted submissions: one unique solved problem per
 * (contestId, index), keeping the earliest acceptance. Repeated accepted
 * submissions for the same problem never count twice.
 */
export function dedupeAcceptedSubmissions(submissions: CfSubmission[]): UniqueSolvedProblem[] {
  const map = new Map<string, UniqueSolvedProblem>();
  for (const s of submissions) {
    if (s.verdict !== "OK") continue;
    const contestId = s.problem.contestId;
    const index = s.problem.index;
    if (contestId == null || !index) continue; // practice submissions cannot be deduped reliably
    const key = `${contestId}:${index}`;
    const existing = map.get(key);
    if (!existing || s.creationTimeSeconds < existing.firstSolvedAt) {
      map.set(key, {
        contestId,
        index,
        name: s.problem.name,
        rating: s.problem.rating,
        firstSolvedAt: s.creationTimeSeconds,
      });
    }
  }
  return [...map.values()];
}

/** Groups solved problems into Codeforces rating bands. */
export function ratingBands(solved: { rating?: number | null }[]): { band: string; count: number }[] {
  const bands = [
    { band: "unrated", min: -Infinity, max: 0 },
    { band: "800–1199", min: 800, max: 1199 },
    { band: "1200–1399", min: 1200, max: 1399 },
    { band: "1400–1599", min: 1400, max: 1599 },
    { band: "1600–1899", min: 1600, max: 1899 },
    { band: "1900–2399", min: 1900, max: 2399 },
    { band: "2400+", min: 2400, max: Infinity },
  ];
  return bands.map((b) => ({
    band: b.band,
    count: solved.filter((p) => (p.rating == null ? b.band === "unrated" : p.rating >= b.min && p.rating <= b.max))
      .length,
  }));
}

export function cfProfileUrl(handle: string): string {
  return `https://codeforces.com/profile/${encodeURIComponent(handle)}`;
}
