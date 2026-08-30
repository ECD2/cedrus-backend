export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TimePoint {
  day: DayIndex;
  minute: number;
}

export type FixedKind = "external-fixed" | "cedrus-fixed";

export interface FixedEvent {
  id: string;
  title: string;
  day: DayIndex;
  start: number;
  end: number;
  kind: FixedKind;
  source: string;
  sourceRef?: string;
  location?: string;
  locked: true;
  tone?: "stone" | "cedar" | "water" | "warning";
}

export interface WorkWindow {
  id: string;
  day: DayIndex;
  start: number;
  end: number;
  label: string;
  contexts: string[];
  energy: "low" | "medium" | "high";
  location?: string;
}

export interface PreferredWindow {
  days?: DayIndex[];
  start: number;
  end: number;
  label?: string;
}

export type TaskStatus = "ready" | "waiting" | "in-progress" | "done";

export interface FlexibleTask {
  id: string;
  title: string;
  project: string;
  totalMinutes: number;
  remainingMinutes: number;
  earliest: TimePoint;
  deadline: TimePoint;
  priority: 1 | 2 | 3 | 4 | 5;
  minChunk: number;
  maxChunk: number;
  splittable: boolean;
  preferredWindows: PreferredWindow[];
  allowedDays: DayIndex[];
  context: string;
  dependencies: string[];
  energy: "low" | "medium" | "high";
  location?: string;
  status: TaskStatus;
  source: string;
  sourceRef?: string;
  autoSchedule: boolean;
  locked: boolean;
  note?: string;
  spaceId?: string;
  goalId?: string;
  goalImportance?: 1 | 2 | 3 | 4 | 5;
  hardDeadline?: boolean;
  requiredLocation?: string;
  recurrence?: string;
  scheduleLabel?: string;
  personalPreference?: 1 | 2 | 3 | 4 | 5;
}

export interface PlacementFactor {
  key: "deadline" | "priority" | "goal" | "time" | "context" | "energy" | "stability" | "balance" | "preference";
  label: string;
  score: number;
  weight: number;
}

export interface PlacementScore {
  total: number;
  factors: PlacementFactor[];
  reasons: string[];
}

export interface ScheduledBlock {
  id: string;
  taskId: string;
  title: string;
  project: string;
  day: DayIndex;
  start: number;
  end: number;
  chunkIndex: number;
  locked: boolean;
  source: string;
  context: string;
  energy: "low" | "medium" | "high";
  placement?: PlacementScore;
}

export interface PlanRisk {
  id: string;
  taskId: string;
  title: string;
  severity: "watch" | "high";
  missingMinutes: number;
  detail: string;
}

export interface PlanDecision {
  id: string;
  type: "stable" | "moved" | "created" | "removed" | "risk" | "blocked";
  headline: string;
  detail: string;
  taskId?: string;
}

export interface PlanScore {
  hardViolations: number;
  unplannedMinutes: number;
  fragments: number;
  movedBlocks: number;
}

export interface PlannerFacts {
  now: TimePoint;
  dayLabels: string[];
  planningDays: DayIndex[];
  workWindows: WorkWindow[];
  fixedEvents: FixedEvent[];
  tasks: FlexibleTask[];
  lockedBlocks?: ScheduledBlock[];
}

export interface PlanResult {
  blocks: ScheduledBlock[];
  unscheduled: Array<{
    taskId: string;
    title: string;
    remainingMinutes: number;
    reason: string;
  }>;
  risks: PlanRisk[];
  decisions: PlanDecision[];
  score: PlanScore;
  completionByTask: Record<string, TimePoint | undefined>;
}

export interface PlannerOptions {
  previous?: PlanResult;
  reason?: string;
}

export interface ScenarioPresentation {
  eyebrow: string;
  headline: string;
  detail: string;
  tone: "quiet" | "focus" | "change" | "risk" | "offline" | "complete";
  prompt?: string;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  group: "core" | "change" | "system";
  facts: PlannerFacts;
  presentation: ScenarioPresentation;
  reason?: string;
  useBaseAsPrevious?: boolean;
}
