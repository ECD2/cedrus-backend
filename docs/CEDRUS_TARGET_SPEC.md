# Cedrus — target spec

**v0.1 draft · 2026-08-16 · for review, not yet canon**

This describes what Cedrus becomes after the private pivot. It is a proposal built
from Emil's stated vision, not an approved design. Argue with it before building it.

---

## 1. What this is

A private, single-user assistant with **two front doors and one brain**.

- **SMS** — text it from anywhere. No app, no VPN, no pairing. Works on cellular.
- **Dashboard** — a screen when you're at a screen.
- **Weekly email** — a digest that arrives without being asked for.

One user: Emil. One phone number. No tiers, no plans, no other accounts.

### What it is not

It is not a relationship manager. The current build is a personal CRM — `people`,
`facts`, drift scores, Dunbar tiers, opportunity cards, stay-in-touch nudges. That
was the consumer product, and it is being retired. Nothing in the vision below is
relationship-shaped.

---

## 2. What survives from today's build

This is the part worth being clear about: **the runtime is right, the domain is wrong.**

### Keep — already built and working

| Thing | State |
|---|---|
| Twilio number + A2P registration | Live. The single most valuable asset. |
| Inbound SMS pipeline + signature validation | Live, verified in prod |
| Inbound allowlist (`ALLOWED_PHONES`) | Live, armed, verified |
| Outbound allowlist | Built, unpushed |
| Scheduler (10 cron jobs) | Live |
| Budget guard (tokens + SMS segments) | Live, armed |
| Railway deploy path, push-is-deploy | Proven, ~30s |
| Supabase project + RLS | Live |
| Structured logging + audit discipline | Live |
| `app_users`, `messages`, `reminders`, `goals`, `saved_items` | Keep |

### Retire

`people` (as a drift-tracked graph), `facts`, `dunbar_tier`,
`relationship_health_score`, `contact_frequency_days`, `is_core_five`,
`opportunity_cards`, the tier/plan/entitlement system, trials and the downgrade job,
`/classic/upgrade`, `/classic/affiliate`, the pricing landing page.

Retire means **unlink and stop reading**, not delete. History stays; the twelve
`archive/*-2026-08-15` tags hold the pre-pivot state.

### Open question

`people` may survive in a much smaller form — as **contacts for context** (who sent
this email, who is in this meeting), with no health score, no cadence, no drift.
Decide before building.

---

## 3. Data model

Four new tables carry the whole system.

### `sources`

One row per connected system.

```
id              uuid pk
kind            text        -- 'gmail' | 'gcal' | 'github' | 'rss' | 'sports' | 'mac'
label           text        -- 'Personal Gmail'
auth_state      text        -- 'connected' | 'expired' | 'revoked' | 'never'
auth_ref        text        -- pointer to secret storage, never the secret
last_sync_at    timestamptz
last_error      text
active          boolean
created_at      timestamptz
```

### `signals` — the spine

Every normalised event from every source. An email, a commit, a game result, a
calendar change: same shape.

```
id              uuid pk
source_id       uuid fk -> sources
watch_id        uuid fk -> watches   -- nullable; which watch caught it
external_id     text        -- provider's id, for dedupe
occurred_at     timestamptz -- when it happened, not when we saw it
ingested_at     timestamptz
kind            text        -- 'email' | 'commit' | 'event' | 'score' | 'article'
title           text
body            text        -- normalised summary, not raw payload
url             text
metadata        jsonb       -- source-specific extras
seen_at         timestamptz -- null = unseen; drives the Today feed
importance      int         -- 0-100, computed; nullable
```

**Unique on `(source_id, external_id)`.** Dedupe is the whole game — every source
will re-deliver the same item, and a duplicate in the Today feed is the fastest way
to make this feel broken.

### `watches`

What you're tracking. A watch is a saved question against a source.

```
id              uuid pk
name            text        -- 'Emails from Laura'
source_id       uuid fk -> sources
filter          jsonb       -- source-specific query
cadence         text        -- 'realtime' | 'hourly' | 'daily' | 'weekly'
channels        text[]      -- which surfaces it reports to
active          boolean
last_run_at     timestamptz
created_at      timestamptz
```

Examples: "Emails from Laura", "Heat game results", "CI status on cedrus-backend",
"Anything mentioning Ascendo", "Calendar changes in the next 48h".

### `runs`

Agent work. Anything Cedrus does rather than reports.

```
id              uuid pk
trigger         text        -- 'sms' | 'schedule' | 'dashboard' | 'manual'
instruction     text        -- what was asked, verbatim
status          text        -- 'queued'|'running'|'awaiting_approval'|'done'|'failed'|'refused'
executor        text        -- 'core' | 'mac'
output          text
error           text
needs_approval  boolean
approved_at     timestamptz
started_at      timestamptz
finished_at     timestamptz
token_cost      int
```

**`needs_approval` is the safety boundary.** Anything that writes to the outside
world — sends an email, creates a calendar event, pushes a commit — stops here and
waits. Reads never do.

---

## 4. The key structural idea

**The dashboard, the SMS reply, and the weekly email are three queries over
`signals`.** Not three subsystems.

| Surface | Query |
|---|---|
| Today feed | `signals where seen_at is null order by importance, occurred_at` |
| Weekly email | `signals where occurred_at > now() - 7d group by watch_id` |
| SMS answer | one question, answered against recent signals |

