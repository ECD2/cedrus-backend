import { buildPlan } from "../planner/scheduler";
import type {
  DayIndex,
  FixedEvent,
  FlexibleTask,
  PlannerFacts,
  ScenarioDefinition,
} from "../planner/types";

const clone = <T,>(value: T): T => structuredClone(value);

const workWindows = ([
  [0, 702, 1110, "Monday"],
  [1, 540, 1110, "Tuesday"],
  [2, 540, 1200, "Wednesday"],
  [3, 540, 1110, "Thursday"],
] as const).map(([day, start, end, label]) => ({
  id: `work-${day}`,
  day,
  start,
  end,
  label: `${label} working range`,
  contexts: ["deep", "creative", "admin", "personal", "calls"],
  energy: day === 0 ? "high" as const : "medium" as const,
  location: "Studio",
}));

const fixedEvents: FixedEvent[] = [
  {
    id: "lunch",
    title: "Lunch with Maya",
    day: 0,
    start: 750,
    end: 795,
    kind: "external-fixed",
    source: "Google Calendar",
    sourceRef: "gcal:lunch-0817",
    location: "Lilia",
    locked: true,
    tone: "stone",
  },
  {
    id: "nth-ai",
    title: "Nth AI",
    day: 0,
    start: 840,
    end: 885,
    kind: "external-fixed",
    source: "Google Calendar",
    sourceRef: "gcal:nth-ai-0817",
    location: "Meet",
    locked: true,
    tone: "water",
  },
  {
    id: "gym",
    title: "Gym",
    day: 0,
    start: 990,
    end: 1050,
    kind: "cedrus-fixed",
    source: "Cedrus",
    sourceRef: "cedrus:gym-monday",
    location: "Brooklyn",
    locked: true,
    tone: "cedar",
  },
  {
    id: "ascendo-review",
    title: "Ascendo partner review",
    day: 1,
    start: 660,
    end: 720,
    kind: "external-fixed",
    source: "Outlook",
    sourceRef: "outlook:ascendo-review",
    location: "Zoom",
    locked: true,
    tone: "stone",
  },
  {
    id: "advisor",
    title: "Advisor call",
    day: 2,
    start: 930,
    end: 990,
    kind: "external-fixed",
    source: "Google Calendar",
    sourceRef: "gcal:advisor-wed",
    location: "Phone",
    locked: true,
    tone: "water",
  },
];

const tasks: FlexibleTask[] = [
  {
    id: "clockout-model",
    title: "Finish Clockout model",
    project: "Clockout",
    totalMinutes: 90,
    remainingMinutes: 90,
    earliest: { day: 0, minute: 702 },
    deadline: { day: 2, minute: 960 },
    priority: 5,
    minChunk: 30,
    maxChunk: 60,
    splittable: true,
    preferredWindows: [{ days: [0, 1, 2], start: 540, end: 960, label: "Deep work" }],
    allowedDays: [0, 1, 2],
    context: "deep",
    dependencies: [],
    energy: "high",
    location: "Mac",
    status: "in-progress",
    source: "Cedrus",
    sourceRef: "cedrus:clockout-model",
    autoSchedule: true,
    locked: false,
    note: "Model pass and verification.",
  },
  {
    id: "ic-memo",
    title: "Draft IC memo",
    project: "Clockout",
    totalMinutes: 120,
    remainingMinutes: 120,
    earliest: { day: 0, minute: 702 },
    deadline: { day: 2, minute: 1200 },
    priority: 4,
    minChunk: 45,
    maxChunk: 75,
    splittable: true,
    preferredWindows: [{ days: [0, 1, 2], start: 780, end: 1200, label: "Writing" }],
    allowedDays: [0, 1, 2],
    context: "creative",
    dependencies: ["clockout-model"],
    energy: "high",
    location: "Mac",
    status: "waiting",
    source: "Cedrus",
    sourceRef: "cedrus:ic-memo",
    autoSchedule: true,
    locked: false,
    note: "Cannot begin until the model is complete.",
  },
  {
    id: "cedrus-copy",
    title: "Write Cedrus concept note",
    project: "Cedrus",
    totalMinutes: 60,
    remainingMinutes: 60,
    earliest: { day: 1, minute: 540 },
    deadline: { day: 1, minute: 1020 },
    priority: 3,
    minChunk: 30,
    maxChunk: 60,
    splittable: true,
    preferredWindows: [{ days: [1], start: 780, end: 1020 }],
    allowedDays: [1],
    context: "creative",
    dependencies: [],
    energy: "medium",
    location: "Studio",
    status: "ready",
    source: "Cedrus",
    autoSchedule: true,
    locked: false,
  },
  {
    id: "filing",
    title: "File studio receipt batch",
    project: "Personal",
    totalMinutes: 30,
    remainingMinutes: 30,
    earliest: { day: 1, minute: 540 },
    deadline: { day: 3, minute: 1020 },
    priority: 2,
    minChunk: 30,
    maxChunk: 30,
    splittable: false,
    preferredWindows: [{ start: 960, end: 1110 }],
    allowedDays: [1, 2, 3],
    context: "admin",
    dependencies: [],
    energy: "low",
    location: "Mac",
    status: "ready",
    source: "Reminders",
    sourceRef: "reminders:filing",
    autoSchedule: true,
    locked: false,
  },
];

