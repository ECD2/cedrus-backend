import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, Bot, CalendarDays, Check, ChevronRight, Clock3, RotateCcw, Sparkles, X } from "lucide-react";
import { Horizon } from "../components/Horizon";
import { buildPlan } from "../planner/scheduler";
import { formatMinute } from "../planner/time";
import type { FixedEvent, ScheduledBlock } from "../planner/types";
import { agentStory, architectureFacts, replayStory, weekStory, worlds, type ArchitectureVariant } from "./architectureData";

type TimeMode = "plan" | "calendar";
type TimeView = "today" | "week" | "projects" | "memory";
type WorldView = "today" | "ascendo" | "cedrus" | "play-nice" | "personal";
type AdaptiveLens = "now" | "time" | "worlds" | "memory";

const variantMeta = {
  time: {
    label: "A · TIME OS",
    headline: "Your day has shape.",
    subline: "Time is the spine. Everything else finds its place.",
    cue: "enter today",
  },
  worlds: {
    label: "B · WORLDS OS",
    headline: "Four worlds. One horizon.",
    subline: "Work and life stay legible because their context stays intact.",
    cue: "enter your worlds",
  },
  adaptive: {
    label: "C · ADAPTIVE OS",
    headline: "The right surface is waiting.",
    subline: "Ask for what matters. Cedrus assembles the view.",
    cue: "enter now",
  },
} as const;

function useMiamiClock() {
  const format = () => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  const [time, setTime] = useState(format);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(format()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}

function currentMiamiMinute() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "12");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function HoldButton({ done, onComplete }: { done: boolean; onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);
  const started = useRef(0);
  const completed = useRef(false);

  function cancel() {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (!completed.current) setProgress(0);
  }

  function start() {
    if (done || frame.current) return;
    completed.current = false;
    started.current = performance.now();
    const step = () => {
      const next = Math.min(1, (performance.now() - started.current) / 720);
      setProgress(next);
      if (next >= 1) {
        completed.current = true;
        frame.current = null;
        onComplete();
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }

  useEffect(() => cancel, []);

  return (
    <button
      className={`hold-button ${progress > 0 ? "is-holding" : ""} ${done ? "is-done" : ""}`}
      type="button"
      onPointerDown={(event) => { event.preventDefault(); start(); }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.repeat) start(); }}
      onKeyUp={(event) => { if (event.key === "Enter") cancel(); }}
    >
      <span style={{ width: `${progress * 100}%` }} />
      <strong>{done ? <><Check size={14} /> sent</> : "hold to send"}</strong>
    </button>
  );
}

function AgentSheet({ open, onClose, variant }: { open: boolean; onClose: () => void; variant: ArchitectureVariant }) {
  const storageKey = `cedrus-v7-${variant}-approval`;
  const [sent, setSent] = useState(() => window.localStorage.getItem(storageKey) === "sent");
  const [draft, setDraft] = useState(agentStory.approval.draft);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="agent-scrim" role="presentation" onPointerDown={onClose}>
      <section className="agent-sheet" role="dialog" aria-modal="true" aria-label="Agent work" onPointerDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>AGENTS · CONSEQUENCES</span><h2>One result. One draft needs you.</h2></div>
          <button type="button" onClick={onClose} aria-label="Close agent work"><X size={18} /></button>
        </header>

        <article className="run-row running">
          <div className="run-state"><i />RUNNING</div>
          <h3>{agentStory.running.title}</h3>
          <p>{agentStory.running.detail}</p>
          <small>{agentStory.running.progress}</small>
        </article>

        <article className="run-row result">
          <div className="run-state"><Check size={12} />RESULT · MEANINGFUL</div>
          <h3>{agentStory.result.title}</h3>
          <p>{agentStory.result.detail}</p>
          <strong>{agentStory.result.consequence}</strong>
        </article>

        <article className={`approval-card ${sent ? "was-sent" : ""}`}>
          <div className="run-state">DRAFT · REQUIRES APPROVAL</div>
          <h3>{agentStory.approval.title}</h3>
          <p>{agentStory.approval.why}</p>
          <textarea value={draft} disabled={sent} onChange={(event) => setDraft(event.target.value)} aria-label="Editable draft to Laura" />
          <small>{sent ? "Sent locally for this demo · undo available for 15 minutes" : "Written by Cedrus · editable · this leaves the building"}</small>
          <div className="approval-actions">
            <HoldButton done={sent} onComplete={() => { setSent(true); window.localStorage.setItem(storageKey, "sent"); }} />
            {sent && <button type="button" className="undo-button" onClick={() => { setSent(false); window.localStorage.removeItem(storageKey); }}><RotateCcw size={13} /> undo</button>}
          </div>
        </article>
      </section>
    </div>
  );
}

