import { MINUTES_PER_DAY, stamp } from "./time";
import type { FlexibleTask, PlacementFactor, PlacementScore, PlannerFacts, WorkWindow } from "./types";

export const PLACEMENT_WEIGHTS = {
  deadline: 27,
  priority: 18,
  goal: 14,
  time: 10,
  context: 9,
  energy: 7,
  stability: 5,
  balance: 5,
  preference: 5,
} as const;

export interface PlacementCandidate {
  day: number;
  start: number;
  end: number;
  window: WorkWindow;
}

function scaled(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, Math.round(value)));
}

function isPreferred(task: FlexibleTask, candidate: PlacementCandidate): boolean {
  if (task.preferredWindows.length === 0) return true;
  return task.preferredWindows.some((preferred) => {
    const dayMatches = !preferred.days || preferred.days.includes(candidate.day as never);
    return dayMatches && candidate.start < preferred.end && preferred.start < candidate.end;
  });
}

export function scorePlacement(
  facts: PlannerFacts,
  task: FlexibleTask,
  candidate: PlacementCandidate,
): PlacementScore {
  const timeUntilDeadline = Math.max(0, stamp(task.deadline) - stamp(facts.now));
  const urgency = 1 - Math.min(1, timeUntilDeadline / (4 * MINUTES_PER_DAY));
  const preferred = isPreferred(task, candidate);
  const contextFit = candidate.window.contexts.includes(task.context);
  const energyFit = candidate.window.energy === task.energy;
  const goalImportance = task.goalImportance ?? 3;
  const preference = task.personalPreference ?? 3;

  const factors: PlacementFactor[] = [
    { key: "deadline", label: "deadline urgency", score: scaled(15 + urgency * 12, PLACEMENT_WEIGHTS.deadline), weight: PLACEMENT_WEIGHTS.deadline },
    { key: "priority", label: "priority", score: scaled((task.priority / 5) * PLACEMENT_WEIGHTS.priority, PLACEMENT_WEIGHTS.priority), weight: PLACEMENT_WEIGHTS.priority },
    { key: "goal", label: "goal importance", score: scaled((goalImportance / 5) * PLACEMENT_WEIGHTS.goal, PLACEMENT_WEIGHTS.goal), weight: PLACEMENT_WEIGHTS.goal },
    { key: "time", label: "time-of-day fit", score: preferred ? PLACEMENT_WEIGHTS.time : 3, weight: PLACEMENT_WEIGHTS.time },
    { key: "context", label: "context continuity", score: contextFit ? PLACEMENT_WEIGHTS.context : 3, weight: PLACEMENT_WEIGHTS.context },
    { key: "energy", label: "energy fit", score: energyFit ? PLACEMENT_WEIGHTS.energy : 3, weight: PLACEMENT_WEIGHTS.energy },
    { key: "stability", label: "schedule stability", score: task.locked ? PLACEMENT_WEIGHTS.stability : 4, weight: PLACEMENT_WEIGHTS.stability },
    { key: "balance", label: "space balance", score: 4, weight: PLACEMENT_WEIGHTS.balance },
    { key: "preference", label: "personal preference", score: scaled((preference / 5) * PLACEMENT_WEIGHTS.preference, PLACEMENT_WEIGHTS.preference), weight: PLACEMENT_WEIGHTS.preference },
  ];

  const reasons = [
    task.priority >= 4 ? "high priority" : `${task.priority}/5 priority`,
    task.hardDeadline ? "must finish before its hard deadline" : "protected before its deadline",
    contextFit ? `continues ${task.context} context` : `uses the available ${candidate.window.label.toLowerCase()}`,
    preferred ? task.preferredWindows[0]?.label ? `inside preferred ${task.preferredWindows[0].label.toLowerCase()} time` : "inside a preferred work window" : "best legal opening",
    energyFit ? `${task.energy}-energy match` : "acceptable energy match",
  ];

  return {
    total: factors.reduce((sum, factor) => sum + factor.score, 0),
    factors,
    reasons,
  };
}
