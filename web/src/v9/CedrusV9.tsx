import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  CloudOff,
  Database,
  Dumbbell,
  Eye,
  FileClock,
  FileText,
  GitBranch,
  HeartPulse,
  History,
  Link2,
  ListChecks,
  Map as MapIcon,
  MessageCircle,
  Mic,
  Pause,
  Phone,
  Play,
  Plus,
  RefreshCcw,
  Route,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TimerReset,
  Undo2,
  Upload,
  Waves,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

type View = "now" | "day" | "programs" | "runs" | "connect" | "atlas";
type ProgramTab = "overview" | "plan" | "progress" | "sources";
type Channel = "ask" | "call" | "text";
type DayLayer = "program" | "workstream" | "loop" | "decision" | "run" | "fixed";
type ConnectionStatus = "live" | "local" | "requested" | "disconnected" | "stale";
type RunStatus = "ready" | "approval" | "running" | "blocked" | "complete";

type Program = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  readiness: number;
  readinessLabel: string;
  progress: number;
  progressDetail: string;
  nextTitle: string;
  nextMeta: string;
  accent: "jade" | "gold" | "slate";
  source: string;
};

type TimelineItem = {
  id: string;
  start: string;
  end: string;
  title: string;
  detail: string;
  kind: "fixed" | "placed" | "protected" | "approval";
  layer: DayLayer;
  source: string;
  outcome: string;
  reason: string;
  icon: ReactNode;
};

type CompileIssue = {
  severity: "warning" | "question";
  title: string;
  detail: string;
};

type RuleTrace = {
  source: string;
  rule: string;
  adaptation: string;
  ownership: "source" | "inferred";
};

type CompileResult = {
  fileName: string;
  title: string;
  rules: number;
  assumptions: number;
  times: string[];
  durations: string[];
  preview: string[];
  issues: CompileIssue[];
  traces: RuleTrace[];
  fingerprint: string;
  text: string;
};

type PlanRevision = {
  id: string;
  programTitle: string;
  fileName: string;
  createdAt: string;
  rules: number;
  issues: number;
  fingerprint: string;
};

type ExecutionRun = {
  id: string;
  title: string;
  detail: string;
  status: RunStatus;
  source: string;
  outcome: string;
  artifact: string;
  budget: string;
};

type ChatMessage = { role: "user" | "cedrus"; text: string };

const initialPrograms: Program[] = [
  {
    id: "triathlon",
    title: "Triathlon",
    subtitle: "80 days",
    image: "/v8/triathlon.png",
    readiness: 72,
    readinessLabel: "Good",
    progress: 34,
    progressDetail: "27 of 80 days",
    nextTitle: "Open-water swim",
    nextMeta: "Today · 7:00 AM · proposed 45 min",
    accent: "jade",
    source: "triathlon-plan.md",
  },
  {
    id: "pickleball",
    title: "Pickleball beta",
    subtitle: "9 days",
    image: "/v8/pickleball.png",
    readiness: 61,
    readinessLabel: "Fair",
    progress: 22,
    progressDetail: "2 of 9 days",
    nextTitle: "Launch sequence",
    nextMeta: "Today · 10:30 AM · 90 min",
    accent: "gold",
    source: "GitHub + Drive",
  },
  {
    id: "travel",
    title: "New York trip",
    subtitle: "next week",
    image: "/v8/travel.png",
    readiness: 84,
    readinessLabel: "Ready",
    progress: 68,
    progressDetail: "8 of 12 details",
    nextTitle: "Confirm hotel gym",
    nextMeta: "Friday · 12 min",
    accent: "slate",
    source: "Calendar + email",
  },
];

const baseTimeline: TimelineItem[] = [
  { id: "routine", start: "6:00", end: "6:30", title: "Morning routine + mobility", detail: "Program occurrence · locked", kind: "fixed", layer: "program", source: "morning-protocol.md", outcome: "Start days with capacity", reason: "The source plan marks this as a daily 6:00 AM commitment.", icon: <Zap size={15} /> },
  { id: "swim", start: "7:00", end: "7:45", title: "Open-water swim", detail: "Triathlon · adapted from 60 min", kind: "placed", layer: "program", source: "triathlon-build-v4.md", outcome: "Finish Olympic Triathlon", reason: "This preserves the week’s key swim while removing threshold work after the lower recovery signal.", icon: <Waves size={15} /> },
  { id: "coach", start: "9:00", end: "9:30", title: "Coach check-in", detail: "Confirmed commitment · fixed", kind: "fixed", layer: "fixed", source: "manual commitment", outcome: "Finish Olympic Triathlon", reason: "A confirmed commitment is treated as fixed until a calendar connection becomes available.", icon: <MessageCircle size={15} /> },
  { id: "launch", start: "10:30", end: "12:00", title: "Pickleball launch sequence", detail: "Workstream next action · protected", kind: "protected", layer: "workstream", source: "Pickleball beta workstream", outcome: "Ship a clean private beta", reason: "This is the only ready next action that clears the onboarding blocker before Friday.", icon: <Sparkles size={15} /> },
  { id: "lunch", start: "12:30", end: "1:15", title: "Lunch with Maya", detail: "Personal commitment · fixed", kind: "fixed", layer: "fixed", source: "manual commitment", outcome: "Protect important relationships", reason: "You marked this as a commitment; Cedrus plans around it rather than moving it.", icon: <CalendarDays size={15} /> },
  { id: "compiler", start: "1:15", end: "1:30", title: "Review compiler run", detail: "Agent run · approval required", kind: "approval", layer: "run", source: "local executor digest", outcome: "Build Cedrus V9", reason: "The run is complete but cannot publish its proposed plan revision without your approval.", icon: <Bot size={15} /> },
  { id: "pricing", start: "2:45", end: "3:05", title: "Decide beta pricing", detail: "Decision · blocks onboarding", kind: "protected", layer: "decision", source: "Pickleball beta decision inbox", outcome: "Ship a clean private beta", reason: "Two onboarding tasks cannot progress until this choice is made.", icon: <GitBranch size={15} /> },
  { id: "venue", start: "3:20", end: "3:30", title: "Follow up with venue", detail: "Open loop · waiting 4 days", kind: "placed", layer: "loop", source: "promise captured from email", outcome: "Confirm New York trip", reason: "The follow-up cadence reached its review point and no response has arrived.", icon: <MessageCircle size={15} /> },
  { id: "strength", start: "5:15", end: "6:07", title: "Strength", detail: "Triathlon · moved for recovery", kind: "placed", layer: "program", source: "triathlon-build-v4.md", outcome: "Finish Olympic Triathlon", reason: "Moving the session protects recovery after the swim without sacrificing the launch block.", icon: <Dumbbell size={15} /> },
];

