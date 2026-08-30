import { describe, expect, it } from "vitest";
import { buildPlan, validatePlan } from "../src/planner/scheduler";
import { PLACEMENT_WEIGHTS } from "../src/planner/scoring";
import { initialV71Facts } from "../src/v71/data";

describe("Cedrus V7.1 modular planner", () => {
  it("uses a transparent placement model whose weights total 100", () => {
    expect(Object.values(PLACEMENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
    const plan = buildPlan(initialV71Facts());
    expect(plan.blocks.every((block) => block.placement?.factors.length === 9)).toBe(true);
    expect(plan.blocks.every((block) => (block.placement?.total ?? 0) <= 100)).toBe(true);
  });

  it("places the Fitness-owned workout only inside its Brooklyn training window", () => {
    const facts = initialV71Facts();
    const plan = buildPlan(facts);
    const workout = plan.blocks.find((block) => block.taskId === "push-workout");

    expect(workout).toBeDefined();
    expect(workout?.day).toBe(0);
    expect(workout?.start).toBeGreaterThanOrEqual(960);
    expect(workout?.end).toBeLessThanOrEqual(1200);
    expect(validatePlan(facts, plan)).toEqual([]);
  });

  it("replans visibly after a high-priority local task is added", () => {
    const facts = initialV71Facts();
    const before = buildPlan(facts);
    facts.tasks.push({
      id: "local-test", title: "Urgent local task", project: "Cedrus", spaceId: "cedrus", totalMinutes: 60, remainingMinutes: 60,
      earliest: facts.now, deadline: { day: 0, minute: 900 }, hardDeadline: true, priority: 5, minChunk: 30, maxChunk: 60, splittable: true,
      preferredWindows: [{ days: [0], start: 702, end: 900, label: "deep-work" }], allowedDays: [0], context: "deep", dependencies: [], energy: "high",
      status: "ready", source: "Cedrus", autoSchedule: true, locked: false, goalImportance: 5, personalPreference: 5,
    });
    const after = buildPlan(facts, { previous: before, reason: "adding an urgent task" });

    expect(after.decisions.some((decision) => ["created", "moved", "risk"].includes(decision.type))).toBe(true);
    expect(validatePlan(facts, after)).toEqual([]);
  });
});
