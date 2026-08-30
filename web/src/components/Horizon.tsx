import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FixedEvent, PlanResult, PlannerFacts, ScheduledBlock } from "../planner/types";
import { formatDuration, formatMinute } from "../planner/time";

const SUNRISE = 390;
const SUNSET = 1200;
const WORLD_SPAN = SUNSET - SUNRISE;

const SKY_KEYS = [
  { minute: 0, colors: ["#14101c", "#0c0a14", "#07060c"] },
  { minute: 252, colors: ["#2a1e2e", "#181320", "#0b0913"] },
  { minute: 336, colors: ["#7e4a50", "#3c2a3a", "#1b1628"] },
  { minute: 408, colors: ["#efa89c", "#de909e", "#9c8aaa"] },
  { minute: 504, colors: ["#f6dccc", "#f0d2c6", "#dcc4c0"] },
  { minute: 720, colors: ["#f8f0e6", "#f4e6da", "#e4d1c8"] },
  { minute: 960, colors: ["#f6e4d2", "#efd2be", "#dbb2a8"] },
  { minute: 1116, colors: ["#f4b8a0", "#e49484", "#aa727a"] },
  { minute: 1194, colors: ["#ee9e8e", "#c6727c", "#4c303a"] },
  { minute: 1254, colors: ["#a45e5a", "#4c2c36", "#1b1322"] },
  { minute: 1332, colors: ["#2c1e26", "#150f1a", "#0a0810"] },
  { minute: 1440, colors: ["#14101c", "#0c0a14", "#07060c"] },
] as const;

const PROJECT_LIGHTS: Record<string, string> = {
  Clockout: "#9ebcc4",
  Cedrus: "#e8aa68",
  Ascendo: "#dfaa58",
  Personal: "#d98263",
  Captured: "#b7a8c1",
};

type RGB = [number, number, number];

function hex(value: string): RGB {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as RGB;
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return a.map((value, index) => value + (b[index] - value) * amount) as RGB;
}

function rgb(value: RGB): string {
  return `rgb(${value.map((part) => Math.round(Math.max(0, Math.min(255, part)))).join(",")})`;
}

function luminance(value: RGB): number {
  return (value[0] * 0.299 + value[1] * 0.587 + value[2] * 0.114) / 255;
}

function skyAt(minute: number) {
  let index = 0;
  while (index < SKY_KEYS.length - 2 && SKY_KEYS[index + 1].minute <= minute) index += 1;
  const current = SKY_KEYS[index];
  const next = SKY_KEYS[index + 1];
  const amount = Math.max(0, Math.min(1, (minute - current.minute) / (next.minute - current.minute)));
  const colors = current.colors.map((color, colorIndex) => mix(hex(color), hex(next.colors[colorIndex]), amount));
  const near = mix(colors[0].map((value) => value * 0.13) as RGB, [24, 14, 16], 0.5);
  const far = mix(colors[0].map((value) => value * 0.3) as RGB, [40, 26, 30], 0.45);
  return { colors, near, far, dark: luminance(colors[1]) < 0.56 };
}

function worldPercent(minute: number): number {
  return 17 + ((minute - SUNRISE) / WORLD_SPAN) * 66;
}

function svgX(percent: number): number {
  return ((percent + 4) / 108) * 1440;
}

function duneY(x: number): number {
  return 300 + Math.sin(x * 0.0042 + 0.6) * 46 + Math.sin(x * 0.0111 + 2.1) * 22 + Math.sin(x * 0.023 + 4.4) * 9;
}

function farY(x: number): number {
  return 336 + Math.sin(x * 0.0031 + 3.3) * 30 + Math.sin(x * 0.0087 + 1.2) * 13;
}

function pathFrom(fn: (x: number) => number, step: number): string {
  const points: Array<[number, number]> = [];
  for (let x = 0; x <= 1440; x += step) points.push([x, fn(x)]);
  let path = `M0,560 L0,${points[0][1].toFixed(1)}`;
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    path += ` Q${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`;
  }
  return `${path} L1440,560 Z`;
}

function ridgeBottom(percent: number): string {
  const heightAboveFloor = (560 - duneY(svgX(percent))) / 560;
  return `calc(${(heightAboveFloor * 48).toFixed(2)}vh - 4px)`;
}

function cleanTaskTitle(title: string): string {
  return title.replace(/^Finish /, "").replace(/^Draft /, "");
}

