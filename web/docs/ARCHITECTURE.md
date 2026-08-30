# Cedrus V6 architecture

## Boundary

V6 is a local, browser-run prototype. It does not authenticate, call a calendar provider, write to an external calendar, run an actual agent, or publish a site. All provider and agent behavior is represented by typed local adapters and deterministic scenarios.

## System layers

```text
Natural-language capture          Scenario/dev controls
            |                              |
            v                              v
      semantic parser  ------------> typed mutations
                                         |
                                         v
calendar adapters --> canonical facts --> planner --> plan + risks + decisions
                                         |
                                         v
                         horizon / plan / calendar / replay
```

### Domain model

The core model distinguishes:

- `external-fixed`: provider events; immovable by Cedrus.
- `cedrus-fixed`: commitments created inside Cedrus and intentionally locked to a time.
- `flexible`: effort that the planner may move or split.
- `locked`: an explicit override that preserves the current placement.

Flexible work contains total and remaining duration, earliest start, deadline, priority, minimum and maximum chunks, split policy, work windows, allowed days, context, dependency IDs, energy, location, status, source, source reference, auto-schedule state, and lock state.

### Planner

The prototype planner is a pure deterministic function:

```text
schedule(facts, previousPlan?) -> {
  blocks,
  unscheduled,
  risks,
  decisions,
  score
}
```

It does not mutate its inputs or call providers. It:

1. normalizes fixed intervals;
2. calculates task pressure, including downstream dependency deadlines;
3. orders ready work deterministically;
4. subtracts fixed and already-planned intervals from executable windows;
5. places legal chunks while avoiding unusable remainders;
6. unlocks dependents after prerequisite completion;
7. emits explicit risk for work that cannot be placed before its deadline;
8. compares with the prior plan to produce a human-readable change set.

Hard constraints are evaluated before soft preferences. If no legal placement exists, the planner leaves work unassigned.

### Semantic layer

The local Ask parser demonstrates the intended contract. It converts a small set of natural-language examples into typed mutations, then passes those mutations to the same planner used by buttons and scenarios.

In a production system an LLM may replace the demonstration parser, but only at this boundary. Output must validate against the mutation schema. Provider facts and schedule placement remain deterministic.

### Provider adapters

Production adapters should implement:

```ts
interface CalendarAdapter {
  listChanges(cursor?: SyncCursor): Promise<ChangePage>;
  getFreeBusy(range: DateRange): Promise<BusyInterval[]>;
  createEvent(input: ProviderEventDraft, precondition?: Revision): Promise<ProviderEvent>;
  updateEvent(ref: ProviderRef, patch: ProviderEventPatch, precondition: Revision): Promise<ProviderEvent>;
  deleteEvent(ref: ProviderRef, precondition: Revision): Promise<void>;
}
```

Adapters must preserve provider IDs, recurrence/exception identity, revisions/etags, tombstones, time zones, sync cursors, and last successful sync. External events become fixed local facts. Flexible Cedrus blocks are not published unless the user explicitly enables that policy.

### Agent adapters

Agent completions enter as provenance-rich mutations: task ID, source run ID, completion or partial progress, output reference, timestamp, and confidence. They may reduce remaining effort or unblock dependencies, but the planner still recomputes the consequence.

### Replay

Every scenario and Ask command produces a local change record with:

- triggering event;
- previous and next plan versions;
- moved/created/removed blocks;
- changed risk state;
- concise explanation.

This is the seed of undo, audit, re-entry, and “why did this move?” behavior.

## Current UI composition

- `Cedrus world`: permanent full-viewport home with a V4-derived time-of-day engine, atmospheric ridge, anchored fixed landmarks, flexible terrain illumination, and one primary sentence.
- `Plan`: exact agenda, task metadata, risk, and decision explanations in a sheet over the world.
- `Calendar`: conventional multi-day time grid in the deeper precision sheet.
- `Ask`: collapsed natural-language capture; its result becomes the world's single current sentence.
- `Projects`, `Agents`, `Replay`: consequence-oriented sheets over the world.
- `Dev`: backtick-only scenario controls with no visible entry in the normal shell.

The world is not a peer view and has no view switcher. Closing any secondary surface returns directly to it. The complete V4-element and V6-capability mapping is recorded in `docs/V6_1_SHELL_MAPPING.md`.

## Production next steps

1. Persist canonical tasks, events, plan versions, and replay in a local database.
2. Add a read-only Google Calendar adapter using incremental sync and revision-safe writes behind an explicit feature flag.
3. Add timezone/DST and RFC 5545 recurrence conformance tests.
4. Add a constraint-solver adapter only after real datasets expose limits in the deterministic allocator.
5. Introduce a schema-constrained semantic parser with a confirmation policy for destructive or external mutations.
6. Add a background re-entry service that recomputes after provider sync and stays silent when no user-relevant consequence exists.
