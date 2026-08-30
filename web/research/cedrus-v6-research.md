# Cedrus V6 research

Research date: 2026-08-17

## Product conclusion

Cedrus should not be a dashboard that contains a calendar. It should maintain a living, explainable plan and reveal only the piece of that plan the user needs now.

The practical architecture is:

1. Calendar providers supply facts: events, free/busy state, recurrence, attendees, and provider version data.
2. A deterministic planner owns placement: hard constraints, dependencies, chunks, work windows, priorities, and deadline risk.
3. A semantic layer translates natural language into typed mutations and turns planner decisions into plain-language explanations.
4. The interface is a horizon first, an agenda second, and a conventional calendar only when explicitly requested.

This deliberately separates “understanding what the user meant” from “deciding whether the resulting schedule is valid.” An LLM may propose structured input; it may not silently place work or invent calendar state.

## What V4 and V5 taught us

### Preserve from V4

- The wide time horizon was the strongest product metaphor.
- Time felt spatial rather than tabular.
- Environmental motion made the schedule feel alive.
- The relationship between now, what is next, and the rest of the day could be read quickly.

### Reject from V4

- The queue/deck treatment made tasks feel separate from time.
- Important decisions still accumulated in peripheral panels.
- The visual language did not yet distinguish fixed events, Cedrus-fixed commitments, and flexible work.

### Preserve from V5

- Project environments, Ask, replay, agents, and simulation scenarios are useful secondary capabilities.
- The prototype demonstrated breadth and consequence tracking.

### Reject from V5

- The default surface became a wall of status, needs, runs, rooms, watches, and changes.
- A high signal count replaced prioritization.
- The schedule became one panel among many instead of the governing physics of the product.

## Open-source systems inspected

The following repositories were cloned at shallow depth and their task models, scheduling code, sync code, and license files were inspected locally.

### FluidCalendar