function durationWords(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!remaining) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours}h ${remaining}m`;
}

interface HorizonProps {
  facts: PlannerFacts;
  plan: PlanResult;
  day: number;
  scrubMinute: number;
  onScrub: (minute: number) => void;
  presentation: {
    eyebrow: string;
    headline: string;
    detail: string;
    tone: string;
  };
}

export function Horizon({ facts, plan, day, scrubMinute, onScrub, presentation }: HorizonProps) {
  const worldRef = useRef<HTMLDivElement>(null);
  const fadeTimer = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [hoverMinute, setHoverMinute] = useState(scrubMinute);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const dayEvents = facts.fixedEvents.filter((event) => event.day === day);
  const dayBlocks = plan.blocks.filter((block) => block.day === day);
  const palette = skyAt(scrubMinute);
  const sunFraction = (scrubMinute - SUNRISE) / WORLD_SPAN;
  const sunVisible = sunFraction >= -0.06 && sunFraction <= 1.06;
  const sunElevation = Math.sin(Math.max(0, Math.min(1, sunFraction)) * Math.PI);
  const sunLeft = worldPercent(scrubMinute);
  const sunTop = 56 - sunElevation * 42;
  const activeBlock = dayBlocks.find((block) => block.start <= scrubMinute && block.end > scrubMinute);
  const activeEvent = dayEvents.find((event) => event.start <= scrubMinute && event.end > scrubMinute);
  const nextFixed = dayEvents.filter((event) => event.start > scrubMinute).sort((a, b) => a.start - b.start)[0];
  const defaultState = presentation.eyebrow.startsWith("Current focus");

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return dayEvents.find((event) => event.id === selectedId) ?? dayBlocks.find((block) => block.id === selectedId) ?? null;
  }, [dayBlocks, dayEvents, selectedId]);

  const sentence = defaultState
    ? nextFixed
      ? `${durationWords(nextFixed.start - scrubMinute)} before ${nextFixed.title}.`
      : activeEvent
        ? `${activeEvent.title} is underway.`
        : activeBlock
          ? `${cleanTaskTitle(activeBlock.title)} has ${durationWords(activeBlock.end - scrubMinute)} left.`
        : "Nothing needs you right now."
    : presentation.headline;

  const currentLine = defaultState
    ? activeBlock
      ? `${cleanTaskTitle(activeBlock.title)} · now`
      : activeEvent
        ? `${activeEvent.title} · fixed now`
        : nextFixed
          ? `The ridge is clear until ${formatMinute(nextFixed.start)}.`
          : "The ridge is clear."
    : presentation.eyebrow;

  const worldStyle = {
    "--sky-bottom": rgb(palette.colors[0]),
    "--sky-middle": rgb(palette.colors[1]),
    "--sky-top": rgb(palette.colors[2]),
    "--ridge-near": rgb(palette.near),
    "--ridge-far": rgb(palette.far),
    "--world-ink": palette.dark ? "240,235,221" : "35,24,22",
    "--star-opacity": `${(1 - Math.max(0, sunElevation)) * (palette.dark ? 0.78 : 0.08)}`,
  } as CSSProperties;

  useEffect(() => {
    setSelectedId(null);
  }, [day, presentation.headline]);

  useEffect(() => () => {
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
  }, []);

  function revealTime() {
    setInteracting(true);
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setInteracting(false), 1500);
  }

  function minuteFromPointer(clientX: number): number | null {
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const rawPercent = ((clientX - rect.left) / rect.width) * 100;
    const fraction = (rawPercent - 17) / 66;
    return Math.round(Math.max(0, Math.min(1439, SUNRISE + fraction * WORLD_SPAN)) / 5) * 5;
  }

  function trackPointer(clientX: number, clientY: number) {
    const rect = worldRef.current?.getBoundingClientRect();
    const nearTerrain = rect ? clientY > rect.top + rect.height * 0.5 : false;
    if (nearTerrain || dragging) revealTime();
    const minute = minuteFromPointer(clientX);
    if (minute === null) return;
    setHoverMinute(minute);
    if (dragging) onScrub(minute);
  }

  function fixedStyle(event: FixedEvent): CSSProperties {
    const left = worldPercent(event.start);
    return {
      left: `${left}%`,
      bottom: ridgeBottom(left),
      "--marker-light": event.tone === "warning" ? "#ff9168" : event.kind === "cedrus-fixed" ? "#e6a35f" : "#ead8c2",
    } as CSSProperties;
  }

  function glowStyle(block: ScheduledBlock): CSSProperties {
    const left = worldPercent(block.start);
    const right = worldPercent(block.end);
    const middle = (left + right) / 2;
    return {
      left: `${left}%`,
      width: `${Math.max(1.6, right - left)}%`,
      bottom: ridgeBottom(middle),
      "--work-light": PROJECT_LIGHTS[block.project] ?? "#c9bba7",
    } as CSSProperties;
  }

  const homesteadX = 150;
  const homesteadY = duneY(homesteadX);

  return (
    <main
      className={`cedrus-world tone-${presentation.tone} ${palette.dark ? "is-dark" : "is-light"} ${interacting ? "world-interacting" : ""}`}
      style={worldStyle}
      aria-label="Cedrus world"
    >
      <div
        className="world-stage"
        ref={worldRef}
        onPointerMove={(event) => trackPointer(event.clientX, event.clientY)}
        onPointerDown={(event) => {
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const minute = minuteFromPointer(event.clientX);
          if (minute !== null) onScrub(minute);
        }}
        onPointerUp={(event) => {
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => onScrub(facts.now.minute)}
      >
        <div className="world-sky" />
        <div className="world-stars" aria-hidden="true">
          {Array.from({ length: 42 }, (_, index) => (
            <span
              key={index}
              style={{
                left: `${3 + ((index * 43) % 94)}%`,
                top: `${4 + ((index * 29) % 48)}%`,
                animationDelay: `${(index % 9) * -0.73}s`,
              }}
            />
          ))}
        </div>
        <div className="world-glow" aria-hidden="true" />
        {sunVisible && (
          <div className="celestial" style={{ left: `${sunLeft}%`, top: `${sunTop}%`, opacity: 0.44 + sunElevation * 0.54 }} aria-hidden="true">
            <span className="celestial-a" />
            <span className="celestial-b" />
          </div>
        )}
        <div className="world-haze" aria-hidden="true" />

        <svg className="world-ridge" viewBox="0 0 1440 560" preserveAspectRatio="none" aria-hidden="true">
          <path className="ridge-far" d={pathFrom(farY, 30)} />
          <path className="ridge-near" d={pathFrom(duneY, 24)} />
          <g className="homestead">
            <path d={`M${homesteadX - 104},${homesteadY + 4} L${homesteadX - 104},${homesteadY - 28} Q${homesteadX - 104},${homesteadY - 82} ${homesteadX - 40},${homesteadY - 84} Q${homesteadX + 24},${homesteadY - 82} ${homesteadX + 24},${homesteadY - 28} L${homesteadX + 24},${homesteadY + 4} Z`} />
            <rect x={homesteadX + 24} y={homesteadY - 32} width="50" height="36" rx="3" />
            <rect x={homesteadX - 144} y={homesteadY - 24} width="42" height="28" rx="3" />
            <circle className="homestead-light" cx={homesteadX - 60} cy={homesteadY - 24} r="3" />
          </g>
        </svg>

        <div className="terrain-lights" aria-label="Flexible work placed by Cedrus">
          {dayBlocks.map((block) => (
            <button
              className={`terrain-light project-${block.project.toLowerCase()} ${selectedId === block.id ? "selected" : ""}`}
              type="button"
              key={block.id}
              style={glowStyle(block)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setSelectedId((current) => current === block.id ? null : block.id)}
              aria-label={`${block.title}, ${formatMinute(block.start)} to ${formatMinute(block.end)}, flexible`}
            >
              <span className="world-tooltip">
                <em>flexible · Cedrus placed {formatDuration(block.end - block.start)} here</em>
                <strong>{block.title}</strong>
                <small>{formatMinute(block.start)}–{formatMinute(block.end)}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="fixed-landmarks" aria-label="Fixed commitments">
          {dayEvents.map((event) => (
            <button
              className={`fixed-landmark ${event.kind} tone-${event.tone ?? "stone"} ${selectedId === event.id ? "selected" : ""}`}
              type="button"
              key={event.id}
              style={fixedStyle(event)}
              onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
              onClick={() => setSelectedId((current) => current === event.id ? null : event.id)}
              aria-label={`${event.title}, ${formatMinute(event.start)} to ${formatMinute(event.end)}, fixed`}
            >
              <span className="landmark-ground" />
              <span className="landmark-light" />
              <span className="world-tooltip">
                <em>{event.kind === "external-fixed" ? "provider fixed" : "Cedrus fixed"}</em>
                <strong>{event.title}</strong>
                <small>{formatMinute(event.start)}–{formatMinute(event.end)}</small>
              </span>
            </button>
          ))}
        </div>

        {presentation.tone !== "complete" && presentation.tone !== "quiet" && <span className="remote-agent-light" aria-hidden="true" />}
        {plan.risks.length > 0 && <span className="risk-beacon" aria-hidden="true" />}

        <section className="world-sentence" aria-live="polite">
          <h1>{sentence}</h1>
          <p>{currentLine}</p>
        </section>

        <div className="time-reveal" aria-hidden="true">
          {[540, 720, 900, 1080].map((minute) => (
            <span key={minute} style={{ left: `${worldPercent(minute)}%` }}>{formatMinute(minute).replace(":00", "")}</span>
          ))}
          <strong style={{ left: `${worldPercent(hoverMinute)}%` }}>{formatMinute(hoverMinute)}</strong>
        </div>

        {selected && (
          <aside className="world-inspector" aria-live="polite">
            {"kind" in selected ? (
              <>
                <span>{selected.kind === "external-fixed" ? "Provider fixed" : "Cedrus fixed"}</span>
                <strong>{selected.title}</strong>
                <p>{formatMinute(selected.start)}–{formatMinute(selected.end)} · {selected.source}{selected.location ? ` · ${selected.location}` : ""}</p>
              </>
            ) : (
              <>
                <span>Flexible · chunk {selected.chunkIndex + 1}</span>
                <strong>{selected.title}</strong>
                <p>Cedrus placed {formatDuration(selected.end - selected.start)} here · {selected.project} · {selected.context}</p>
              </>
            )}
          </aside>
        )}

        <div className="world-vignette" aria-hidden="true" />
        <div className="world-grain" aria-hidden="true" />
      </div>
    </main>
  );
}
