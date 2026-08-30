export type DemoProject = {
  id: string;
  name: string;
  accent: string;
  summary: string;
  status: string;
  loops: string;
  current: string;
  next: string;
  waiting: string;
  people: string[];
  recent: string[];
};

export type DemoPerson = {
  id: string;
  name: string;
  context: string;
  projects: string[];
  current: string;
  waitingOnMe: string;
  waitingOnThem: string;
  next: string;
  recent: string;
};

export type BriefStyle = "concise" | "analytical" | "personal" | "newsletter" | "executive" | "narrative";
export type BriefCadence = "daily" | "weekly" | "manual";
export type BriefDelivery = "dashboard" | "email" | "SMS";

export type DemoBrief = {
  id: string;
  name: string;
  description: string;
  cadenceLabel: string;
  style: BriefStyle;
  cadence: BriefCadence;
  delivery: BriefDelivery;
  inputs: string[];
  sections: string[];
};

export type BriefSettings = Pick<DemoBrief, "style" | "cadence" | "delivery" | "inputs" | "sections">;

export type ReplayEvent = {
  id: string;
  time: string;
  minute: number;
  title: string;
  detail: string;
  kind: "work" | "person" | "cedrus" | "agent" | "project";
};

export type KnowledgeFact = {
  id: string;
  label: string;
  value: string;
  inferred?: boolean;
  confidence?: "high" | "medium";
  evidence?: string[];
};

export const deskProjects: DemoProject[] = [
  {
    id: "ascendo",
    name: "Ascendo",
    accent: "#d4a15e",
    summary: "Clockout in motion. IC Thursday.",
    status: "2 open loops",
    loops: "Clockout model · Chantico update",
    current: "Clockout model",
    next: "IC memo",
    waiting: "Chantico update",
    people: ["Laura", "Diego", "Claudia"],
    recent: ["Model assumptions tightened", "IC moved to Thursday", "Laura added one diligence question"],
  },
  {
    id: "cedrus",
    name: "Cedrus",
    accent: "#86a995",
    summary: "V6.3 active. The Personal Desk is taking shape.",
    status: "No blockers",
    loops: "Desk navigation · mobile scroll",
    current: "V6.3 Personal Desk",
    next: "Interaction critique",
    waiting: "Phone validation",
    people: ["Emil", "Design agent"],
    recent: ["World preserved", "Desk architecture chosen", "People and Briefs added"],
  },
  {
    id: "play-nice",
    name: "Play Nice",
    accent: "#c98268",
    summary: "Website exploration. Facility research.",
    status: "1 decision Friday",
    loops: "Pricing · facility shortlist",
    current: "Pricing review",
    next: "Talk with Dad",
    waiting: "Facility numbers",
    people: ["Dad", "Uncle", "Javier"],
    recent: ["Two facilities shortlisted", "Brand route narrowed", "Pricing conversation scheduled"],
  },
  {
    id: "personal",
    name: "Personal",
    accent: "#cfc3ad",
    summary: "Gym today. Dinner Friday.",
    status: "The week has room",
    loops: "Receipts · dinner",
    current: "Protect late afternoon",
    next: "Gym",
    waiting: "Dinner confirmation",
    people: ["Maya", "Javier"],
    recent: ["Gym moved later", "Friday dinner held", "Receipts grouped for Tuesday"],
  },
];

export const deskPeople: DemoPerson[] = [
  { id: "laura", name: "Laura", context: "Ascendo · Founder Partner", projects: ["Ascendo", "Clockout"], current: "Clockout IC", waitingOnMe: "Reply to model thread", waitingOnThem: "Fundraising update", next: "IC Thursday · 9:00 AM", recent: "3 meaningful interactions" },
  { id: "diego", name: "Diego", context: "Ascendo · Investment team", projects: ["Ascendo", "Chantico"], current: "Chantico diligence", waitingOnMe: "Review market map", waitingOnThem: "Founder references", next: "Partner review · Tuesday", recent: "Decision notes aligned yesterday" },
  { id: "claudia", name: "Claudia", context: "Ascendo · Operations", projects: ["Ascendo"], current: "Fund administration", waitingOnMe: "Approve one document", waitingOnThem: "Quarterly packet", next: "Review · Wednesday", recent: "Two operating details resolved" },
  { id: "dad", name: "Dad", context: "Play Nice · Partner", projects: ["Play Nice", "Personal"], current: "Pricing conversation", waitingOnMe: "Bring revised model", waitingOnThem: "Friday timing", next: "Friday · 3:00 PM", recent: "Facility criteria clarified" },
  { id: "uncle", name: "Uncle", context: "Play Nice · Advisor", projects: ["Play Nice"], current: "Facility research", waitingOnMe: "Send shortlist", waitingOnThem: "Lease perspective", next: "After Friday call", recent: "One useful introduction" },
  { id: "javier", name: "Javier", context: "Friend · Miami", projects: ["Personal", "Play Nice"], current: "Dinner planning", waitingOnMe: "Choose a night", waitingOnThem: "Restaurant idea", next: "Friday evening", recent: "Last spoke Sunday" },
  { id: "maya", name: "Maya", context: "Friend · New York", projects: ["Personal"], current: "Lunch today", waitingOnMe: "Walk over at 12:20", waitingOnThem: "Nothing", next: "12:30 PM · Lilia", recent: "Lunch moved fifteen minutes" },
  { id: "emil", name: "Emil", context: "Cedrus · Product", projects: ["Cedrus"], current: "Personal Desk", waitingOnMe: "Finish interaction pass", waitingOnThem: "Product critique", next: "V6.3 review", recent: "Architecture sharpened this morning" },
];

