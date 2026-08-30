# Cedrus V6.1 shell restoration map

This document freezes the visual and functional authorities before the V6.1 shell changes begin.

- **Visual authority:** `cedrusv04.html`
- **Functional authority:** the V6 planner, facts, scenarios, Ask mutations, replay, adapters, and tests
- **Scope:** presentation and information hierarchy only; no scheduler redesign

## V4 visual inventory

| V4 element | What was lost in V6 | V6.1 restoration rule |
| --- | --- | --- |
| Fixed, full-viewport world | The world became a bordered widget beneath application chrome. | The environment fills the viewport and remains visible behind every secondary surface. |
| Interpolated 24-hour sky | V6 used a single flat beige scene. | Restore the V4 color-key engine: plum night, clay dawn, cream daylight, peach sunset, and gradual interpolation while scrubbing. |
| Large double celestial light | The sun became a small timeline knob with a label and permanent line. | Restore a natural, atmospheric sun/moon with bloom. It moves on the same spatial time mapping as commitments. No permanent line. |
| Stars, horizon glow, haze, vignette, grain | V6 flattened the scene into clean generic shapes. | Restore depth layers and restrained texture; all remain noninteractive and subordinate to the day. |
| Procedural far and near ridges | V6 used three broad green SVG hills. | Reuse V4's ridge mathematics and warm silhouette treatment, including a deep far ridge and a near ridge. |
| Homestead silhouette | The landscape lost its inhabited, strange character. | Restore a small, low settlement embedded in the ridge, never as a card or logo. |
| Vaporator/antenna markers | Meetings became tall rectangles with labels permanently exposed. | Fixed commitments become slender, planted structures. Their project/source light is visible; details appear only on hover/focus/click. |
| Shared sun/marker time map | The timeline was diagrammatic rather than environmental. | Sun and commitments use one 6:30am–8:00pm spatial mapping across the central 66% of the world. |
| Project identity as tiny light | V6 used labeled blue task rails and colored cards. | Keep project identity as low-intensity light: Clockout blue, Cedrus amber, Ascendo ochre, Personal clay. |
| The “smallest true thing” sentence | V6 opened with an eyebrow, large headline, explanatory paragraph, metrics, and navigation. | Home shows one quiet next-state sentence and one short current-work line. Scenario consequences may temporarily replace it. |
| Literal empty landscape | V6 always displayed timeline furniture. | Free time renders nothing. No empty-state card, grid, placeholder, or bar. |
| Hover tooltip | V6 printed structure and work labels into the landscape. | Exact title, time, fixed/flexible status, source, and reason appear only on hover/focus or selection. |
| Scrimmed deck over the world | Plan and Calendar replaced the world as peer views. | Precision surfaces rise as sheets over the still-visible Cedrus world and close back to home. |
| Navigation revealed by movement | V6 permanently exposed its full information architecture. | Bottom-edge Plan, Calendar, Projects, and Replay controls fade in with pointer/keyboard activity. |
| Hidden development panel | V6 displayed a bug control at all times. | Scenario controls have no visible normal-shell entry; backtick remains the developer shortcut. |
| Calm entrance | V6 appeared immediately as an application. | Use a brief breathing circle and tiny `cedrus` wordmark, then dissolve into the already-loaded world. |

## V6 capability → V4 language

| Retained V6 capability | V6.1 expression |
| --- | --- |
| Deterministic planner | Unchanged and invisible. The world is a projection of its output, never a competing scheduling engine. |
| External fixed commitment | A slender antenna/vaporator planted at its scheduled time, with a cool source light. |
| Cedrus fixed commitment | A lower, warmer anchored shelter/beacon at its scheduled time. It is still visibly planted, not movable. |
| Flexible work block | A soft illumination washing across the terrain for its exact duration. It has no rectangular body and no permanent label. |
| Locked work | Remains governed by planner facts; when selected, its detail explicitly says locked. |
| Free time | Empty ridge and sky. |
| Current work | The quiet line beneath the central sentence, for example `Clockout model · now`. |
| Next boundary | The central sentence, for example `48 minutes before Lunch with Maya.` |
| Deadline risk | A distant orange beacon plus the single central consequence sentence. Exact options wait inside Plan/Ask. |
| Agent activity | A tiny remote environmental light. Routine activity has no chrome. |
| Meaningful agent completion | A small `1 result` indicator at top right; opening it reveals the consequence-oriented agent sheet. |
| Ask | Collapsed `ask cedrus` text at bottom center. Click or `⌘K` expands a restrained input; responses replace the central sentence instead of creating another card. |
| Plan | A bottom sheet with exact agenda, hard constraints, risks, and rationale. |
| Calendar | A deeper precision sheet containing the conventional multi-day grid. |
| Replay | A quiet bottom sheet showing the deterministic decision log. |
| Projects | A quiet bottom sheet preserving project context and signals. |
| Scenario controls | Backtick-only developer sheet. No icon, badge, or status appears in the normal shell. |
| Time scrubbing | Pointer activity reveals faint time marks; drag across the world to change the observed hour. Double-click returns to now. The affordance fades again. |
| Day navigation | Removed from home. Plan contains compact day controls; Calendar contains the multi-day context. |
| Plan feasibility | Removed from home. It appears only as a consequence when there is a real risk, and precisely inside Plan. |

## Acceptance hierarchy

1. With labels mentally removed, the first viewport must read as the V4 Cedrus world: warm, ancient, technological, inhabited, and spacious.
2. At rest, it must communicate only location, approximate time, current work, and the next meaningful boundary.
3. Pointer, keyboard, or consequence-driven interaction may reveal the V6 machinery without replacing the world.
4. Closing any secondary surface must immediately restore the calm home state.
5. Planner outputs and existing scenario tests must remain unchanged.