type TimelineItem = {
  id: string;
  title: string;
  start: number;
  end: number;
  type: "fixed" | "flexible" | "free";
  detail: string;
  project?: string;
};

function DayTimeline({ compact = false }: { compact?: boolean }) {
  const facts = useMemo(architectureFacts, []);
  const plan = useMemo(() => buildPlan(facts), [facts]);
  const events: TimelineItem[] = [
    ...facts.fixedEvents.filter((event) => event.day === 0).map((event: FixedEvent) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      type: "fixed" as const,
      detail: `${event.source} fixed${event.location ? ` · ${event.location}` : ""}`,
    })),
    ...plan.blocks.filter((block) => block.day === 0).map((block: ScheduledBlock) => ({
      id: block.id,
      title: block.title.replace("Finish ", "").replace("Draft ", ""),
      start: block.start,
      end: block.end,
      type: "flexible" as const,
      detail: `Cedrus placed · ${block.context}`,
      project: block.project,
    })),
  ].sort((a, b) => a.start - b.start);

  const withOpen: TimelineItem[] = [];
  let cursor = 600;
  events.forEach((item) => {
    if (item.start - cursor >= 30) withOpen.push({ id: `free-${cursor}`, title: "Open", start: cursor, end: item.start, type: "free", detail: `${item.start - cursor}m unclaimed` });
    withOpen.push(item);
    cursor = Math.max(cursor, item.end);
  });
  if (1110 - cursor >= 30) withOpen.push({ id: `free-${cursor}`, title: "Open", start: cursor, end: 1110, type: "free", detail: `${1110 - cursor}m unclaimed` });

  return (
    <div className={`day-timeline ${compact ? "is-compact" : ""}`}>
      <div className="current-time-rule"><span>NOW · 11:42</span></div>
      {withOpen.map((item) => (
        <article className={`timeline-item is-${item.type}`} key={item.id}>
          <time>{formatMinute(item.start)}</time>
          <div className="timeline-rail"><i /></div>
          <div className="timeline-copy">
            <span>{item.type === "fixed" ? "FIXED" : item.type === "flexible" ? "CEDRUS PLACED" : "CAPACITY"}</span>
            <h3>{item.title}</h3>
            <p>{formatMinute(item.start)}—{formatMinute(item.end)} · {item.detail}</p>
            {item.type === "flexible" && !compact && <button type="button" className="text-action">why here <ChevronRight size={13} /></button>}
          </div>
        </article>
      ))}
    </div>
  );
}

