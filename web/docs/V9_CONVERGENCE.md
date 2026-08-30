# Cedrus V9 Convergence Notes

## Visual contract

V8 is the immutable visual reference for V9. The V9 stylesheet imports after the unchanged V8 stylesheet and is limited to new structural components and responsive states. Existing V8 images remain under `public/v8/` and are reused directly.

## Domain layers represented in the interface

- Programs produce scheduled occurrences.
- Workstreams contribute ready next actions.
- Open loops contribute follow-ups when their cadence matures.
- Decisions contribute review blocks when work is blocked on a choice.
- Agent runs contribute supervision or approval blocks.
- Confirmed commitments remain fixed and are never silently moved.

Every timeline item carries a source, outcome, and human-readable placement reason.

## Implemented local loops

### Markdown compiler

`compileMarkdown()` extracts a title, rule candidates, assumptions, time references, and durations. It also returns lint issues, source-to-rule traces, ownership labels, and a deterministic source fingerprint.

Publishing creates an append-only local revision record keyed by fingerprint. Publishing the same fingerprint again is idempotent in the prototype.

### Adaptive day

The Day surface can filter by domain layer, explain every item, and preview the effect of restoring training duration. The ripple preview is explicitly a ghost schedule and performs no mutation.

### Agent runs

The Runs surface distinguishes ready, approval, running, blocked, and complete states. A dry run enumerates exact proposed actions. Approval creates a scoped local receipt before the run may start.

### Living fitness session

The session preserves planned, proposed, and actual values separately. Segments can be added or substituted mid-session. The live timer is derived from a persisted start timestamp rather than increment-only state.

## Backend bridge still required

- Replace local program/revision persistence with the shared Cedrus domain model and append-only audit tables.
- Power Now and the morning brief from one stored composition with channel-specific renderers.
- Replace demo timeline records with real programs, workstreams, loops, decisions, commitments, and agent runs.
- Consume Local Observer digests into agent-run proposals.
- Add Calendar read before proposal/approval/write.
- Add health read connections with provenance and freshness before readiness may be presented as live.
- Add durable run execution and server-side approval receipts.
- Keep the Chief of Staff application read-only; do not route mutation authority through it.
