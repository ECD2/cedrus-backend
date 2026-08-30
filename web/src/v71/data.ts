import type { FlexibleTask, PlannerFacts } from "../planner/types";

export type GenericEntity = {
  id: string;
  type: "goal" | "project" | "task" | "event" | "person" | "metric" | "file" | "note" | "agent" | "routine" | "brief" | "source";
  name: string;
  detail?: string;
  status?: string;
  value?: string;
};

export type SpaceRecord = {
  id: string;
  name: string;
  glyph: string;
  accent: string;
  statement: string;
  views: string[];
  entities: GenericEntity[];
  schedulerHooks?: string[];
};

const task = (value: FlexibleTask): FlexibleTask => value;

export function initialV71Facts(): PlannerFacts {
  return {
    now: { day: 0, minute: 702 },
    dayLabels: ["Mon 17", "Tue 18", "Wed 19", "Thu 20", "Fri 21", "Sat 22", "Sun 23"],
    planningDays: [0, 1, 2, 3, 4],
    workWindows: [
      { id: "mon-work", day: 0, start: 702, end: 1110, label: "Monday work schedule", contexts: ["deep", "creative", "admin", "calls"], energy: "high", location: "Studio" },
      { id: "mon-fitness", day: 0, start: 960, end: 1200, label: "After-work training schedule", contexts: ["fitness"], energy: "medium", location: "Brooklyn" },
      { id: "tue-work", day: 1, start: 600, end: 1110, label: "Tuesday work schedule", contexts: ["deep", "creative", "admin", "calls"], energy: "medium", location: "Studio" },
      { id: "wed-work", day: 2, start: 540, end: 1140, label: "Wednesday work schedule", contexts: ["deep", "creative", "admin", "calls"], energy: "high", location: "Studio" },
      { id: "thu-work", day: 3, start: 600, end: 1110, label: "Thursday work schedule", contexts: ["deep", "creative", "admin", "calls"], energy: "medium", location: "Studio" },
      { id: "fri-work", day: 4, start: 600, end: 1020, label: "Friday work schedule", contexts: ["deep", "creative", "admin", "calls", "personal"], energy: "medium", location: "Studio" },
    ],
    fixedEvents: [
      { id: "lunch-maya", title: "Lunch with Maya", day: 0, start: 750, end: 795, kind: "external-fixed", source: "Google Calendar", sourceRef: "gcal:lunch", location: "Lilia", locked: true, tone: "stone" },
      { id: "nth-ai", title: "Nth AI", day: 0, start: 840, end: 885, kind: "external-fixed", source: "Outlook", sourceRef: "outlook:nth", location: "Meet", locked: true, tone: "water" },
      { id: "partner-sync", title: "Ascendo partner sync", day: 1, start: 660, end: 720, kind: "external-fixed", source: "Google Calendar", location: "Zoom", locked: true, tone: "stone" },
      { id: "advisor-call", title: "Advisor call", day: 2, start: 930, end: 990, kind: "external-fixed", source: "Google Calendar", location: "Phone", locked: true, tone: "water" },
      { id: "clockout-ic", title: "Clockout IC", day: 3, start: 540, end: 630, kind: "external-fixed", source: "Outlook", location: "Board room", locked: true, tone: "warning" },
    ],
    tasks: [
      task({
        id: "clockout-model", title: "Finish Clockout model", project: "Ascendo", spaceId: "ascendo", goalId: "clockout-ic-goal", goalImportance: 5,
        totalMinutes: 90, remainingMinutes: 90, earliest: { day: 0, minute: 702 }, deadline: { day: 2, minute: 960 }, hardDeadline: true,
        priority: 5, minChunk: 30, maxChunk: 60, splittable: true, preferredWindows: [{ days: [0, 1, 2], start: 540, end: 960, label: "deep-work" }],
        allowedDays: [0, 1, 2], context: "deep", dependencies: [], energy: "high", status: "in-progress", source: "Linear", sourceRef: "linear:clockout-model",
        autoSchedule: true, locked: false, scheduleLabel: "Ascendo working hours", personalPreference: 5, note: "Model pass and verification before IC.",
      }),
      task({
        id: "ic-memo", title: "Draft IC memo", project: "Ascendo", spaceId: "ascendo", goalId: "clockout-ic-goal", goalImportance: 5,
        totalMinutes: 120, remainingMinutes: 120, earliest: { day: 0, minute: 702 }, deadline: { day: 2, minute: 1200 }, hardDeadline: true,
        priority: 4, minChunk: 45, maxChunk: 75, splittable: true, preferredWindows: [{ days: [0, 1, 2], start: 780, end: 1140, label: "writing" }],
        allowedDays: [0, 1, 2], context: "creative", dependencies: ["clockout-model"], energy: "high", status: "waiting", source: "Cedrus",
        autoSchedule: true, locked: false, scheduleLabel: "Ascendo working hours", personalPreference: 4, note: "Unlocks when the model finishes.",
      }),
      task({
        id: "cedrus-prototype", title: "Build V7.1 interaction pass", project: "Cedrus", spaceId: "cedrus", goalImportance: 4,
        totalMinutes: 75, remainingMinutes: 75, earliest: { day: 1, minute: 600 }, deadline: { day: 2, minute: 1080 },
        priority: 4, minChunk: 30, maxChunk: 75, splittable: true, preferredWindows: [{ days: [1, 2], start: 720, end: 1080, label: "creative" }],
        allowedDays: [1, 2], context: "creative", dependencies: [], energy: "medium", status: "ready", source: "GitHub", sourceRef: "github:cedrus-v71",
        autoSchedule: true, locked: false, personalPreference: 5,
      }),
      task({
        id: "push-workout", title: "Push workout", project: "Fitness", spaceId: "fitness", goalId: "strength-progress", goalImportance: 4,
        totalMinutes: 68, remainingMinutes: 68, earliest: { day: 0, minute: 960 }, deadline: { day: 0, minute: 1200 },
        priority: 3, minChunk: 60, maxChunk: 68, splittable: false, preferredWindows: [{ days: [0], start: 990, end: 1200, label: "after 4 PM" }],
        allowedDays: [0], context: "fitness", dependencies: [], energy: "medium", requiredLocation: "Brooklyn", location: "Gym", status: "ready", source: "Fitness module",
        autoSchedule: true, locked: false, recurrence: "Push · Pull · Legs rotation", scheduleLabel: "Training window", personalPreference: 5,
      }),
      task({
        id: "play-nice-pricing", title: "Review pricing model", project: "Play Nice", spaceId: "play-nice", goalImportance: 3,
        totalMinutes: 45, remainingMinutes: 45, earliest: { day: 3, minute: 660 }, deadline: { day: 4, minute: 960 }, priority: 3,
        minChunk: 45, maxChunk: 45, splittable: false, preferredWindows: [{ days: [3, 4], start: 780, end: 1020, label: "afternoon" }],
        allowedDays: [3, 4], context: "deep", dependencies: [], energy: "medium", status: "ready", source: "Email intake", autoSchedule: true, locked: false,
      }),
      task({
        id: "receipt-batch", title: "File receipt batch", project: "Personal", spaceId: "personal", goalImportance: 2,
        totalMinutes: 30, remainingMinutes: 30, earliest: { day: 1, minute: 600 }, deadline: { day: 4, minute: 1020 }, priority: 2,
        minChunk: 30, maxChunk: 30, splittable: false, preferredWindows: [{ start: 960, end: 1110, label: "low-energy" }], allowedDays: [1, 2, 3, 4],
        context: "admin", dependencies: [], energy: "low", status: "ready", source: "Reminders", autoSchedule: true, locked: false,
      }),
    ],
  };
}