const connectors = [
  { id: "brief", name: "Daily Brief", detail: "Unattended 7:00 AM composition", icon: <Sparkles size={18} />, initialStatus: "live" as ConnectionStatus, access: "read + deliver", freshness: "delivered this morning" },
  { id: "twilio", name: "Twilio", detail: "Allowlisted inbound and outbound SMS", icon: <Phone size={18} />, initialStatus: "live" as ConnectionStatus, access: "read + approved send", freshness: "production verified" },
  { id: "email", name: "Resend", detail: "Idempotent outbound email ledger", icon: <Send size={18} />, initialStatus: "live" as ConnectionStatus, access: "outbound only", freshness: "healthy" },
  { id: "observer", name: "Local Observer", detail: "Redacted coding-session digests", icon: <Eye size={18} />, initialStatus: "local" as ConnectionStatus, access: "local read", freshness: "awaiting consumption" },
  { id: "calendar", name: "Google Calendar", detail: "Fixed events and approved schedule writes", icon: <CalendarDays size={18} />, initialStatus: "disconnected" as ConnectionStatus, access: "none", freshness: "not connected" },
  { id: "health", name: "Apple Health", detail: "Recovery, sleep, HRV, and workouts", icon: <HeartPulse size={18} />, initialStatus: "disconnected" as ConnectionStatus, access: "none", freshness: "not connected" },
  { id: "strava", name: "Strava", detail: "Activities and completion evidence", icon: <Activity size={18} />, initialStatus: "disconnected" as ConnectionStatus, access: "none", freshness: "not connected" },
  { id: "github", name: "GitHub", detail: "Repositories and watched plan files", icon: <GitBranch size={18} />, initialStatus: "requested" as ConnectionStatus, access: "proposed read", freshness: "setup pending" },
];

const initialRuns: ExecutionRun[] = [
  { id: "compile", title: "Compile Triathlon Build v4", detail: "Six rules extracted; one schedule assumption needs review.", status: "approval", source: "triathlon-build-v4.md", outcome: "Finish Olympic Triathlon", artifact: "plan-revision-preview.json", budget: "18.4k tokens · no external writes" },
  { id: "observer", title: "Digest yesterday’s coding session", detail: "Converted the local session into accomplishments, blockers, and next actions.", status: "complete", source: "Local Observer · redacted digest", outcome: "Build Cedrus V9", artifact: "session-digest-2026-08-25.md", budget: "4.2k tokens · local only" },
  { id: "trip", title: "Prepare New York constraints", detail: "Waiting for calendar and hotel-gym evidence before composing the trip week.", status: "blocked", source: "New York trip program", outcome: "Travel without losing training continuity", artifact: "No artifact yet", budget: "Paused · 0 external writes" },
  { id: "brief", title: "Compose morning brief", detail: "Rendered one composition into SMS and email with matching citations.", status: "complete", source: "07:00 scheduled job", outcome: "Know what deserves attention", artifact: "brief-composition-2026-08-26.json", budget: "32.1k tokens · 2 messages" },
];

export function compileMarkdown(fileName: string, text: string): CompileResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#\s+/.test(line));
  const frontmatterTitle = text.match(/^---[\s\S]*?\ntitle:\s*(.+)$/m)?.[1]?.trim();
  const title = frontmatterTitle || heading?.replace(/^#\s+/, "") || fileName.replace(/\.md$/i, "");
  const ruleLines = lines.filter((line) => /^[-*]\s+/.test(line) || /\b(must|never|every|daily|weekly|required|deadline|duration|preferred|before|after)\b/i.test(line));
  const assumptionLines = lines.filter((line) => /\b(prefer|ideally|around|maybe|usually|if possible|roughly)\b/i.test(line));
  const times = [...text.matchAll(/\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi)].map((match) => match[0]).slice(0, 5);
  const durations = [...text.matchAll(/\b\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b/gi)].map((match) => match[0]).slice(0, 5);
  const preview = ruleLines.slice(0, 4).map((line) => line.replace(/^[-*]\s+/, ""));
  const issues: CompileIssue[] = [];
  if (durations.length === 0) issues.push({ severity: "warning", title: "Durations are missing", detail: "Cedrus cannot reserve honest blocks until the plan defines or approves durations." });
  if (times.length === 0) issues.push({ severity: "question", title: "No preferred windows found", detail: "The scheduler can choose legal openings, but it needs to know whether any time of day should be protected." });
  if (!/\b(outcome|goal|success|finish|ship|complete|race)\b/i.test(text)) issues.push({ severity: "question", title: "Outcome is implicit", detail: "Attach a clear outcome so scheduled work has a visible line of sight." });
  if (/\b(?:every day|daily)\b/i.test(text) && !/\b(?:weekend|saturday|sunday|seven days|7 days)\b/i.test(text)) issues.push({ severity: "question", title: "Daily may include weekends", detail: "Confirm whether the recurrence applies seven days a week." });
  if (/\bnever\b/i.test(text) && /\bif possible\b/i.test(text)) issues.push({ severity: "warning", title: "Hard and soft language coexist", detail: "Review whether every “never” is truly hard and every “if possible” may yield." });
  const traces = ruleLines.slice(0, 6).map((line, index) => {
    const source = line.replace(/^[-*]\s+/, "");
    const ownership: RuleTrace["ownership"] = /\b(prefer|ideally|around|if possible|usually)\b/i.test(source) ? "inferred" : "source";
    return {
      source,
      rule: `Rule ${String(index + 1).padStart(2, "0")} · ${/\bnever|must|required|deadline\b/i.test(source) ? "hard constraint" : "schedulable instruction"}`,
      adaptation: ownership === "source" ? "Preserve unless a direct conflict requires a choice." : "Cedrus may adapt after showing the consequence.",
      ownership,
    };
  });
  const fingerprint = Array.from(text).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 2166136261).toString(16).padStart(8, "0");
  return {
    fileName,
    title,
    rules: Math.max(ruleLines.length, Math.min(12, Math.max(1, Math.round(lines.length / 6)))),
    assumptions: assumptionLines.length,
    times,
    durations,
    preview,
    issues,
    traces,
    fingerprint,
    text,
  };
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function layerLabel(layer: DayLayer) {
  return ({ program: "PROGRAM", workstream: "WORKSTREAM", loop: "OPEN LOOP", decision: "DECISION", run: "AGENT RUN", fixed: "COMMITMENT" } as Record<DayLayer, string>)[layer];
}

function connectionLabel(status: ConnectionStatus) {
  return ({ live: "live", local: "local only", requested: "setup pending", disconnected: "not connected", stale: "stale" } as Record<ConnectionStatus, string>)[status];
}

function ProductNav({ view, onView, onAsk, dark = false }: { view: View; onView: (view: View) => void; onAsk: () => void; dark?: boolean }) {
  return (
    <header className={`v8-nav ${dark ? "is-dark" : ""}`}>
      <button className="v8-wordmark" type="button" onClick={() => onView("now")}><i /> CEDRUS <small>V9</small></button>
      <nav aria-label="Main navigation">
        {(["now", "day", "programs", "runs", "atlas", "connect"] as View[]).map((item) => (
          <button key={item} className={view === item ? "is-active" : ""} type="button" onClick={() => onView(item)}>{item}</button>
        ))}
      </nav>
      <button className="v8-result" type="button" onClick={onAsk}><span /> brief current · ask</button>
    </header>
  );
}

function ScoreRing({ value, label, accent }: { value: number; label: string; accent: Program["accent"] }) {
  const color = accent === "jade" ? "#2d7659" : accent === "gold" ? "#b78e2e" : "#65737c";
  return (
    <div className="v8-score-wrap">
      <div className="v8-score" style={{ background: `conic-gradient(${color} ${value * 3.6}deg, rgba(84,72,58,.12) 0deg)` }}><span>{value}</span></div>
      <small>{label}</small>
    </div>
  );
}

