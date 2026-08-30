import { baseFacts } from "../scenarios";
import type { FixedEvent, PlannerFacts } from "../planner/types";

export type ArchitectureVariant = "time" | "worlds" | "adaptive";

export const architectureFacts = (): PlannerFacts => {
  const facts = structuredClone(baseFacts);
  const lauraMeeting: FixedEvent = {
    id: "laura-clockout",
    title: "Laura · Clockout",
    day: 0,
    start: 660,
    end: 702,
    kind: "external-fixed",
    source: "Calendar",
    sourceRef: "mock:laura-clockout",
    location: "Meet",
    locked: true,
    tone: "water",
  };
  facts.fixedEvents = [lauraMeeting, ...facts.fixedEvents];
  return facts;
};

export const worlds = [
  {
    id: "ascendo",
    name: "Ascendo",
    accent: "#d7a45e",
    statement: "Clockout is moving toward Thursday's IC.",
    allocation: "3h 15m today · 8h 30m this week",
    projects: ["Clockout", "Chantico", "Nth AI"],
    people: ["Laura", "Diego", "Claudia"],
    waiting: ["You owe Laura the revised model", "Diego owes founder references"],
    brief: "Ascendo Weekly · Friday 4:00 PM",
  },
  {
    id: "cedrus",
    name: "Cedrus",
    accent: "#86aa98",
    statement: "The V7 architecture experiment is ready to compare.",
    allocation: "1h 30m today · 4h this week",
    projects: ["Time OS", "Worlds OS", "Adaptive OS"],
    people: ["Emil", "Design agent"],
    waiting: ["Architecture reaction", "Phone comparison"],
    brief: "Cedrus Build Log · Sunday 6:00 PM",
  },
  {
    id: "play-nice",
    name: "Play Nice",
    accent: "#c98568",
    statement: "Pricing and facility research converge Friday.",
    allocation: "45m today · 2h this week",
    projects: ["Pricing", "Facility shortlist", "Brand route"],
    people: ["Dad", "Uncle", "Javier"],
    waiting: ["Dad owes Friday timing", "You owe the revised model"],
    brief: "Decision note · Friday 5:30 PM",
  },
  {
    id: "personal",
    name: "Personal",
    accent: "#cfc4af",
    statement: "The week has room around a few protected edges.",
    allocation: "1h today · 4h 20m this week",
    projects: ["Gym", "Dinner", "Receipts"],
    people: ["Dad", "Uncle", "Javier"],
    waiting: ["Javier owes a restaurant idea", "You owe a night"],
    brief: "Monday Brief · Monday 7:30 AM",
  },
] as const;

export const agentStory = {
  running: {
    title: "Model validation running",
    detail: "Checking the revised Clockout sensitivities. No action needed.",
    progress: "7 of 9 checks",
  },
  result: {
    title: "The dependency cleared",
    detail: "Three duplicate sources were removed. Cedrus moved the IC memo into the new opening.",
    consequence: "IC memo · today 2:45 PM",
  },
  approval: {
    title: "Reply to Laura about the model",
    why: "She asked twice and needs the revision before Thursday's IC.",
    draft: "Laura — sending the revised model Wednesday night so you have it before the IC. The sensitivity table is rebuilt; the conclusion hasn’t moved.",
  },
};

export const weekStory = [
  { day: "MON 17", load: "6h 03m", free: "1h 57m", pressure: "balanced", items: ["Clockout model", "Laura · fixed", "IC memo", "Gym · fixed"] },
  { day: "TUE 18", load: "5h 30m", free: "2h 30m", pressure: "open", items: ["Ascendo review · fixed", "Cedrus concept note", "Play Nice pricing"] },
  { day: "WED 19", load: "7h 00m", free: "1h 00m", pressure: "tight", items: ["Clockout finish", "Advisor call · fixed", "IC prep"] },
  { day: "THU 20", load: "4h 15m", free: "3h 45m", pressure: "IC 9:00", items: ["Clockout IC · fixed", "Chantico start", "Open afternoon"] },
  { day: "FRI 21", load: "3h 30m", free: "4h 30m", pressure: "open", items: ["Ascendo Weekly", "Play Nice decision", "Personal"] },
];

export const replayStory = [
  ["8:42", "Clockout model started", "A protected deep-work block opened the day."],
  ["9:17", "Laura followed up", "One model assumption needed a clearer answer."],
  ["9:18", "Cedrus changed priority", "Admin moved to Tuesday; the model stayed first."],
  ["9:46", "Play Nice note captured", "Pricing review joined Friday's conversation."],
  ["10:11", "Agent completed validation", "The dependency cleared without interrupting you."],
  ["10:12", "IC memo moved earlier", "Cedrus used newly available creative time."],
  ["10:38", "Diego added a reference", "The diligence thread gained one source."],
  ["11:04", "Ascendo Weekly updated", "Clockout entered What matters."],
  ["11:39", "Model passed", "The remaining model blocks left the plan."],
] as const;