export const initialSpaces: SpaceRecord[] = [
  {
    id: "ascendo", name: "Ascendo", glyph: "A", accent: "#c48a45", statement: "Move Clockout through Thursday’s investment committee with the model and memo intact.",
    views: ["Overview", "Goals", "People", "Briefs"], schedulerHooks: ["Partner schedule", "IC deadlines", "Deep-work preference"],
    entities: [
      { id: "ag1", type: "goal", name: "Clockout · IC ready", detail: "Goal · due Thursday 9:00 AM", status: "on track" },
      { id: "ap1", type: "project", name: "Clockout diligence", detail: "Project · 2 active tasks", status: "active" },
      { id: "at1", type: "task", name: "Finish Clockout model", detail: "90m · Linear", status: "in progress" },
      { id: "at2", type: "task", name: "Draft IC memo", detail: "120m · depends on model", status: "waiting" },
      { id: "apeople", type: "person", name: "Laura, Diego, Claudia", detail: "3 people in this space" },
      { id: "abrief", type: "brief", name: "Ascendo Weekly", detail: "Friday · 4:00 PM" },
    ],
  },
  {
    id: "cedrus", name: "Cedrus", glyph: "C", accent: "#728e7d", statement: "Build a personal operating system that remains calm as its capabilities expand.",
    views: ["Overview", "Builds", "Sources", "History"], schedulerHooks: ["Creative schedule", "Mac availability"],
    entities: [
      { id: "cg1", type: "goal", name: "V7.1 interaction proof", detail: "Goal · this week", status: "active" },
      { id: "cp1", type: "project", name: "Modular Personal OS", detail: "Program · prototype" },
      { id: "ct1", type: "task", name: "Build V7.1 interaction pass", detail: "75m · GitHub", status: "ready" },
      { id: "cagent", type: "agent", name: "Prototype verifier", detail: "1 result ready", status: "completed" },
      { id: "csource", type: "source", name: "Local repository", detail: "Last sync 4m ago", status: "connected" },
    ],
  },
  {
    id: "play-nice", name: "Play Nice", glyph: "P", accent: "#b66f59", statement: "Converge pricing, facility research, and a decision route by Friday.",
    views: ["Overview", "Goals", "Research"], schedulerHooks: ["Friday decision deadline"],
    entities: [
      { id: "pg1", type: "goal", name: "Make the facility decision", detail: "Goal · Friday", status: "watch" },
      { id: "pp1", type: "project", name: "Pricing model", detail: "Project · one task ready" },
      { id: "pt1", type: "task", name: "Review pricing model", detail: "45m · Email intake", status: "ready" },
      { id: "pn1", type: "note", name: "Three facility routes", detail: "Research note · updated yesterday" },
    ],
  },
  {
    id: "fitness", name: "Fitness", glyph: "F", accent: "#477f72", statement: "Build strength without letting running disappear from the week.",
    views: ["Today", "Program", "Progress", "Sources"], schedulerHooks: ["68m duration", "Prefer after 4 PM", "Medium flexibility", "Gym location"],
    entities: [
      { id: "fg1", type: "goal", name: "Strength progressing", detail: "3 sessions this week", status: "on track", value: "3" },
      { id: "fg2", type: "goal", name: "Run three times", detail: "2 of 3 this week", status: "one left", value: "2/3" },
      { id: "fm1", type: "metric", name: "Running", detail: "This week", value: "7.8 mi" },
      { id: "fm2", type: "metric", name: "Bench press", detail: "Recent best", value: "185 × 6" },
      { id: "fm3", type: "metric", name: "5K", detail: "Recent best", value: "23:41" },
      { id: "fr1", type: "routine", name: "Push workout", detail: "5 exercises · about 68m", status: "today" },
      { id: "fs1", type: "source", name: "Gym", detail: "Workout program", status: "connected" },
      { id: "fs2", type: "source", name: "Strava", detail: "Runs and distance", status: "connected" },
      { id: "fs3", type: "source", name: "Apple Health", detail: "Recovery and activity", status: "connected" },
    ],
  },
  {
    id: "personal", name: "Personal", glyph: "•", accent: "#9b8c79", statement: "Keep the week open around relationships, home, and the ordinary things that matter.",
    views: ["Overview", "People", "Routines", "Notes"], schedulerHooks: ["No calls before 10 AM"],
    entities: [
      { id: "pe1", type: "person", name: "Dad, Uncle, Javier", detail: "People · three open threads" },
      { id: "pr1", type: "routine", name: "Monday reset", detail: "Weekly · 30m" },
      { id: "pt1", type: "task", name: "File receipt batch", detail: "30m · Reminders", status: "ready" },
      { id: "pn1", type: "note", name: "Dinner shortlist", detail: "4 places saved" },
    ],
  },
];