function WeekSurface() {
  return (
    <section className="week-surface" aria-label="Week plan">
      <header className="section-intro"><span>WEEK 34 · AUGUST 17—21</span><h2>Capacity is visible before pressure becomes risk.</h2><p>26h 18m committed · 13h 42m open</p></header>
      <div className="week-grid">
        {weekStory.map((day, index) => (
          <article className={index === 0 ? "is-today" : day.pressure === "tight" ? "is-tight" : ""} key={day.day}>
            <header><span>{day.day}</span><strong>{day.load}</strong><small>{day.free} free</small></header>
            <div className="capacity-bar"><i style={{ height: `${46 + index * 7}%` }} /></div>
            <ul>{day.items.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>{day.pressure}</p>
          </article>
        ))}
      </div>
      <div className="allocation-line"><span>ASCENDO <b>12h 15m</b></span><span>CEDRUS <b>4h</b></span><span>PLAY NICE <b>2h</b></span><span>PERSONAL <b>4h 20m</b></span></div>
    </section>
  );
}

function PrecisionCalendar() {
  return (
    <section className="precision-calendar" aria-label="Precision calendar">
      <header><div><span>CALENDAR · PRECISION</span><h2>August 17—21</h2></div><p><i className="legend-flex" /> flexible <i className="legend-fixed" /> fixed</p></header>
      <div className="calendar-grid">
        <div className="calendar-hours">{[9, 11, 13, 15, 17].map((hour) => <span key={hour}>{hour > 12 ? hour - 12 : hour}{hour >= 12 ? "p" : "a"}</span>)}</div>
        {weekStory.map((day, index) => (
          <div className="calendar-day" key={day.day}>
            <b>{day.day.slice(0, 3)}</b>
            <i className="cal-block flex" style={{ top: `${9 + index * 8}%`, height: "19%" }}>{day.items[0]}</i>
            <i className="cal-block fixed" style={{ top: `${36 + index * 5}%`, height: "12%" }}>{day.items[1]}</i>
            <i className="cal-block flex alt" style={{ top: `${59 - index * 3}%`, height: "18%" }}>{day.items[2]}</i>
          </div>
        ))}
      </div>
    </section>
  );
}

function AscendoProject() {
  return (
    <section className="project-focus">
      <header><span>PROJECT · ASCENDO</span><h2>Clockout reaches IC on Thursday.</h2><p>8h 30m allocated this week · 3h 15m today</p></header>
      <div className="project-measure"><div><small>CLOCKOUT</small><strong>3h 15m</strong><i style={{ width: "78%" }} /></div><div><small>CHANTICO</small><strong>1h 30m</strong><i style={{ width: "42%" }} /></div><div><small>NTH AI</small><strong>45m</strong><i style={{ width: "24%" }} /></div></div>
      <div className="project-columns"><article><span>PEOPLE</span><h3>Laura · Diego · Claudia</h3><p>Three relationships, shown through active work—not as a CRM.</p></article><article><span>NEXT DEADLINE</span><h3>Clockout IC · Thursday 9:00</h3><p>The model and memo both resolve before this fixed edge.</p></article><article><span>SCHEDULED OUTPUT</span><h3>Ascendo Weekly · Friday 4:00</h3><p>Generated after the week's final decision window.</p></article></div>
    </section>
  );
}

function MemorySurface() {
  return (
    <section className="memory-surface"><header className="section-intro"><span>MEMORY · REPLAY</span><h2>What changed, and why.</h2><p>Consequences remain. Chatter disappears.</p></header><div className="replay-line">{replayStory.map(([time, title, detail], index) => <article key={time}><time>{time}</time><i /><div><span>{index % 3 === 0 ? "CEDRUS" : index % 3 === 1 ? "PERSON" : "WORK"}</span><h3>{title}</h3><p>{detail}</p></div></article>)}</div></section>
  );
}

function TimePrototype({ onAgent }: { onAgent: () => void }) {
  const [view, setView] = useState<TimeView>("today");
  const [mode, setMode] = useState<TimeMode>("plan");

  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent<TimeView>).detail;
      setView(next);
      document.getElementById("architecture-core")?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("cedrus-time-nav", handler);
    return () => window.removeEventListener("cedrus-time-nav", handler);
  }, []);

  return (
    <>
      <header className="architecture-title"><div><span>A · TIME OS</span><h1>{view === "today" ? "Monday is the product." : view === "week" ? "The week, before it happens." : view === "projects" ? "Projects become time." : "Time leaves a memory."}</h1></div><div className="surface-tabs">{(["today", "week", "projects", "memory"] as TimeView[]).map((item) => <button className={view === item ? "active" : ""} type="button" onClick={() => setView(item)} key={item}>{item}</button>)}</div></header>
      {view === "today" && <section className="time-today"><div className="today-heading"><div><span>MONDAY · AUGUST 17</span><h2>6h 03m planned</h2><p>1h 57m open · no deadline risk</p></div><div className="precision-switch"><button className={mode === "plan" ? "active" : ""} onClick={() => setMode("plan")} type="button">plan</button><button className={mode === "calendar" ? "active" : ""} onClick={() => setMode("calendar")} type="button">calendar</button></div></div>{mode === "plan" ? <DayTimeline /> : <PrecisionCalendar />}<button className="agent-inline" onClick={onAgent} type="button"><Bot size={15} /> 1 working · 1 needs you <ChevronRight size={14} /></button></section>}
      {view === "week" && <WeekSurface />}
      {view === "projects" && <AscendoProject />}
      {view === "memory" && <MemorySurface />}
    </>
  );
}