This is why the design work gets tractable: you are laying out **one kind of object**
in three densities. Get the signal card right and most of the UI follows.

---

## 5. Surfaces

### 5a. SMS

The always-available door. Latency budget is real: Twilio's synchronous window is
~15s and current round trips run 5–6s. Anything slower needs ack-then-background.

Rough grammar (natural language, not commands — these are intents):

| Intent | Example |
|---|---|
| Ask | "what came in today?" |
| Ask scoped | "anything from Laura?" |
| Act | "draft a reply to the Ascendo thread" |
| Remind | "remind me Thursday about the IC memo" |
| Watch | "watch the Heat schedule" |
| Approve | "yes" / "send it" |

Replies must be short. SMS segments cost money and count against the budget guard.

### 5b. Dashboard

Five screens. Each is listed with the data behind it and the states it must handle.

**Today** — the default screen.
- Unseen signals, newest first, grouped by watch.
- Each card: source icon, watch name, title, one-line body, relative time, link out.
- Actions: mark seen, open source, ask about it, snooze.
- States: empty ("nothing new"), loading, source-error banner.

**Watches** — what you track.
- List of watches with last activity and signal count in the last 7 days.
- Actions: pause, edit filter, change cadence, delete, add new.
- States: empty (first-run — this is the onboarding surface), paused watches dimmed.

**Ask** — a query box.
- Free text in, answer out, with the signals it drew on cited below.
- History of previous asks.

**Runs** — agent activity.
- Anything `awaiting_approval` pinned at the top. This is the one screen with urgency.
- Everything else as a reverse-chronological log with status, duration, token cost.

**Settings** — sources and plumbing.
- Per source: connection state, last sync, reconnect, disconnect.
- Weekly email: day, time, on/off.
- Quiet hours, SMS on/off.

### 5c. Weekly email

- Fixed day and time. One email.
- Grouped by watch, not by source.
- Each group: 3–5 items max, with a link to the dashboard for the rest.
- Plain, readable, no marketing shape. This is a briefing, not a newsletter.

**Gating note:** the email path already selects on `brief_email_status='subscribed'`
— an opt-in filter. Keep that. Opt-in fails closed; the SMS path's `opted_out` filter
fails open, which is exactly how a stranger ended up in the brief loader.

---

## 6. Architecture

```
Sources ──► Cedrus core (Railway, always on) ──► Surfaces
                    │
                    └──► Mac node (tailnet, local execution)
```

**Cedrus core — Railway.** Always on. Owns the Twilio webhook, the scheduler, signal
ingestion for anything cloud-reachable (Gmail, Calendar, feeds, sports), the digest
compiler, and the database.

**Mac node — EmilGPT.** Owns anything that needs local filesystem or repo access.
Reachable over tailnet only. Not always on, so **anything routed here is
asynchronous by design** — the core queues a run, the Mac picks it up when awake.

### The decision this rests on

Whether the Mac node ever becomes the brain depends on always-on hardware. A laptop
that sleeps cannot answer an SMS in 15 seconds. **That is what a Mac Studio would
actually buy** — not speed, but permission to invert this. Until then, core is the
brain and the Mac is an arm.

### Devices

iPhone, iPad, MacBook Air, MacBook Pro. Note that they reach the two halves
differently: SMS works everywhere with no setup; the dashboard is a web surface
behind auth; the Mac node requires tailnet and per-device pairing.

---

## 7. Build order

Sequenced so each step produces something usable rather than more scaffolding.

1. **Close the lock.** Outbound allowlist merged and pushed. `/api` allowlist in
   `createRequireUser`. RLS tightened to one uid. *(Blocked on the missing Law 8
   migration runner — resolve that first.)*
2. **One source, end to end.** Gmail read-only → `signals` rows you can query.
   Proves the spine before anything is built on it.
3. **Watches on that one source.** "Emails from X." Nothing else.
4. **Weekly email.** Compile from signals, opt-in gated, sending to one address.
   First feature that arrives without you asking.
5. **Today screen.** Signal cards over the same data.
6. **Second and third sources.** Calendar, then feeds/sports.
7. **Runs and approvals.** Agent execution, starting read-only.
8. **Mac node integration.** Repo and file access as a queued executor.

Steps 2–4 are the shortest path from here to something that changes a day.

---

## 8. Known debt this spec does not fix

- **The dry-run recording bug.** `markSent`, `logOutbound` and `recordBriefSent`
  execute even when nothing goes on the wire, so outbound records include messages
  that never existed. The `messages` table is not currently trustworthy as a record
  of what was sent.
- **CEDRUS.md drift.** At least seven known-stale claims as of 2026-08-16, including
  a mandated migration runner that does not exist on the machine.
- **cedrus.life is dark.** Twilio-registered compliance routes return 404. Must be
  restored regardless of everything else here — it is the number's compliance
  surface.
- **cedrus.miami.** Signup disabled, but the page still counts down to a dead event
  and its database is gone.
- **Latency headroom.** 5–6s of a ~15s Twilio window.

---

## 9. Open decisions

1. Does `people` survive as lightweight contacts, or go entirely?
2. Mac Studio — buy or not? Determines whether the architecture above ever inverts.
3. First Gmail mailbox: Workspace (publishable as Internal, no 7-day token expiry)
   or personal (verification or weekly re-auth)?
4. Does the dashboard get rebuilt inside the existing frontend repo, or start clean?
5. Is `importance` computed, manual, or dropped for v1?
