import { LockKeyhole, Sparkles } from "lucide-react";
import type { PlanResult, PlannerFacts } from "../planner/types";
import { formatMinute } from "../planner/time";

const START = 540;
const END = 1200;

function top(minute: number): number {
  return ((minute - START) / (END - START)) * 100;
}

interface CalendarViewProps {
  facts: PlannerFacts;
  plan: PlanResult;
}

export function CalendarView({ facts, plan }: CalendarViewProps) {
  return (
    <main className="precision-view calendar-view">
      <header className="precision-header">
        <p className="state-eyebrow">Precision workspace</p>
        <h1>Calendar</h1>
        <p>The conventional grid, when exact placement matters.</p>
      </header>

      <div className="calendar-shell">
        <div className="calendar-times" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => 540 + index * 60).map((minute) => (
            <span key={minute} style={{ top: `${top(minute)}%` }}>{formatMinute(minute)}</span>
          ))}
        </div>
        <div className="calendar-days">
          {facts.planningDays.map((day) => (
            <section className="calendar-day" key={day} aria-label={facts.dayLabels[day]}>
              <h2>{facts.dayLabels[day]}</h2>
              <div className="calendar-grid-lines" aria-hidden="true">
                {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
              </div>
              {facts.fixedEvents.filter((event) => event.day === day).map((event) => (
                <article
                  key={event.id}
                  className={`calendar-block ${event.kind}`}
                  style={{ top: `${top(event.start)}%`, height: `${Math.max(2.4, top(event.end) - top(event.start))}%` }}
                >
                  <LockKeyhole size={11} />
                  <strong>{event.title}</strong>
                  <span>{formatMinute(event.start)}</span>
                </article>
              ))}
              {plan.blocks.filter((block) => block.day === day).map((block) => (
                <article
                  key={block.id}
                  className={`calendar-block flexible project-${block.project.toLowerCase()}`}
                  style={{ top: `${top(block.start)}%`, height: `${Math.max(2.4, top(block.end) - top(block.start))}%` }}
                >
                  <Sparkles size={11} />
                  <strong>{block.title}</strong>
                  <span>{formatMinute(block.start)}</span>
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