export const fitnessExercises = [
  ["Bench press", "4 × 6", "185 lb target"],
  ["Incline dumbbell press", "3 × 8", "controlled"],
  ["Standing shoulder press", "3 × 8", "20 lb / side"],
  ["Lateral raises", "3 × 10", "15 lb"],
  ["Dips", "3 × 10", "bodyweight"],
] as const;

export const addOptions = [
  ["connect", "Connect something", "Calendar, communication, fitness, work, data, or local"],
  ["space", "Create a space", "Add a new part of your life without changing code"],
  ["project", "Add a project", "A project can live inside any space"],
  ["goal", "Add a goal", "Goals can connect directly to tasks or programs"],
  ["task", "Add a task", "Add work and let Time find it a legal place"],
  ["person", "Add a person", "Keep context and commitments together"],
  ["metric", "Track something", "Create a metric in any space"],
  ["teach", "Teach Cedrus", "Add a preference, boundary, or recurring intention"],
  ["import", "Import", "Simulate a local folder, file, or data import"],
] as const;

export const connectionGroups = [
  ["Calendar", ["Google Calendar", "Outlook", "CalDAV"]],
  ["Communication", ["Gmail", "SMS", "Email intake"]],
  ["Fitness", ["Strava", "Apple Health", "Gym"]],
  ["Work", ["GitHub", "Drive", "Slack"]],
  ["Data", ["Website", "RSS", "API", "Webhook", "MCP"]],
  ["Local", ["Folder", "Repository", "Mac"]],
] as const;
