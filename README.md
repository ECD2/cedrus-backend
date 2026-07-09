# Cedrus — Backend

SMS-first relationship-memory agent. Twilio → this Node/Express app on Railway →
Supabase (storage) + OpenAI (understanding) → reply via Twilio.

This backend implements the **inbound message pipeline** AND the proactive half
(weekly brief + daily sweeps) in `src/jobs/`. Still TODO: the trial-downgrade
core-five pick and the monthly core-five recompute (`src/services/coreFive.js`).

## Architecture (the three-layer split)

- **Supabase = storage.** All DB access is centralized in `src/services/`. Table
  and view names match the schema exactly (`app_users`, `people`, `messages`,
  `facts`, `saved_items`, `contact_events`, `pending_prompts`, `nudges`,
  `v_message_quota`, `v_weekly_nudge_usage`, `v_agent_person_context`, ...).
- **This code = logic.** Routes are thin; `src/pipeline/` orchestrates; services
  own storage; jobs run the schedule.
- **OpenAI = language.** One call in `src/pipeline/05_understand.js`, driven by
  `prompts/extraction.system.txt`, returns extraction JSON + a drafted reply.

## Folder map

    src/
      index.js              boot express, mount routes, start cron
      config.js             env loading + validation (fails fast)
      lib/                  supabase / openai / twilio clients
      routes/               sms.js (the Twilio webhook), health.js
      pipeline/             the inbound stages, in order:
        index.js              orchestrator (Stages B–E)
        03_compliance.js      STOP/START/HELP
        04_rateLimit.js       abuse cap via v_message_quota
        05_understand.js      the OpenAI extraction + reply call
        06_resolveEntities.js fuzzy-match backstop + create/merge people
        07_persist.js         writes + the pending-prompt cascade
      services/             ALL Supabase access (users, messages, people,
                            memory, relationships, usage, consent, briefs, coreFive)
      jobs/                 scheduler + brief/sweeps/trial/core-five (scaffolded)
      utils/                logger, time (area-code→tz default)
    prompts/
      extraction.system.txt the agent's brain (loaded at boot)

## What works now vs. what's scaffolded

- **Working (no AI):** webhook verify → find/create user (auto self-person via
  DB trigger) → STOP/START/HELP → abuse cap → idempotent inbound logging →
  onboarding reply. You can text the number and watch a row land in `messages`.
- **Wired, needs your eyes:** the OpenAI call and the persist/resolve logic run,
  but you'll tune the prompt and the fuzzy-match threshold from real logs.
- **Built — the weekly brief (the heartbeat):** `src/jobs/weeklyBrief.js` +
  `src/jobs/brief/` (eligibility, gather, select, compose) + `prompts/brief.system.txt`.
  Code curates and gates (free = core-five magic + a locked teaser of who's slipping
  outside the circle; Pro/trial = everyone + action offers); the LLM composes the warm
  SMS. Opens ONE pending prompt for the closing question.
- **Built — daily sweeps (the mid-week pulse):** `src/jobs/dailySweeps.js` +
  `src/jobs/sweeps/` (eligibility, candidates, select, compose) + `prompts/nudge.system.txt`.
  Sends at most ONE well-timed nudge per eligible user, gated by the weekly nudge budget
  (`v_weekly_nudge_usage`), a once-per-day rail, a daytime window, and a per-person cooldown.
  Free → goal follow-ups + day-of birthdays (core-five only); Pro → also real-time drift,
  across everyone. Goal follow-ups open a pending prompt so a "yes" fires the showing-up
  cascade and completes the goal. Honors BRIEF_DRY_RUN for safe testing.
- **Scaffolded (TODO):** trial-downgrade core-five pick, and the closeness-weighted
  core-five recompute algorithm (`src/services/coreFive.js`).

## Local setup

    cp .env.example .env      # fill in Supabase service-role, OpenAI, Twilio
    npm install
    npm run dev

For local webhook testing without Twilio signatures, set
`VALIDATE_TWILIO_SIGNATURE=false` and POST form data to `/sms/inbound`.

## Deploy to Railway

1. Push this folder to a Git repo and create a Railway project from it.
2. Add the env vars from `.env.example` in the Railway dashboard.
3. Railway builds via Nixpacks and runs `node src/index.js` (see `railway.json`).
   Healthcheck is `GET /health`.
4. Copy your public Railway URL into `PUBLIC_BASE_URL` (needed to validate Twilio
   signatures).

## Connect Twilio

Set your number's **A MESSAGE COMES IN** webhook to:

    POST  https://<your-app>.up.railway.app/sms/inbound

(You'll also complete A2P 10DLC registration before US carriers deliver at volume.)

## Testing the weekly brief before Twilio is live

- Set `BRIEF_DRY_RUN=true` — the job composes + records the brief but LOGS the text
  instead of sending it. (You'll still need placeholder Twilio env vars so the app boots,
  and a real OpenAI key for composition.)
- Or call `previewBrief(user)` from `src/jobs/weeklyBrief.js` for a side-effect-free
  gather → select → compose that just returns the text — ideal for tuning voice.
- The curation logic in `src/jobs/brief/select.js` is pure and unit-testable with mock
  context (no network), so you can verify the free/Pro gate and drift thresholds directly.

## Build order (recommended)

1. Get Stages A→B green: text the number, confirm a `messages` row appears.
2. Drop in / iterate the extraction prompt; confirm facts + people land correctly.
3. Build the weekly brief job (the first proactive beat).
4. Build daily sweeps (drift/birthdays/events) behind the nudge budget.
5. Implement `coreFive.recomputeCoreFive` and wire it into trial-downgrade + monthly.

## Notes

- `ENABLE_JOBS=false` on any second instance so crons don't double-run.
- Replace the `incrementShowingUp` read-modify-write and the JS fuzzy-match with
  Postgres RPCs when you want atomicity / typo tolerance (both are marked TODO).
- The reply is sent via TwiML (synchronous). If processing ever exceeds Twilio's
  ~15s window, switch to ack-then-`sendSms()`; the pipeline already supports it.
