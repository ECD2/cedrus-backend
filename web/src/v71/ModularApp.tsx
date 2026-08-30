import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clock3,
  Dumbbell,
  Link2,
  ListTodo,
  MessageCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Horizon } from "../components/Horizon";
import { buildPlan } from "../planner/scheduler";
import { formatDuration, formatMinute, stamp } from "../planner/time";
import type { FlexibleTask, PlacementScore, PlannerFacts, ScheduledBlock } from "../planner/types";
import {
  addOptions,
  connectionGroups,
  fitnessExercises,
  initialSpaces,
  initialV71Facts,
  type GenericEntity,
  type SpaceRecord,
} from "./data";

type MainView = "now" | "time" | "spaces";
type TimeTab = "today" | "week" | "calendar" | "tasks";
type AddMode = "menu" | "connect" | "space" | "project" | "goal" | "task" | "person" | "metric" | "teach" | "import";

type PlannerState = {
  facts: PlannerFacts;
  plan: ReturnType<typeof buildPlan>;
};

const STORAGE = {
  tasks: "cedrus-v71-tasks",
  spaces: "cedrus-v71-spaces",
  connections: "cedrus-v71-connections",
  teachings: "cedrus-v71-teachings",
};

if (new URLSearchParams(window.location.search).has("resetDemo")) {
  Object.values(STORAGE).forEach((key) => window.localStorage.removeItem(key));
  window.history.replaceState({}, "", window.location.pathname);
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function startingPlanner(): PlannerState {
  const facts = initialV71Facts();
  const savedTasks = readStored<FlexibleTask[] | null>(STORAGE.tasks, null);
  if (savedTasks?.length) facts.tasks = savedTasks;
  return { facts, plan: buildPlan(facts) };
}

function cleanTitle(title: string) {
  return title.replace(/^Finish /, "").replace(/^Draft /, "");
}

function spaceName(spaceId: string | undefined, spaces: SpaceRecord[]) {
  return spaces.find((space) => space.id === spaceId)?.name ?? "Personal";
}

function ProductNav({ view, onView, onAdd }: { view: MainView; onView: (view: MainView) => void; onAdd: () => void }) {
  return (
    <header className={`v71-nav is-${view}`}>
      <button className="v71-wordmark" type="button" onClick={() => onView("now")} aria-label="Cedrus now">
        <i /> CEDRUS
      </button>
      <nav aria-label="Main navigation">
        {(["now", "time", "spaces"] as MainView[]).map((item) => (
          <button className={view === item ? "is-active" : ""} type="button" key={item} onClick={() => onView(item)}>{item}</button>
        ))}
        <button className="nav-add" type="button" onClick={onAdd} aria-label="Add to Cedrus"><Plus size={15} /></button>
      </nav>
      <button className="agent-result" type="button" onClick={() => onView("now")}><span /> 1 result</button>
    </header>
  );
}

function NowView({ planner, onTime }: { planner: PlannerState; onTime: () => void }) {
  const [scrubMinute, setScrubMinute] = useState(planner.facts.now.minute);
  const items = useMemo(() => [
    ...planner.facts.fixedEvents.filter((event) => event.day === 0 && event.end > planner.facts.now.minute).map((event) => ({
      id: event.id, title: event.title, start: event.start, end: event.end, kind: "fixed", detail: event.source,
    })),
    ...planner.plan.blocks.filter((block) => block.day === 0 && block.end > planner.facts.now.minute).map((block) => ({
      id: block.id, title: cleanTitle(block.title), start: block.start, end: block.end, kind: "placed", detail: spaceName(planner.facts.tasks.find((task) => task.id === block.taskId)?.spaceId, initialSpaces),
    })),
  ].sort((a, b) => a.start - b.start).slice(0, 4), [planner]);

  return (
    <div className="v71-now">
      <section className="now-world">
        <Horizon
          facts={planner.facts}
          plan={planner.plan}
          day={0}
          scrubMinute={scrubMinute}
          onScrub={setScrubMinute}
          presentation={{ eyebrow: "Current focus", headline: "Nothing needs you right now.", detail: "The day is held.", tone: "quiet" }}
        />
        <div className="now-meta">
          <button type="button" onClick={onTime}>your immediate plan <ChevronDown size={14} /></button>
        </div>
      </section>

      <section className="now-immediate" aria-label="Immediate plan">
        <header>
          <div><span>MONDAY · MIAMI</span><h2>The next edge of the day.</h2></div>
          <button type="button" onClick={onTime}>open Time <ArrowRight size={15} /></button>
        </header>
        <div className="now-agenda">
          {items.map((item) => (
            <article key={item.id}>
              <time>{formatMinute(item.start)}</time>
              <i className={`is-${item.kind}`} />
              <div><span>{item.kind === "fixed" ? "FIXED" : "CEDRUS PLACED"}</span><h3>{item.title}</h3><p>{formatDuration(item.end - item.start)} · {item.detail}</p></div>
            </article>
          ))}
        </div>
        <article className="meaningful-result">
          <div><Bot size={15} /><span>AGENT RESULT · MEANINGFUL</span></div>
          <h3>The Clockout dependency cleared.</h3>
          <p>Three duplicate sources were removed. The memo kept its protected writing block; nothing else moved.</p>
          <button type="button">review result <ChevronRight size={14} /></button>
        </article>
      </section>
    </div>
  );
}

type TimelineItem = {
  id: string;
  title: string;
  day: number;
  start: number;
  end: number;
  kind: "fixed" | "placed";
  detail: string;
  block?: ScheduledBlock;
};

function dayItems(planner: PlannerState, day: number): TimelineItem[] {
  return [
    ...planner.facts.fixedEvents.filter((event) => event.day === day).map((event) => ({
      id: event.id, title: event.title, day, start: event.start, end: event.end, kind: "fixed" as const,
      detail: `${event.source}${event.location ? ` · ${event.location}` : ""}`,
    })),
    ...planner.plan.blocks.filter((block) => block.day === day).map((block) => ({
      id: block.id, title: cleanTitle(block.title), day, start: block.start, end: block.end, kind: "placed" as const,
      detail: `${block.project} · ${block.context}`, block,
    })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
}

function TodayTimeline({ planner, onWhy }: { planner: PlannerState; onWhy: (block: ScheduledBlock) => void }) {
  const items = dayItems(planner, 0);
  return (
    <section className="today-schedule" aria-label="Today chronological schedule">
      <div className="schedule-head"><span>MON 17</span><strong>6h 03m committed</strong><small>2h 27m open</small></div>
      <div className="now-line"><span>11:42 · NOW</span></div>
      {items.map((item) => (
        <article className={`schedule-item is-${item.kind}`} key={item.id}>
          <time>{formatMinute(item.start)}</time>
          <div className="schedule-rail"><i /></div>
          <div className="schedule-copy">
            <span>{item.kind === "fixed" ? "FIXED COMMITMENT" : "CEDRUS PLACED"}</span>
            <h3>{item.title}</h3>
            <p>{formatMinute(item.start)}—{formatMinute(item.end)} · {formatDuration(item.end - item.start)} · {item.detail}</p>
            {item.block?.placement && <button type="button" onClick={() => onWhy(item.block!)}>why here · {item.block.placement.total}/100 <ChevronRight size={13} /></button>}
          </div>
        </article>
      ))}
      {planner.plan.risks.length > 0 && (
        <article className="schedule-risk"><span>CAPACITY RISK</span><strong>{planner.plan.risks[0].title}</strong><p>{planner.plan.risks[0].detail}</p></article>
      )}
    </section>
  );
}

function WeekView({ planner, onWhy }: { planner: PlannerState; onWhy: (block: ScheduledBlock) => void }) {
  return (
    <section className="week-view">
      <header className="surface-intro"><span>WEEK 34 · AUG 17—21</span><h2>Capacity before pressure.</h2><p>Time recalculates when the queue or calendar changes.</p></header>
      <div className="week-days">
        {planner.facts.planningDays.map((day) => {
          const items = dayItems(planner, day);
          const minutes = items.reduce((sum, item) => sum + item.end - item.start, 0);
          return (
            <article className={day === 0 ? "is-today" : ""} key={day}>
              <header><span>{planner.facts.dayLabels[day]}</span><strong>{formatDuration(minutes)}</strong></header>
              <div className="day-load"><i style={{ width: `${Math.min(100, (minutes / 540) * 100)}%` }} /></div>
              <ul>{items.map((item) => <li key={item.id}><time>{formatMinute(item.start)}</time><button type="button" onClick={() => item.block && onWhy(item.block)}>{item.title}</button></li>)}</ul>
              {items.length === 0 && <p>Open by design.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CalendarView({ planner }: { planner: PlannerState }) {
  const monthDays = Array.from({ length: 42 }, (_, index) => index - 4);
  return (
    <section className="calendar-view">
      <header className="surface-intro"><span>AUGUST 2026</span><h2>Commitments and placed work.</h2><p>Provider events stay fixed. Flexible work is visible without impersonating an event.</p></header>
      <div className="month-weekdays">{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="month-grid">
        {monthDays.map((day, index) => {
          const inMonth = day > 0 && day <= 31;
          const demoDay = day >= 17 && day <= 21 ? day - 17 : -1;
          const count = demoDay >= 0 ? dayItems(planner, demoDay).length : 0;
          return <button type="button" className={`${day === 17 ? "is-today" : ""} ${!inMonth ? "is-out" : ""}`} key={index}><span>{inMonth ? day : ""}</span>{count > 0 && <i>{count}</i>}</button>;
        })}
      </div>
      <div className="calendar-legend"><span><i className="fixed" /> fixed</span><span><i className="placed" /> Cedrus placed</span><span><i className="open" /> open</span></div>
    </section>
  );
}

function TasksView({ planner, spaces, onEdit, onAdd }: { planner: PlannerState; spaces: SpaceRecord[]; onEdit: (task: FlexibleTask) => void; onAdd: () => void }) {
  const tasks = [...planner.facts.tasks].sort((a, b) => b.priority - a.priority || stamp(a.deadline) - stamp(b.deadline));
  return (
    <section className="tasks-view">
      <header className="surface-intro task-head"><div><span>LOCAL TASK QUEUE · {tasks.length}</span><h2>The inputs Time is honoring.</h2><p>Edit priority, deadline, duration, chunking, or preferred hours and the plan recalculates.</p></div><button type="button" onClick={onAdd}><Plus size={15} /> add task</button></header>
      <div className="task-table-head"><span>Task</span><span>Priority</span><span>Duration</span><span>Deadline</span><span>Source</span></div>
      <div className="task-list">
        {tasks.map((task) => {
          const blocks = planner.plan.blocks.filter((block) => block.taskId === task.id);
          return (
            <button type="button" className="task-row" key={task.id} onClick={() => onEdit(task)}>
              <span className="task-main"><i style={{ background: spaces.find((space) => space.id === task.spaceId)?.accent }} /><span><strong>{task.title}</strong><small>{spaceName(task.spaceId, spaces)} · {task.status.replace("-", " ")}{task.dependencies.length ? " · has dependency" : ""}</small></span></span>
              <span><b className={`priority p${task.priority}`}>P{task.priority}</b></span>
              <span>{formatDuration(task.remainingMinutes)}{task.splittable && <small>{task.minChunk}m min chunk</small>}</span>
              <span>{planner.facts.dayLabels[task.deadline.day]}<small>{formatMinute(task.deadline.minute)}{task.hardDeadline ? " · hard" : ""}</small></span>
              <span>{task.source}<small>{blocks.length ? `${blocks.length} block${blocks.length === 1 ? "" : "s"}` : "not placed"}</small></span>
              <ChevronRight size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PlanChange({ planner }: { planner: PlannerState }) {
  const consequential = planner.plan.decisions.filter((decision) => decision.type !== "stable");
  if (!consequential.length) return null;
  return (
    <details className="plan-change" open>
      <summary><Sparkles size={14} /><span><strong>The plan changed.</strong> {planner.plan.score.movedBlocks} moved · {consequential.filter((item) => item.type === "created").length} created</span><ChevronDown size={14} /></summary>
      <div>{consequential.slice(0, 4).map((decision) => <p key={decision.id}><b>{decision.headline}</b> {decision.detail}</p>)}</div>
    </details>
  );
}

function TimeView({ planner, spaces, tab, onTab, onWhy, onEdit, onAdd }: {
  planner: PlannerState;
  spaces: SpaceRecord[];
  tab: TimeTab;
  onTab: (tab: TimeTab) => void;
  onWhy: (block: ScheduledBlock) => void;
  onEdit: (task: FlexibleTask) => void;
  onAdd: () => void;
}) {
  return (
    <main className="v71-surface time-surface">
      <header className="time-header">
        <div><span>TIME · LIVE PLAN</span><p>{planner.plan.score.hardViolations === 0 ? "All hard constraints honored" : "Constraint conflict"} · {planner.plan.score.unplannedMinutes ? `${formatDuration(planner.plan.score.unplannedMinutes)} unplaced` : "everything fits"}</p></div>
        <button type="button" onClick={onAdd}><CirclePlus size={16} /> task</button>
      </header>
      <nav className="time-tabs" aria-label="Time views">
        {(["today", "week", "calendar", "tasks"] as TimeTab[]).map((item) => <button type="button" className={tab === item ? "is-active" : ""} key={item} onClick={() => onTab(item)}>{item}</button>)}
      </nav>
      <PlanChange planner={planner} />
      {tab === "today" && <TodayTimeline planner={planner} onWhy={onWhy} />}
      {tab === "week" && <WeekView planner={planner} onWhy={onWhy} />}
      {tab === "calendar" && <CalendarView planner={planner} />}
      {tab === "tasks" && <TasksView planner={planner} spaces={spaces} onEdit={onEdit} onAdd={onAdd} />}
    </main>
  );
}

function EntityIcon({ type }: { type: GenericEntity["type"] }) {
  if (type === "task") return <ListTodo size={14} />;
  if (type === "event") return <CalendarDays size={14} />;
  if (type === "source") return <Link2 size={14} />;
  if (type === "agent") return <Bot size={14} />;
  if (type === "routine") return <Clock3 size={14} />;
  return <span>{type.slice(0, 1).toUpperCase()}</span>;
}

function FitnessSpace({ space, onTime, connected, onConnect }: { space: SpaceRecord; onTime: () => void; connected: string[]; onConnect: (source: string) => void }) {
  const [started, setStarted] = useState(false);
  const metric = (id: string) => space.entities.find((entity) => entity.id === id);
  return (
    <div className="fitness-space">
      <section className="fitness-today">
        <header><div><span>TODAY · PUSH</span><h2>Five exercises.<br />About 68 minutes.</h2><p>Fitness owns the program. Time owns the placement.</p></div><Dumbbell size={30} /></header>
        <div className="workout-list">
          {fitnessExercises.map(([name, sets, note], index) => <article key={name}><i>{index + 1}</i><div><strong>{name}</strong><span>{sets} · {note}</span></div><button type="button" aria-label={`Mark ${name} complete`}><span /></button></article>)}
        </div>
        <div className="fitness-actions"><button className={started ? "is-started" : ""} type="button" onClick={() => setStarted((value) => !value)}>{started ? <><Check size={15} /> workout started</> : "start workout"}</button><button type="button" onClick={onTime}>see its time <ArrowRight size={15} /></button></div>
      </section>

      <section className="fitness-week">
        <header><span>THIS WEEK</span><strong>3 strength · 7.8 mi running</strong></header>
        <div className="session-track">{[["P", "done"], ["P", "done"], ["L", "done"], ["P", "next"]].map(([label, state], index) => <div className={`is-${state}`} key={index}><i>{state === "done" ? <Check size={13} /> : label}</i><span>{["Push", "Pull", "Legs", "Push"][index]}</span></div>)}</div>
        <div className="goal-progress"><article><span>STRENGTH</span><strong>Progressing</strong><div><i style={{ width: "75%" }} /></div><small>3 sessions complete</small></article><article><span>RUNNING</span><strong>2 / 3</strong><div><i style={{ width: "66%" }} /></div><small>one run left</small></article></div>
      </section>

      <section className="fitness-metrics">
        <header><span>RECENT SIGNALS</span><p>Program progress, not just calendar occupancy.</p></header>
        <div><article><span>BENCH PRESS</span><strong>{metric("fm2")?.value}</strong><small>recent best · 6 reps</small></article><article><span>5K</span><strong>{metric("fm3")?.value}</strong><small>recent best</small></article><article><span>RUNNING</span><strong>{metric("fm1")?.value}</strong><small>this week</small></article></div>
      </section>

      <section className="fitness-sources">
        <header><span>FITNESS SOURCES</span><p>Mock connections · local demo only</p></header>
        <div>{["Gym", "Strava", "Apple Health"].map((source) => <button type="button" className={connected.includes(source) ? "is-connected" : ""} key={source} onClick={() => onConnect(source)}><Link2 size={14} /><span>{source}<small>{connected.includes(source) ? "connected" : "connect"}</small></span>{connected.includes(source) && <Check size={14} />}</button>)}</div>
      </section>
    </div>
  );
}

function GenericSpace({ space }: { space: SpaceRecord }) {
  const grouped = space.entities.reduce<Record<string, GenericEntity[]>>((groups, entity) => {
    const key = entity.type === "goal" ? "Goals" : entity.type === "project" ? "Projects & programs" : entity.type === "task" ? "Tasks & activities" : "Context";
    groups[key] = [...(groups[key] ?? []), entity];
    return groups;
  }, {});
  return (
    <div className="generic-space">
      {Object.entries(grouped).map(([label, entities]) => (
        <section key={label}>
          <header><span>{label}</span><small>{entities.length}</small></header>
          <div>{entities.map((entity) => <article key={entity.id}><i><EntityIcon type={entity.type} /></i><div><strong>{entity.name}</strong><p>{entity.detail}</p></div>{entity.value && <b>{entity.value}</b>}{entity.status && <span>{entity.status}</span>}</article>)}</div>
        </section>
      ))}
      <section className="space-hooks"><header><span>SCHEDULER HOOKS</span></header><div>{space.schedulerHooks?.map((hook) => <p key={hook}><Check size={12} /> {hook}</p>)}</div></section>
    </div>
  );
}

function SpacesView({ spaces, selectedId, onSelect, onTime, connected, onConnect, onAdd }: {
  spaces: SpaceRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onTime: () => void;
  connected: string[];
  onConnect: (source: string) => void;
  onAdd: () => void;
}) {
  const selected = spaces.find((space) => space.id === selectedId) ?? spaces[0];
  return (
    <main className="v71-surface spaces-surface">
      <aside className="space-index">
        <header><span>SPACES · {spaces.length}</span><button type="button" onClick={onAdd}><Plus size={15} /></button></header>
        <nav>{spaces.map((space) => <button type="button" className={selected.id === space.id ? "is-active" : ""} key={space.id} onClick={() => onSelect(space.id)}><i style={{ background: space.accent }}>{space.glyph}</i><span>{space.name}<small>{space.entities.length} objects</small></span><ChevronRight size={14} /></button>)}</nav>
      </aside>
      <section className="space-content">
        <header className="space-hero" style={{ "--space-accent": selected.accent } as React.CSSProperties}>
          <div><span>SPACE · {selected.views.join(" · ")}</span><h1>{selected.name}</h1><p>{selected.statement}</p></div>
          <i>{selected.glyph}</i>
        </header>
        {selected.id === "fitness" ? <FitnessSpace space={selected} onTime={onTime} connected={connected} onConnect={onConnect} /> : <GenericSpace space={selected} />}
      </section>
    </main>
  );
}

function WhySheet({ block, onClose }: { block: ScheduledBlock | null; onClose: () => void }) {
  if (!block?.placement) return null;
  const score: PlacementScore = block.placement;
  return (
    <div className="modal-scrim" onPointerDown={onClose}>
      <aside className="why-sheet" role="dialog" aria-modal="true" aria-label={`Why ${block.title} is here`} onPointerDown={(event) => event.stopPropagation()}>
        <header><div><span>WHY HERE</span><h2>{cleanTitle(block.title)}</h2><p>{formatMinute(block.start)}—{formatMinute(block.end)} · {formatDuration(block.end - block.start)}</p></div><button type="button" onClick={onClose}><X size={17} /></button></header>
        <div className="score-orbit"><strong>{score.total}</strong><span>/100</span></div>
        <p className="score-summary">{score.reasons.slice(0, 4).join(" · ")}.</p>
        <div className="score-factors">{score.factors.map((factor) => <div key={factor.key}><span>{factor.label}</span><i><b style={{ width: `${(factor.score / factor.weight) * 100}%` }} /></i><strong>{factor.score}/{factor.weight}</strong></div>)}</div>
        <section className="hard-constraints"><span>HARD CONSTRAINTS PASSED</span><p><Check size={13} /> no calendar conflict</p><p><Check size={13} /> after earliest start</p><p><Check size={13} /> before deadline</p><p><Check size={13} /> allowed schedule and working hours</p><p><Check size={13} /> minimum chunk and location honored</p></section>
      </aside>
    </div>
  );
}

type TaskDraft = {
  title: string; spaceId: string; duration: string; priority: string; deadlineDay: string; deadlineTime: string; minChunk: string; preferred: string; hardDeadline: boolean;
};

function TaskEditor({ task, spaces, onClose, onSave }: { task: FlexibleTask | null | undefined; spaces: SpaceRecord[]; onClose: () => void; onSave: (draft: TaskDraft, existing?: FlexibleTask | null) => void }) {
  const [draft, setDraft] = useState<TaskDraft>(() => task ? {
    title: task.title, spaceId: task.spaceId ?? spaces[0].id, duration: String(task.remainingMinutes), priority: String(task.priority), deadlineDay: String(task.deadline.day),
    deadlineTime: `${String(Math.floor(task.deadline.minute / 60)).padStart(2, "0")}:${String(task.deadline.minute % 60).padStart(2, "0")}`,
    minChunk: String(task.minChunk), preferred: task.preferredWindows[0]?.label ?? "any time", hardDeadline: Boolean(task.hardDeadline),
  } : { title: "", spaceId: spaces[0].id, duration: "60", priority: "3", deadlineDay: "1", deadlineTime: "17:00", minChunk: "30", preferred: "deep-work", hardDeadline: false });

  function update<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function submit(event: FormEvent) { event.preventDefault(); if (draft.title.trim()) onSave(draft, task); }
  return (
    <div className="modal-scrim" onPointerDown={onClose}>
      <form className="task-editor" onSubmit={submit} onPointerDown={(event) => event.stopPropagation()}>
        <header><div><span>{task ? "EDIT TASK · REPLAN" : "ADD TASK · AUTO-SCHEDULE"}</span><h2>{task ? "Change the facts." : "Give Time real inputs."}</h2></div><button type="button" onClick={onClose}><X size={17} /></button></header>
        <label className="full"><span>Task</span><input autoFocus value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="What needs doing?" /></label>
        <div className="form-grid">
          <label><span>Space</span><select value={draft.spaceId} onChange={(event) => update("spaceId", event.target.value)}>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>
          <label><span>Duration</span><input type="number" min="15" step="15" value={draft.duration} onChange={(event) => update("duration", event.target.value)} /><small>minutes</small></label>
          <label><span>Priority</span><select value={draft.priority} onChange={(event) => update("priority", event.target.value)}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>P{value} · {value === 5 ? "critical" : value === 4 ? "high" : value === 3 ? "normal" : "low"}</option>)}</select></label>
          <label><span>Minimum chunk</span><input type="number" min="15" step="15" value={draft.minChunk} onChange={(event) => update("minChunk", event.target.value)} /><small>minutes</small></label>
          <label><span>Deadline day</span><select value={draft.deadlineDay} onChange={(event) => update("deadlineDay", event.target.value)}>{[0, 1, 2, 3, 4].map((day) => <option value={day} key={day}>{["Mon 17", "Tue 18", "Wed 19", "Thu 20", "Fri 21"][day]}</option>)}</select></label>
          <label><span>Deadline time</span><input type="time" value={draft.deadlineTime} onChange={(event) => update("deadlineTime", event.target.value)} /></label>
          <label className="full"><span>Preferred window</span><select value={draft.preferred} onChange={(event) => update("preferred", event.target.value)}><option value="deep-work">Deep work · mornings</option><option value="writing">Writing · afternoons</option><option value="after 4 PM">After 4 PM</option><option value="any time">Any legal opening</option></select></label>
        </div>
        <label className="check-field"><input type="checkbox" checked={draft.hardDeadline} onChange={(event) => update("hardDeadline", event.target.checked)} /><span><strong>Hard deadline</strong><small>Cedrus may flag risk, but will never place work after it.</small></span></label>
        <div className="constraint-note"><SlidersHorizontal size={14} /><p>Calendar conflicts, dependencies, earliest start, allowed schedules, working hours, minimum chunks, location, and locked blocks remain hard constraints.</p></div>
        <footer><button type="button" onClick={onClose}>cancel</button><button className="save-primary" type="submit">{task ? "save & replan" : "add & replan"}<ArrowRight size={15} /></button></footer>
      </form>
    </div>
  );
}

function PlusModal({ mode, spaces, connected, teachings, onMode, onClose, onConnect, onCreateSpace, onCreateEntity, onTeach, onTask }: {
  mode: AddMode | null; spaces: SpaceRecord[]; connected: string[]; teachings: string[]; onMode: (mode: AddMode) => void; onClose: () => void;
  onConnect: (source: string) => void; onCreateSpace: (name: string) => void; onCreateEntity: (type: "project" | "goal" | "person" | "metric", name: string, spaceId: string) => void;
  onTeach: (statement: string) => void; onTask: () => void;
}) {
  const [name, setName] = useState("");
  const [targetSpace, setTargetSpace] = useState(spaces[0]?.id ?? "personal");
  if (!mode) return null;
  const activeMode = mode;
  const title = activeMode === "menu" ? "ADD TO CEDRUS" : addOptions.find(([id]) => id === activeMode)?.[1].toUpperCase();

  function saveGeneric(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (activeMode === "space") onCreateSpace(name.trim());
    if (["project", "goal", "person", "metric"].includes(activeMode)) onCreateEntity(activeMode as "project" | "goal" | "person" | "metric", name.trim(), targetSpace);
    if (activeMode === "teach") onTeach(name.trim());
    setName("");
  }

  return (
    <div className="plus-scrim" onPointerDown={onClose}>
      <section className="plus-modal" role="dialog" aria-modal="true" aria-label="Add to Cedrus" onPointerDown={(event) => event.stopPropagation()}>
        <header><button type="button" onClick={() => mode === "menu" ? onClose() : onMode("menu")}>{mode === "menu" ? <Sparkles size={15} /> : "back"}</button><span>{title}</span><button type="button" onClick={onClose}><X size={17} /></button></header>
        {mode === "menu" && <div className="add-menu">{addOptions.map(([id, label, detail]) => <button type="button" key={id} onClick={() => id === "task" ? onTask() : onMode(id)}><i>{id === "connect" ? <Link2 size={16} /> : id === "teach" ? <Sparkles size={16} /> : <Plus size={16} />}</i><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={15} /></button>)}</div>}
        {mode === "connect" && <div className="connect-menu"><p>No live authentication yet. These connections are simulated and stored locally.</p>{connectionGroups.map(([group, sources]) => <section key={group}><span>{group}</span><div>{sources.map((source) => <button type="button" className={connected.includes(source) ? "is-connected" : ""} key={source} onClick={() => onConnect(source)}>{source}{connected.includes(source) && <Check size={13} />}</button>)}</div></section>)}</div>}
        {mode === "import" && <div className="import-panel"><i><Link2 size={20} /></i><h2>Import into the object layer.</h2><p>A folder, repository, CSV, or exported calendar would be normalized into sources, entities, events, metrics, and actions.</p><button type="button" onClick={() => onConnect("Local import")}><Plus size={14} /> simulate local import {connected.includes("Local import") && <Check size={13} />}</button></div>}
        {(["space", "project", "goal", "person", "metric", "teach"] as AddMode[]).includes(mode) && (
          <form className="quick-create" onSubmit={saveGeneric}>
            <span>{mode === "teach" ? "A preference, boundary, routine, or intention" : `${mode} name`}</span>
            <textarea autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={mode === "teach" ? "Don’t schedule calls before 10 AM" : `Name this ${mode}`} />
            {mode !== "space" && mode !== "teach" && <label><span>Add to</span><select value={targetSpace} onChange={(event) => setTargetSpace(event.target.value)}>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label>}
            {mode === "teach" && teachings.length > 0 && <div className="teachings">{teachings.slice(-3).map((statement) => <p key={statement}><Check size={12} /> {statement}</p>)}</div>}
            <button type="submit">save locally <ArrowRight size={15} /></button>
          </form>
        )}
      </section>
    </div>
  );
}

function AskDock({ onRoute }: { onRoute: (query: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    onRoute(query);
    setAnswer(query.toLowerCase().includes("time") || query.toLowerCase().includes("week") ? "Opening the relevant Time view." : query.toLowerCase().includes("fitness") ? "Opening Fitness with its program context." : "I’m holding that in this local Cedrus session.");
    setQuery("");
  }
  return (
    <div className={`ask-dock ${open ? "is-open" : ""}`}>
      {!open ? <button type="button" onClick={() => setOpen(true)}><MessageCircle size={15} /><span>Ask Cedrus</span><kbd>⌘K</kbd></button> : <form onSubmit={submit}><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask, route, or capture…" /><button type="submit"><ArrowRight size={15} /></button><button type="button" onClick={() => setOpen(false)}><X size={15} /></button>{answer && <p>{answer}</p>}</form>}
    </div>
  );
}

export function ModularApp() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MainView>("now");
  const [timeTab, setTimeTab] = useState<TimeTab>("today");
  const [planner, setPlanner] = useState<PlannerState>(startingPlanner);
  const [spaces, setSpaces] = useState<SpaceRecord[]>(() => readStored(STORAGE.spaces, initialSpaces));
  const [selectedSpace, setSelectedSpace] = useState("fitness");
  const [connected, setConnected] = useState<string[]>(() => readStored(STORAGE.connections, ["Gym", "Strava", "Apple Health"]));
  const [teachings, setTeachings] = useState<string[]>(() => readStored(STORAGE.teachings, ["Don’t schedule calls before 10 AM", "I train Push Pull Legs", "I want three runs each week"]));
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [editTask, setEditTask] = useState<FlexibleTask | null | undefined>(undefined);
  const [whyBlock, setWhyBlock] = useState<ScheduledBlock | null>(null);
  const [toast, setToast] = useState("");

  function navigate(next: MainView) {
    setView(next);
    window.setTimeout(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function replan(nextFacts: PlannerFacts, reason: string) {
    const nextPlan = buildPlan(nextFacts, { previous: planner.plan, reason });
    setPlanner({ facts: nextFacts, plan: nextPlan });
    window.localStorage.setItem(STORAGE.tasks, JSON.stringify(nextFacts.tasks));
    const moved = nextPlan.score.movedBlocks;
    setToast(moved ? `${moved} block${moved === 1 ? "" : "s"} moved after ${reason}.` : `Plan recalculated after ${reason}; existing blocks held.`);
    window.setTimeout(() => setToast(""), 4200);
  }

  function saveTask(draft: TaskDraft, existing?: FlexibleTask | null) {
    const [hour, minute] = draft.deadlineTime.split(":").map(Number);
    const duration = Math.max(15, Number(draft.duration) || 60);
    const minChunk = Math.min(duration, Math.max(15, Number(draft.minChunk) || 30));
    const deadlineDay = Number(draft.deadlineDay) as 0 | 1 | 2 | 3 | 4;
    const selected = spaces.find((space) => space.id === draft.spaceId);
    const preferred = draft.preferred === "after 4 PM" ? { days: [deadlineDay], start: 960, end: 1200, label: draft.preferred } : draft.preferred === "any time" ? null : { start: draft.preferred === "deep-work" ? 540 : 780, end: draft.preferred === "deep-work" ? 960 : 1140, label: draft.preferred };
    const nextTask: FlexibleTask = {
      ...(existing ?? {} as FlexibleTask),
      id: existing?.id ?? `local-${Date.now()}`,
      title: draft.title.trim(), project: selected?.name ?? "Personal", spaceId: draft.spaceId,
      totalMinutes: duration, remainingMinutes: duration, earliest: existing?.earliest ?? planner.facts.now,
      deadline: { day: deadlineDay, minute: hour * 60 + minute }, hardDeadline: draft.hardDeadline,
      priority: Number(draft.priority) as 1 | 2 | 3 | 4 | 5, minChunk, maxChunk: duration, splittable: minChunk < duration,
      preferredWindows: preferred ? [preferred as FlexibleTask["preferredWindows"][number]] : [], allowedDays: [0, 1, 2, 3, 4],
      context: existing?.context ?? (draft.spaceId === "fitness" ? "fitness" : "deep"), dependencies: existing?.dependencies ?? [],
      energy: existing?.energy ?? "medium", status: existing?.status === "done" ? "ready" : existing?.status ?? "ready", source: existing?.source ?? "Cedrus",
      autoSchedule: true, locked: false, goalImportance: existing?.goalImportance ?? 3, personalPreference: existing?.personalPreference ?? 3,
    };
    const nextFacts = structuredClone(planner.facts);
    nextFacts.tasks = existing ? nextFacts.tasks.map((task) => task.id === existing.id ? nextTask : task) : [...nextFacts.tasks, nextTask];
    replan(nextFacts, existing ? `editing “${nextTask.title}”` : `adding “${nextTask.title}”`);
    setEditTask(undefined);
    setTimeTab("today");
    navigate("time");
  }

  function toggleConnection(source: string) {
    const next = connected.includes(source) ? connected.filter((item) => item !== source) : [...connected, source];
    setConnected(next); window.localStorage.setItem(STORAGE.connections, JSON.stringify(next));
    setToast(connected.includes(source) ? `${source} disconnected locally.` : `${source} connected in simulation.`);
  }

  function createSpace(name: string) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `space-${Date.now()}`;
    const next = [...spaces, { id, name, glyph: name.slice(0, 1).toUpperCase(), accent: "#7f6f91", statement: `A new space for ${name}. Add goals, projects, tasks, people, metrics, sources, and routines when they matter.`, views: ["Overview"], entities: [], schedulerHooks: [] }];
    setSpaces(next); setSelectedSpace(id); window.localStorage.setItem(STORAGE.spaces, JSON.stringify(next)); setAddMode(null); navigate("spaces"); setToast(`${name} is now a space.`);
  }

  function createEntity(type: "project" | "goal" | "person" | "metric", name: string, target: string) {
    const entity: GenericEntity = { id: `${type}-${Date.now()}`, type, name, detail: `${type} · added locally`, status: type === "goal" ? "new" : undefined };
    const next = spaces.map((space) => space.id === target ? { ...space, entities: [...space.entities, entity] } : space);
    setSpaces(next); setSelectedSpace(target); window.localStorage.setItem(STORAGE.spaces, JSON.stringify(next)); setAddMode(null); navigate("spaces"); setToast(`${name} added to ${spaceName(target, next)}.`);
  }

  function teach(statement: string) {
    const next = [...teachings, statement]; setTeachings(next); window.localStorage.setItem(STORAGE.teachings, JSON.stringify(next)); setAddMode(null); setToast("Cedrus learned that preference locally.");
  }

  function routeAsk(query: string) {
    const lower = query.toLowerCase();
    if (lower.includes("fitness") || lower.includes("workout")) { setSelectedSpace("fitness"); navigate("spaces"); }
    else if (lower.includes("week")) { setTimeTab("week"); navigate("time"); }
    else if (lower.includes("task") || lower.includes("schedule") || lower.includes("time")) { setTimeTab("today"); navigate("time"); }
  }

  return (
    <div className={`v71-app world-ready view-${view}`} ref={scrollRef}>
      <ProductNav view={view} onView={navigate} onAdd={() => setAddMode("menu")} />
      {view === "now" && <NowView planner={planner} onTime={() => { setTimeTab("today"); navigate("time"); }} />}
      {view === "time" && <TimeView planner={planner} spaces={spaces} tab={timeTab} onTab={setTimeTab} onWhy={setWhyBlock} onEdit={setEditTask} onAdd={() => setEditTask(null)} />}
      {view === "spaces" && <SpacesView spaces={spaces} selectedId={selectedSpace} onSelect={setSelectedSpace} onTime={() => { setTimeTab("today"); navigate("time"); }} connected={connected} onConnect={toggleConnection} onAdd={() => setAddMode("space")} />}
      <AskDock onRoute={routeAsk} />
      <WhySheet block={whyBlock} onClose={() => setWhyBlock(null)} />
      {editTask !== undefined && <TaskEditor key={editTask?.id ?? "new"} task={editTask} spaces={spaces} onClose={() => setEditTask(undefined)} onSave={saveTask} />}
      <PlusModal mode={addMode} spaces={spaces} connected={connected} teachings={teachings} onMode={setAddMode} onClose={() => setAddMode(null)} onConnect={toggleConnection} onCreateSpace={createSpace} onCreateEntity={createEntity} onTeach={teach} onTask={() => { setAddMode(null); setEditTask(null); }} />
      {toast && <div className="v71-toast"><Check size={14} /> {toast}</div>}
    </div>
  );
}
