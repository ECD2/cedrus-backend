import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  FlaskConical,
  History,
  Play,
  ShieldCheck,
  X,
} from "lucide-react";
import type { PlanResult, ScenarioDefinition } from "../planner/types";
import { formatDuration } from "../planner/time";
import { projects } from "../scenarios";

export type PanelKind = "projects" | "agents" | "replay" | "dev";

interface SecondaryPanelProps {
  kind: PanelKind;
  plan: PlanResult;
  scenarios: ScenarioDefinition[];
  activeScenario: string;
  onScenario: (id: string) => void;
  closing?: boolean;
  onClose: () => void;
}

function titleFor(kind: PanelKind): { eyebrow: string; title: string } {
  if (kind === "projects") return { eyebrow: "Environments", title: "The work behind the day." };
  if (kind === "agents") return { eyebrow: "Agents", title: "Consequences, not chatter." };
  if (kind === "replay") return { eyebrow: "Replay", title: "What changed and why." };
  return { eyebrow: "Developer panel", title: "Change the physics." };
}

export function SecondaryPanel({ kind, plan, scenarios, activeScenario, onScenario, closing = false, onClose }: SecondaryPanelProps) {
  const heading = titleFor(kind);

  return (
    <div className={`panel-backdrop ${closing ? "is-closing" : ""}`} role="presentation" onMouseDown={onClose}>
      <section
        className={`secondary-panel panel-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={heading.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <div>
            <p className="state-eyebrow">{heading.eyebrow}</p>
            <h1>{heading.title}</h1>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close" aria-label="Close panel">
            <X size={19} />
          </button>
        </header>

        {kind === "projects" && (
          <div className="project-environments">
            {projects.map((project, index) => (
              <button className="project-environment" type="button" key={project.id}>
                <span className="project-index">0{index + 1}</span>
                <span className="project-orbit" style={{ backgroundColor: project.color }} />
                <span className="project-main">
                  <strong>{project.name}</strong>
                  <span>{project.state}</span>
                </span>
                <span className="project-signal">{project.signal}</span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
        )}

        {kind === "agents" && (
          <div className="agent-environment">
            <article className="agent-lead">
              <div className="agent-pulse"><Bot size={22} /></div>
              <div>
                <span className="agent-status">Result · 11:39am</span>
                <h2>Clockout model passed validation</h2>
                <p>The dependency cleared. Cedrus removed the remaining model blocks and brought the IC memo forward.</p>
              </div>
              <CheckCircle2 size={22} />
            </article>
            <p className="panel-principle"><ShieldCheck size={14} /> Agents report consequences into the planner. They do not place time directly.</p>
          </div>
        )}

        {kind === "replay" && (
          <div className="replay-timeline">
            <div className="replay-summary">
              <History size={18} />
              <div>
                <strong>{plan.score.movedBlocks ? `${plan.score.movedBlocks} block${plan.score.movedBlocks === 1 ? "" : "s"} moved` : "The plan held"}</strong>
                <span>{plan.score.unplannedMinutes ? `${formatDuration(plan.score.unplannedMinutes)} remains unplaced` : "No deadline impact"}</span>
              </div>
            </div>
            {plan.decisions.map((decision, index) => (
              <article className={`replay-entry ${decision.type}`} key={decision.id}>
                <span className="replay-number">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{decision.headline}</strong>
                  <p>{decision.detail}</p>
                </div>
              </article>
            ))}
          </div>
        )}

        {kind === "dev" && (
          <div className="dev-environment">
            <div className="dev-note">
              <FlaskConical size={18} />
              <p>Every control below swaps deterministic facts and runs the same planner. There are no prerecorded schedule positions.</p>
            </div>
            {(["core", "change", "system"] as const).map((group) => (
              <section className="scenario-group" key={group}>
                <h2>{group}</h2>
                <div className="scenario-buttons">
                  {scenarios.filter((scenario) => scenario.group === group).map((scenario) => (
                    <button
                      type="button"
                      key={scenario.id}
                      className={scenario.id === activeScenario ? "active" : ""}
                      onClick={() => {
                        onScenario(scenario.id);
                        onClose();
                      }}
                    >
                      <Play size={13} />
                      <span>{scenario.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <div className="dev-metrics">
              <span><strong>0</strong> hard violations</span>
              <span><strong>{plan.blocks.length}</strong> placed blocks</span>
              <span><strong>{formatDuration(plan.score.unplannedMinutes)}</strong> unplaced</span>
              <span><strong>local</strong> provider mode</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
