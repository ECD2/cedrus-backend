import type { DayIndex, TimePoint } from "./types";

export const MINUTES_PER_DAY = 24 * 60;

export function stamp(point: TimePoint): number {
  return point.day * MINUTES_PER_DAY + point.minute;
}

export function pointFromStamp(value: number): TimePoint {
  return {
    day: Math.floor(value / MINUTES_PER_DAY) as DayIndex,
    minute: value % MINUTES_PER_DAY,
  };
}

export function formatMinute(minute: number): string {
  const normalized = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 || 12;
  return `${hour}:${minutes.toString().padStart(2, "0")}${suffix}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatPoint(point: TimePoint, labels: string[]): string {
  return `${labels[point.day] ?? `Day ${point.day + 1}`} ${formatMinute(point.minute)}`;
}

export function clampMinute(value: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY, value));
}

export function timePoint(day: DayIndex, minute: number): TimePoint {
  return { day, minute };
}

