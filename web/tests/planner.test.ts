import { describe, expect, it } from "vitest";
import { buildPlan, validatePlan } from "../src/planner/scheduler";
import { baseFacts, getScenario } from "../src/scenarios";

describe("Cedrus deterministic planner", () => {
  it("places the Clockout model around fixed events and unlocks the memo", () => {
    const plan = buildPlan(baseFacts);
    const model = plan.blocks.filter((block) => block.taskId === "clockout-model");
    const memo = plan.blocks.filter((block) => block.taskId === "ic-memo");

    expect(model.map((block) => [block.day, block.start, block.end])).toEqual([
      [0, 702, 750],
      [0, 795, 837],
    ]);
    expect(memo.map((block) => [block.day, block.start, block.end])).toEqual([
      [0, 885, 960],
      [0, 1050, 1095],
    ]);
    expect(plan.risks).toEqual([]);
    expect(validatePlan(baseFacts, plan)).toEqual([]);
  });

  it("moves flexible work when a new fixed meeting arrives", () => {
    const facts = getScenario("conflict").facts;
    const plan = buildPlan(facts, { previous: buildPlan(baseFacts), reason: "a meeting arrived" });

    expect(validatePlan(facts, plan)).toEqual([]);
    expect(plan.score.movedBlocks).toBeGreaterThan(0);
    expect(plan.decisions.some((decision) => decision.type === "moved")).toBe(true);
  });

  it("leaves work unassigned when a moved deadline is impossible", () => {
    const facts = getScenario("deadline-risk").facts;
    const plan = buildPlan(facts);
    const risk = plan.risks.find((item) => item.taskId === "ic-memo");

    expect(risk?.missingMinutes).toBe(15);
    expect(plan.score.hardViolations).toBe(0);
    expect(validatePlan(facts, plan)).toEqual([]);
  });

  it("unblocks the memo after an agent completes the model", () => {
    const facts = getScenario("agent-completion").facts;
    const plan = buildPlan(facts);
    const model = plan.blocks.filter((block) => block.taskId === "clockout-model");
    const memo = plan.blocks.filter((block) => block.taskId === "ic-memo");

    expect(model).toHaveLength(0);
    expect(memo[0]).toMatchObject({ day: 0, start: 702 });
    expect(validatePlan(facts, plan)).toEqual([]);
  });

  it("is deterministic", () => {
    expect(buildPlan(baseFacts)).toEqual(buildPlan(structuredClone(baseFacts)));
  });
});