function GlobalToday({ onEnterWorld }: { onEnterWorld: (id: WorldView) => void }) {
  return (
    <section className="worlds-today"><header className="section-intro"><span>TODAY · ALL WORLDS</span><h2>A whole day, without flattening its contexts.</h2><p>6h 03m planned · 1h 57m open</p></header><div className="world-allocation">{worlds.map((world, index) => <button type="button" onClick={() => onEnterWorld(world.id as WorldView)} key={world.id}><i style={{ background: world.accent, width: `${86 - index * 14}%` }} /><span>{world.name}</span><strong>{world.allocation.split(" · ")[0]}</strong><small>{world.statement}</small></button>)}</div><div className="today-time-bridge"><div><Clock3 size={18} /><span>TIME REMAINS GLOBAL</span><h3>The merged plan is one click away.</h3></div><DayTimeline compact /></div></section>
  );
}

function WorldEnvironment({ id, onToday, onAgent }: { id: Exclude<WorldView, "today">; onToday: () => void; onAgent: () => void }) {
  const world = worlds.find((item) => item.id === id)!;
  return (
    <section className="world-environment" style={{ "--world-accent": world.accent } as CSSProperties}>
      <header><span>{world.name.toUpperCase()} · ENVIRONMENT</span><h2>{world.statement}</h2><p>{world.allocation}</p><button type="button" onClick={onToday}><CalendarDays size={15} /> merged calendar</button></header>
      <div className="editorial-time"><span>TIME · TODAY</span><strong>{id === "ascendo" ? "Clockout model · Laura · Nth AI · IC memo" : world.projects.join(" · ")}</strong><p>{id === "ascendo" ? "3h 15m protected around two fixed commitments." : "This world's commitments remain visible inside the global plan."}</p></div>
      <div className="editorial-projects"><span>PROJECTS</span>{world.projects.map((project, index) => <article key={project}><small>0{index + 1}</small><h3>{project}</h3><p>{index === 0 ? "moving now" : index === 1 ? "next edge" : "held in view"}</p><ChevronRight size={15} /></article>)}</div>
      <div className="editorial-split"><article><span>PEOPLE</span><h3>{world.people.join(" · ")}</h3><p>{id === "ascendo" ? "Laura is tied to Clockout, Thursday's decision and today's waiting state." : "Relationships appear where the shared work lives."}</p></article><article><span>WAITING</span>{world.waiting.map((item) => <p key={item}>{item}</p>)}</article></div>
      <button className="editorial-agent" type="button" onClick={onAgent}><span>AGENT WORK</span><strong>{agentStory.result.title}</strong><p>{agentStory.result.consequence}</p><ChevronRight size={16} /></button>
      <div className="editorial-brief"><span>SCHEDULED BRIEF</span><h3>{world.brief}</h3><p>Inputs inherit this world's context. The output lands back on the calendar.</p></div>
      <div className="context-ask">ask {world.name.toLowerCase()}…</div>
    </section>
  );
}

function WorldsPrototype({ onAgent }: { onAgent: () => void }) {
  const [view, setView] = useState<WorldView>("today");
  useEffect(() => {
    const handler = (event: Event) => { setView((event as CustomEvent<WorldView>).detail); document.getElementById("architecture-core")?.scrollIntoView({ behavior: "smooth" }); };
    window.addEventListener("cedrus-world-nav", handler);
    return () => window.removeEventListener("cedrus-world-nav", handler);
  }, []);
  return <><header className="architecture-title world-title"><div><span>B · WORLDS OS</span><h1>{view === "today" ? "Today crosses every world." : `Inside ${worlds.find((world) => world.id === view)?.name}.`}</h1></div><div className="surface-tabs">{(["today", "ascendo", "cedrus", "play-nice", "personal"] as WorldView[]).map((item) => <button className={view === item ? "active" : ""} type="button" onClick={() => setView(item)} key={item}>{item === "play-nice" ? "play nice" : item}</button>)}</div></header>{view === "today" ? <GlobalToday onEnterWorld={setView} /> : <WorldEnvironment id={view} onToday={() => setView("today")} onAgent={onAgent} />}</>;
}

function AdaptiveNow({ onAgent, onLens }: { onAgent: () => void; onLens: (lens: AdaptiveLens) => void }) {
  return (
    <section className="adaptive-now"><div className="now-primary"><span>NOW · FOCUS</span><h2>Clockout model</h2><strong>48m left</strong><p>Cedrus protected this block until Laura.</p><div className="focus-progress"><i /></div></div><div className="now-next"><span>NEXT · 11:00</span><h3>Laura · Clockout</h3><p>Fixed · one model question waiting</p></div><button className="now-agent" type="button" onClick={onAgent}><Sparkles size={16} /><span>AGENT</span><strong>Model validation running</strong><small>7 of 9 checks</small></button><div className="now-open"><span>OPEN TODAY</span><strong>1h 57m</strong><p>Best opening · after 5:30</p></div><button className="since-away" type="button" onClick={() => onLens("memory")}><span>SINCE YOU WERE AWAY</span><strong>2 meaningful changes</strong><p>IC memo moved · one result arrived</p><ArrowDown size={15} /></button></section>
  );
}

