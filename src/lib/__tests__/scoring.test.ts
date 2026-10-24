import { describe, expect, it } from "vitest";
import { computeStandings, problemPenalty, validateProblemResult } from "@/lib/scoring";

describe("ICPC penalty calculation", () => {
  it("counts accept time plus 20 min per wrong attempt on solved problems", () => {
    expect(problemPenalty({ code: "A", solved: true, attempts: 1, solveTimeMinutes: 40 }, 20)).toBe(40);
    expect(problemPenalty({ code: "A", solved: true, attempts: 3, solveTimeMinutes: 40 }, 20)).toBe(80);
    expect(problemPenalty({ code: "A", solved: true, attempts: 0, solveTimeMinutes: 10 }, 20)).toBe(10);
  });

  it("gives zero penalty for unsolved problems (standard ICPC rules)", () => {
    expect(problemPenalty({ code: "B", solved: false, attempts: 5, solveTimeMinutes: null }, 20)).toBe(0);
  });
});

describe("computeStandings — ICPC mode", () => {
  const participants = [
    {
      label: "Alpha",
      problems: [
        { code: "A", solved: true, attempts: 1, solveTimeMinutes: 30 },
        { code: "B", solved: true, attempts: 3, solveTimeMinutes: 100 },
      ],
    },
    {
      label: "Beta",
      problems: [
        { code: "A", solved: true, attempts: 1, solveTimeMinutes: 20 },
        { code: "B", solved: false, attempts: 5, solveTimeMinutes: null },
      ],
    },
    {
      label: "Gamma",
      problems: [
        { code: "A", solved: true, attempts: 2, solveTimeMinutes: 90 },
        { code: "B", solved: true, attempts: 1, solveTimeMinutes: 250 },
      ],
    },
  ];

  it("ranks by solved desc, then penalty asc", () => {
    const rows = computeStandings(participants, "icpc", 20);
    expect(rows[0]!.label).toBe("Alpha"); // 2 solved, penalty 30+140=170
    expect(rows[1]!.label).toBe("Gamma"); // 2 solved, penalty 110+250=360
    expect(rows[2]!.label).toBe("Beta"); // 1 solved
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties deterministically by last solve then name", () => {
    const tied = [
      {
        label: "Zeta",
        problems: [{ code: "A", solved: true, attempts: 1, solveTimeMinutes: 50 }],
      },
      {
        label: "Abc",
        problems: [{ code: "A", solved: true, attempts: 1, solveTimeMinutes: 50 }],
      },
    ];
    const rows = computeStandings(tied, "icpc", 20);
    expect(rows[0]!.label).toBe("Abc");
    expect(rows[1]!.label).toBe("Zeta");
  });
});

describe("computeStandings — points mode", () => {
  it("ranks by score desc regardless of solved count", () => {
    const rows = computeStandings(
      [
        {
          label: "ManySmall",
          problems: [
            { code: "A", solved: true, attempts: 1, solveTimeMinutes: 10, points: 100 },
            { code: "B", solved: true, attempts: 1, solveTimeMinutes: 20, points: 100 },
          ],
        },
        {
          label: "OneBig",
          problems: [{ code: "C", solved: true, attempts: 1, solveTimeMinutes: 30, points: 500 }],
        },
      ],
      "points",
      20,
    );
    expect(rows[0]!.label).toBe("OneBig");
    expect(rows[0]!.score).toBe(500);
    expect(rows[1]!.label).toBe("ManySmall");
    expect(rows[1]!.solved).toBe(2);
  });
});

describe("validateProblemResult", () => {
  it("requires solve time for solved problems", () => {
    expect(validateProblemResult({ code: "A", solved: true, attempts: 1, solveTimeMinutes: null })).toContain("solve time");
    expect(validateProblemResult({ code: "A", solved: true, attempts: 1, solveTimeMinutes: 42 })).toBeNull();
  });

  it("rejects negative attempts", () => {
    expect(validateProblemResult({ code: "A", solved: false, attempts: -1 })).toContain("attempts");
  });
});
