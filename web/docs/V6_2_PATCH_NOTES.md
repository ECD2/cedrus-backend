# Cedrus V6.2 patch notes

V6.2 is a focused interaction and product-shell patch. It preserves the V6.1 world and does not alter the deterministic planning brain, scenario facts, or planner tests.

## What changed

- Bottom-edge tools remain quiet at rest, become clearer near the lower edge, and show a restrained active underline.
- Plan, Calendar, Projects, and Replay use one rise-and-return motion language and retain their active tool state while open.
- Ask Cedrus has a clearer expansion cue and keeps the keyboard shortcut discoverable after first use.
- Plan distinguishes fixed commitments from Cedrus-placed work, marks the current and next items, exposes useful open time, and gives status and placement rationale clearer hierarchy.
- The central sentence and horizon landmarks have slightly stronger hierarchy without becoming cards or dashboard chrome.
- Agent completion uses a small breathing result signal and a narrower consequence-focused result sheet.
- Phone navigation and timeline landmarks use larger tap targets; Plan and Calendar use full-width sheets; the world, Ask, daylight, and night states remain usable at 390 × 844.
- The entrance completes more quickly while preserving the calm reveal.

## Protected boundary

The following behavior remains the V6.1 baseline:

- `src/planner/`
- `src/scenarios/`
- `tests/planner.test.ts`

No provider integration, persistence, remote AI service, or background execution was added.

## Verification

The patch was exercised in the browser across desktop daylight, sunset, and night; phone daylight and night; normal, empty, planning-question, agent-result, and deadline-pressure states; and Ask, keyboard shortcut, Plan, Calendar, Projects, Replay, landmarks, time scrubbing, and close/return interactions.
