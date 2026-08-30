import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Dumbbell,
  FileText,
  GitBranch,
  HeartPulse,
  Link2,
  Map as MapIcon,
  MessageCircle,
  Mic,
  Phone,
  Play,
  Plus,
  Route,
  Send,
  Smartphone,
  Sparkles,
  Upload,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

type View = "now" | "day" | "programs" | "connect" | "atlas";
type ProgramTab = "overview" | "plan" | "progress" | "sources";
type Channel = "ask" | "call" | "text";

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
  kind: "fixed" | "placed" | "protected";
  icon: ReactNode;
};

type CompileResult = {
  fileName: string;
  title: string;
  rules: number;
  assumptions: number;
  times: string[];
  durations: string[];
  preview: string[];
  text: string;
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
    nextTitle: "Run intervals",
    nextMeta: "Today · 7:00 AM · 48 min",
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
  { id: "routine", start: "6:00", end: "6:45", title: "Morning routine + mobility", detail: "Locked routine", kind: "fixed", icon: <Zap size={15} /> },
  { id: "run", start: "7:00", end: "7:48", title: "Run intervals", detail: "Triathlon · outdoor · Cedrus placed", kind: "placed", icon: <Route size={15} /> },
  { id: "coach", start: "9:00", end: "9:30", title: "Coach check-in", detail: "Google Calendar · fixed", kind: "fixed", icon: <MessageCircle size={15} /> },
  { id: "launch", start: "10:30", end: "12:00", title: "Pickleball launch sequence", detail: "Protected deep work · GitHub + Drive", kind: "protected", icon: <Sparkles size={15} /> },
  { id: "lunch", start: "12:30", end: "1:15", title: "Lunch with Maya", detail: "Wynwood · fixed", kind: "fixed", icon: <CalendarDays size={15} /> },
  { id: "strength", start: "4:30", end: "5:22", title: "Strength", detail: "Triathlon · gym · Cedrus placed", kind: "placed", icon: <Dumbbell size={15} /> },
];