function ProgramCard({ program, onOpen, onStart }: { program: Program; onOpen: () => void; onStart: () => void }) {
  return (
    <article className={`v8-program-card accent-${program.accent}`}>
      <button className="program-photo" type="button" onClick={onOpen} style={{ backgroundImage: `url(${program.image})` }} aria-label={`Open ${program.title}`} />
      <div className="program-identity">
        <span>ACTIVE PROGRAM</span>
        <h3>{program.title} <small>· {program.subtitle}</small></h3>
        <p>{program.id === "triathlon" ? "Build endurance, resilience, and race readiness around the life you actually live." : program.id === "pickleball" ? "Move the private beta from working code to a clean first experience." : "Keep travel, training, work, and people reconciled before departure."}</p>
        <button type="button" onClick={onOpen}>why this plan? <ChevronRight size={13} /></button>
      </div>
      <ScoreRing value={program.readiness} label={program.readinessLabel} accent={program.accent} />
      <div className="program-next"><span>NEXT</span><strong>{program.nextTitle}</strong><small>{program.nextMeta}</small></div>
      <div className="program-progress"><span>PROGRESS</span><strong>{program.progress}%</strong><div><i style={{ width: `${program.progress}%` }} /></div><small>{program.progressDetail}</small></div>
      <button className="program-action" type="button" onClick={program.id === "triathlon" ? onStart : onOpen}>{program.id === "triathlon" ? "Start" : "View"}</button>
    </article>
  );
}

function NowView({ programs, adapted, onView, onAsk, onOpenProgram, onStartWorkout, recentImport }: {
  programs: Program[];
  adapted: boolean;
  onView: (view: View) => void;
  onAsk: () => void;
  onOpenProgram: (id: string) => void;
  onStartWorkout: () => void;
  recentImport: CompileResult | null;
}) {
  const nextRef = useRef<HTMLDivElement>(null);
  const timeline = adapted ? baseTimeline.map((item) => item.id === "swim" ? { ...item, end: "7:30", detail: "Reduced to 30 min · recovery mode", reason: "The plan remains alive while intensity and duration yield to the recovery signal." } : item.id === "strength" ? { ...item, start: "5:45", end: "6:30", detail: "Reduced and moved · recovery mode" } : item) : baseTimeline;
  return (
    <div className="v8-now v9-now">
      <section className="v8-world">
        <ProductNav view="now" onView={onView} onAsk={onAsk} dark />
        <div className="v8-sun" /><div className="v8-haze" /><div className="v8-ridge ridge-back" /><div className="v8-ridge ridge-front" />
        <div className="world-copy">
          <span>ONE COMPOSITION · MIAMI</span>
          <h1>{adapted ? <>Recover today.<br />Important work still fits.</> : <>A demanding day.<br />Still workable.</>}</h1>
          <p>{adapted ? "Recovery mode reduced the training load without moving a commitment or publishing anything externally." : "Protect the swim and one focused block. Let the rest stay flexible."}</p>
        </div>
        <div className="world-markers" aria-label="Today in the horizon">
          {[timeline[1], timeline[2], timeline[3], timeline[5]].map((item, index) => <button key={item.id} style={{ left: `${17 + index * 22}%` }} type="button" onClick={() => onView("day")}><span>{item.start}</span><strong>{item.title.replace(" sequence", "")}</strong><i /></button>)}
        </div>
        <div className="world-dock">
          <button type="button" onClick={onAsk}><MessageCircle size={15} /> Ask</button>
          <button type="button" onClick={onAsk}><Phone size={15} /> Call</button>
          <button type="button" onClick={onAsk}><Smartphone size={15} /> Text</button>
        </div>
        <button className="world-scroll" type="button" onClick={() => nextRef.current?.scrollIntoView({ behavior: "smooth" })}>your day, assembled <ChevronDown size={14} /></button>
      </section>

      <div className="v9-command-strip" ref={nextRef}>
        <button type="button" onClick={() => onOpenProgram("triathlon")}><span>PROTECT</span><strong>Open-water swim</strong><small>Key session · race outcome</small></button>
        <button type="button" onClick={() => onView("day")}><span>CONSTRAINT</span><strong>Launch sequence by noon</strong><small>Protected workstream · 90 min</small></button>
        <button type="button" onClick={() => onAsk()}><span>CHANGED</span><strong>{adapted ? "Recovery mode is active" : "One approval is waiting"}</strong><small>{adapted ? "Two training blocks adapted" : "No external writes have occurred"}</small></button>
      </div>

      <div className="v8-home v9-home">
        <section className="v8-next">
          <header><div><span>WEDNESDAY · AUGUST 26</span><h2>The next edge of the day.</h2></div><button type="button" onClick={() => onView("day")}>open full day <ArrowRight size={15} /></button></header>
          <article className="v9-choice-point">
            <span>CHOICE POINT</span>
            <h3>Protect the swim or the launch?</h3>
            <p>Both still fit, but restoring the full swim would remove the only realistic recovery buffer.</p>
            <div><button type="button" onClick={() => onView("day")}>protect both</button><button type="button" onClick={() => onView("day")}>show ripple</button></div>
          </article>
          <div className="next-list">
            {timeline.slice(1, 7).map((item) => <button key={item.id} type="button" onClick={() => onView(item.layer === "run" ? "runs" : "day")}><time>{item.start}</time><i className={`is-${item.kind}`} /><div><span>{layerLabel(item.layer)}</span><strong>{item.title}</strong><small>{item.detail}</small></div><ChevronRight size={15} /></button>)}
          </div>
        </section>

        <section className="v8-programs-home">
          <header><div><span>ACTIVE PROGRAMS</span><h2>Plans Cedrus is keeping alive.</h2></div><button type="button" onClick={() => onView("connect")}><Plus size={15} /> add program</button></header>
          <button className="compile-banner" type="button" onClick={() => onView("connect")}><FileText size={15} /><span><strong>{recentImport?.fileName ?? "triathlon-build-v4.md"}</strong> · {recentImport?.rules ?? 12} rules · immutable revision</span><Check size={15} /></button>
          <div className="program-card-list">
            {programs.slice(0, 2).map((program) => <ProgramCard key={program.id} program={program} onOpen={() => onOpenProgram(program.id)} onStart={onStartWorkout} />)}
          </div>
          <button className="all-programs" type="button" onClick={() => onView("programs")}>view all programs <ArrowRight size={14} /></button>
        </section>
      </div>
    </div>
  );
}

