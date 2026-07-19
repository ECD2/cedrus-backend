# N2 COMPLETION — Weekly-note email backend (WS-F)

**Session:** night N2, 2026-07-19 · **Branch:** `feat/brief-email` (worktree
`nb-brief/`, from origin/main 43622e4) · **Committed locally, not pushed.**

## What exists now

The canonical-note email layer, new files only (list + wiring in
[MOUNT_N2.md](MOUNT_N2.md)):

1. **Composer** (`src/services/brief/composer.js`) — one canonical record per
   `(user, week_of)` in the existing `briefs`/`brief_items` tables, anchored on
   their live UNIQUE constraint. Re-runs reuse, never regenerate; a record the
   SMS job wrote first is reused verbatim (and vice versa). The SMS preview
   (1–3 items, distinct people, date-critical guaranteed, 134-char UCS-2
   budget, scheme-less `cedrus.life/n/…` link) and the full email render from
   the SAME loaded record — the invariant has a test, not a convention.
2. **Renderer** (`renderer.js` + `template.js`) — deterministic HTML +
   plaintext ("your weekly note"; the word "brief" never renders). Brand:
   olive `#737F45`, brown `#3D2D1F`, cream `#F2EFE6`, terracotta `#C98F70`,
   Garamond serif anchors / Avenir body with web-safe fallbacks. Sections
   THIS WEEK / YOUR PEOPLE / TRACKED EVENTS / ONE SMALL THING, caps 6/4/3/1,
   ≤12 rows (Free ≤8) + overflow line. Stable subject "Your week 🌲",
   neutral no-name preheader, one 🌲 max, no em dashes (stored bodies are
   normalized), exact footer set (standing privacy line, delivery controls,
   "Unsubscribe (email only, texts keep working)"), no images/pixels,
   <100KB, quiet-week and muted registers.
3. **Valence & safety law** — every item is banded via the real
   `voiceGuard.resolveBand`; **negative and crisis content never renders in
   any channel**; sensitive-neutral renders through `applyVoiceGuard` (cheer
   words and `!` structurally stripped) and suppresses the Pro teaser for the
   whole note. Free tier gets exactly the aggregate teaser line, never names.
   The 48h crisis window renders the muted register (no 🌲, no playful layer,
   factual items + full footer kept). **Gap, per instructions:** the
   `crisis_suppressed_until` column doesn't exist yet (WS-C), so
   `isInSuppressionWindow` currently always returns false; until it lands,
   the outright negative-marker exclusion above is the operative guard, and
   items only a *stored flag* (not text markers) would catch can't be caught —
   flagged in MOUNT_N2 §6.3.
4. **Action tokens** (`tokens.js`) — D18 rows in `brief_action_tokens`:
   CSPRNG 32-byte raw (only ever inside the URL), sha256-hex at rest,
   7-day expiry, atomic single-use claim, supersession on the next cycle,
   `view_full_brief` render-only, every failure the same neutral shape,
   constant-time hash comparison. Action types validated against the live
   CHECK — issuing an unknown type (e.g. `unsubscribe`) throws, with a test.
5. **Unsubscribe** — scoped per BRIEF-03/D16: stateless HMAC-SHA256 token
   (session8 U-2 design; the live schema has no unsubscribe storage — see
   MOUNT_N2 §6.1 for the deliberate deviation from the N2 brief wording and
   the WS-C decision it queues). Redemption writes `brief_email_status`
   → `'unsubscribed'` + `consent_events('brief_unsubscribed', source
   'email')` and touches nothing else — SMS `opted_out` proven untouched.
6. **Transport** (`transport.js`) — mock default writes full RFC 822 .eml
   (multipart/alternative, RFC 2047 subject, `From: Cedrus
   <brief@cedrus.life>`, `Reply-To: help@cedrus.life`, List-Unsubscribe
   mailto+https, RFC 8058 `List-Unsubscribe-Post: One-Click`). The Sendgrid
   stub refuses to construct without `BRIEF_EMAIL_LIVE=true` AND a key, and
   re-checks before any network. **No real sending, no signup, no keys
   tonight** — tests prove zero network calls.
7. **Job** (`src/jobs/briefEmail.js`) — hourly, per-user local send window,
   master-switch OFF by default, fail-closed without the link secret. Hard
   consent gate re-reads `app_users` at send time: only
   `subscribed` + address + `verified_at` passes; the send path contains no
   subscription writes (a persistent tracker across every test scenario
   proves zero `app_users` writes). Delivery ledger on the live UNIQUE
   `(brief_id, channel)`: send-before-mark ordering, retries reuse the row,
   3-attempt cap, sanitized failure reasons, structural-fields-only logging.

## Test results

`sh test/run-all.sh` — the full existing battery: **all suites pass**
(fact pipeline, logger, reminders, people guard, dedup, weekly-brief
ordering, twilio signature, WS-B safety/voice/search).

`sh test/run-n2-brief-email.sh` — the new WS-F battery, three suites,
**~120 checks, all pass**, covering every N2-required test: idempotency,
single-canonical-record invariant, token single-use + expiry (+ supersession,
render-only view, neutral no-oracle failures), consent gate (incl. the
poked-row defense and never-auto-subscribe), negative-content exclusion in
every channel, renderer snapshot for a fixture user (golden files), and mock
transport output existence (+ byte-determinism, headers, body round-trip).

## Open the samples (docs/n2-samples/)

Three deterministic renders of realistic weeks — each as `.eml` (opens in
Mail), `.html` (browser), `.txt` (plaintext part), `.sms-preview.txt` (the
paired SMS from the same record):

- **01-trial-full-note** — birthday, life event, drift, tracked event, last
  week's intention, snooze links. Its fixture also contains a loss-language
  item ("his father passed away") — visibly absent from all four renders
  (`excluded=1`): the valence gate, demonstrated.
- **02-free-note-with-teaser** — Free register: tight note + the exact
  aggregate Pro line; the stored per-person teaser names never leak.
- **03-quiet-week** — honest calm, one small thing, nothing manufactured.

## Not done (deliberately)

No route handlers (T24), no confirm/double-opt-in flow (T22), no SendGrid
account/DNS, no scheduler/config/run-all edits (described in MOUNT_N2), no
schema changes, no push, no deploy, no hosted-database access.