export const baseFacts: PlannerFacts = {
  now: { day: 0, minute: 702 },
  dayLabels: ["Mon 17", "Tue 18", "Wed 19", "Thu 20", "Fri 21", "Sat 22", "Sun 23"],
  planningDays: [0, 1, 2, 3],
  workWindows,
  fixedEvents,
  tasks,
};

function withMeeting(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.fixedEvents.push({
    id: "new-meeting",
    title: "Founder reference call",
    day: 0,
    start: 915,
    end: 975,
    kind: "external-fixed",
    source: "Google Calendar",
    sourceRef: "gcal:new-reference-call",
    location: "Meet",
    locked: true,
    tone: "warning",
  });
  return facts;
}

function withoutLunch(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.fixedEvents = facts.fixedEvents.filter((event) => event.id !== "lunch");
  return facts;
}

function withUrgentAscendo(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.tasks.push({
    id: "urgent-ascendo",
    title: "Resolve Ascendo term note",
    project: "Ascendo",
    totalMinutes: 45,
    remainingMinutes: 45,
    earliest: { day: 0, minute: 702 },
    deadline: { day: 0, minute: 900 },
    priority: 5,
    minChunk: 30,
    maxChunk: 45,
    splittable: false,
    preferredWindows: [],
    allowedDays: [0],
    context: "deep",
    dependencies: [],
    energy: "high",
    location: "Mac",
    status: "ready",
    source: "Linear",
    sourceRef: "linear:ASC-91",
    autoSchedule: true,
    locked: false,
  });
  return facts;
}

function deadlineRisk(): PlannerFacts {
  const facts = clone(baseFacts);
  const memo = facts.tasks.find((task) => task.id === "ic-memo")!;
  memo.deadline = { day: 0, minute: 1050 };
  memo.priority = 5;
  memo.maxChunk = 105;
  return facts;
}

function agentCompletion(): PlannerFacts {
  const facts = clone(baseFacts);
  const model = facts.tasks.find((task) => task.id === "clockout-model")!;
  model.remainingMinutes = 0;
  model.status = "done";
  model.note = "Completed by the Clockout model agent at 11:39am.";
  const memo = facts.tasks.find((task) => task.id === "ic-memo")!;
  memo.preferredWindows = [];
  return facts;
}

function macOffline(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.fixedEvents.push({
    id: "mac-asleep",
    title: "Mac asleep",
    day: 0,
    start: 702,
    end: 810,
    kind: "cedrus-fixed",
    source: "Cedrus device bridge",
    location: "Mac",
    locked: true,
    tone: "warning",
  });
  return facts;
}

function overrun(): PlannerFacts {
  const facts = clone(baseFacts);
  const model = facts.tasks.find((task) => task.id === "clockout-model")!;
  model.remainingMinutes = 120;
  model.totalMinutes = 120;
  model.note = "The validation pass added 30 minutes.";
  return facts;
}