function DayView({ programs, adapted, onView, onAsk, connectionStates }: { programs: Program[]; adapted: boolean; onView: (view: View) => void; onAsk: () => void; connectionStates: Record<string, ConnectionStatus> }) {
  const timeline = useMemo(() => adapted ? baseTimeline.map((item) => item.id === "swim" ? { ...item, end: "7:30", detail: "Reduced to 30 min · recovery mode" } : item.id === "strength" ? { ...item, start: "5:45", end: "6:30", detail: "Reduced and moved · recovery mode" } : item) : baseTimeline, [adapted]);
  const [selectedId, setSelectedId] = useState("swim");
  const [layer, setLayer] = useState<DayLayer | "all">("all");
  const [showRipple, setShowRipple] = useState(false);
  const selected = timeline.find((item) => item.id === selectedId) ?? timeline[1];
  const visibleTimeline = layer === "all" ? timeline : timeline.filter((item) => item.layer === layer);
  return (
    <div className="v8-surface v9-day-surface">
      <ProductNav view="day" onView={onView} onAsk={onAsk} />
      <main className="day-layout">
        <aside className="day-programs">
          <span className="v8-kicker">PROGRAMS</span>
          <h2>What time is serving.</h2>
          {programs.map((program) => <button key={program.id} className={program.id === "triathlon" ? "is-selected" : ""} type="button"><img src={program.image} alt="" /><span><strong>{program.title}</strong><small>{program.subtitle}</small></span><ChevronRight size={14} /></button>)}
          <button className="day-add" type="button" onClick={() => onView("connect")}><Plus size={14} /> Add plan</button>
          <div className="day-connections"><span className="v8-kicker">SYSTEM TRUTH</span>{connectors.slice(0, 5).map((connector) => <div key={connector.id}>{connector.icon}<span>{connector.name}</span><i className={`is-${connectionStates[connector.id]}`} title={connectionLabel(connectionStates[connector.id])} /></div>)}</div>
        </aside>

        <section className="day-runway">
          <header><div><span className="v8-kicker">TODAY · AUGUST 26</span><h1>Wednesday’s runway</h1></div><div className="day-legend"><span><i className="fixed" /> fixed</span><span><i className="placed" /> Cedrus placed</span></div></header>
          <nav className="v9-layer-filter" aria-label="Day layers">
            {(["all", "program", "workstream", "loop", "decision", "run"] as const).map((item) => <button key={item} className={layer === item ? "is-active" : ""} type="button" onClick={() => setLayer(item)}>{item === "all" ? "all layers" : layerLabel(item)}</button>)}
          </nav>
          <div className="runway-grid">
            <div className="runway-list">
              <div className="runway-line" />
              {visibleTimeline.map((item) => <button key={item.id} className={`runway-item is-${item.kind} ${selectedId === item.id ? "is-selected" : ""}`} type="button" onClick={() => { setSelectedId(item.id); setShowRipple(false); }}><time>{item.start}</time><i /><div>{item.icon}<span><b>{layerLabel(item.layer)}</b><strong>{item.title}</strong><small>{item.start}—{item.end} · {item.detail}</small></span></div></button>)}
            </div>
            <article className="placement-detail">
              <span className="v8-kicker">{layerLabel(selected.layer)} · SELECTED</span>
              <h2>{selected.title}</h2>
              <p>{selected.start}—{selected.end} · {selected.kind === "fixed" ? "confirmed commitment" : selected.kind === "approval" ? "awaiting your approval" : "placed by Cedrus"}</p>
              <div className="v9-line-of-sight"><span>ADVANCES</span><strong>{selected.outcome}</strong><small>Source · {selected.source}</small></div>
              <div className="constraint-list"><span className="v8-kicker">LEGALITY CHECK</span>{["No confirmed commitment moved", "Protected focus remains intact", "Recovery buffer stays legal", "External writes require approval"].map((label) => <div key={label}><Check size={14} /><span>{label}</span></div>)}</div>
              <div className="why-placement"><span className="v8-kicker">WHY HERE?</span><p>{selected.reason}</p></div>
              <button type="button" onClick={() => setShowRipple((value) => !value)}>{showRipple ? "hide ripple" : "preview ripple"} <ArrowRight size={14} /></button>
              {showRipple && <div className="v9-ripple-preview"><header><RefreshCcw size={14} /><span><strong>Ghost schedule only</strong><small>Nothing has changed</small></span></header><div><span>Restore full swim</span><b>+15 min</b></div><div><span>Recovery buffer</span><b>−22 min</b></div><div><span>Launch sequence</span><b>unchanged</b></div><button type="button" onClick={() => setShowRipple(false)}>keep current plan</button></div>}
            </article>
          </div>
        </section>

        <aside className="day-noticed">
          <span className="v8-kicker">CHOICE POINT</span>
          <h2>Protect the swim or the launch?</h2>
          <article><HeartPulse size={18} /><div><strong>{adapted ? "Recovery mode active" : "Readiness is inferred"}</strong><small>{adapted ? "User-reported low sleep" : "Health connection is not live"}</small></div></article>
          <div className="noticed-copy"><strong>Both fit at the current intensity.</strong><p>Restoring the full swim removes the only realistic buffer before the launch block. Cedrus will not silently make that trade.</p></div>
          <button type="button" onClick={() => setShowRipple(true)}>show the consequence <ChevronRight size={14} /></button>
          <button className="v9-noticed-secondary" type="button" onClick={onAsk}>ask Cedrus why <ChevronRight size={14} /></button>
        </aside>
      </main>
    </div>
  );
}

