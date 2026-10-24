import { describe, expect, it } from "vitest";
import { dedupeAcceptedSubmissions, parseProblemUrl, ratingBands } from "@/lib/cf";
import { matchScore, rankMatches, suggestTeams } from "@/lib/matching";
import { parseCSV, toCSV } from "@/lib/csv";

describe("parseProblemUrl", () => {
  it("recognizes Codeforces problemset links", () => {
    expect(parseProblemUrl("https://codeforces.com/problemset/problem/1850/A")).toEqual({
      source: "codeforces",
      externalId: "1850A",
      recognized: true,
    });
  });

  it("recognizes Codeforces contest links with sub-indexes", () => {
    expect(parseProblemUrl("https://codeforces.com/contest/1850/problem/B1")).toEqual({
      source: "codeforces",
      externalId: "1850B1",
      recognized: true,
    });
  });

  it("recognizes AtCoder and CSES links", () => {
    expect(parseProblemUrl("https://atcoder.jp/contests/abc300/tasks/abc300_a")!.externalId).toBe("abc300_abc300_a");
    expect(parseProblemUrl("https://cses.fi/problemset/task/1068")!.externalId).toBe("1068");
  });

  it("rejects non-URLs", () => {
    expect(parseProblemUrl("not a url")).toBeNull();
  });
});

describe("dedupeAcceptedSubmissions", () => {
  it("counts a problem solved twice as ONE unique solve", () => {
    const result = dedupeAcceptedSubmissions([
      { id: 1, creationTimeSeconds: 200, problem: { contestId: 4, index: "A" }, verdict: "OK" },
      { id: 2, creationTimeSeconds: 100, problem: { contestId: 4, index: "A" }, verdict: "OK" },
      { id: 3, creationTimeSeconds: 150, problem: { contestId: 4, index: "A" }, verdict: "WRONG_ANSWER" },
      { id: 4, creationTimeSeconds: 300, problem: { contestId: 71, index: "A" }, verdict: "OK" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((p) => p.contestId === 4 && p.index === "A")!.firstSolvedAt).toBe(100); // earliest acceptance
  });

  it("ignores submissions without a contest id (cannot dedupe reliably)", () => {
    const result = dedupeAcceptedSubmissions([
      { id: 1, creationTimeSeconds: 1, problem: { index: "A" }, verdict: "OK" },
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("ratingBands", () => {
  it("groups problems into bands", () => {
    const bands = ratingBands([{ rating: 800 }, { rating: 900 }, { rating: 1500 }, { rating: null }]);
    expect(bands.find((b) => b.band === "800–1199")!.count).toBe(2);
    expect(bands.find((b) => b.band === "1400–1599")!.count).toBe(1);
    expect(bands.find((b) => b.band === "unrated")!.count).toBe(1);
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(4);
  });
});

describe("matchScore", () => {
  it("rewards shared language, availability and similar experience with explainable reasons", () => {
    const me = {
      id: "me", name: "Me", preferredLanguage: "C++",
      availability: ["sat-morning", "sat-evening"], experience: "beginner" as const,
      academicYear: "First Year",
    };
    const other = {
      id: "o", name: "Other", preferredLanguage: "C++",
      availability: ["sat-morning", "sun-evening"], experience: "beginner" as const,
      academicYear: "First Year",
    };
    const result = matchScore(me, other);
    expect(result.score).toBeGreaterThan(60);
    expect(result.reasons.some((r) => r.includes("C++"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("availability"))).toBe(true);
  });

  it("gives a low score for disjoint preferences", () => {
    const result = matchScore(
      { id: "a", name: "A", preferredLanguage: "Python", availability: ["mon-evening"], experience: "advanced", academicYear: null },
      { id: "b", name: "B", preferredLanguage: "C++", availability: ["sat-morning"], experience: "none", academicYear: null },
    );
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it("never exceeds 100", () => {
    const result = matchScore(
      { id: "a", name: "A", preferredLanguage: "C++", availability: Array.from({ length: 11 }, (_, i) => `s${i}`), experience: "beginner", academicYear: "Y" },
      { id: "b", name: "B", preferredLanguage: "C++", availability: Array.from({ length: 11 }, (_, i) => `s${i}`), experience: "beginner", academicYear: "Y" },
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("excludes self and ranks by score", () => {
    const ranked = rankMatches(
      { id: "me", name: "Me", preferredLanguage: "C++", availability: [], experience: null },
      [
        { id: "me", name: "Me", preferredLanguage: "C++", availability: [], experience: null },
        { id: "x", name: "X", preferredLanguage: "C++", availability: [], experience: null },
        { id: "y", name: "Y", preferredLanguage: "Java", availability: [], experience: null },
      ],
    );
    expect(ranked.map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("suggestTeams", () => {
  it("prefers teams matching the student's language", () => {
    const ranked = suggestTeams(
      { id: "me", name: "Me", preferredLanguage: "Python", availability: [], experience: null },
      [
        { id: "t1", name: "PyTeam", preferredLanguages: ["Python"], availability: [], missing: 2 },
        { id: "t2", name: "CppTeam", preferredLanguages: ["C++"], availability: [], missing: 2 },
      ],
    );
    expect(ranked[0]!.team.id).toBe("t1");
  });
});

describe("CSV round-trip", () => {
  it("escapes and parses quoted fields", () => {
    const csv = toCSV([{ name: "Team, \"Alpha\"", score: 3, note: 'say "hi"\nnewline' }]);
    const parsed = parseCSV(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe('Team, "Alpha"');
    expect(parsed[0]!.score).toBe("3");
    expect(parsed[0]!.note).toBe('say "hi"\nnewline');
  });

  it("returns empty for header-only input", () => {
    expect(parseCSV("a,b\n")).toHaveLength(0);
  });
});