function reentry(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.now = { day: 1, minute: 555 };
  const model = facts.tasks.find((task) => task.id === "clockout-model")!;
  model.remainingMinutes = 0;
  model.status = "done";
  const memo = facts.tasks.find((task) => task.id === "ic-memo")!;
  memo.remainingMinutes = 75;
  memo.status = "in-progress";
  facts.fixedEvents = facts.fixedEvents.map((event) =>
    event.id === "ascendo-review" ? { ...event, start: 720, end: 780 } : event,
  );
  return facts;
}

function chaotic(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.fixedEvents.push(
    {
      id: "chaos-1",
      title: "Portfolio emergency",
      day: 0,
      start: 900,
      end: 975,
      kind: "external-fixed",
      source: "Outlook",
      locked: true,
      tone: "warning",
    },
    {
      id: "chaos-2",
      title: "Dentist hold",
      day: 1,
      start: 540,
      end: 660,
      kind: "external-fixed",
      source: "Google Calendar",
      locked: true,
      tone: "stone",
    },
  );
  facts.tasks.push({
    id: "chaos-urgent",
    title: "Ship board correction",
    project: "Ascendo",
    totalMinutes: 180,
    remainingMinutes: 180,
    earliest: { day: 0, minute: 702 },
    deadline: { day: 0, minute: 990 },
    priority: 5,
    minChunk: 45,
    maxChunk: 90,
    splittable: true,
    preferredWindows: [],
    allowedDays: [0],
    context: "deep",
    dependencies: [],
    energy: "high",
    location: "Mac",
    status: "ready",
    source: "Linear",
    autoSchedule: true,
    locked: false,
  });
  return facts;
}

function empty(): PlannerFacts {
  const facts = clone(baseFacts);
  facts.now = { day: 0, minute: 600 };
  facts.tasks = [];
  facts.fixedEvents = [];
  return facts;
}

export const scenarios: ScenarioDefinition[] = [
  {
    id: "normal",
    label: "Normal day",
    group: "core",
    facts: clone(baseFacts),
    presentation: {
      eyebrow: "Current focus · 48 minutes to the next boundary",
      headline: "Finish the Clockout model.",
      detail: "Cedrus protected two clean passes around lunch. The IC memo unlocks when the model is done.",
      tone: "focus",
      prompt: "What should I do now?",
    },
  },
  {
    id: "empty",
    label: "Quiet day",
    group: "core",
    facts: empty(),
    presentation: {
      eyebrow: "Nothing is asking for you",
      headline: "The day is open.",
      detail: "Cedrus will stay quiet until a commitment, deadline, or useful suggestion appears.",
      tone: "quiet",
      prompt: "Give me two hours for Cedrus tomorrow",
    },
  },
  {
    id: "chaotic",
    label: "Chaotic day",
    group: "core",
    facts: chaotic(),
    reason: "two hard commitments arrived",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "The day no longer fits",
      headline: "One promise needs a decision.",
      detail: "Cedrus protected meetings and deadline-critical work. The board correction is still short; open Plan to see the exact tradeoff.",
      tone: "risk",
      prompt: "Show me the least costly tradeoff",
    },
  },
  {
    id: "conflict",
    label: "New meeting",
    group: "change",
    facts: withMeeting(),
    reason: "a 3:15pm reference call arrived",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "One block moved · no deadline impact",
      headline: "The memo moved around the new call.",
      detail: "Clockout stayed protected. Cedrus shifted writing to the next legal window and kept the day feasible.",
      tone: "change",
      prompt: "Why did you move the memo?",
    },
  },
  {
    id: "cancellation",
    label: "Cancellation",
    group: "change",
    facts: withoutLunch(),
    reason: "lunch was cancelled",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "45 minutes returned",
      headline: "Clockout became continuous.",
      detail: "Cedrus pulled the model together and brought the memo forward without changing its deadline.",
      tone: "change",
      prompt: "Keep the new space open instead",
    },
  },
  {
    id: "deadline-risk",
    label: "Deadline risk",
    group: "change",
    facts: deadlineRisk(),
    reason: "the IC memo deadline moved to 5:30pm today",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "Deadline risk · 15 minutes short",
      headline: "The memo cannot finish by 5:30.",
      detail: "Every fixed commitment is protected. Extend the deadline, shorten the memo, or move Gym to recover the missing time.",
      tone: "risk",
      prompt: "What are my options?",
    },
  },
  {
    id: "agent-completion",
    label: "Agent finished",
    group: "system",
    facts: agentCompletion(),
    reason: "the Clockout model agent finished early",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "Agent completed · dependency cleared",
      headline: "The IC memo is ready now.",
      detail: "The model passed validation at 11:39. Cedrus removed its remaining blocks and opened the writing path.",
      tone: "complete",
      prompt: "Open the agent result",
    },
  },
  {
    id: "mac-offline",
    label: "Mac asleep",
    group: "system",
    facts: macOffline(),
    reason: "the Mac is asleep until 1:30pm",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "Device offline · plan recovered",
      headline: "Mac work waits until 1:30.",
      detail: "Cedrus held the blocked time, preserved fixed events, and moved the memo into Tuesday rather than pretending the work could run.",
      tone: "offline",
      prompt: "What can I do without the Mac?",
    },
  },
  {
    id: "overrun",
    label: "Work overrun",
    group: "change",
    facts: overrun(),
    reason: "Clockout needs 30 additional minutes",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "Estimate changed · 30 minutes added",
      headline: "Clockout expanded; the memo moved.",
      detail: "The extra validation pass consumed the late-afternoon margin. The memo continues Tuesday with its Wednesday deadline intact.",
      tone: "change",
      prompt: "Why is the memo on Tuesday?",
    },
  },
  {
    id: "urgent-ascendo",
    label: "Urgent Ascendo",
    group: "change",
    facts: withUrgentAscendo(),
    reason: "an urgent Ascendo term note arrived",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "Urgent work inserted · the day still fits",
      headline: "Handle the Ascendo note first.",
      detail: "Its 3:00pm deadline outranks Clockout’s later slack. Cedrus moved the model but preserved both Clockout deliverables.",
      tone: "focus",
      prompt: "Start the Ascendo note",
    },
  },
  {
    id: "re-entry",
    label: "Morning re-entry",
    group: "system",
    facts: reentry(),
    reason: "three changes landed while you were away",
    useBaseAsPrevious: true,
    presentation: {
      eyebrow: "Since you left · 3 meaningful changes",
      headline: "The model finished. The memo is underway.",
      detail: "Ascendo moved one hour later, the model agent completed, and 45 minutes of the memo are already accounted for.",
      tone: "complete",
      prompt: "Walk me through the changes",
    },
  },
];

