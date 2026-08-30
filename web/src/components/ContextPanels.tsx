import { useMemo, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  CircleHelp,
  FileText,
  FlaskConical,
  Plus,
  RotateCcw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { ScenarioDefinition } from "../planner/types";
import {
  agentResults,
  deskPeople,
  knowledgeFacts,
  type BriefSettings,
  type DemoBrief,
  type DemoPerson,
  type DemoProject,
} from "../v63/data";
import type { LocalDemoState, TimeMode } from "../v63/useLocalDemoState";

export type ContextPanel =
  | { kind: "project"; project: DemoProject }
  | { kind: "person"; person: DemoPerson }
  | { kind: "brief"; brief: DemoBrief }
  | { kind: "knowledge" }
  | { kind: "intake"; seed?: string }
  | { kind: "results" }
  | { kind: "dev" };

interface ContextPanelsProps {
  panel: ContextPanel;
  closing?: boolean;
  localState: LocalDemoState;
  activeScenario: string;
  scenarios: ScenarioDefinition[];
  onClose: () => void;
  onPerson: (person: DemoPerson) => void;
  onContextAsk: (value: string, context: string) => void;
  onBriefSettings: (id: string, settings: BriefSettings) => void;
  onKnowledgeConfirm: (id: string) => void;
  onKnowledgeCorrect: (id: string, value: string) => void;
  onIntakeSave: (value: string) => void;
  onScenario: (id: string) => void;
  onTimeMode: (mode: TimeMode) => void;
  onDateOffset: (offset: number) => void;
  onProjectUpdate: () => void;
  onAgentResult: () => void;
  onReplayExample: () => void;
  onReset: () => void;
}

function Frame({
  eyebrow,
  title,
  className = "",
  closing,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  className?: string;
  closing?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={"context-backdrop " + (closing ? "is-closing" : "")} role="presentation" onMouseDown={onClose}>
      <section className={"context-panel " + className} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="context-header">
          <div><p>{eyebrow}</p><h1>{title}</h1></div>
          <button type="button" onClick={onClose} aria-label="Close environment"><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ContextAsk({ name, onSubmit }: { name: string; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form className="context-ask" onSubmit={(event) => { event.preventDefault(); if (value.trim()) { onSubmit(value.trim()); setValue(""); } }}>
      <label htmlFor={"ask-" + name.toLowerCase().replaceAll(" ", "-")}>Ask {name}</label>
      <div>
        <input id={"ask-" + name.toLowerCase().replaceAll(" ", "-")} value={value} onChange={(event) => setValue(event.target.value)} placeholder="What am I behind on?" />
        <button type="submit" aria-label={"Ask " + name}><ArrowUp size={15} /></button>
      </div>
    </form>
  );
}

function ProjectEnvironment({ project, onPerson, onAsk }: { project: DemoProject; onPerson: (person: DemoPerson) => void; onAsk: (value: string) => void }) {
  return (
    <div className="context-body project-context">
      <div className="project-context-accent" style={{ background: project.accent }} />
      <div className="context-triptych">
        <div><span>Current</span><strong>{project.current}</strong></div>
        <div><span>Next</span><strong>{project.next}</strong></div>
        <div><span>Waiting</span><strong>{project.waiting}</strong></div>
      </div>
      <section className="context-block">
        <p>Open loops</p>
        <h2>{project.loops}</h2>
      </section>
      <section className="context-block">
        <p>People</p>
        <div className="context-people">
          {project.people.map((name) => {
            const person = deskPeople.find((candidate) => candidate.name === name);
            return <button type="button" key={name} onClick={() => person && onPerson(person)}><span>{name.slice(0, 1)}</span>{name}</button>;
          })}
        </div>
      </section>
      <section className="context-block">
        <p>Recent · 3 meaningful changes</p>
        <ol className="recent-list">{project.recent.map((item) => <li key={item}>{item}</li>)}</ol>
      </section>
      <ContextAsk name={project.name} onSubmit={onAsk} />
    </div>
  );
}

function PersonEnvironment({ person }: { person: DemoPerson }) {
  const rows = [
    ["current", person.current],
    ["waiting on me", person.waitingOnMe],
    ["waiting on " + person.name.toLowerCase(), person.waitingOnThem],
    ["next", person.next],
    ["recent", person.recent],
  ];
  return (
    <div className="context-body person-context">
      <p className="person-context-line">{person.context}</p>
      <div className="person-projects">{person.projects.map((project) => <span key={project}>{project}</span>)}</div>
      <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="context-principle"><UserRound size={14} /> Cedrus understands {person.name} through shared context, not a relationship score.</p>
    </div>
  );
}

const inputOptions = ["Ascendo", "Cedrus", "Play Nice", "Personal", "selected people", "calendar", "saved items"];
const sectionOptions = ["What changed", "What matters", "Decisions", "Upcoming", "Waiting on", "Ideas", "Links"];
const styleOptions: BriefSettings["style"][] = ["concise", "analytical", "personal", "newsletter", "executive", "narrative"];

function BriefStudio({ brief, settings, onChange }: { brief: DemoBrief; settings: BriefSettings; onChange: (settings: BriefSettings) => void }) {
  const [generated, setGenerated] = useState(brief.id === "newsletter");
  const toggle = (key: "inputs" | "sections", value: string) => {
    const current = settings[key];
    onChange({ ...settings, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  };
  return (
    <div className="context-body brief-studio">
      <div className="brief-builder-grid">
        <section>
          <p className="studio-label">Inputs</p>
          <div className="studio-options">{inputOptions.map((item) => <button type="button" className={settings.inputs.includes(item) ? "selected" : ""} key={item} onClick={() => toggle("inputs", item)}>{settings.inputs.includes(item) && <Check size={12} />}{item}</button>)}</div>
        </section>
        <section>
          <p className="studio-label">Sections</p>
          <div className="studio-options">{sectionOptions.map((item) => <button type="button" className={settings.sections.includes(item) ? "selected" : ""} key={item} onClick={() => toggle("sections", item)}>{settings.sections.includes(item) && <Check size={12} />}{item}</button>)}</div>
        </section>
        <section className="studio-selects">
          <label>Style<select value={settings.style} onChange={(event) => onChange({ ...settings, style: event.target.value as BriefSettings["style"] })}>{styleOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Cadence<select value={settings.cadence} onChange={(event) => onChange({ ...settings, cadence: event.target.value as BriefSettings["cadence"] })}><option>daily</option><option>weekly</option><option>manual</option></select></label>
          <label>Delivery · demo only<select value={settings.delivery} onChange={(event) => onChange({ ...settings, delivery: event.target.value as BriefSettings["delivery"] })}><option>dashboard</option><option>email</option><option>SMS</option></select></label>
        </section>
      </div>
      <div className="brief-preview">
        <header><div><span>Preview</span><strong>{brief.name}</strong></div><button type="button" onClick={() => setGenerated(true)}><Sparkles size={14} /> Generate mock draft</button></header>
        {generated ? (
          <article>
            <p className="preview-date">Week of August 17 · Draft</p>
            <h2>The useful things that moved this week.</h2>
            <p>Clockout is through its model pass, which brings the IC memo forward. Cedrus V6.3 is now less a calendar and more a place to work from.</p>
            <h3>What matters</h3>
            <ul><li>Resolve the remaining Clockout diligence question.</li><li>Review Play Nice pricing before Friday.</li><li>Keep Tuesday morning protected for Cedrus.</li></ul>
            <blockquote>One idea worth keeping: the calmer the home becomes, the deeper the desk can feel.</blockquote>
            <p className="preview-note">Mock preview only · nothing will be sent</p>
          </article>
        ) : <div className="preview-empty"><FileText size={22} /><p>Generate a realistic draft from the selected mock inputs.</p></div>}
      </div>
    </div>
  );
}

function KnowledgeEnvironment({
  state,
  onConfirm,
  onCorrect,
}: {
  state: LocalDemoState;
  onConfirm: (id: string) => void;
  onCorrect: (id: string, value: string) => void;
}) {
  const [why, setWhy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  return (
    <div className="context-body knowledge-context">
      <p className="knowledge-intro">A small, editable model of your preferences and priorities. Inferences explain themselves.</p>
      <div className="knowledge-list">
        {knowledgeFacts.map((fact) => {
          const value = state.correctedKnowledge[fact.id] ?? fact.value;
          const confirmed = state.confirmedKnowledge.includes(fact.id);
          return (
            <article key={fact.id}>
              <div><span>{fact.label}{fact.inferred ? " · inferred" : ""}</span><strong>{value}</strong></div>
              {fact.inferred && (
                <div className="knowledge-actions">
                  <button type="button" onClick={() => onConfirm(fact.id)}>{confirmed ? <CheckCircle2 size={13} /> : <Check size={13} />}{confirmed ? "confirmed" : "confirm"}</button>
                  <button type="button" onClick={() => { setEditing(fact.id); setCorrection(value); }}>correct</button>
                  <button type="button" onClick={() => setWhy(why === fact.id ? null : fact.id)}><CircleHelp size={13} /> why?</button>
                </div>
              )}
              {why === fact.id && <div className="knowledge-why"><span>Why I think that · confidence {fact.confidence}</span><ul>{fact.evidence?.map((line) => <li key={line}>{line}</li>)}</ul></div>}
              {editing === fact.id && <form className="knowledge-correction" onSubmit={(event) => { event.preventDefault(); onCorrect(fact.id, correction); setEditing(null); }}><input value={correction} onChange={(event) => setCorrection(event.target.value)} aria-label={"Correct " + fact.label} /><button type="submit">save</button></form>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function IntakeEnvironment({ seed, onSave }: { seed?: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(seed ?? "Need to revisit Play Nice pricing before we talk to Dad Friday.");
  const [classified, setClassified] = useState(true);
  return (
    <div className="context-body intake-context">
      <label htmlFor="intake-text">Throw anything into Cedrus</label>
      <textarea id="intake-text" value={value} onChange={(event) => { setValue(event.target.value); setClassified(false); }} />
      <button className="intake-classify" type="button" onClick={() => setClassified(true)}><Sparkles size={14} /> Classify locally</button>
      {classified && (
        <div className="classification">
          <div><span>Project</span><strong>Play Nice</strong></div>
          <div><span>Task</span><strong>Review pricing</strong></div>
          <div><span>Deadline</span><strong>Friday before meeting</strong></div>
          <div><span>Duration</span><strong>30m suggested</strong></div>
          <button type="button" onClick={() => onSave(value)}><Plus size={14} /> Add to the demo desk</button>
        </div>
      )}
      <p className="context-principle">Demo classification only. Nothing is sent to a calendar, inbox, or external service.</p>
    </div>
  );
}

function ResultsEnvironment() {
  return (
    <div className="context-body results-context">
      {agentResults.map((result, index) => <article key={result.id}><span><Bot size={17} /> Result {String(index + 1).padStart(2, "0")} · {result.time}</span><h2>{result.title}</h2><p>{result.detail}</p><CheckCircle2 size={18} /></article>)}
      <p className="context-principle">Agents report consequences into Cedrus. They do not schedule time directly.</p>
    </div>
  );
}

function DevEnvironment(props: Pick<ContextPanelsProps, "activeScenario" | "scenarios" | "localState" | "onScenario" | "onTimeMode" | "onDateOffset" | "onProjectUpdate" | "onAgentResult" | "onReplayExample" | "onKnowledgeCorrect" | "onIntakeSave" | "onReset">) {
  const scenarioLabels = ["normal", "empty", "chaotic", "deadline-risk", "agent-completion"];
  const timeModes: TimeMode[] = ["auto", "morning", "noon", "sunset", "night"];
  return (
    <div className="context-body dev-context">
      <p className="context-principle"><FlaskConical size={15} /> Hidden demo controls. The planner below remains deterministic and local.</p>
      <section><h2>Miami time and atmosphere</h2><div className="dev-button-grid">{timeModes.map((mode) => <button type="button" className={props.localState.timeMode === mode ? "active" : ""} key={mode} onClick={() => props.onTimeMode(mode)}>{mode}</button>)}</div></section>
      <section><h2>Miami date</h2><div className="dev-button-grid"><button type="button" className={props.localState.dateOffset === 0 ? "active" : ""} onClick={() => props.onDateOffset(0)}>today</button><button type="button" className={props.localState.dateOffset === 1 ? "active" : ""} onClick={() => props.onDateOffset(1)}>tomorrow</button></div></section>
      <section><h2>Planner scenarios</h2><div className="dev-button-grid">{props.scenarios.filter((scenario) => scenarioLabels.includes(scenario.id)).map((scenario) => <button type="button" className={props.activeScenario === scenario.id ? "active" : ""} key={scenario.id} onClick={() => props.onScenario(scenario.id)}>{scenario.id === "chaotic" ? "Busy day" : scenario.label}</button>)}</div></section>
      <section><h2>Demo events</h2><div className="dev-button-grid"><button type="button" onClick={props.onAgentResult}>new agent result</button><button type="button" onClick={props.onProjectUpdate}>new project update</button><button type="button" onClick={() => props.onIntakeSave("Demo intake item created from the developer panel.")}>intake item</button><button type="button" onClick={props.onReplayExample}>replay example</button><button type="button" onClick={() => props.onKnowledgeCorrect("writing", "Writing works best after lunch")}>knowledge correction</button></div></section>
      <button className="dev-reset" type="button" onClick={props.onReset}><RotateCcw size={14} /> Reset local demo state</button>
    </div>
  );
}

export function ContextPanels(props: ContextPanelsProps) {
  const { panel, localState, closing, onClose } = props;
  const briefSettings = useMemo(() => panel.kind === "brief" ? localState.briefSettings[panel.brief.id] : undefined, [localState.briefSettings, panel]);

  if (panel.kind === "project") return <Frame eyebrow="Project environment" title={panel.project.name} className="panel-project-context" closing={closing} onClose={onClose}><ProjectEnvironment project={panel.project} onPerson={props.onPerson} onAsk={(value) => props.onContextAsk(value, panel.project.name)} /></Frame>;
  if (panel.kind === "person") return <Frame eyebrow="Person in context" title={panel.person.name} className="panel-person-context" closing={closing} onClose={onClose}><PersonEnvironment person={panel.person} /></Frame>;
  if (panel.kind === "brief" && briefSettings) return <Frame eyebrow="Brief studio · demo" title={panel.brief.name} className="panel-brief-context" closing={closing} onClose={onClose}><BriefStudio brief={panel.brief} settings={briefSettings} onChange={(settings) => props.onBriefSettings(panel.brief.id, settings)} /></Frame>;
  if (panel.kind === "knowledge") return <Frame eyebrow="What Cedrus knows about me" title="Personal knowledge" className="panel-knowledge-context" closing={closing} onClose={onClose}><KnowledgeEnvironment state={localState} onConfirm={props.onKnowledgeConfirm} onCorrect={props.onKnowledgeCorrect} /></Frame>;
  if (panel.kind === "intake") return <Frame eyebrow="Universal intake · demo" title="Add this to Cedrus" className="panel-intake-context" closing={closing} onClose={onClose}><IntakeEnvironment seed={panel.seed} onSave={props.onIntakeSave} /></Frame>;
  if (panel.kind === "results") return <Frame eyebrow="Agents" title="Consequences, not chatter." className="panel-results-context" closing={closing} onClose={onClose}><ResultsEnvironment /></Frame>;
  return <Frame eyebrow="Developer panel" title="Change the demo." className="panel-dev-context" closing={closing} onClose={onClose}><DevEnvironment {...props} /></Frame>;
}