function WorldsIndex({ onSelect }: { onSelect: (id: string) => void }) {
  return <section className="adaptive-worlds"><header className="section-intro"><span>WORLDS</span><h2>Choose a context. Keep the escape route.</h2><p>Each world assembles a concise surface.</p></header>{worlds.map((world) => <button type="button" onClick={() => onSelect(world.id)} key={world.id}><i style={{ background: world.accent }} /><span>{world.name.toUpperCase()}</span><h3>{world.statement}</h3><p>{world.allocation}</p><ChevronRight size={18} /></button>)}</section>;
}

function AdaptivePrototype({ onAgent }: { onAgent: () => void }) {
  const [lens, setLens] = useState<AdaptiveLens>("now");
  const [timeMode, setTimeMode] = useState<"today" | "week" | "calendar">("today");
  const [selectedWorld, setSelectedWorld] = useState<string | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ lens: AdaptiveLens; query?: string }>).detail;
      setLens(detail.lens);
      if (detail.query === "week") setTimeMode("week");
      if (detail.query === "calendar") setTimeMode("calendar");
      if (detail.query && worlds.some((world) => world.id === detail.query)) { setSelectedWorld(detail.query); setLens("worlds"); }
      document.getElementById("architecture-core")?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("cedrus-adaptive-nav", handler);
    return () => window.removeEventListener("cedrus-adaptive-nav", handler);
  }, []);
  const selected = selectedWorld ? worlds.find((world) => world.id === selectedWorld) : null;
  return <><header className="architecture-title adaptive-title"><div><span>C · ADAPTIVE OS</span><h1>{lens === "now" ? "What matters right now." : lens === "time" ? "A stable place for precision." : lens === "worlds" ? selected ? `${selected.name}, assembled.` : "Enter a world." : "What changed remains findable."}</h1></div><div className="surface-tabs">{(["now", "time", "worlds", "memory"] as AdaptiveLens[]).map((item) => <button className={lens === item ? "active" : ""} type="button" onClick={() => { setLens(item); if (item !== "worlds") setSelectedWorld(null); }} key={item}>{item}</button>)}</div></header>{lens === "now" && <AdaptiveNow onAgent={onAgent} onLens={setLens} />}{lens === "time" && <section className="adaptive-time"><div className="precision-switch adaptive-switch">{(["today", "week", "calendar"] as const).map((item) => <button className={timeMode === item ? "active" : ""} type="button" onClick={() => setTimeMode(item)} key={item}>{item}</button>)}</div>{timeMode === "today" ? <DayTimeline /> : timeMode === "week" ? <WeekSurface /> : <PrecisionCalendar />}</section>}{lens === "worlds" && (selected ? <WorldEnvironment id={selected.id as Exclude<WorldView, "today">} onToday={() => { setLens("time"); setTimeMode("today"); }} onAgent={onAgent} /> : <WorldsIndex onSelect={setSelectedWorld} />)}{lens === "memory" && <MemorySurface />}</>;
}

