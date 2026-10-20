import { describe, expect, it } from "vitest";
import { completionProblems, emptyEvaluationState, rankingProblems, scoreSum } from "@/lib/evaluation";
import { presentationLabels } from "@/lib/ordering";
import { completeState } from "./helpers";

const labels = presentationLabels(8);

describe("ranking validation", () => {
  it("accepts a strict permutation", () => {
    expect(rankingProblems(labels, ["H", "G", "F", "E", "D", "C", "B", "A"])).toEqual([]);
  });
  it("rejects missing, duplicate and unknown entries", () => {
    expect(rankingProblems(labels, null)).not.toEqual([]);
    expect(rankingProblems(labels, ["A", "B", "C", "D", "E", "F", "G"]).join()).toMatch(/Missing/);
    expect(rankingProblems(labels, ["A", "A", "C", "D", "E", "F", "G", "H"]).join()).toMatch(/more than once/);
    expect(rankingProblems(labels, ["A", "B", "C", "D", "E", "F", "G", "Z"]).join()).toMatch(/Unknown/);
  });
});

describe("completion", () => {
  it("requires an explicit confirmation of the ranking", () => {
    const s = completeState();
    s.rankingConfirmed = false;
    expect(completionProblems(labels, s, { rubricMode: "required", errorMode: "optional" })).toContain(
      "Ranking has not been confirmed.",
    );
  });

  it("requires all 40 rubric scores only when rubric mode is required", () => {
    const s = completeState();
    delete s.responses.C.scores.verifiability;
    expect(completionProblems(labels, s, { rubricMode: "required", errorMode: "off" }).join()).toMatch(/Response C/);
    expect(completionProblems(labels, s, { rubricMode: "optional", errorMode: "off" })).toEqual([]);
    expect(completionProblems(labels, s, { rubricMode: "off", errorMode: "off" })).toEqual([]);
  });

  it("does not derive the ranking from rubric scores", () => {
    const s = completeState();
    // Response A has the lowest accuracy but the ranking puts H first; both are accepted as-is.
    expect(scoreSum(s.responses.A)).toBe(12);
    expect(completionProblems(labels, s, { rubricMode: "required", errorMode: "optional" })).toEqual([]);
    expect(s.ranking![0]).toBe("H");
  });

  it("starts empty", () => {
    expect(emptyEvaluationState(labels).ranking).toBeNull();
  });
});