export const deskBriefs: DemoBrief[] = [
  {
    id: "monday-brief",
    name: "Monday Brief",
    description: "Personal operating brief",
    cadenceLabel: "Mondays · 7:30 AM",
    style: "personal",
    cadence: "weekly",
    delivery: "dashboard",
    inputs: ["Ascendo", "Cedrus", "Personal", "calendar"],
    sections: ["What matters", "Decisions", "Upcoming", "Waiting on"],
  },
  {
    id: "ascendo-weekly",
    name: "Ascendo Weekly",
    description: "Workstream recap",
    cadenceLabel: "Fridays · 4:00 PM",
    style: "executive",
    cadence: "weekly",
    delivery: "email",
    inputs: ["Ascendo", "Laura", "Diego", "calendar"],
    sections: ["What changed", "Decisions", "Upcoming", "Waiting on"],
  },
  {
    id: "cedrus-build-log",
    name: "Cedrus Build Log",
    description: "Development summary",
    cadenceLabel: "Sunday · 6:00 PM",
    style: "analytical",
    cadence: "weekly",
    delivery: "dashboard",
    inputs: ["Cedrus", "saved items"],
    sections: ["What changed", "Decisions", "Ideas", "Links"],
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "Draft workspace",
    cadenceLabel: "Manual",
    style: "newsletter",
    cadence: "manual",
    delivery: "email",
    inputs: ["Cedrus", "Ascendo", "saved items"],
    sections: ["What matters", "Ideas", "Links"],
  },
];

export const replayEvents: ReplayEvent[] = [
  { id: "r1", time: "8:42", minute: 522, title: "Started Clockout model", detail: "A protected deep-work block opened the day.", kind: "work" },
  { id: "r2", time: "9:17", minute: 557, title: "Laura followed up", detail: "One model assumption needed a clearer answer.", kind: "person" },
  { id: "r3", time: "9:18", minute: 558, title: "Cedrus changed priority", detail: "The model stayed first; admin work moved to Tuesday.", kind: "cedrus" },
  { id: "r4", time: "9:46", minute: 586, title: "Play Nice note captured", detail: "Pricing review was classified under Friday's meeting.", kind: "project" },
  { id: "r5", time: "10:11", minute: 611, title: "Agent completed validation", detail: "The dependency cleared without interrupting you.", kind: "agent" },
  { id: "r6", time: "10:12", minute: 612, title: "IC memo moved earlier", detail: "Cedrus used the newly available creative block.", kind: "cedrus" },
  { id: "r7", time: "10:38", minute: 638, title: "Diego added a reference", detail: "The diligence thread gained one useful source.", kind: "person" },
  { id: "r8", time: "11:04", minute: 664, title: "Monday brief updated", detail: "Clockout and the partner review entered What matters.", kind: "project" },
  { id: "r9", time: "11:39", minute: 699, title: "Model passed", detail: "The remaining model blocks disappeared from the plan.", kind: "agent" },
  { id: "r10", time: "12:30", minute: 750, title: "Lunch with Maya", detail: "A fixed commitment began on time.", kind: "person" },
  { id: "r11", time: "2:00", minute: 840, title: "Nth AI", detail: "The afternoon's fixed anchor held.", kind: "work" },
  { id: "r12", time: "4:30", minute: 990, title: "Gym stayed protected", detail: "Cedrus left the late afternoon boundary intact.", kind: "cedrus" },
];

export const agentResults = [
  { id: "a1", time: "11:39 AM", title: "Clockout model passed validation", detail: "The dependency cleared. Cedrus brought the IC memo forward." },
  { id: "a2", time: "10:11 AM", title: "Diligence sources reconciled", detail: "Three duplicates were removed and one new founder reference was preserved." },
  { id: "a3", time: "9:54 AM", title: "Play Nice facility scan finished", detail: "Two options match the current size and price constraints." },
];

export const knowledgeFacts: KnowledgeFact[] = [
  { id: "location", label: "Location", value: "Miami" },
  { id: "work", label: "Work", value: "Ascendo Venture Capital" },
  { id: "focus", label: "Preferred focus", value: "Morning", inferred: true, confidence: "high", evidence: ["you kept 7 of 9 deep-work blocks before noon", "you declined two early meetings to protect focus"] },
  { id: "gym", label: "Gym", value: "Usually late afternoon", inferred: true, confidence: "high", evidence: ["gym landed after 4 PM in 8 of 10 mock days", "you told Cedrus “gym later” twice"] },
  { id: "meetings", label: "Meetings", value: "Avoid before 10 when possible" },
  { id: "priority-1", label: "Current priority", value: "Clockout" },
  { id: "priority-2", label: "Current priority", value: "Cedrus V6.3" },
  { id: "priority-3", label: "Current priority", value: "Play Nice" },
  { id: "language-1", label: "Language", value: "English" },
  { id: "language-2", label: "Language", value: "Spanish" },
  { id: "writing", label: "Writing", value: "Long-form work after lunch", inferred: true, confidence: "medium", evidence: ["creative blocks completed more often after 1 PM", "memo work was moved out of early mornings three times"] },
  { id: "buffer", label: "Transitions", value: "15 minutes before in-person meetings" },
];

export const demoFlexibleSignals = [
  "Finish Clockout model",
  "Draft IC memo",
  "Write Cedrus concept note",
  "File studio receipts",
  "Review Play Nice pricing",
  "Prepare Chantico questions",
  "Draft Monday Brief",
  "Read facility shortlist",
];

export const intakeExamples = [
  "Need to revisit Play Nice pricing before we talk to Dad Friday.",
  "Save the article about agent memory for Cedrus.",
  "Remind me to ask Laura about the fundraising update.",
  "New idea: a short newsletter section called Things Cedrus Noticed.",
  "Block thirty minutes for the facility shortlist tomorrow.",
];
