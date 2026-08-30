import {
  MINUTES_PER_DAY,
  formatDuration,
  formatMinute,
  formatPoint,
  pointFromStamp,
  stamp,
} from "./time";
import { scorePlacement } from "./scoring";
import type {
  DayIndex,
  FlexibleTask,
  PlanDecision,
  PlanResult,
  PlannerFacts,
  PlannerOptions,
  ScheduledBlock,
  TimePoint,
  WorkWindow,
} from "./types";

interface Interval {
  day: DayIndex;
  start: number;
  end: number;
  window: WorkWindow;
}

interface TaskState {
  task: FlexibleTask;
  effectiveDeadline: number;
  earliest: number;
  remaining: number;
  blocks: ScheduledBlock[];
  processed: boolean;
  completed: boolean;
  reason?: string;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function sortedBlocks(blocks: ScheduledBlock[]): ScheduledBlock[] {
  return [...blocks].sort((a, b) => a.day - b.day || a.start - b.start || a.id.localeCompare(b.id));
}

function subtractOccupied(window: WorkWindow, occupied: Array<{ day: DayIndex; start: number; end: number }>): Interval[] {
  const blockers = occupied
    .filter((item) => item.day === window.day && overlap(window.start, window.end, item.start, item.end))
    .map((item) => ({ start: Math.max(window.start, item.start), end: Math.min(window.end, item.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const blocker of blockers) {
    const last = merged.at(-1);
    if (last && blocker.start <= last.end) {
      last.end = Math.max(last.end, blocker.end);
    } else {
      merged.push({ ...blocker });
    }
  }

  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const blocker of merged) {
    if (blocker.start > cursor) gaps.push({ day: window.day, start: cursor, end: blocker.start, window });
    cursor = Math.max(cursor, blocker.end);
  }
  if (cursor < window.end) gaps.push({ day: window.day, start: cursor, end: window.end, window });
  return gaps;
}

function isPreferred(task: FlexibleTask, interval: Interval): boolean {
  if (task.preferredWindows.length === 0) return true;
  return task.preferredWindows.some((preferred) => {
    const dayMatches = !preferred.days || preferred.days.includes(interval.day);
    return dayMatches && overlap(interval.start, interval.end, preferred.start, preferred.end);
  });
}

function candidateIntervals(
  facts: PlannerFacts,
  task: FlexibleTask,
  earliestValue: number,
  deadlineValue: number,
  occupied: Array<{ day: DayIndex; start: number; end: number }>,
): Interval[] {
  const candidates = facts.workWindows
    .filter((window) => facts.planningDays.includes(window.day))
    .filter((window) => task.allowedDays.length === 0 || task.allowedDays.includes(window.day))
    .filter((window) => !task.requiredLocation || window.location === task.requiredLocation)
    .flatMap((window) => subtractOccupied(window, occupied))
    .map((interval) => {
      const intervalStart = interval.day * MINUTES_PER_DAY + interval.start;
      const intervalEnd = interval.day * MINUTES_PER_DAY + interval.end;
      const startValue = Math.max(intervalStart, earliestValue, stamp(facts.now));
      const endValue = Math.min(intervalEnd, deadlineValue);
      if (endValue <= startValue) return null;
      return {
        ...interval,
        day: Math.floor(startValue / MINUTES_PER_DAY) as DayIndex,
        start: startValue % MINUTES_PER_DAY,
        end: endValue % MINUTES_PER_DAY || (endValue > startValue ? MINUTES_PER_DAY : 0),
      };
    })
    .filter((interval): interval is Interval => Boolean(interval && interval.end > interval.start));

  return candidates.sort((a, b) => {
    const aScore = scorePlacement(facts, task, a).total;
    const bScore = scorePlacement(facts, task, b).total;
    const aPreferred = isPreferred(task, a) ? 0 : 1;
    const bPreferred = isPreferred(task, b) ? 0 : 1;
    return (
      bScore - aScore ||
      aPreferred - bPreferred ||
      a.day - b.day ||
      a.start - b.start
    );
  });
}

function chooseChunk(
  task: FlexibleTask,
  remaining: number,
  available: number,
  allowSmallUnscheduledRemainder: boolean,
): number {
  if (!task.splittable) return available >= remaining ? remaining : 0;
  if (remaining <= available && remaining <= task.maxChunk) return remaining;
  if (available < task.minChunk) return 0;

  let chunk = Math.min(task.maxChunk, available, remaining);
  const remainder = remaining - chunk;

  if (remainder > 0 && remainder < task.minChunk) {
    if (allowSmallUnscheduledRemainder) return chunk;
    const adjustment = task.minChunk - remainder;
    if (chunk - adjustment >= task.minChunk) {
      chunk -= adjustment;
    } else {
      return 0;
    }
  }

  return chunk;
}

function inheritedDeadlines(tasks: FlexibleTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dependents = new Map<string, FlexibleTask[]>();
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      const list = dependents.get(dependency) ?? [];
      list.push(task);
      dependents.set(dependency, list);
    }
  }

  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (taskId: string): number => {
    if (memo.has(taskId)) return memo.get(taskId)!;
    const task = byId.get(taskId);
    if (!task) return Number.POSITIVE_INFINITY;
    if (visiting.has(taskId)) return stamp(task.deadline);
    visiting.add(taskId);

    let value = stamp(task.deadline);
    for (const dependent of dependents.get(taskId) ?? []) {
      const dependentDeadline = visit(dependent.id);
      value = Math.min(value, dependentDeadline - dependent.remainingMinutes);
    }

    visiting.delete(taskId);
    memo.set(taskId, value);
    return value;
  };

  for (const task of tasks) visit(task.id);
  return memo;
}

function pressure(state: TaskState): number {
  const usableSpan = Math.max(1, state.effectiveDeadline - state.earliest);
  const slack = Math.max(-1440, usableSpan - state.remaining);
  const riskPressure = Math.max(0, 5200 - slack * 2.5);
  const startedBoost = state.task.status === "in-progress" ? 700 : 0;
  return state.task.priority * 1000 + riskPressure + startedBoost;
}

function allocateTask(
  facts: PlannerFacts,
  state: TaskState,
  occupied: Array<{ day: DayIndex; start: number; end: number }>,
): void {
  while (state.remaining > 0) {
    const intervals = candidateIntervals(
      facts,
      state.task,
      state.earliest,
      state.effectiveDeadline,
      occupied,
    );
    let placed = false;

    for (const [index, interval] of intervals.entries()) {
      const available = interval.end - interval.start;
      const canDeferWholeRemainder = intervals.slice(index + 1).some((later) =>
        state.remaining <= state.task.maxChunk && later.end - later.start >= state.remaining,
      );
      const chunk = chooseChunk(
        state.task,
        state.remaining,
        available,
        !canDeferWholeRemainder,
      );
      if (chunk <= 0) continue;

      const block: ScheduledBlock = {
        id: `${state.task.id}:${state.blocks.length}`,
        taskId: state.task.id,
        title: state.task.title,
        project: state.task.project,
        day: interval.day,
        start: interval.start,
        end: interval.start + chunk,
        chunkIndex: state.blocks.length,
        locked: state.task.locked,
        source: state.task.source,
        context: state.task.context,
        energy: state.task.energy,
        placement: scorePlacement(facts, state.task, {
          day: interval.day,
          start: interval.start,
          end: interval.start + chunk,
          window: interval.window,
        }),
      };

      state.blocks.push(block);
      state.remaining -= chunk;
      occupied.push({ day: block.day, start: block.start, end: block.end });
      placed = true;
      break;
    }

    if (!placed) break;
  }

  state.completed = state.remaining === 0;
  if (!state.completed) {
    state.reason = state.blocks.length > 0 ? "Only part of the work fits before its deadline." : "No legal work window remains before its deadline.";
  }
}

function decisionLog(
  facts: PlannerFacts,
  blocks: ScheduledBlock[],
  risks: PlanResult["risks"],
  previous: PlanResult | undefined,
  reason: string | undefined,
): { decisions: PlanDecision[]; movedBlocks: number } {
  if (!previous) {
    if (risks.length > 0) {
      return {
        movedBlocks: 0,
        decisions: risks.map((risk) => ({
          id: `risk:${risk.taskId}`,
          type: "risk" as const,
          headline: `${risk.title} is at risk`,
          detail: risk.detail,
          taskId: risk.taskId,
        })),
      };
    }
    return {
      movedBlocks: 0,
      decisions: [{
        id: "stable:initial",
        type: "stable",
        headline: blocks.length ? "The plan fits." : "Nothing needs placing.",
        detail: blocks.length
          ? `${blocks.length} work block${blocks.length === 1 ? "" : "s"} fit around every fixed commitment.`
          : "Cedrus is holding the horizon open.",
      }],
    };
  }

  const decisions: PlanDecision[] = [];
  const previousById = new Map(previous.blocks.map((block) => [block.id, block]));
  const nextById = new Map(blocks.map((block) => [block.id, block]));
  let movedBlocks = 0;

  for (const block of blocks) {
    const before = previousById.get(block.id);
    if (!before) {
      decisions.push({
        id: `created:${block.id}`,
        type: "created",
        headline: `${block.title} gained a work block`,
        detail: `${formatPoint({ day: block.day, minute: block.start }, facts.dayLabels)} for ${formatDuration(block.end - block.start)}${reason ? ` after ${reason}` : ""}.`,
        taskId: block.taskId,
      });
      continue;
    }
    if (before.day !== block.day || before.start !== block.start || before.end !== block.end) {
      movedBlocks += 1;
      decisions.push({
        id: `moved:${block.id}`,
        type: "moved",
        headline: `${block.title} moved`,
        detail: `${formatPoint({ day: before.day, minute: before.start }, facts.dayLabels)} → ${formatPoint({ day: block.day, minute: block.start }, facts.dayLabels)}${reason ? ` because ${reason}` : ""}.`,
        taskId: block.taskId,
      });
    }
  }

  for (const block of previous.blocks) {
    if (!nextById.has(block.id)) {
      decisions.push({
        id: `removed:${block.id}`,
        type: "removed",
        headline: `${block.title} left the plan`,
        detail: reason ? `The block was removed because ${reason}.` : "The work no longer needs this block.",
        taskId: block.taskId,
      });
    }
  }

  for (const risk of risks) {
    decisions.push({
      id: `risk:${risk.taskId}`,
      type: "risk",
      headline: `${risk.title} no longer fits`,
      detail: risk.detail,
      taskId: risk.taskId,
    });
  }

  if (decisions.length === 0) {
    decisions.push({
      id: "stable:unchanged",
      type: "stable",
      headline: "The plan held.",
      detail: reason ? `Cedrus absorbed ${reason} without moving any work.` : "No work needed to move.",
    });
  }

  return { decisions, movedBlocks };
}

export function buildPlan(facts: PlannerFacts, options: PlannerOptions = {}): PlanResult {
  const deadlineMap = inheritedDeadlines(facts.tasks);
  const states = new Map<string, TaskState>();
  const completionByTask: Record<string, TimePoint | undefined> = {};
  const occupied: Array<{ day: DayIndex; start: number; end: number }> = facts.fixedEvents.map((event) => ({
    day: event.day,
    start: event.start,
    end: event.end,
  }));
  const lockedBlocks = facts.lockedBlocks ?? [];
  for (const block of lockedBlocks) occupied.push({ day: block.day, start: block.start, end: block.end });

  for (const task of facts.tasks) {
    const done = task.status === "done" || task.remainingMinutes <= 0;
    states.set(task.id, {
      task,
      effectiveDeadline: deadlineMap.get(task.id) ?? stamp(task.deadline),
      earliest: stamp(task.earliest),
      remaining: done ? 0 : task.remainingMinutes,
      blocks: [],
      processed: done || !task.autoSchedule,
      completed: done,
      reason: !task.autoSchedule && !done ? "Auto-scheduling is paused for this task." : undefined,
    });
    if (done) completionByTask[task.id] = task.earliest;
  }

  while ([...states.values()].some((state) => !state.processed)) {
    const eligible = [...states.values()]
      .filter((state) => !state.processed)
      .filter((state) => state.task.dependencies.every((id) => states.get(id)?.completed ?? true))
      .map((state) => {
        const dependencyEnds = state.task.dependencies
          .map((id) => completionByTask[id])
          .filter((point): point is TimePoint => Boolean(point))
          .map(stamp);
        state.earliest = Math.max(state.earliest, ...dependencyEnds, stamp(facts.now));
        return state;
      })
      .sort((a, b) => pressure(b) - pressure(a) || a.effectiveDeadline - b.effectiveDeadline || a.task.id.localeCompare(b.task.id));

    if (eligible.length === 0) break;
    const state = eligible[0];
    allocateTask(facts, state, occupied);
    state.processed = true;
    if (state.completed) {
      const last = state.blocks.at(-1);
      completionByTask[state.task.id] = last
        ? { day: last.day, minute: last.end }
        : state.task.earliest;
    }
  }

  for (const state of states.values()) {
    if (!state.processed) {
      state.processed = true;
      state.reason = "A dependency does not finish in time.";
    }
  }

  const blocks = sortedBlocks([
    ...lockedBlocks,
    ...[...states.values()].flatMap((state) => state.blocks),
  ]);
  const unscheduled = [...states.values()]
    .filter((state) => state.remaining > 0)
    .map((state) => ({
      taskId: state.task.id,
      title: state.task.title,
      remainingMinutes: state.remaining,
      reason: state.reason ?? "The work is not scheduled.",
    }));
  const risks = unscheduled
    .filter((item) => states.get(item.taskId)?.task.autoSchedule)
    .map((item) => {
      const task = states.get(item.taskId)!.task;
      return {
        id: `risk:${task.id}`,
        taskId: task.id,
        title: task.title,
        severity: item.remainingMinutes >= task.minChunk ? "high" as const : "watch" as const,
        missingMinutes: item.remainingMinutes,
        detail: `${formatDuration(item.remainingMinutes)} cannot be placed before ${formatPoint(task.deadline, facts.dayLabels)}. ${item.reason}`,
      };
    });
  const log = decisionLog(facts, blocks, risks, options.previous, options.reason);

  return {
    blocks,
    unscheduled,
    risks,
    decisions: log.decisions,
    completionByTask,
    score: {
      hardViolations: 0,
      unplannedMinutes: unscheduled.reduce((total, item) => total + item.remainingMinutes, 0),
      fragments: blocks.length,
      movedBlocks: log.movedBlocks,
    },
  };
}

export function validatePlan(facts: PlannerFacts, plan: PlanResult): string[] {
  const errors: string[] = [];
  const all = [
    ...facts.fixedEvents.map((event) => ({ id: event.id, title: event.title, day: event.day, start: event.start, end: event.end })),
    ...plan.blocks,
  ];
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      if (a.day === b.day && overlap(a.start, a.end, b.start, b.end)) {
        errors.push(`${a.title} overlaps ${b.title}.`);
      }
    }
  }

  for (const block of plan.blocks) {
    const task = facts.tasks.find((item) => item.id === block.taskId);
    if (!task) continue;
    if (stamp({ day: block.day, minute: block.start }) < stamp(task.earliest)) {
      errors.push(`${block.title} starts before its earliest time.`);
    }
    if (stamp({ day: block.day, minute: block.end }) > stamp(task.deadline)) {
      errors.push(`${block.title} ends after its deadline.`);
    }
  }

  return errors;
}

export function describeBlock(block: ScheduledBlock, labels: string[]): string {
  return `${labels[block.day]} ${formatMinute(block.start)}–${formatMinute(block.end)}`;
}

export function pointAt(block: ScheduledBlock): TimePoint {
  return pointFromStamp(block.day * MINUTES_PER_DAY + block.start);
}