export function ArchitectureApp({ variant }: { variant: ArchitectureVariant }) {
  const facts = useMemo(architectureFacts, []);
  const plan = useMemo(() => buildPlan(facts), [facts]);
  const [minute, setMinute] = useState(currentMiamiMinute);
  const [agentOpen, setAgentOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [askReply, setAskReply] = useState<string | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const miamiTime = useMiamiClock();
  const meta = variantMeta[variant];

  useEffect(() => {
    const onScroll = () => setScrollProgress(Math.min(1, window.scrollY / (window.innerHeight * 0.8)));
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function navigate(value: string) {
    if (variant === "time") window.dispatchEvent(new CustomEvent("cedrus-time-nav", { detail: value as TimeView }));
    if (variant === "worlds") window.dispatchEvent(new CustomEvent("cedrus-world-nav", { detail: value as WorldView }));
    if (variant === "adaptive") window.dispatchEvent(new CustomEvent("cedrus-adaptive-nav", { detail: { lens: value as AdaptiveLens } }));
  }

  function submitAsk(event: React.FormEvent) {
    event.preventDefault();
    const value = ask.trim().toLowerCase();
    if (!value) return;
    if (value.includes("agent") || value.includes("result")) setAgentOpen(true);
    else if (variant === "time") {
      const view: TimeView = value.includes("week") ? "week" : value.includes("ascendo") || value.includes("project") ? "projects" : value.includes("change") || value.includes("memory") ? "memory" : "today";
      window.dispatchEvent(new CustomEvent("cedrus-time-nav", { detail: view }));
    } else if (variant === "worlds") {
      const view: WorldView = value.includes("cedrus") ? "cedrus" : value.includes("play nice") ? "play-nice" : value.includes("personal") ? "personal" : value.includes("ascendo") || value.includes("waiting") ? "ascendo" : "today";
      window.dispatchEvent(new CustomEvent("cedrus-world-nav", { detail: view }));
    } else {
      let lens: AdaptiveLens = "now";
      let query: string | undefined;
      if (value.includes("week")) { lens = "time"; query = "week"; }
      else if (value.includes("calendar") || value.includes("plan")) { lens = "time"; query = "calendar"; }
      else if (value.includes("ascendo")) { lens = "worlds"; query = "ascendo"; }
      else if (value.includes("waiting")) { lens = "worlds"; query = "ascendo"; }
      else if (value.includes("change") || value.includes("memory") || value.includes("replay")) lens = "memory";
      window.dispatchEvent(new CustomEvent("cedrus-adaptive-nav", { detail: { lens, query } }));
    }
    setAskReply(`Cedrus assembled “${ask.trim()}”.`);
    setAsk("");
    window.setTimeout(() => setAskReply(null), 4200);
  }

  const navItems = variant === "time" ? ["today", "week", "projects", "memory"] : variant === "worlds" ? ["today", "ascendo", "cedrus", "play-nice", "personal"] : ["now", "time", "worlds", "memory"];
  return (
    <div className={`cedrus-app architecture-app variant-${variant} tone-sunset world-ready shell-awake ${scrollProgress > 0.58 ? "desk-entered" : ""}`} style={{ "--desk-progress": scrollProgress } as CSSProperties}>
      <header className="world-header architecture-header"><button className="wordmark" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>CEDRUS</button><nav className="top-navigation" aria-label={`${meta.label} navigation`}>{navItems.map((item) => <button type="button" onClick={() => navigate(item)} key={item}>{item === "play-nice" ? "play nice" : item}</button>)}</nav><div className="world-signal"><button className="architecture-agent-signal" type="button" onClick={() => setAgentOpen(true)}><i />1 working · 1 needs you</button><time>{miamiTime}</time><small>MIAMI</small></div></header>
      <section className="world-journey" aria-label="Cedrus world"><div className="world-sticky"><Horizon facts={facts} plan={plan} day={facts.now.day} scrubMinute={minute} onScrub={setMinute} presentation={{ eyebrow: meta.label, headline: meta.headline, detail: meta.subline, tone: "focus" }} /><p className="world-thesis">{meta.subline}</p><button className="world-scroll-cue" type="button" onClick={() => document.getElementById("architecture-core")?.scrollIntoView({ behavior: "smooth" })}><span /><small>{meta.cue}</small></button></div></section>
      <main className="architecture-core" id="architecture-core">{variant === "time" ? <TimePrototype onAgent={() => setAgentOpen(true)} /> : variant === "worlds" ? <WorldsPrototype onAgent={() => setAgentOpen(true)} /> : <AdaptivePrototype onAgent={() => setAgentOpen(true)} />}</main>
      <form className="architecture-ask" onSubmit={submitAsk}><span>ASK CEDRUS</span><input value={ask} onChange={(event) => setAsk(event.target.value)} placeholder={variant === "adaptive" ? "show me my week…" : variant === "worlds" ? "what’s going on with Ascendo?" : "what should move today?"} aria-label="Ask Cedrus" /><button type="submit">↵</button></form>
      {askReply && <aside className="ask-toast" aria-live="polite"><Sparkles size={14} />{askReply}</aside>}
      <AgentSheet open={agentOpen} onClose={() => setAgentOpen(false)} variant={variant} />
    </div>
  );
}
