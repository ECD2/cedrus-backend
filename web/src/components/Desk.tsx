import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  FileText,
  LockKeyhole,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { PlanResult, PlannerFacts } from "../planner/types";
import { formatDuration, formatMinute } from "../planner/time";
import { deskBriefs, deskPeople, deskProjects, type DemoBrief, type DemoPerson, type DemoProject } from "../v63/data";

type SurfaceKind = "plan" | "calendar";

interface DeskProps {
  facts: PlannerFacts;
  plan: PlanResult;
  timeLabel: string;
  dateLabel: string;
  currentMinute: number;
  worldTone: "day" | "sunset" | "night";
  projectUpdate?: string | null;
  onOpenSurface: (surface: SurfaceKind) => void;
  onProject: (project: DemoProject) => void;
  onPerson: (person: DemoPerson) => void;
  onBrief: (brief: DemoBrief) => void;
  onReplay: () => void;
}

type AgendaItem = {
  id: string;
  title: string;
  start: number;
  end: number;
  fixed: boolean;
  meta: string;
};

function buildAgenda(facts: PlannerFacts, plan: PlanResult): AgendaItem[] {
  const day = facts.now.day;
  return [
    ...facts.fixedEvents.filter((event) => event.day === day).map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      fixed: true,
      meta: event.location ?? event.source,
    })),
    ...plan.blocks.filter((block) => block.day === day).map((block) => ({
      id: block.id,
      title: block.title,
      start: block.start,
      end: block.end,
      fixed: false,
      meta: block.project,
    })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
}

function SectionTitle({ index, title, statement }: { index: string; title: string; statement: string }) {
  return (
    <header className="desk-section-title">
      <p><span>{index}</span>{title}</p>
      <h2>{statement}</h2>
    </header>
  );
}