const connectors = [
  { id: "calendar", name: "Google Calendar", detail: "Fixed events + schedule writes", icon: <CalendarDays size={18} />, defaultConnected: true },
  { id: "health", name: "Apple Health", detail: "Recovery, sleep, HRV + workouts", icon: <HeartPulse size={18} />, defaultConnected: true },
  { id: "strava", name: "Strava", detail: "Activities + completion events", icon: <Activity size={18} />, defaultConnected: true },
  { id: "github", name: "GitHub", detail: "Repositories + watched plan files", icon: <GitBranch size={18} />, defaultConnected: true },
  { id: "twilio", name: "Twilio", detail: "Your SMS + voice front door", icon: <Phone size={18} />, defaultConnected: false },
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
  return {
    fileName,
    title,
    rules: Math.max(ruleLines.length, Math.min(12, Math.max(1, Math.round(lines.length / 6)))),
    assumptions: assumptionLines.length,
    times,
    durations,
    preview,
    text,
  };
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function ProductNav({ view, onView, onAsk, dark = false }: { view: View; onView: (view: View) => void; onAsk: () => void; dark?: boolean }) {
  return (
    <header className={`v8-nav ${dark ? "is-dark" : ""}`}>
      <button className="v8-wordmark" type="button" onClick={() => onView("now")}><i /> CEDRUS <small>V8</small></button>
      <nav aria-label="Main navigation">
        {(["now", "day", "programs", "connect"] as View[]).map((item) => (
          <button key={item} className={view === item ? "is-active" : ""} type="button" onClick={() => onView(item)}>{item}</button>
        ))}
        <button type="button" onClick={onAsk}>ask</button>
      </nav>
      <button className="v8-result" type="button" onClick={onAsk}><span /> 1 adaptation</button>
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
  const timeline = adapted ? baseTimeline.map((item) => item.id === "strength" ? { ...item, start: "5:15", end: "6:07", detail: "Moved for recovery · Cedrus placed" } : item) : baseTimeline;
  return (
    <div className="v8-now">
      <section className="v8-world">
        <ProductNav view="now" onView={onView} onAsk={onAsk} dark />
        <div className="v8-sun" /><div className="v8-haze" /><div className="v8-ridge ridge-back" /><div className="v8-ridge ridge-front" />
        <div className="world-copy">
          <span>CEDRUS PLANNED · MIAMI</span>
          <h1>{adapted ? "Recover today. The launch stays protected." : "Train first. The launch still fits."}</h1>
          <p>{adapted ? "Your sleep signal changed the fitness plan, not your most important work." : "Your body, calendar, and commitments agree on the shape of the day."}</p>
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

      <div className="v8-home" ref={nextRef}>
        <section className="v8-next">
          <header><div><span>TUESDAY · AUGUST 25</span><h2>The next edge of the day.</h2></div><button type="button" onClick={() => onView("day")}>open full day <ArrowRight size={15} /></button></header>
          <div className="next-list">
            {timeline.slice(2).map((item) => <button key={item.id} type="button" onClick={() => onView("day")}><time>{item.start}</time><i className={`is-${item.kind}`} /><div><span>{item.kind === "fixed" ? "FIXED" : item.kind === "protected" ? "PROTECTED" : "CEDRUS PLACED"}</span><strong>{item.title}</strong><small>{item.detail}</small></div><ChevronRight size={15} /></button>)}
          </div>
        </section>

        <section className="v8-programs-home">
          <header><div><span>ACTIVE PROGRAMS</span><h2>Plans Cedrus is keeping alive.</h2></div><button type="button" onClick={() => onView("connect")}><Plus size={15} /> add program</button></header>
          <button className="compile-banner" type="button" onClick={() => onView("connect")}><FileText size={15} /><span><strong>{recentImport?.fileName ?? "triathlon-plan.md"}</strong> · {recentImport?.rules ?? 12} rules understood</span><Check size={15} /></button>
          <div className="program-card-list">
            {programs.slice(0, 2).map((program) => <ProgramCard key={program.id} program={program} onOpen={() => onOpenProgram(program.id)} onStart={onStartWorkout} />)}
          </div>
          <button className="all-programs" type="button" onClick={() => onView("programs")}>view all programs <ArrowRight size={14} /></button>
        </section>
      </div>
    </div>
  );
}

function DayView({ programs, adapted, onView, onAsk }: { programs: Program[]; adapted: boolean; onView: (view: View) => void; onAsk: () => void }) {
  const timeline = useMemo(() => adapted ? baseTimeline.map((item) => item.id === "strength" ? { ...item, start: "5:15", end: "6:07", detail: "Moved for recovery · Cedrus placed" } : item) : baseTimeline, [adapted]);
  const [selectedId, setSelectedId] = useState("run");
  const selected = timeline.find((item) => item.id === selectedId) ?? timeline[1];
  return (
    <div className="v8-surface">
      <ProductNav view="day" onView={onView} onAsk={onAsk} />
      <main className="day-layout">
        <aside className="day-programs">
          <span className="v8-kicker">PROGRAMS</span>
          <h2>What Time is serving.</h2>
          {programs.map((program) => <button key={program.id} className={program.id === "triathlon" ? "is-selected" : ""} type="button"><img src={program.image} alt="" /><span><strong>{program.title}</strong><small>{program.subtitle}</small></span><ChevronRight size={14} /></button>)}
          <button className="day-add" type="button" onClick={() => onView("connect")}><Plus size={14} /> Add plan</button>
          <div className="day-connections"><span className="v8-kicker">CONNECTED</span>{connectors.map((connector) => <div key={connector.id}>{connector.icon}<span>{connector.name}</span><i className={connector.defaultConnected ? "is-live" : ""} /></div>)}</div>
        </aside>

        <section className="day-runway">
          <header><div><span className="v8-kicker">TODAY · AUGUST 25</span><h1>Tuesday’s runway</h1></div><div className="day-legend"><span><i className="fixed" /> fixed</span><span><i className="placed" /> Cedrus placed</span></div></header>
          <div className="runway-grid">
            <div className="runway-list">
              <div className="runway-line" />
              {timeline.map((item) => <button key={item.id} className={`runway-item is-${item.kind} ${selectedId === item.id ? "is-selected" : ""}`} type="button" onClick={() => setSelectedId(item.id)}><time>{item.start}</time><i /><div>{item.icon}<span><strong>{item.title}</strong><small>{item.start}—{item.end} · {item.detail}</small></span></div></button>)}
            </div>
            <article className="placement-detail">
              <span className="v8-kicker">SELECTED PLACEMENT</span>
              <h2>{selected.title}</h2>
              <p>{selected.start}—{selected.end} · {selected.kind === "fixed" ? "provider commitment" : "placed by Cedrus"}</p>
              <div className="constraint-list"><span className="v8-kicker">HARD CONSTRAINTS PASSED</span>{["No calendar overlap", "Launch block protected", "Recovery window honored", "Required location available"].map((label) => <div key={label}><Check size={14} /><span>{label}</span></div>)}</div>
              <div className="why-placement"><span className="v8-kicker">WHY HERE?</span><p>{selected.id === "run" ? "This is the coolest legal outdoor window, leaves recovery before strength, and preserves your 10:30 launch block." : selected.kind === "fixed" ? "This provider event is locked. Cedrus planned flexible work around it." : "This block fits the program’s duration, context, and recovery rules without moving a fixed commitment."}</p></div>
              <button type="button">view rule trace <ArrowRight size={14} /></button>
            </article>
          </div>
        </section>

        <aside className="day-noticed">
          <span className="v8-kicker">CEDRUS NOTICED</span>
          <h2>{adapted ? "One useful adaptation." : "The day is stable."}</h2>
          <article><HeartPulse size={18} /><div><strong>{adapted ? "Poor sleep detected" : "Recovery looks workable"}</strong><small>{adapted ? "6h 02m last night" : "Readiness 72 · HRV stable"}</small></div></article>
          <div className="noticed-copy"><strong>{adapted ? "Strength moved to 5:15 PM." : "No plan changes needed."}</strong><p>{adapted ? "The launch remains protected. The training load stays useful without stacking intensity." : "Your run, launch block, fixed events, and strength session fit without conflict."}</p></div>
          <button type="button" onClick={onAsk}>{adapted ? "review adaptation" : "ask about today"} <ChevronRight size={14} /></button>
        </aside>
      </main>
    </div>
  );
}

function ProgramsView({ programs, selectedId, onSelect, onView, onAsk, onStartWorkout }: { programs: Program[]; selectedId: string; onSelect: (id: string) => void; onView: (view: View) => void; onAsk: () => void; onStartWorkout: () => void }) {
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
              <section className="today-briefing"><header><div><span className="v8-kicker">TODAY’S BRIEFING</span><h2>{program.nextTitle}</h2><p>{program.nextMeta}</p></div><ScoreRing value={program.readiness} label={program.readinessLabel} accent={program.accent} /></header>{isTriathlon ? <><div className="briefing-steps"><div><span>WARM-UP</span><strong>10 min easy</strong></div><div><span>THRESHOLD</span><strong>6 × 3 min</strong></div><div><span>RECOVERY</span><strong>90 sec easy</strong></div><div><span>COOL DOWN</span><strong>8 min</strong></div></div><button type="button" onClick={onStartWorkout}><Play size={15} /> start guided workout</button></> : <><p className="program-copy">Cedrus assembled the relevant context, protected the right block, and left the rest of the day flexible.</p><button type="button" onClick={() => onView("day")}>open in day <ArrowRight size={14} /></button></>}</section>
              <section className="program-signals"><span className="v8-kicker">CURRENT SIGNALS</span><h2>What the plan sees.</h2>{(isTriathlon ? [["Recovery", "72 · improving"], ["Last session", "Bike endurance · complete"], ["Week load", "4h 18m of 7h 30m"], ["Travel effect", "New York week needs review"]] : [["Open issues", "5 · two block onboarding"], ["Protected time", "90 minutes today"], ["Repository", "Main branch healthy"], ["Next decision", "Pricing before onboarding"]]).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
              <section className="program-arc"><span className="v8-kicker">PROGRAM ARC</span><h2>{program.progressDetail}</h2><div className="arc-track"><i style={{ width: `${program.progress}%` }} /></div><div className="arc-labels"><span>Build</span><span>Sharpen</span><span>Perform</span><span>Learn</span></div></section>
            </div>
          )}
          {tab === "plan" && <div className="plan-sheet"><header><div><span className="v8-kicker">SOURCE OF TRUTH</span><h2>{program.source}</h2></div><button type="button"><GitBranch size={14} /> view source</button></header><div className="compile-summary"><div><strong>12</strong><span>rules understood</span></div><div><strong>3</strong><span>reviewable assumptions</span></div><div><strong>0</strong><span>unresolved conflicts</span></div></div><div className="rule-table">{[["Run intervals", "Tue + Fri · 45–55m", "Preferred 6–8 AM"], ["Long ride", "Saturday · 150m", "Hard 3-hour window"], ["Swim endurance", "2× weekly · 60m", "Pool required"], ["Strength", "2× weekly · 50m", "18h from long ride"]].map((row, index) => <div key={row[0]}><span>{String(index + 1).padStart(2, "0")}</span><strong>{row[0]}</strong><p>{row[1]}</p><small>{row[2]}</small></div>)}</div></div>}
          {tab === "progress" && <div className="progress-sheet"><header><span className="v8-kicker">PROGRESS</span><h2>The plan is producing evidence.</h2></header>{[["Weekly training", 76, "5h 42m of 7h 30m"], ["Run durability", 58, "16.4 miles this week"], ["Bike endurance", 69, "Long ride at 2h 18m"], ["Swim consistency", 42, "2 of 3 sessions"]].map(([label, value, detail]) => <div className="progress-row" key={String(label)}><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><strong>{value}%</strong><small>{detail}</small></div>)}</div>}
          {tab === "sources" && <div className="sources-sheet"><header><span className="v8-kicker">SOURCES + PERMISSIONS</span><h2>What this program can see and do.</h2></header>{connectors.slice(0, 4).map((connector) => <div key={connector.id}>{connector.icon}<span><strong>{connector.name}</strong><small>{connector.detail}</small></span><b>{connector.id === "calendar" ? "read + propose" : "read only"}</b></div>)}</div>}
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
        <header><span className="v8-kicker">OUTCOME ATLAS</span><h1>Your life, understood as active outcomes.</h1><p>Every connection is explainable, permissioned, and tied back to a source.</p></header>
        <section className="atlas-map">
          <svg viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><path d="M500 280 C370 270 310 130 185 120 M500 280 C640 260 690 120 820 120 M500 280 C350 320 300 430 175 450 M500 280 C640 330 700 440 830 450" /><path className="is-soft" d="M185 120 C360 30 640 30 820 120 M175 450 C370 530 650 530 830 450" /></svg>
          <button className="atlas-now" type="button" onClick={() => onView("day")}><span>NOW</span><strong>What needs you next</strong><small>Choose from a legal plan</small><ArrowRight size={18} /></button>
          <article className="atlas-node node-tri"><span>TRIATHLON · 80 DAYS</span><h2>Keep the session aerobic?</h2><p>Check recovery, then decide by 6:30 AM.</p><footer><FileText size={13} /> triathlon-plan.md · 12 rules</footer></article>
          <article className="atlas-node node-pick"><span>PICKLEBALL BETA</span><h2>Pricing before onboarding?</h2><p>Five open issues; two affect the first-run experience.</p><footer><GitBranch size={13} /> main · live</footer></article>
          <article className="atlas-node node-rec"><span>RECOVERY</span><h2>Protect sleep tonight.</h2><p>Strength can move. The launch block should not.</p><footer><HeartPulse size={13} /> Health · live</footer></article>
          <article className="atlas-node node-trip"><span>NEW YORK TRIP</span><h2>Adapt race week.</h2><p>The hotel gym is unconfirmed; flight timing is stable.</p><footer><CalendarDays size={13} /> Calendar · watching</footer></article>
        </section>
        <section className="atlas-time"><header><span>6 AM</span><span>9 AM</span><span>12 PM</span><span>3 PM</span><span>6 PM</span><span>8 PM</span></header><div className="atlas-lane"><b>Fixed</b><i style={{ left: "7%", width: "9%" }}>Coach</i><i style={{ left: "39%", width: "10%" }}>Lunch</i></div><div className="atlas-lane placed"><b>Placed</b><i style={{ left: "2%", width: "14%" }}>Run</i><i style={{ left: "22%", width: "18%" }}>Launch</i><i style={{ left: "69%", width: "12%" }}>Strength</i></div><div className="atlas-lane open"><b>Open</b><i style={{ left: "49%", width: "20%" }}>2h 12m open</i></div></section>
      </main>
    </div>
  );
}

