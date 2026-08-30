import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, LockKeyhole, Sparkles } from "lucide-react";
import type { PlanResult, PlannerFacts } from "../planner/types";
import type { DayIndex } from "../planner/types";
import { formatDuration, formatMinute } from "../planner/time";

interface PlanViewProps {
  facts: PlannerFacts;
  plan: PlanResult;
  day: DayIndex;
  onDay: (day: DayIndex) => void;
}

export function PlanView({ facts, plan, day, onDay }: PlanViewProps) {
  const items = [
    ...facts.fixedEvents.filter((event) => event.day === day).map((event) => ({
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      kind: event.kind,
      meta: `Fixed · ${event.source}${event.location ? ` · ${event.location}` : ""}`,
    })),
    ...plan.blocks.filter((block) => block.day === day).map((block) => ({
      id: block.id,
      title: block.title,
      start: block.start,
      end: block.end,
      kind: "flexible" as const,
      meta: `Cedrus placed · ${block.project} · ${block.context}`,
    })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  const currentItem = day === facts.now.day
    ? items.find((item) => item.start <= facts.now.minute && item.end > facts.now.minute)
    : undefined;
  const nextItem = items.find((item) => item.start > (day === facts.now.day ? facts.now.minute : 0));
  const window = facts.workWindows.find((candidate) => candidate.day === day);
  const agendaRows: Array<
    | { kind: "open"; id: string; start: number; end: number }
    | (typeof items)[number]
  > = [];

  if (window) {
    let cursor = day === facts.now.day ? Math.max(window.start, facts.now.minute) : window.start;
    items.forEach((item) => {
      if (item.start - cursor >= 15) agendaRows.push({ kind: "open", id: `open-${cursor}-${item.start}`, start: cursor, end: item.start });
      agendaRows.push(item);
      cursor = Math.max(cursor, item.end);
    });
    if (window.end - cursor >= 15) agendaRows.push({ kind: "open", id: `open-${cursor}-${window.end}`, start: cursor, end: window.end });
  } else {
    agendaRows.push(...items);
  }

  const summary = items.length === 0
    ? "The day is open."
    : currentItem
      ? `${currentItem.title} now.${nextItem ? ` ${nextItem.title} at ${formatMinute(nextItem.start)} is next.` : " Nothing follows it."}`
      : nextItem
        ? `${nextItem.title} at ${formatMinute(nextItem.start)} is next.`
        : "The placed work is complete.";

  return (
    <main className="precision-view plan-view">
      <header className="precision-header">
        <div className="plan-day-navigation">
          <button
            type="button"
            disabled={day === facts.planningDays[0]}
            onClick={() => onDay(facts.planningDays[Math.max(0, facts.planningDays.indexOf(day) - 1)])}
            aria-label="Previous planning day"
          >
            <ChevronLeft size={15} />
          </button>
          <p className="state-eyebrow">Exact plan</p>
          <button
            type="button"
            disabled={day === facts.planningDays.at(-1)}
            onClick={() => onDay(facts.planningDays[Math.min(facts.planningDays.length - 1, facts.planningDays.indexOf(day) + 1)])}
            aria-label="Next planning day"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <h1>{facts.dayLabels[day]}</h1>
        <p>{summary}</p>
      </header>

      <div className="plan-layout">
        <section className="agenda" aria-label="Exact agenda">
          {agendaRows.map((item) => item.kind === "open" ? (
            <article className="agenda-item open-time" key={item.id}>
              <time>{formatMinute(item.start)}</time>
              <div className="agenda-line"><span /></div>
              <div className="agenda-copy">
                <div className="agenda-title-row">
                  <h2>Open time</h2>
                </div>
                <p>{formatDuration(item.end - item.start)} unclaimed</p>
              </div>
            </article>
          ) : (
            <article
              className={`agenda-item ${item.kind} ${item.id === currentItem?.id ? "is-now" : ""} ${item.id === nextItem?.id ? "is-next" : ""}`}
              key={item.id}
              aria-current={item.id === currentItem?.id ? "true" : undefined}
            >
              <time>{formatMinute(item.start)}</time>
              <div className="agenda-line"><span /></div>
              <div className="agenda-copy">
                <div className="agenda-title-row">
                  <h2>{item.title}{item.id === currentItem?.id && <> <span className="now-badge">now</span></>}</h2>
                  {item.kind === "flexible" ? <Sparkles size={14} /> : <LockKeyhole size={14} />}
                </div>
                <p>{item.meta}</p>
                <span>{formatDuration(item.end - item.start)} · ends {formatMinute(item.end)}</span>
              </div>
            </article>
          ))}
          {items.length === 0 && <p className="empty-precision">Cedrus is holding this day open.</p>}
        </section>

        <aside className="plan-reasoning">
          <div className="reasoning-status">
            {plan.risks.length ? <AlertTriangle size={18} /> : <Check size={18} />}
            <div>
              <strong>{plan.risks.length ? "Needs a decision" : "On track"}</strong>
              <span>{plan.score.unplannedMinutes ? `${formatDuration(plan.score.unplannedMinutes)} needs room` : "Nothing is at risk"}</span>
            </div>
          </div>
          <h2>Why Cedrus placed it here</h2>
          <div className="decision-list">
            {plan.decisions.slice(0, 5).map((decision) => (
              <div className={`decision ${decision.type}`} key={decision.id}>
                <ArrowRight size={13} />
                <div>
                  <strong>{decision.headline}</strong>
                  <p>{decision.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {plan.risks.map((risk) => (
            <div className="risk-note" key={risk.id}>
              <strong>{risk.title}</strong>
              <p>{risk.detail}</p>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}