export function Desk({
  facts,
  plan,
  timeLabel,
  dateLabel,
  currentMinute,
  worldTone,
  projectUpdate,
  onOpenSurface,
  onProject,
  onPerson,
  onBrief,
  onReplay,
}: DeskProps) {
  const agenda = buildAgenda(facts, plan);
  const nowMinute = currentMinute;
  const current = agenda.find((item) => item.start <= nowMinute && item.end > nowMinute);
  const next = agenda.find((item) => item.start > nowMinute);
  const workWindow = facts.workWindows.find((item) => item.day === facts.now.day);
  let openMinutes = 0;
  if (workWindow) {
    let cursor = Math.max(workWindow.start, nowMinute);
    agenda.filter((item) => item.end > cursor).forEach((item) => {
      if (item.start > cursor) openMinutes += item.start - cursor;
      cursor = Math.max(cursor, item.end);
    });
    openMinutes += Math.max(0, workWindow.end - cursor);
  }

  return (
    <main className="personal-desk" aria-label="Cedrus personal desk">
      <div className={"desk-horizon tone-" + worldTone} aria-label={"Live Miami horizon, " + timeLabel}>
        <div className="desk-sky">
          <span className="desk-sun" />
          <span className="desk-star-field" />
        </div>
        <svg viewBox="0 0 1440 180" preserveAspectRatio="none" aria-hidden="true">
          <path className="desk-ridge-far" d="M0 134 Q140 82 300 126 T610 108 T910 122 T1190 96 T1440 118 L1440 180 L0 180 Z" />
          <path className="desk-ridge-near" d="M0 150 Q150 116 290 150 T590 132 T870 149 T1150 121 T1440 142 L1440 180 L0 180 Z" />
          <g className="desk-dome"><path d="M1158 132 Q1182 92 1206 132 Z" /><rect x="1205" y="121" width="18" height="12" rx="2" /></g>
        </svg>
        <div className="desk-horizon-meta"><span>{dateLabel}</span><strong>{timeLabel}</strong><small>MIAMI</small></div>
      </div>

      <div className="desk-paper">
        <section className="desk-section today-section" id="today-desk" aria-labelledby="today-title">
          <SectionTitle index="01" title="Today" statement="The shape of the day, without the machinery." />
          <div className="today-lead">
            <div className="today-current">
              <p className="desk-kicker">Now</p>
              <h3 id="today-title">{current?.title ?? "Nothing needs you right now."}</h3>
              <p>{current ? "until " + formatMinute(current.end) + " · " + current.meta : "The next decision can wait."}</p>
            </div>
            <div className="today-next">
              <p className="desk-kicker">Next</p>
              <strong>{next?.title ?? "The day is clear"}</strong>
              <span>{next ? formatMinute(next.start) : "No fixed commitments"}</span>
            </div>
            <div className="today-open">
              <p className="desk-kicker">Open</p>
              <strong>{openMinutes ? formatDuration(openMinutes) : "No room"}</strong>
              <span>{openMinutes ? "still unclaimed today" : "Cedrus is holding the edges"}</span>
            </div>
          </div>

          <div className="today-agenda">
            <div className="agenda-rule" aria-hidden="true" />
            {agenda.map((item) => (
              <article className={"desk-agenda-row " + (item.fixed ? "is-fixed " : "is-flexible ") + (item.id === current?.id ? "is-current" : "")} key={item.id}>
                <time>{formatMinute(item.start)}</time>
                <span className="agenda-mark" aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.fixed ? "Fixed" : "Cedrus placed"} · {item.meta} · ends {formatMinute(item.end)}</p>
                </div>
                {item.fixed ? <LockKeyhole size={14} aria-label="Fixed commitment" /> : <Sparkles size={14} aria-label="Cedrus placed work" />}
              </article>
            ))}
          </div>

          <footer className="today-footer">
            <div>
              <Clock3 size={15} />
              <span>{plan.risks.length ? "One decision needs you" : "The plan fits around every fixed commitment."}</span>
            </div>
            <div className="today-tools" aria-label="Today precision tools">
              <button type="button" onClick={() => onOpenSurface("plan")}>plan <ArrowUpRight size={13} /></button>
              <button type="button" onClick={() => onOpenSurface("calendar")}>calendar <ArrowUpRight size={13} /></button>
            </div>
          </footer>
        </section>

        <section className="desk-section projects-section" id="projects" aria-labelledby="projects-title">
          <SectionTitle index="02" title="Projects" statement="The worlds currently asking for your attention." />
          {projectUpdate && <p className="desk-update" role="status">{projectUpdate}</p>}
          <div className="project-ledger">
            {deskProjects.map((project, index) => (
              <button type="button" className="project-ledger-row" key={project.id} onClick={() => onProject(project)}>
                <span className="project-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="project-accent" style={{ background: project.accent }} />
                <span className="project-copy">
                  <strong id={index === 0 ? "projects-title" : undefined}>{project.name}</strong>
                  <span>{project.summary}</span>
                </span>
                <span className="project-status">{project.status}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        </section>

        <section className="desk-section people-section" id="people" aria-labelledby="people-title">
          <SectionTitle index="03" title="People" statement="People in the context of what your lives share." />
          <div className="people-editorial">
            {deskPeople.map((person, index) => (
              <button type="button" className="person-line" key={person.id} onClick={() => onPerson(person)}>
                <span className="person-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="person-avatar" aria-hidden="true">{person.name.slice(0, 1)}</span>
                <span className="person-copy">
                  <strong id={index === 0 ? "people-title" : undefined}>{person.name}</strong>
                  <span>{person.context}</span>
                </span>
                <span className="person-current">{person.current}</span>
                <ArrowDownRight size={15} />
              </button>
            ))}
          </div>
          <p className="people-principle"><UserRound size={14} /> Context, not contact management. Cedrus only shows what matters to the work and life you share.</p>
        </section>

        <section className="desk-section briefs-section" id="briefs" aria-labelledby="briefs-title">
          <SectionTitle index="04" title="Briefs" statement="Turn what Cedrus knows into recurring, useful output." />
          <div className="brief-ledger">
            {deskBriefs.map((brief, index) => (
              <button type="button" className="brief-row" key={brief.id} onClick={() => onBrief(brief)}>
                <span className="brief-symbol"><FileText size={16} /></span>
                <span className="brief-copy">
                  <strong id={index === 0 ? "briefs-title" : undefined}>{brief.name}</strong>
                  <span>{brief.description}</span>
                </span>
                <span className="brief-cadence">{brief.cadenceLabel}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
          <button className="replay-invitation" type="button" onClick={onReplay}>
            <span className="desk-kicker">Replay</span>
            <strong>Walk back through what changed.</strong>
            <span>Time, decisions, people, and quiet agent work — in order.</span>
            <ArrowUpRight size={17} />
          </button>
        </section>

        <footer className="desk-ending">
          <span>Cedrus keeps the world quiet.</span>
          <span>The desk remembers the rest.</span>
        </footer>
      </div>
    </main>
  );
}