function ConnectView({ onView, onAsk, connected, onToggle, compile, onFile, onPublish }: {
  onView: (view: View) => void;
  onAsk: () => void;
  connected: Record<string, boolean>;
  onToggle: (id: string) => void;
  compile: CompileResult | null;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onPublish: () => void;
}) {
  return (
    <div className="v8-surface">
      <ProductNav view="connect" onView={onView} onAsk={onAsk} />
      <main className="connect-page">
        <header><span className="v8-kicker">CONNECT + IMPORT</span><h1>Give Cedrus a source of truth.</h1><p>Connect a service, watch a repository, or compile a Markdown plan. Nothing gains write access without an explicit permission.</p></header>
        <section className="import-panel">
          <div><Upload size={20} /><span><strong>Import a Markdown program</strong><small>Drop in a researched plan, routine, project, or operating document.</small></span></div>
          <label><input type="file" accept=".md,text/markdown,text/plain" onChange={onFile} />Choose .md file</label>
        </section>
        {compile && <section className="compile-review"><header><div><span className="v8-kicker">COMPILE REVIEW</span><h2>{compile.title}</h2><p>{compile.fileName}</p></div><Check size={22} /></header><div className="compile-facts"><div><strong>{compile.rules}</strong><span>rules understood</span></div><div><strong>{compile.assumptions}</strong><span>assumptions</span></div><div><strong>{compile.times.length}</strong><span>time references</span></div><div><strong>{compile.durations.length}</strong><span>durations</span></div></div>{compile.preview.length > 0 && <div className="compile-preview">{compile.preview.map((rule) => <p key={rule}><Check size={13} /> {rule}</p>)}</div>}<footer><button type="button">review assumptions</button><button className="is-primary" type="button" onClick={onPublish}>publish program <ArrowRight size={14} /></button></footer></section>}
        <section className="connector-grid"><header><span className="v8-kicker">CONNECTIONS</span><h2>One brain, more senses.</h2></header><div>{connectors.map((connector) => <article key={connector.id} className={connected[connector.id] ? "is-connected" : ""}><div className="connector-icon">{connector.icon}</div><span><strong>{connector.name}</strong><small>{connector.detail}</small></span><button type="button" onClick={() => onToggle(connector.id)}>{connected[connector.id] ? <><Check size={13} /> connected</> : "connect"}</button></article>)}</div></section>
      </main>
    </div>
  );
}

