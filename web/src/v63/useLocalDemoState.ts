import { useEffect, useState } from "react";
import { deskBriefs, type BriefSettings } from "./data";

export type TimeMode = "auto" | "morning" | "noon" | "sunset" | "night";

export type LocalDemoState = {
  version: 1;
  briefSettings: Record<string, BriefSettings>;
  intakeItems: string[];
  confirmedKnowledge: string[];
  correctedKnowledge: Record<string, string>;
  projectNotes: Record<string, string>;
  timeMode: TimeMode;
  dateOffset: number;
  lastSeen: string;
};

export const STORAGE_KEY = "cedrus-v63-personal-desk";

function defaults(): LocalDemoState {
  return {
    version: 1,
    briefSettings: Object.fromEntries(deskBriefs.map((brief) => [brief.id, {
      style: brief.style,
      cadence: brief.cadence,
      delivery: brief.delivery,
      inputs: brief.inputs,
      sections: brief.sections,
    }])),
    intakeItems: [],
    confirmedKnowledge: [],
    correctedKnowledge: {},
    projectNotes: {},
    timeMode: "auto",
    dateOffset: 0,
    lastSeen: new Date().toISOString(),
  };
}

export function useLocalDemoState() {
  const [state, setState] = useState<LocalDemoState>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored ? { ...defaults(), ...JSON.parse(stored) } : defaults();
    } catch {
      return defaults();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, lastSeen: new Date().toISOString() }));
    } catch {
      // The demo remains usable when storage is unavailable.
    }
  }, [state]);

  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage restrictions in private browsing.
    }
    setState(defaults());
  }

  return { state, setState, reset };
}