function ProgramsView({ programs, selectedId, onSelect, onView, onAsk, onStartWorkout, revisions, connectionStates }: { programs: Program[]; selectedId: string; onSelect: (id: string) => void; onView: (view: View) => void; onAsk: () => void; onStartWorkout: () => void; revisions: PlanRevision[]; connectionStates: Record<string, ConnectionStatus> }) {
  const [tab, setTab] = useState<ProgramTab>("overview");
  const program = programs.find((item) => item.id === selectedId) ?? programs[0];
  const isTriathlon = program.id === "triathlon";
  return (
    <div className="v8-surface">
      <ProductNav view="programs" onView={onView} onAsk={onAsk} />
      <main className="programs-layout">
        <aside className="programs-rail"><span className="v8-kicker">PROGRAMS</span><h2>Plans with a pulse.</h2>{programs.map((item) => <button key={item.id} className={item.id === program.id ? "is-selected" : ""} type="button" onClick={() => { onSelect(item.id); setTab("overview"); }}><img src={item.image} alt="" /><span><strong>{item.title}</strong><small>{item.subtitle} · {item.progress}%</small></span></button>)}<button className="programs-add" type="button" onClick={() => onView("connect")}><Plus size={14} /> connect or import</button></aside>
        <section className="program-detail">
          <header className="program-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(17,20,19,.76), rgba(17,20,19,.08)), url(${program.image})` }}><div><span>ACTIVE PROGRAM · {program.source}</span><h1>{program.title}</h1><p>{program.subtitle} · Cedrus is adapting the plan without changing its intent.</p><button type="button" onClick={() => onView("atlas")}><MapIcon size={15} /> open outcome atlas</button></div></header>
          <nav className="program-tabs" aria-label="Program detail">{(["overview", "plan", "progress", "sources"] as ProgramTab[]).map((item) => <button key={item} className={tab === item ? "is-active" : ""} type="button" onClick={() => setTab(item)}>{item}</button>)}</nav>
          {tab === "overview" && (
            <div className="program-overview">
              <section className="today-briefing"><header><div><span className="v8-kicker">TODAY’S BRIEFING</span><h2>{isTriathlon ? "Open-water swim" : program.nextTitle}</h2><p>{isTriathlon ? "Today · 7:00 AM · planned 60 / proposed 45 min" : program.nextMeta}</p></div><ScoreRing value={program.readiness} label={program.readinessLabel} accent={program.accent} /></header>{isTriathlon ? <><div className="briefing-steps"><div><span>PLAN</span><strong>60 min</strong></div><div><span>ACTUAL</span><strong>Not started</strong></div><div><span>ADAPTATION</span><strong>−15 min</strong></div><div><span>EVIDENCE</span><strong>User review</strong></div></div><button type="button" onClick={onStartWorkout}><Play size={15} /> start living session</button></> : <><p className="program-copy">Cedrus assembled the relevant context, protected the right block, and left the rest of the day flexible.</p><button type="button" onClick={() => onView("day")}>open in day <ArrowRight size={14} /></button></>}</section>
              <section className="program-signals"><span className="v8-kicker">CURRENT SIGNALS</span><h2>What the plan actually sees.</h2>{(isTriathlon ? [["Readiness", "72 · user-entered"], ["Health connection", "Not connected"], ["Last session", "Bike endurance · complete"], ["Travel effect", "New York week needs review"]] : [["Open issues", "5 · two block onboarding"], ["Protected time", "90 minutes today"], ["Repository", "Setup pending"], ["Next decision", "Pricing before onboarding"]]).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
              <section className="program-arc"><span className="v8-kicker">PROGRAM ARC</span><h2>{program.progressDetail}</h2><div className="arc-track"><i style={{ width: `${program.progress}%` }} /></div><div className="arc-labels"><span>Build</span><span>Sharpen</span><span>Perform</span><span>Learn</span></div></section>
            </div>
          )}
          {tab === "plan" && <div className="plan-sheet"><header><div><span className="v8-kicker">SOURCE OF TRUTH</span><h2>{program.source}</h2><p className="v9-revision-note"><History size={13} /> {revisions[0] ? `Revision ${revisions[0].id} · ${revisions[0].fingerprint}` : "Bundled demo revision · original preserved"}</p></div><button type="button" onClick={() => onView("connect")}><GitBranch size={14} /> compile new revision</button></header><div className="compile-summary"><div><strong>12</strong><span>source rules</span></div><div><strong>3</strong><span>reviewable assumptions</span></div><div><strong>0</strong><span>silent mutations</span></div></div><div className="rule-table">{[["Open-water swim", "2× weekly · planned 60m", "Source-owned"], ["Long ride", "Saturday · 150m", "Hard 3-hour window"], ["Strength", "2× weekly · 50m", "18h from long ride"], ["Recovery adaptation", "Reduce before dropping", "Cedrus-inferred"]].map((row, index) => <div key={row[0]}><span>{String(index + 1).padStart(2, "0")}</span><strong>{row[0]}</strong><p>{row[1]}</p><small>{row[2]}</small></div>)}</div></div>}
          {tab === "progress" && <div className="progress-sheet"><header><span className="v8-kicker">PROGRESS · PLAN VS ACTUAL</span><h2>The plan is producing evidence.</h2></header>{[["Weekly training", 76, "5h 42m actual / 7h 30m planned"], ["Run durability", 58, "16.4 miles actual"], ["Bike endurance", 69, "Long ride completed at 2h 18m"], ["Swim consistency", 42, "2 actual / 3 planned"]].map(([label, value, detail]) => <div className="progress-row" key={String(label)}><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><strong>{value}%</strong><small>{detail}</small></div>)}{isTriathlon && <section className="v9-exercise-memory"><span className="v8-kicker">UNIVERSAL SESSION MEMORY</span><h3>Every session remains searchable.</h3><div><span>Open-water swim</span><strong>4 sessions · 3h 12m</strong></div><div><span>Strength · squat pattern</span><strong>8 sessions · last 165 lb</strong></div><div><span>Bike endurance</span><strong>6 sessions · longest 2h 18m</strong></div></section>}</div>}
          {tab === "sources" && <div className="sources-sheet"><header><span className="v8-kicker">SOURCES + PERMISSIONS</span><h2>What this program can truthfully see and do.</h2></header>{connectors.filter((connector) => ["brief", "observer", "calendar", "health", "strava", "github"].includes(connector.id)).map((connector) => <div key={connector.id}>{connector.icon}<span><strong>{connector.name}</strong><small>{connector.freshness} · {connector.detail}</small></span><b className={`v9-source-state is-${connectionStates[connector.id]}`}>{connectionLabel(connectionStates[connector.id])} · {connector.access}</b></div>)}</div>}
        </section>
      </main>
    </div>
  );
}

function AtlasView({ onView, onAsk }: { onView: (view: View) => void; onAsk: () => void }) {
  return (
    <div className="v8-surface atlas-surface">
      <ProductNav view="atlas" onView={onView} onAsk={onAsk} />
      <main className="atlas-layout">
        <header><span className="v8-kicker">OUTCOME ATLAS · CONVERGENCE</span><h1>See where today is actually taking you.</h1><p>Every program, workstream, open loop, decision, and run needs a visible line of sight—or it becomes drift.</p></header>
        <section className="atlas-map">
          <svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><path d="M500 280 C370 270 310 130 185 120 M500 280 C640 260 690 120 820 120 M500 280 C350 320 300 430 175 450 M500 280 C640 330 700 440 830 450" /><path className="is-soft" d="M185 120 C360 30 640 30 820 120 M175 450 C370 530 650 530 830 450" /></svg>
          <button className="atlas-now" type="button" onClick={() => onView("day")}><span>NORTH STAR</span><strong>Live an expansive, healthy life</strong><small>Today has four lines of sight</small><ArrowRight size={18} /></button>
          <article className="atlas-node node-tri"><span>TRIATHLON · 80 DAYS</span><h2>Protect useful consistency.</h2><p>The swim advances durability without consuming the launch window.</p><footer><FileText size={13} /> triathlon-build-v4.md · revisioned</footer></article>
          <article className="atlas-node node-pick"><span>PICKLEBALL BETA</span><h2>Decide pricing before onboarding.</h2><p>Two workstream actions are blocked behind one decision.</p><footer><GitBranch size={13} /> repository setup pending</footer></article>
          <article className="atlas-node node-rec"><span>RECOVERY</span><h2>Use honest evidence.</h2><p>Readiness is user-entered until a health connection is authorized.</p><footer><HeartPulse size={13} /> Health · not connected</footer></article>
          <article className="atlas-node node-trip"><span>NEW YORK TRIP</span><h2>Resolve training logistics.</h2><p>The hotel gym and calendar constraints are still unverified.</p><footer><CalendarDays size={13} /> Calendar · not connected</footer></article>
        </section>
        <section className="atlas-time"><header><span>6 AM</span><span>9 AM</span><span>12 PM</span><span>3 PM</span><span>6 PM</span><span>8 PM</span></header><div className="atlas-lane"><b>Fixed</b><i style={{ left: "7%", width: "9%" }}>Coach</i><i style={{ left: "39%", width: "10%" }}>Lunch</i></div><div className="atlas-lane placed"><b>Placed</b><i style={{ left: "2%", width: "14%" }}>Swim</i><i style={{ left: "22%", width: "18%" }}>Launch</i><i style={{ left: "69%", width: "12%" }}>Strength</i></div><div className="atlas-lane open"><b>Open</b><i style={{ left: "49%", width: "20%" }}>1h 47m open</i></div></section>
        <section className="v9-atlas-insights">
          <article><AlertTriangle size={17} /><div><span className="v8-kicker">CONFLICT FOUND</span><h2>Two outcomes want the same recovery buffer.</h2><p>The current plan preserves both. Restoring swim intensity would create an honest choice.</p></div><button type="button" onClick={() => onView("day")}>show ripple <ArrowRight size={14} /></button></article>
          <article><CloudOff size={17} /><div><span className="v8-kicker">DRIFT INBOX · 3</span><h2>Three objects have no useful line of sight.</h2><p>One stale task, one orphaned note, and one recurring block are consuming attention without advancing an outcome.</p></div><button type="button" onClick={onAsk}>review drift <ArrowRight size={14} /></button></article>
        </section>
      </main>
    </div>
  );
}

function RunsView({ runs, onStatus, onView, onAsk }: { runs: ExecutionRun[]; onStatus: (id: string, status: RunStatus) => void; onView: (view: View) => void; onAsk: () => void }) {
  const [selectedId, setSelectedId] = useState(runs[0]?.id ?? "");
  const [showDryRun, setShowDryRun] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  if (!selected) return null;
  const approve = () => {
    onStatus(selected.id, "ready");
    setReceipt(`approval-${selected.id}-0826`);
    setShowDryRun(false);
  };
  const advance = () => {
    const nextStatus: RunStatus = selected.status === "ready" ? "running" : selected.status === "running" ? "complete" : selected.status;
    onStatus(selected.id, nextStatus);
    if (nextStatus === "complete") setReceipt(`run-${selected.id}-complete-0826`);
  };
  return (
    <div className="v8-surface v9-runs-surface">
      <ProductNav view="runs" onView={onView} onAsk={onAsk} />
      <main className="v9-runs-layout">
        <aside className="v9-runs-rail">
          <span className="v8-kicker">EXECUTION QUEUE</span>
          <h2>Human-visible machine work.</h2>
          <p>A workout and an agent run share one grammar: brief, prerequisites, live state, evidence, and a finish condition.</p>
          <nav aria-label="Agent runs">{runs.map((run) => <button key={run.id} className={run.id === selected.id ? "is-selected" : ""} type="button" onClick={() => { setSelectedId(run.id); setShowDryRun(false); setReceipt(null); }}><span className={`v9-run-dot is-${run.status}`} /><span><strong>{run.title}</strong><small>{run.status} · {run.outcome}</small></span><ChevronRight size={14} /></button>)}</nav>
        </aside>
        <section className="v9-run-detail">
          <header><div><span className="v8-kicker">AGENT RUN · {selected.status}</span><h1>{selected.title}</h1><p>{selected.detail}</p></div><span className={`v9-run-status is-${selected.status}`}>{selected.status}</span></header>
          <div className="v9-run-grid">
            <article className="v9-run-brief">
              <span className="v8-kicker">RUN BRIEF</span>
              <h2>What this run is allowed to do.</h2>
              <div><span>Source</span><strong>{selected.source}</strong></div>
              <div><span>Advances</span><strong>{selected.outcome}</strong></div>
              <div><span>Budget</span><strong>{selected.budget}</strong></div>
              <div><span>Artifact</span><strong>{selected.artifact}</strong></div>
            </article>
            <article className="v9-run-timeline">
              <span className="v8-kicker">EXECUTION HISTORY</span>
              <h2>Durable, inspectable state.</h2>
              <div className="is-done"><CheckCircle2 size={15} /><span><strong>Input validated</strong><small>Source preserved · fingerprint recorded</small></span></div>
              <div className="is-done"><CheckCircle2 size={15} /><span><strong>Plan compiled</strong><small>Six rules · one question · no external writes</small></span></div>
              <div className={selected.status === "approval" ? "is-current" : "is-done"}>{selected.status === "approval" ? <Pause size={15} /> : <CheckCircle2 size={15} />}<span><strong>Human approval</strong><small>{selected.status === "approval" ? "Paused at the mutation boundary" : "Approved with a scoped receipt"}</small></span></div>
              <div className={selected.status === "complete" ? "is-done" : selected.status === "running" ? "is-current" : ""}>{selected.status === "complete" ? <CheckCircle2 size={15} /> : <TimerReset size={15} />}<span><strong>Publish local revision</strong><small>{selected.status === "complete" ? "Artifact and evidence attached" : "Ready after approval"}</small></span></div>
            </article>
          </div>
          {selected.status === "approval" && <section className="v9-approval-card"><div><ShieldCheck size={20} /><span><strong>Approval required at the exact write boundary.</strong><small>Review the proposed actions before Cedrus creates anything.</small></span></div><button type="button" onClick={() => setShowDryRun((value) => !value)}><Eye size={14} /> {showDryRun ? "hide dry run" : "review dry run"}</button></section>}
          {showDryRun && <section className="v9-dry-run"><header><div><span className="v8-kicker">DRY RUN · NOTHING DELIVERED</span><h2>Exact proposed actions</h2></div><FileClock size={21} /></header><ol><li><span>01</span><div><strong>Create one immutable plan revision</strong><small>Target: Cedrus local program store · source body remains unchanged</small></div></li><li><span>02</span><div><strong>Create 23 proposed occurrences</strong><small>No Google Calendar writes; each occurrence retains a rule trace</small></div></li><li><span>03</span><div><strong>Attach compilation receipt</strong><small>Fingerprint, assumptions, issues, actor, and approval are recorded</small></div></li></ol><footer><button type="button" onClick={() => setShowDryRun(false)}>reject</button><button type="button" className="is-primary" onClick={approve}>approve and queue <ArrowRight size={14} /></button></footer></section>}
          {(selected.status === "ready" || selected.status === "running") && <button className="v9-run-primary" type="button" onClick={advance}>{selected.status === "ready" ? <><Play size={14} /> start approved run</> : <><Check size={14} /> finish demo run</>}</button>}
          {selected.status === "complete" && <section className="v9-run-receipt"><CheckCircle2 size={18} /><span><strong>Run complete · evidence attached</strong><small>{receipt ?? selected.artifact} · safe to inspect</small></span><button type="button" onClick={() => onView("programs")}>open artifact <ArrowRight size={14} /></button></section>}
          {receipt && selected.status !== "complete" && <section className="v9-run-receipt"><ShieldCheck size={18} /><span><strong>Approval receipt created</strong><small>{receipt} · scoped to this run</small></span></section>}
        </section>
      </main>
    </div>
  );
}

function ConnectView({ onView, onAsk, connectionStates, onRequest, compile, onFile, onPublish, revisions }: {
  onView: (view: View) => void;
  onAsk: () => void;
  connectionStates: Record<string, ConnectionStatus>;
  onRequest: (id: string) => void;
  compile: CompileResult | null;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onPublish: () => void;
  revisions: PlanRevision[];
}) {
  return (
    <div className="v8-surface v9-connect-surface">
      <ProductNav view="connect" onView={onView} onAsk={onAsk} />
      <main className="connect-page">
        <header><span className="v8-kicker">UNIVERSAL COMPILER + CONNECTIONS</span><h1>Give Cedrus a source of truth.</h1><p>Compile a researched plan into reviewable rules, or request a service connection. Sources stay immutable and nothing gains write access without an explicit permission.</p></header>
        <section className="import-panel">
          <div><Upload size={20} /><span><strong>Import a Markdown program</strong><small>Drop in a researched plan, routine, project, or operating document.</small></span></div>
          <label><input type="file" accept=".md,text/markdown,text/plain" onChange={onFile} />Choose .md file</label>
        </section>
        {compile && <section className="compile-review v9-compile-review"><header><div><span className="v8-kicker">COMPILATION PREVIEW · NO MUTATION YET</span><h2>{compile.title}</h2><p>{compile.fileName} · fingerprint {compile.fingerprint}</p></div><ShieldCheck size={22} /></header><div className="compile-facts"><div><strong>{compile.rules}</strong><span>rules understood</span></div><div><strong>{compile.assumptions}</strong><span>assumptions</span></div><div><strong>{compile.issues.length}</strong><span>review items</span></div><div><strong>{compile.traces.length}</strong><span>source traces</span></div></div><div className="v9-compile-columns"><section><span className="v8-kicker">SOURCE → RULE TRACE</span>{compile.traces.length > 0 ? compile.traces.map((trace) => <article key={`${trace.rule}-${trace.source}`}><div><span className={`v9-owned is-${trace.ownership}`}>{trace.ownership === "source" ? "source-owned" : "Cedrus-inferred"}</span><strong>{trace.source}</strong></div><ArrowRight size={14} /><div><strong>{trace.rule}</strong><small>{trace.adaptation}</small></div></article>) : <p className="v9-empty-state">No explicit rules found. Add concrete instructions before publishing.</p>}</section><section><span className="v8-kicker">PLAN LINTER</span>{compile.issues.length > 0 ? compile.issues.map((issue) => <article className={`v9-compile-issue is-${issue.severity}`} key={issue.title}>{issue.severity === "warning" ? <AlertTriangle size={15} /> : <MessageCircle size={15} />}<div><strong>{issue.title}</strong><small>{issue.detail}</small></div></article>) : <article className="v9-compile-issue is-clear"><CheckCircle2 size={15} /><div><strong>No blocking gaps found</strong><small>Review the source trace, then publish an immutable revision.</small></div></article>}</section></div><footer><button type="button" onClick={onAsk}>ask about assumptions</button><button className="is-primary" type="button" onClick={onPublish}>publish immutable revision <ArrowRight size={14} /></button></footer></section>}
        {revisions.length > 0 && <section className="v9-revision-ledger"><header><div><span className="v8-kicker">REVISION LEDGER</span><h2>Originals remain untouched.</h2></div><Database size={20} /></header>{revisions.map((revision) => <article key={revision.id}><History size={15} /><span><strong>{revision.programTitle} · {revision.id}</strong><small>{revision.fileName} · {revision.rules} rules · {revision.issues} review items</small></span><code>{revision.fingerprint}</code></article>)}</section>}
        <section className="connector-grid v9-connector-grid"><header><span className="v8-kicker">CONNECTION TRUTH</span><h2>One brain, more senses.</h2><p>Every state shows scope, freshness, and whether Cedrus can write.</p></header><div>{connectors.map((connector) => { const status = connectionStates[connector.id]; const stable = status === "live" || status === "local"; return <article key={connector.id} className={stable ? "is-connected" : `is-${status}`}><div className="connector-icon">{connector.icon}</div><span><strong>{connector.name}</strong><small>{connector.detail}</small><em>{connector.freshness} · {connector.access}</em></span><button type="button" disabled={stable} onClick={() => onRequest(connector.id)}>{stable ? <><Check size={13} /> {connectionLabel(status)}</> : status === "requested" ? "setup pending" : "request setup"}</button></article>; })}</div></section>
      </main>
    </div>
  );
}

function OmnichannelDock({ onOpen }: { onOpen: (channel: Channel) => void }) {
  return <div className="omni-dock"><button type="button" onClick={() => onOpen("ask")}><Sparkles size={15} /> Ask Cedrus</button><i /><button type="button" onClick={() => onOpen("call")}><Phone size={15} /> Call</button><i /><button type="button" onClick={() => onOpen("text")}><MessageCircle size={15} /> Text</button><i /><button type="button" onClick={() => onOpen("ask")}><Upload size={15} /> Import .md</button></div>;
}

function AskPanel({ open, channel, messages, onClose, onChannel, onSend, twilioLive }: {
  open: boolean;
  channel: Channel;
  messages: ChatMessage[];
  onClose: () => void;
  onChannel: (channel: Channel) => void;
  onSend: (message: string) => void;
  twilioLive: boolean;
}) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (!value.trim()) return; onSend(value.trim()); setValue(""); };
  return (
    <aside className={`ask-panel ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <header><div><span>CEDRUS CHANNEL</span><strong>{channel === "ask" ? "Ask" : channel === "call" ? "Call" : "Text"}</strong></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <nav>{(["ask", "call", "text"] as Channel[]).map((item) => <button type="button" key={item} className={channel === item ? "is-active" : ""} onClick={() => onChannel(item)}>{item === "ask" ? <Bot size={14} /> : item === "call" ? <Phone size={14} /> : <Smartphone size={14} />}{item}</button>)}</nav>
      {channel === "call" && <div className="call-state"><div><Mic size={24} /></div><h2>Voice is designed, not connected.</h2><p>{twilioLive ? "Your Twilio SMS front door is production-verified. Voice will use the same identity, permissions, memory, and receipts once the call bridge is built." : "Connect Twilio SMS first, then add voice behind the same allowlist and approval policy."}</p><button type="button">review voice bridge</button></div>}
      {channel !== "call" && <><div className="chat-thread">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`is-${message.role}`}><span>{message.role === "cedrus" ? "CEDRUS" : "YOU"}</span><p>{message.text}</p></div>)}</div><form onSubmit={submit}><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={channel === "text" ? "Text your Cedrus number…" : "Ask about your day, plan, or code…"} /><button type="submit" aria-label="Send"><Send size={16} /></button></form></>}
    </aside>
  );
}

function WorkoutSheet({ open, live, elapsed, onClose, onStart, onFinish }: { open: boolean; live: boolean; elapsed: number; onClose: () => void; onStart: () => void; onFinish: () => void }) {
  const [segments, setSegments] = useState([["Warm-up", "10 min easy"], ["Open-water rhythm", "20 min steady"], ["Sight + settle", "6 × 30 sec"], ["Cool down", "10 min easy"]]);
  const [activeIndex, setActiveIndex] = useState(0);
  const addSegment = () => setSegments((items) => [...items, ["Added in session", "5 min easy"]]);
  return <div className={`workout-backdrop ${open ? "is-open" : ""}`} aria-hidden={!open}><section className="workout-sheet v9-workout-sheet"><header><div><span>TRIATHLON · {live ? "LIVE ACTUAL" : "TODAY’S PLAN"}</span><h2>{live ? formatElapsed(elapsed) : "Open-water swim"}</h2></div><button type="button" onClick={onClose}><X size={17} /></button></header><div className="v9-plan-actual"><div><span>PLANNED</span><strong>60 min</strong></div><div><span>PROPOSED</span><strong>45 min</strong></div><div><span>ACTUAL</span><strong>{live ? formatElapsed(elapsed) : "—"}</strong></div></div><div className="workout-readiness"><HeartPulse size={18} /><span><strong>Readiness 72 · user-entered</strong><small>Health is not connected. Cedrus reduced duration from your reported sleep, not a live health feed.</small></span></div>{segments.map(([title, detail], index) => <button className={`workout-step v9-workout-step ${live && index === activeIndex ? "is-active" : ""}`} type="button" onClick={() => live && setActiveIndex(index)} key={`${title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><small>{detail}</small></div>{live && index === activeIndex && <i>now</i>}</button>)}<button className="v9-add-segment" type="button" onClick={addSegment}><Plus size={14} /> add or substitute segment</button><div className="v9-memory-note"><History size={15} /><span><strong>Living session memory</strong><small>Edits become actual history. The original plan remains unchanged.</small></span></div><button className="workout-primary" type="button" onClick={live ? onFinish : onStart}>{live ? "finish and attach evidence" : <><Play size={15} /> start living session</>}</button></section></div>;
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function CedrusV9() {
  const [view, setView] = useState<View>("now");
  const [programs, setPrograms] = useState<Program[]>(initialPrograms);
  const [selectedProgram, setSelectedProgram] = useState("triathlon");
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [recentImport, setRecentImport] = useState<CompileResult | null>(null);
  const [adapted, setAdapted] = useState(false);
  const [connectionStates, setConnectionStates] = useState<Record<string, ConnectionStatus>>(() => Object.fromEntries(connectors.map((item) => [item.id, item.initialStatus])));
  const [revisions, setRevisions] = useState<PlanRevision[]>(() => readLocal("cedrus-v9-revisions", []));
  const [runs, setRuns] = useState<ExecutionRun[]>(initialRuns);
  const [askOpen, setAskOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("ask");
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "cedrus", text: "The day is workable. The 7:00 swim and 10:30 launch block both fit; one compiler run is waiting for approval." }]);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [workoutLive, setWorkoutLive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [workoutStartedAt, setWorkoutStartedAt] = useState<number | null>(() => readLocal<number | null>("cedrus-v9-workout-started-at", null));

  useEffect(() => {
    if (!workoutLive || !workoutStartedAt) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - workoutStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [workoutLive, workoutStartedAt]);

  useEffect(() => {
    window.localStorage.setItem("cedrus-v9-revisions", JSON.stringify(revisions));
  }, [revisions]);

  const openAsk = (nextChannel: Channel = "ask") => { setChannel(nextChannel); setAskOpen(true); };
  const openProgram = (id: string) => { setSelectedProgram(id); setView("programs"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCompile(compileMarkdown(file.name, String(reader.result ?? "")));
    reader.readAsText(file);
  };
  const publishProgram = () => {
    if (!compile) return;
    const existing = revisions.find((revision) => revision.fingerprint === compile.fingerprint);
    if (existing) {
      setRecentImport(compile);
      setView("programs");
      return;
    }
    const id = `imported-${compile.fingerprint}`;
    const revision: PlanRevision = { id: `r${String(revisions.length + 1).padStart(3, "0")}`, programTitle: compile.title, fileName: compile.fileName, createdAt: new Date().toISOString(), rules: compile.rules, issues: compile.issues.length, fingerprint: compile.fingerprint };
    setPrograms((items) => [...items, { id, title: compile.title, subtitle: "new program", image: "/v8/travel.png", readiness: 70, readinessLabel: "Ready", progress: 0, progressDetail: "just connected", nextTitle: compile.preview[0] ?? "Review first action", nextMeta: compile.times[0] ? `Next · ${compile.times[0]}` : "Ready to schedule", accent: "slate", source: compile.fileName }]);
    setRevisions((items) => [revision, ...items]);
    setRecentImport(compile);
    setSelectedProgram(id);
    setView("programs");
  };
  const sendMessage = (message: string) => {
    setMessages((items) => [...items, { role: "user", text: message }]);
    const lower = message.toLowerCase();
    if (lower.includes("sleep") || lower.includes("tired") || lower.includes("recover")) {
      setAdapted(true);
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "Recovery mode is now a local proposal: swim reduced to 30 minutes and strength moved to 5:45 PM. No confirmed commitment or external calendar event moved." }]), 250);
    } else if (lower.includes("triathlon") || lower.includes("swim")) {
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "Your next triathlon session is Open-water swim at 7:00 AM. It advances the race outcome and preserves the 10:30 launch block. Health is not connected, so readiness remains user-entered." }]), 250);
    } else if (lower.includes("why") || lower.includes("ripple")) {
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "Restoring the full swim adds 15 minutes and removes 22 minutes of recovery buffer. The launch block can remain unchanged. I will not apply that trade without your choice." }]), 250);
    } else {
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "I’m holding that against programs, workstreams, open loops, decisions, agent runs, and current permissions. In this V9 build I can explain the day, preview adaptations, compile a Markdown plan, and create local approval receipts." }]), 250);
    }
  };

  const requestConnection = (id: string) => setConnectionStates((state) => ({ ...state, [id]: state[id] === "requested" ? "disconnected" : state[id] === "disconnected" ? "requested" : state[id] }));
  const updateRunStatus = (id: string, status: RunStatus) => setRuns((items) => items.map((run) => run.id === id ? { ...run, status } : run));
  const startWorkout = () => {
    const startedAt = Date.now();
    setWorkoutStartedAt(startedAt);
    window.localStorage.setItem("cedrus-v9-workout-started-at", JSON.stringify(startedAt));
    setElapsed(0);
    setWorkoutLive(true);
  };
  const finishWorkout = () => {
    setWorkoutLive(false);
    setWorkoutOpen(false);
    setWorkoutStartedAt(null);
    window.localStorage.removeItem("cedrus-v9-workout-started-at");
    setPrograms((items) => items.map((program) => program.id === "triathlon" ? { ...program, progress: Math.min(100, program.progress + 1), progressDetail: "actual session attached today" } : program));
  };

  return (
    <div className="cedrus-v8 cedrus-v9">
      {view === "now" && <NowView programs={programs} adapted={adapted} onView={navigate} onAsk={() => openAsk("ask")} onOpenProgram={openProgram} onStartWorkout={() => setWorkoutOpen(true)} recentImport={recentImport} />}
      {view === "day" && <DayView programs={programs} adapted={adapted} onView={navigate} onAsk={() => openAsk("ask")} connectionStates={connectionStates} />}
      {view === "programs" && <ProgramsView programs={programs} selectedId={selectedProgram} onSelect={setSelectedProgram} onView={navigate} onAsk={() => openAsk("ask")} onStartWorkout={() => setWorkoutOpen(true)} revisions={revisions} connectionStates={connectionStates} />}
      {view === "runs" && <RunsView runs={runs} onStatus={updateRunStatus} onView={navigate} onAsk={() => openAsk("ask")} />}
      {view === "atlas" && <AtlasView onView={navigate} onAsk={() => openAsk("ask")} />}
      {view === "connect" && <ConnectView onView={navigate} onAsk={() => openAsk("ask")} connectionStates={connectionStates} onRequest={requestConnection} compile={compile} onFile={handleFile} onPublish={publishProgram} revisions={revisions} />}
      {view !== "now" && <OmnichannelDock onOpen={openAsk} />}
      <AskPanel open={askOpen} channel={channel} messages={messages} onClose={() => setAskOpen(false)} onChannel={setChannel} onSend={sendMessage} twilioLive={connectionStates.twilio === "live"} />
      <WorkoutSheet open={workoutOpen} live={workoutLive} elapsed={elapsed} onClose={() => setWorkoutOpen(false)} onStart={startWorkout} onFinish={finishWorkout} />
    </div>
  );
}