function OmnichannelDock({ onOpen }: { onOpen: (channel: Channel) => void }) {
  return <div className="omni-dock"><button type="button" onClick={() => onOpen("ask")}><Sparkles size={15} /> Ask Cedrus</button><i /><button type="button" onClick={() => onOpen("call")}><Phone size={15} /> Call</button><i /><button type="button" onClick={() => onOpen("text")}><MessageCircle size={15} /> Text</button><i /><button type="button" onClick={() => onOpen("ask")}><Upload size={15} /> Import .md</button></div>;
}

function AskPanel({ open, channel, messages, onClose, onChannel, onSend, twilioConnected }: {
  open: boolean;
  channel: Channel;
  messages: ChatMessage[];
  onClose: () => void;
  onChannel: (channel: Channel) => void;
  onSend: (message: string) => void;
  twilioConnected: boolean;
}) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (!value.trim()) return; onSend(value.trim()); setValue(""); };
  return (
    <aside className={`ask-panel ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <header><div><span>CEDRUS CHANNEL</span><strong>{channel === "ask" ? "Ask" : channel === "call" ? "Call" : "Text"}</strong></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <nav>{(["ask", "call", "text"] as Channel[]).map((item) => <button type="button" key={item} className={channel === item ? "is-active" : ""} onClick={() => onChannel(item)}>{item === "ask" ? <Bot size={14} /> : item === "call" ? <Phone size={14} /> : <Smartphone size={14} />}{item}</button>)}</nav>
      {channel === "call" && <div className="call-state"><div><Mic size={24} /></div><h2>{twilioConnected ? "Cedrus is ready to answer." : "Connect your Twilio number."}</h2><p>{twilioConnected ? "Incoming calls will reach the same brain, programs, permissions, and audit history as this dashboard." : "The V8 call surface is ready. Add your number in Connect to activate the webhook flow."}</p><button type="button">{twilioConnected ? "test call routing" : "open Connect"}</button></div>}
      {channel !== "call" && <><div className="chat-thread">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`is-${message.role}`}><span>{message.role === "cedrus" ? "CEDRUS" : "YOU"}</span><p>{message.text}</p></div>)}</div><form onSubmit={submit}><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={channel === "text" ? "Text your Cedrus number…" : "Ask about your day, plan, or code…"} /><button type="submit" aria-label="Send"><Send size={16} /></button></form></>}
    </aside>
  );
}

function WorkoutSheet({ open, live, elapsed, onClose, onStart, onFinish }: { open: boolean; live: boolean; elapsed: number; onClose: () => void; onStart: () => void; onFinish: () => void }) {
  return <div className={`workout-backdrop ${open ? "is-open" : ""}`} aria-hidden={!open}><section className="workout-sheet"><header><div><span>TRIATHLON · {live ? "LIVE" : "TODAY’S BRIEFING"}</span><h2>{live ? formatElapsed(elapsed) : "Run intervals"}</h2></div><button type="button" onClick={onClose}><X size={17} /></button></header><div className="workout-readiness"><HeartPulse size={18} /><span><strong>Readiness 72 · good</strong><small>Keep intensity. Watch the last two repetitions.</small></span></div>{[["Warm-up", "10 min easy"], ["Threshold", "6 × 3 min"], ["Recovery", "90 sec easy"], ["Cool down", "8 min"]].map(([title, detail], index) => <div className={`workout-step ${live && index === 0 ? "is-active" : ""}`} key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><small>{detail}</small></div>{live && index === 0 && <i>now</i>}</div>)}<button className="workout-primary" type="button" onClick={live ? onFinish : onStart}>{live ? "finish session" : <><Play size={15} /> start guided workout</>}</button></section></div>;
}

export function CedrusV8() {
  const [view, setView] = useState<View>("now");
  const [programs, setPrograms] = useState<Program[]>(initialPrograms);
  const [selectedProgram, setSelectedProgram] = useState("triathlon");
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [recentImport, setRecentImport] = useState<CompileResult | null>(null);
  const [adapted, setAdapted] = useState(false);
  const [connected, setConnected] = useState<Record<string, boolean>>(() => Object.fromEntries(connectors.map((item) => [item.id, item.defaultConnected])));
  const [askOpen, setAskOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("ask");
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "cedrus", text: "The day is stable. Your 7:00 run and 10:30 launch block both fit." }]);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [workoutLive, setWorkoutLive] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!workoutLive) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [workoutLive]);

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
    const id = `imported-${Date.now()}`;
    setPrograms((items) => [...items, { id, title: compile.title, subtitle: "new program", image: "/v8/travel.png", readiness: 70, readinessLabel: "Ready", progress: 0, progressDetail: "just connected", nextTitle: compile.preview[0] ?? "Review first action", nextMeta: compile.times[0] ? `Next · ${compile.times[0]}` : "Ready to schedule", accent: "slate", source: compile.fileName }]);
    setRecentImport(compile);
    setSelectedProgram(id);
    setView("programs");
  };
  const sendMessage = (message: string) => {
    setMessages((items) => [...items, { role: "user", text: message }]);
    const lower = message.toLowerCase();
    if (lower.includes("sleep") || lower.includes("tired") || lower.includes("recover")) {
      setAdapted(true);
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "I moved strength to 5:15 PM, kept the launch protected, and left the run aerobic. No fixed commitment moved." }]), 250);
    } else if (lower.includes("triathlon") || lower.includes("run")) {
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "Your next triathlon session is Run intervals at 7:00 AM. It fits the recovery rule and leaves three hours before protected launch work." }]), 250);
    } else {
      window.setTimeout(() => setMessages((items) => [...items, { role: "cedrus", text: "I’m holding that against your programs, calendar, and permissions. In this V8 prototype I can explain the day, adapt recovery, and compile a Markdown plan." }]), 250);
    }
  };

  return (
    <div className="cedrus-v8">
      {view === "now" && <NowView programs={programs} adapted={adapted} onView={navigate} onAsk={() => openAsk("ask")} onOpenProgram={openProgram} onStartWorkout={() => setWorkoutOpen(true)} recentImport={recentImport} />}
      {view === "day" && <DayView programs={programs} adapted={adapted} onView={navigate} onAsk={() => openAsk("ask")} />}
      {view === "programs" && <ProgramsView programs={programs} selectedId={selectedProgram} onSelect={setSelectedProgram} onView={navigate} onAsk={() => openAsk("ask")} onStartWorkout={() => setWorkoutOpen(true)} />}
      {view === "atlas" && <AtlasView onView={navigate} onAsk={() => openAsk("ask")} />}
      {view === "connect" && <ConnectView onView={navigate} onAsk={() => openAsk("ask")} connected={connected} onToggle={(id) => setConnected((state) => ({ ...state, [id]: !state[id] }))} compile={compile} onFile={handleFile} onPublish={publishProgram} />}
      {view !== "now" && <OmnichannelDock onOpen={openAsk} />}
      <AskPanel open={askOpen} channel={channel} messages={messages} onClose={() => setAskOpen(false)} onChannel={setChannel} onSend={sendMessage} twilioConnected={connected.twilio} />
      <WorkoutSheet open={workoutOpen} live={workoutLive} elapsed={elapsed} onClose={() => setWorkoutOpen(false)} onStart={() => { setWorkoutLive(true); setElapsed(0); }} onFinish={() => { setWorkoutLive(false); setWorkoutOpen(false); setPrograms((items) => items.map((program) => program.id === "triathlon" ? { ...program, progress: Math.min(100, program.progress + 1), progressDetail: "session completed today" } : program)); }} />
    </div>
  );
}
