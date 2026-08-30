import type { FixedEvent, FlexibleTask, PlannerFacts } from "../planner/types";

export interface SyncCursor {
  provider: "google" | "outlook" | "caldav";
  value: string;
  scope: string;
  lastSuccessfulSync: string;
}

export interface ProviderRevision {
  etag?: string;
  sequence?: number;
  updatedAt: string;
}

export interface ProviderEventRecord extends FixedEvent {
  providerId: string;
  calendarId: string;
  recurrenceId?: string;
  originalStart?: string;
  revision: ProviderRevision;
  deleted: boolean;
}

export interface CalendarChangePage {
  upserts: ProviderEventRecord[];
  tombstones: Array<{ providerId: string; calendarId: string }>;
  nextPage?: string;
  nextCursor?: SyncCursor;
  requiresFullSync: boolean;
}

export interface CalendarAdapter {
  readonly provider: SyncCursor["provider"];
  listChanges(cursor?: SyncCursor): Promise<CalendarChangePage>;
  getFreeBusy(range: { start: string; end: string }): Promise<Array<{ start: string; end: string }>>;
  createEvent(input: Omit<ProviderEventRecord, "providerId" | "revision">): Promise<ProviderEventRecord>;
  updateEvent(ref: { providerId: string; calendarId: string }, patch: Partial<ProviderEventRecord>, revision: ProviderRevision): Promise<ProviderEventRecord>;
  deleteEvent(ref: { providerId: string; calendarId: string }, revision: ProviderRevision): Promise<void>;
}

export interface SemanticMutation {
  id: string;
  type: "add-task" | "update-task" | "complete-task" | "move-fixed" | "explain" | "summarize";
  task?: FlexibleTask;
  taskId?: string;
  patch?: Partial<FlexibleTask | FixedEvent>;
  confidence: number;
  sourceText: string;
}

export interface AgentConsequence {
  runId: string;
  taskId: string;
  outcome: "completed" | "partial" | "blocked";
  minutesCompleted?: number;
  outputRef?: string;
  timestamp: string;
}

export interface PlanningSnapshot {
  version: string;
  facts: PlannerFacts;
  createdAt: string;
  trigger: string;
}

