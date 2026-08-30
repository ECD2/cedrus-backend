import { useState } from "react";
import { Bot, BriefcaseBusiness, History, Sparkles, UserRound, X } from "lucide-react";
import { replayEvents } from "../v63/data";

interface ReplayExperienceProps {
  closing?: boolean;
  onClose: () => void;
}

const iconFor = {
  work: BriefcaseBusiness,
  person: UserRound,
  cedrus: Sparkles,
  agent: Bot,
  project: History,
};

export function ReplayExperience({ closing, onClose }: ReplayExperienceProps) {
  const [phase, setPhase] = useState("morning");
  return (
    <div className={"replay-experience phase-" + phase + " " + (closing ? "is-closing" : "")} role="dialog" aria-modal="true" aria-label="Replay — what changed today">
      <header className="replay-header">
        <div><span>Replay</span><strong>Monday, August 17</strong></div>
        <button type="button" onClick={onClose} aria-label="Close Replay"><X size={19} /></button>
      </header>

      <div
        className="replay-scroll"
        onScroll={(event) => {
          const element = event.currentTarget;
          const ratio = element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight);
          setPhase(ratio < 0.34 ? "morning" : ratio < 0.7 ? "noon" : "sunset");
        }}
      >
        <div className="replay-environment" aria-hidden="true">
          <div className="replay-sky"><span className="replay-sun" /><span className="replay-stars" /></div>
          <svg viewBox="0 0 1440 430" preserveAspectRatio="none">
            <path className="replay-ridge-far" d="M0 310 Q150 218 330 296 T680 258 T1040 302 T1440 246 L1440 430 L0 430 Z" />
            <path className="replay-ridge-near" d="M0 344 Q170 276 340 342 T720 294 T1080 350 T1440 306 L1440 430 L0 430 Z" />
            <g className="replay-dome"><path d="M1100 312 Q1132 254 1164 312 Z" /><rect x="1163" y="297" width="24" height="15" rx="2" /></g>
          </svg>
        </div>

        <section className="replay-intro">
          <p>What changed while you were living the day.</p>
          <h1>The plan moved quietly.<br />The reasons remain.</h1>
          <span>Scroll through the memory</span>
        </section>

        <div className="replay-chronology">
          {replayEvents.map((event, index) => {
            const Icon = iconFor[event.kind];
            return (
              <article className={"replay-memory kind-" + event.kind} key={event.id}>
                <time>{event.time}</time>
                <span className="replay-memory-mark"><Icon size={14} /></span>
                <div>
                  <p>{String(index + 1).padStart(2, "0")} · {event.kind}</p>
                  <h2>{event.title}</h2>
                  <span>{event.detail}</span>
                </div>
              </article>
            );
          })}
        </div>

        <footer className="replay-outro">
          <History size={18} />
          <h2>The day still belongs to you.</h2>
          <p>Replay keeps the consequence and the reason, then lets the world become quiet again.</p>
          <button type="button" onClick={onClose}>Return to Cedrus</button>
        </footer>
      </div>
    </div>
  );
}