Source: [dotnetfactory/fluid-calendar](https://github.com/dotnetfactory/fluid-calendar), MIT, inspected at commit `832a7ba` (2026-07-02).

Useful ideas:

- Clean separation between calendar conflict discovery, slot generation, slot scoring, and task scheduling.
- A legible score made from work-hour alignment, energy match, project proximity, buffers, time preference, deadline proximity, and priority.
- Locked tasks are excluded from rescheduling.
- Calendar-provider code sits behind services instead of leaking into every component.

Limits for Cedrus:

- The current scheduler places a task as one contiguous duration; it is not a full chunk/dependency planner.
- It scores generated candidate slots greedily. It does not prove global feasibility or model deadline risk across a dependency chain.
- The project describes itself as active and not production-ready. It is a valuable implementation reference, not a foundation to transplant.

Cedrus decision: preserve the service boundaries and factor-level explanations; replace the single-slot greedy model with explicit chunks, hard constraints, and deterministic re-planning.

### Annado

Source: [ABeehive/Annado](https://github.com/ABeehive/Annado), MIT, inspected at commit `a67c744` (2026-07-17).

Useful ideas:

- Markdown/Obsidian tasks remain portable and human-readable.
- `when` and `deadline` are separate concepts.
- Agenda scheduling respects working hours, breaks, blocking calendar events, event-specific blocking overrides, priority layers, and task duration.
- When a task does not fit, the UI produces the next three available suggestions instead of hiding failure.
- Delete/restore uses an exact snapshot, which is a strong model for trustworthy replay.

Limits for Cedrus:

- Auto-scheduling is day-local first-fit placement by deadline/when/anytime layers.
- It does not split long work, propagate dependency pressure, or optimize the plan across multiple days.

Cedrus decision: adopt the distinction between desired timing and deadline, explicit “does not fit” states, and reversible mutations. Go beyond its first-fit algorithm.

### Zero Calendar

Source: [x1xhlol/zero-calendar](https://github.com/x1xhlol/zero-calendar), MIT, inspected at commit `5e27779` (2026-04-26).

Useful ideas:

- Natural-language operations are tools over calendar facts, not replacements for those facts.
- The system prompt explicitly forbids invented calendar state and requires tool confirmation for mutations.
- Google sync stores sync tokens, watch channel IDs, expiration, resource IDs, and verification tokens.
- Incremental sync handles pagination, deletion, and `410 Gone` by clearing the invalid token and recovering with a full sync.
- Read, conflict-check, create, update, and delete capabilities have clean boundaries.

Limits for Cedrus:

- Free-time discovery is essentially a 9–5 gap finder.
- There is no rich flexible-task model, global re-planning, dependency graph, or chunk policy.
- Calling event CRUD “AI scheduling” would overstate the actual planning depth.

Cedrus decision: use its provider-state discipline later. Do not treat natural-language calendar CRUD as the V6 scheduler.

### taskcheck

Source: [00sapo/taskcheck](https://github.com/00sapo/taskcheck), AGPL-3.0, inspected at commit `9c9abdb` (2026-08-03).

Useful ideas:

- A schedule is simulated one work chunk at a time.
- Urgency is recomputed after each allocation and for each future day.
- Dependencies block work and can pass urgency backward to prerequisites.
- Work maps, calendar blocks, vacations, estimated effort, deadlines, and a configurable chunk size are considered together.
- Dry-run previews and automatic pre-write backups make rescheduling auditable and reversible.
- When a deadline cannot be met, the system escalates urgency in bounded retries, then reports that the schedule is infeasible instead of pretending.

Limits for Cedrus:

- Scheduling output is principally daily effort allocation rather than a precise intra-day plan.
- Its license is reciprocal and its model is tied to Taskwarrior.

Cedrus decision: independently implement chunk-by-chunk recalculation, dependency urgency inheritance, deadline-risk reporting, dry-run behavior, and replay. No taskcheck source is copied.

### Timefold Solver

Sources: [TimefoldAI/timefold-solver](https://github.com/TimefoldAI/timefold-solver) and [constraints and score documentation](https://docs.timefold.ai/timefold-solver/latest/constraints-and-score/overview), Apache-2.0. Repository state checked on 2026-08-17; current community release line is Java/Kotlin.

Useful ideas:

- Hard constraints represent physical or contractual impossibility; soft constraints represent preferences.
- Scores are compared lexicographically: no amount of soft preference should beat one hard violation.
- Constraint evaluation must be deterministic and free of side effects.
- Over-constrained planning should leave work unassigned or explicitly show an infeasible plan rather than fabricate feasibility.
- Score explanations are first-class and constraint weights may later be configurable.

Limits for Cedrus V6:

- The Java/Kotlin runtime and solver lifecycle are disproportionate for a small browser-local prototype.
- Search-based optimization would make the prototype harder to inspect while the domain model is still changing.

Cedrus decision: use Timefold’s hard/soft mental model and explanation discipline now. Keep a solver adapter boundary so Timefold or OR-Tools can be evaluated when scale or constraint complexity justifies it.

### LifeOS

Source: [nbramia/LifeOS](https://github.com/nbramia/LifeOS), GPL-3.0, inspected at commit `35beaf6` (2026-08-15).

Useful ideas:

- Local-first storage with optional cloud or local inference.
- Stable client contracts let web, voice, Telegram, and MCP share one orchestration core.
- Source-specific ingest is separated from normalized entities and searchable records.
- Scheduled jobs stay silent when there is no result worth showing.
- Agent work is budgeted, audited, restart-safe, and allowed to ask one focused question when genuinely stuck.
- External source identity is retained while entities are reconciled locally.

Limits for Cedrus:

- It is a broad personal-data and agent operating system, not a time optimizer.
- Its scheduler triggers jobs; it does not arrange flexible work around calendar commitments.

Cedrus decision: borrow the adapter, provenance, silent-success, and audited-agent patterns for the secondary environments. Keep the planner independent.

### ATOM

Source: [rush86999/atom](https://github.com/rush86999/atom), AGPL-3.0, inspected through its redirected repository at commit `ca2b427` (2026-08-17).

The current product is a governed enterprise agent-workforce platform, not an open-source Motion replacement. Its strongest relevant ideas are maturity gates, audit trails, mutation approvals, postcondition verification, and capability-scoped agents. Its calendar layer is an integration tool, not a personal planning solver.

Cedrus decision: take the governance lesson for future agent actions. Do not use it as scheduling architecture.

## Commercial baseline research

### Motion

Motion’s current help material describes the domain model Cedrus must at least match: earliest start, total duration, deadline, priority, work schedule, breaks, calendar busy state, recurrence, dependencies/blockers, hard deadlines, and configurable minimum chunks. See [what auto-scheduling considers](https://www.usemotion.com/help/time-management/auto-scheduling/reference-auto-scheduling/what-auto-scheduling-considers) and its [task scheduling FAQ](https://www.usemotion.com/help/project-management/task/task-scheduling-faq).

Important lesson: a task without a duration and a planning boundary is not schedulable. Cedrus should make incomplete metadata easy to repair, but it should not invent silent certainty.

### Reclaim

Reclaim’s current priority model applies across meetings, habits, tasks, scheduling links, and provider events. It combines priority, availability, deadline, and flexibility; fixed external meetings remain protected by default. See [Reclaim priorities](https://help.reclaim.ai/en/articles/8291694-how-reclaim-uses-priorities-to-intelligently-plan-your-workweek).

Important lesson: priorities should be universal across time-bearing objects, but Cedrus should keep type-specific fixedness explicit so a low-priority meeting does not accidentally become movable work.

### SkedPal

SkedPal’s [Time Maps](https://docs.skedpal.com/time-maps/introduction-to-time-maps) express preferred windows for categories such as deep work, evenings, weekends, and personal tasks. Advanced task properties include minimum block length, buffers, automatic deferral, and sequential scheduling.

Important lesson: “context” should become an executable availability window, not a decorative tag.

### Morgen

Morgen’s [Frames](https://www.morgen.so/guides/how-to-use-frames) template an ideal week and filter which tasks belong in which periods. Its AI Planner uses availability, deadlines, priority, capacity, task filters, padding, chunks, and breaks, then presents a preview for approval.

Important lesson: Cedrus needs reusable contextual windows. Unlike Morgen, Cedrus V6 will make deterministic re-planning the normal state and reserve approval for meaningful external writes or destructive tradeoffs.

### Sunsama

Sunsama’s model is intentionally more manual: guided daily planning, explicit estimates, drag-to-timebox, optional auto-scheduling, and auto-rescheduling on conflicts or early completion. See [timeboxing basics](https://help.sunsama.com/docs/getting-started/basics/timeboxing-the-basics/).

Important lesson: a deliberate re-entry ritual is valuable even when the planner is automatic. The user should be able to review what changed without managing every block.

## Calendar correctness research

Provider integration is a state-replication problem, not a fetch-and-render feature.

- [Google Calendar incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync) requires an initial full sync, persisted `nextSyncToken`, identical query parameters across later syncs, pagination, deleted entries, and recovery from invalid tokens with a new full sync.
- Google Calendar resource `etag` values support conditional writes and protect against lost updates; see [resource versions](https://developers.google.com/calendar/api/guides/version-resources).
- [Microsoft Graph calendar delta](https://learn.microsoft.com/en-us/graph/delta-query-events) uses opaque next/delta links and tracks each calendar and time window separately.
- [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) defines the provider-independent event, to-do, free/busy, recurrence, exception, time-zone, sequence, and unique-identifier concepts Cedrus adapters must preserve.
- [RFC 4791](https://datatracker.ietf.org/doc/html/rfc4791) defines CalDAV collection and query behavior for interoperable calendar access.

Cedrus should therefore store canonical local objects plus provider provenance, revision/etag, recurrence identity, exception identity, sync cursor, deletion/tombstone state, and last successful sync. Provider events are fixed by default; Cedrus work blocks remain internal until a user opts into external publication.

## Planner strategy selected for V6

The first V6 planner is a deterministic interval allocator, intentionally smaller than a general constraint solver.

### Hard constraints

- No overlap with external fixed events, Cedrus-fixed commitments, or locked work.
- Do not schedule before earliest start or after deadline.
- Respect dependency completion before dependent work starts.
- Respect allowed days, executable work windows, and current time.
- Respect remaining effort and min/max chunk policy.

### Soft preferences

- Deadline slack and explicit priority.
- Earlier completion when risk is equal.
- Preferred windows, energy, location, and context.
- Fewer fragments and continuity with the current task.
- Stability: avoid moving an existing block when a valid nearby plan still exists.

### Re-planning events

The same planner runs after a new meeting, cancellation, overrun, early completion, deadline change, new urgent task, agent completion, or device re-entry. Each run returns both the new plan and a decision log describing what moved, why, and what remains at risk.

### Escalation path

If real data produces combinatorial pressure, retain the typed domain model and add a solver adapter. Timefold is the best fit for a JVM service; OR-Tools CP-SAT is a strong alternative where integer interval variables, precedence, and no-overlap constraints are needed. The browser prototype should not depend on either yet.

## Interface principles selected for V6

- Default to silence. Show one primary state.
- Make the horizon 55–70% of the initial viewport.
- Encode fixedness, movement, risk, and provenance spatially before adding labels.
- Keep Ask as a quiet command line, not a permanent chat panel.
- Reveal Plan and Calendar as deeper precision levels, not competing home widgets.
- Make project environments, agents, replay, and developer simulations secondary doors.
- When the system changes the plan, say the consequence first: what moved, why, and whether the day is still feasible.

## Directly reusable conclusions

1. Model `earliest` and `deadline` separately.
2. Model provider-fixed, Cedrus-fixed, flexible, and locked states separately.
3. Retain total duration and remaining duration.
4. Treat preferred work contexts as executable windows.
5. Allocate in chunks and recalculate pressure after each placement.
6. Let dependent deadlines increase prerequisite urgency.
7. Return unscheduled work and risk explicitly.
8. Preserve provider provenance and cursors.
9. Produce a replayable plan change set for every recalculation.
10. Keep LLM output behind schema validation and planner verification.