export const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export function getScenario(id: string): ScenarioDefinition {
  return scenariosById.get(id) ?? scenarios[0];
}

export function computeScenario(id: string) {
  const scenario = getScenario(id);
  const previous = scenario.useBaseAsPrevious ? buildPlan(baseFacts) : undefined;
  const plan = buildPlan(scenario.facts, { previous, reason: scenario.reason });
  return { scenario, plan, previous };
}

export const projects = [
  {
    id: "cedrus",
    name: "Cedrus",
    state: "Designing the calendar that disappears",
    signal: "Concept note Tuesday",
    color: "#df8f45",
  },
  {
    id: "clockout",
    name: "Clockout",
    state: "Model → memo dependency chain",
    signal: "Model in progress",
    color: "#8ca8b1",
  },
  {
    id: "ascendo",
    name: "Ascendo",
    state: "Fund work and portfolio decisions",
    signal: "Partner review Tuesday",
    color: "#a4ad73",
  },
  {
    id: "personal",
    name: "Personal",
    state: "Health, people, and home",
    signal: "Gym fixed at 4:30",
    color: "#c97453",
  },
];

export function scenarioForEvent(event: "meeting" | "cancellation" | "deadline" | "agent" | "offline" | "overrun" | "urgent" | "reentry"): string {
  const map: Record<typeof event, string> = {
    meeting: "conflict",
    cancellation: "cancellation",
    deadline: "deadline-risk",
    agent: "agent-completion",
    offline: "mac-offline",
    overrun: "overrun",
    urgent: "urgent-ascendo",
    reentry: "re-entry",
  };
  return map[event];
}

export function dayLabel(day: DayIndex): string {
  return baseFacts.dayLabels[day] ?? `Day ${day + 1}`;
}
