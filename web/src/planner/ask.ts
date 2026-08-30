import type { FlexibleTask, PlannerFacts } from "./types";
import { buildPlan } from "./scheduler";
import { formatDuration, formatPoint } from "./time";

export interface AskResult {
  kind: "answer" | "mutation" | "clarify";
  title: string;
  detail: string;
  facts?: PlannerFacts;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function durationFromText(text: string): number | undefined {
  const minuteMatch = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
  if (/\btwo hours?\b/i.test(text)) return 120;
  if (/\ban hour\b/i.test(text)) return 60;
  return undefined;
}

function requestedDay(text: string): 0 | 1 | 2 | 3 {
  if (/\btomorrow\b/i.test(text)) return 1;
  if (/\bwednesday\b/i.test(text)) return 2;
  if (/\bthursday\b/i.test(text)) return 3;
  return 0;
}

function titleFromText(text: string): string {
  const forMatch = text.match(/(?:for|on)\s+(.+?)(?:\s+(?:today|tomorrow|wednesday|thursday))?$/i);
  if (forMatch?.[1]) return forMatch[1].replace(/[.?!]$/, "").trim();
  return "New focus block";
}

export function interpretAsk(input: string, currentFacts: PlannerFacts): AskResult {
  const text = input.trim();
  const lower = text.toLowerCase();
  const plan = buildPlan(currentFacts);

  if (!text) {
    return {
      kind: "clarify",
      title: "Ask about the plan or add work.",
      detail: "Try “give me two hours for Cedrus tomorrow” or “why did the memo move?”",
    };
  }

  if (lower.includes("why") && (lower.includes("move") || lower.includes("memo"))) {
    const decision = plan.decisions.find((item) => item.taskId === "ic-memo") ?? plan.decisions[0];
    return {
      kind: "answer",
      title: decision?.headline ?? "The memo follows the model.",
      detail: decision?.detail ?? "The memo cannot begin until the Clockout model is complete, so fixed events and the dependency determine its first legal window.",
    };
  }

  if (/what should i do|what now|start next/i.test(lower)) {
    const next = plan.blocks.find((block) => block.day === currentFacts.now.day && block.end > currentFacts.now.minute);
    if (!next) {
      return { kind: "answer", title: "Nothing is urgent.", detail: "The horizon is open; Cedrus has no work that needs your attention now." };
    }
    return {
      kind: "answer",
      title: next.title,
      detail: `${formatPoint({ day: next.day, minute: next.start }, currentFacts.dayLabels)} for ${formatDuration(next.end - next.start)}. It is the highest-pressure legal block in the current plan.`,
    };
  }

  if (/what does tomorrow|tomorrow look|summari[sz]e tomorrow/i.test(lower)) {
    const tomorrowBlocks = plan.blocks.filter((block) => block.day === 1);
    const tomorrowFixed = currentFacts.fixedEvents.filter((event) => event.day === 1);
    return {
      kind: "answer",
      title: tomorrowBlocks.length || tomorrowFixed.length ? "Tomorrow has shape." : "Tomorrow is open.",
      detail: `${tomorrowFixed.length} fixed commitment${tomorrowFixed.length === 1 ? "" : "s"}, ${tomorrowBlocks.length} flexible work block${tomorrowBlocks.length === 1 ? "" : "s"}, and ${plan.risks.length ? `${plan.risks.length} active risk` : "no active risk"}.`,
    };
  }

  if (/finish(?:ed)? (?:the )?(?:clockout )?model|model (?:is )?done/i.test(lower)) {
    const facts = clone(currentFacts);
    const model = facts.tasks.find((task) => task.id === "clockout-model");
    if (!model) return { kind: "clarify", title: "I could not find that task.", detail: "Name the work you completed." };
    model.remainingMinutes = 0;
    model.status = "done";
    return {
      kind: "mutation",
      title: "Clockout model completed.",
      detail: "The IC memo is unblocked and the plan has been recalculated.",
      facts,
    };
  }

  if (/move gym later|gym later/i.test(lower)) {
    const facts = clone(currentFacts);
    const gym = facts.fixedEvents.find((event) => event.id === "gym");
    if (!gym) return { kind: "clarify", title: "Gym is not in this plan.", detail: "Add a fixed Gym commitment first." };
    gym.start = 1080;
    gym.end = 1140;
    return {
      kind: "mutation",
      title: "Gym moved to 6:00pm.",
      detail: "Cedrus recovered the 4:30–6:00 window and recalculated the memo.",
      facts,
    };
  }

  const duration = durationFromText(text);
  if (duration && /give me|block|make time|schedule|need/i.test(lower)) {
    const facts = clone(currentFacts);
    const day = requestedDay(text);
    const title = titleFromText(text);
    const id = `ask-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${day}`;
    const task: FlexibleTask = {
      id,
      title,
      project: /cedrus/i.test(title) ? "Cedrus" : "Captured",
      totalMinutes: duration,
      remainingMinutes: duration,
      earliest: { day, minute: day === 0 ? currentFacts.now.minute : 540 },
      deadline: { day, minute: 1080 },
      priority: 3,
      minChunk: Math.min(45, duration),
      maxChunk: Math.min(90, duration),
      splittable: duration > 45,
      preferredWindows: [],
      allowedDays: [day],
      context: "deep",
      dependencies: [],
      energy: "medium",
      location: "Studio",
      status: "ready",
      source: "Ask",
      sourceRef: `ask:${Date.now()}`,
      autoSchedule: true,
      locked: false,
    };
    facts.tasks = [...facts.tasks.filter((item) => item.id !== id), task];
    const next = buildPlan(facts);
    const block = next.blocks.find((item) => item.taskId === id);
    return {
      kind: "mutation",
      title: block ? `${title} fits.` : `${title} needs a tradeoff.`,
      detail: block
        ? `${formatDuration(duration)} begins ${formatPoint({ day: block.day, minute: block.start }, facts.dayLabels)}.`
        : `${formatDuration(duration)} could not fit before the requested boundary. Open Plan to adjust it.`,
      facts,
    };
  }

  return {
    kind: "clarify",
    title: "I need one planning detail.",
    detail: "Include a duration and a boundary, for example: “block 90 minutes for the website tomorrow.”",
  };
}

