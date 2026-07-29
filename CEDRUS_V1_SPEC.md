# CEDRUS — V1 PRODUCT SPEC (THE CANON)

**Read this file at the start of every session, immediately after `CEDRUS_OPERATING_DOCTRINE.md`.**

The doctrine says *how* we build. This file says *what* we are building. Where a pre-pivot
document, comment, route, or piece of copy disagrees with this file, **this file wins and the older
artifact is stale** — but see PART 6: stale does not mean deleted.

Pivot date: **2026-07-28.**
Last updated: 2026-07-28.

---

## PART 1 — THE PRODUCT

**Cedrus is the daytime social layer for people who work from home.**

Launch city: **Miami.**

Tagline: **"Working from home does not have to mean spending the day alone."**

**Web is the primary surface.** The web platform carries the concierge chat, Your Day, and the
garden. **SMS is secondary** — it carries cards, nudges, and replies, and nothing that only exists
over SMS.

The problem is not that people have no friends. It is that the friends exist, the free hours exist,
and nothing ever puts the two in the same room on a Tuesday afternoon. Cedrus is the thing that
notices.

---

## PART 2 — THE LOOP

Everything Cedrus does is one of these five steps. If a feature is not a step in this loop, it is
not in V1.

1. **Notice an opportunity** — a window in the user's day, a person who fits it, a reason.
2. **Suggest the right person and context** — one person, one specific occasion, not a list.
3. **Help send the invitation** — Cedrus drafts; the *user* sends.
4. **Confirm whether time together happened** — the user tells us. Only the user.
5. **Reflect it in the garden** — confirmed time advances a tree.

Step 4 is the hinge. Without a user confirmation, step 5 never fires, and a card that was never
acted on simply fades. We do not infer that a meeting happened.

---

## PART 3 — THE RULES

These are product laws. They are as binding as the doctrine's Laws — an instruction that conflicts
with one gets pushed back on, not followed.

### Cadence

- **2–3 opportunity cards per week, maximum. Never daily.**
- Scarcity is the feature. A card the user ignores costs more than a card we never sent.
- No streaks. No counters. No "you haven't opened Cedrus in 4 days."

### What a card may be built from — SINGLE-SIDED DATA ONLY

A card may draw on:

- the user's own stated availability windows,
- the user's own circle (their people, their logged facts),
- public Miami events.

A card may **not** draw on anything belonging to another person, whether or not that person is also
a Cedrus user. No cross-user matching, no "your friend is also free," no reading anyone's calendar
but the user's own. **Single-sided means the card would be identical if no other Cedrus account
existed.**

### The invitation

- **Every card ends with a forwardable invite written in the user's voice.**
- The user copies it, edits it, sends it — from their own phone, their own thread, their own name.
- **Cedrus NEVER messages an invitee.** Not a text, not an email, not a calendar invite, not a
  notification, not "on behalf of." There is no code path where Cedrus originates contact with a
  person who did not sign up for Cedrus. This is absolute and it is the thing that makes the product
  trustworthy enough to use on real friendships.

### Card replies

The complete reply vocabulary, over web and SMS alike:

| Reply | Meaning | Effect |
|---|---|---|
| **YES** | I want this | Show the invite, offer to help send it |
| **SKIP** | Not this one | Card closes, no penalty, no follow-up |
| **LATER** | Right idea, wrong time | Card may resurface once, later |
| **NOT THEM** | Right idea, wrong person | Suppress this person for this kind of card |
| **NEVER** | Stop suggesting this | Hard, durable suppression |

`NEVER` is permanent until the user reverses it themselves. Nothing decays it, nothing overrides it.

### The garden

- **Only user-confirmed in-person time advances a tree.** Not a text exchange, not a like, not a
  call, not a card the user said YES to. In person, and confirmed by the user.
- **Stages:** Sprout → Sapling → Young Cedar → Cedar.
- **Existing friends import at the stage the user says.** A twenty-year friendship does not start as
  a sprout. The user tells us where it stands and we believe them.
- **Seasons:** active / resting / dormant / renewed.
- **Never death.** A tree does not die, wither, or disappear. It rests, and it can be renewed.
- **No streaks. No guilt copy.** Nothing in the garden may imply the user has failed, neglected
  someone, or fallen behind. "Resting" is a neutral, true word. Anything that reads as an
  accusation is a bug, not a nudge.

---

## PART 4 — PRICING

**There is no pricing in V1.**

- Everyone is a free **"Founding Member."**
- The `plan` column in the database **stays exactly as it is** — do not rewrite it, do not migrate
  it, do not repurpose it. The existing entitlement machinery (`services/entitlements.js`,
  `planTier()`, `v_people_for_agent.proactive_enabled`) is left alone.
- Member status is expressed by a **new additive column: `app_users.member_status`, set to
  `'founding'`.** (Note: the pivot brief said "users"; the real table is `app_users`.) Additive,
  nullable or defaulted, no backfill of anything else, no change to existing reads.
- **No Stripe work.** Not tonight, not in this phase. Do not add, wire, test, or remove Stripe.

The two live trials still lapse on Aug 6 / Aug 8 and the downgrade job still runs. That is existing
behaviour and it is out of scope — but note that a lapsed trial empties the free-plan Today feed
(doctrine flag 22), so V1 must not depend on trial-tier entitlements for anything a Founding Member
is promised.

---

## PART 5 — NON-GOALS

Explicitly out of scope. If a session finds itself building one of these, it has gone off-spec and
should stop and report.

- **Stranger matching.** Cedrus never introduces the user to someone they don't know.
- **Venue booking.** We suggest a place; we do not reserve it, pay for it, or hold it.
- **Autonomous texting to non-users.** See PART 3 — this is the hardest line in the product.
- **Shared calendars.** We read the user's availability as the user states it. We do not sync,
  merge, or expose calendars between people.
- **Group-chat bots.** Cedrus is not a participant in anyone's group thread.
- **Pricing / Stripe.**
- **Deleting anything.** See PART 6.

---

## PART 6 — THE PRESERVATION LAW

**Nothing that exists is deleted.**

1. **The old app remains fully functional at `/classic`.** Every route, every screen, every feature
   that works today keeps working there — sign-in, Today, People, person panels, saved items,
   admin. "Fully functional" means a user could live in `/classic` indefinitely and not notice the
   pivot.
2. **The new experience takes the root routes.** `/` and the primary paths become the new daytime
   social layer.
3. **Old backend endpoints are untouched.** No renames, no signature changes, no removals, no
   "while I'm in here" cleanups.
4. **New features are additive only** — new tables, new columns, new endpoints. Never a
   destructive migration, never a repurposed column, never a dropped view.
5. This applies to code, routes, database objects, copy, and tests alike. A test that guards old
   behaviour keeps guarding old behaviour.

Practical note for the frontend: it is TanStack Start file-based routing (`src/routes/`), so
`/classic` is a route-prefix move, and `routeTree.gen.ts` is generated — regenerate, don't
hand-edit. Moving a route file changes its URL, so the move itself is the risky part of the
preservation law, not the new build. Prove `/classic/*` renders before the root routes change.

---

## PART 7 — HOW THIS INTERACTS WITH THE DOCTRINE

Nothing here relaxes anything there. Specifically:

- **Law 5 / Law 6 still bind.** Both repos deploy on push. Sessions **STOP before push**. Only Emil
  pushes. The pivot does not create an exception and no overnight session may invent one.
- **`BRIEF_DRY_RUN` stays `true`** until a named arming session. No card, nudge, or brief goes on
  the wire before then. Building the card engine is in scope; sending is not.
- **Law 8 still binds.** Every new table and column for the garden, cards, and windows goes through
  `run-migration.mjs`, unqualified table names, additive and idempotent.
- **PART 3 of the doctrine (what counts as proof) still binds.** A card engine that produces cards
  in a test proves nothing about the suppression rules; run the control.

---

## PART 8 — OPEN QUESTIONS (not blockers, decide before they bite)

| # | Question |
|---|---|
| V1 | What exactly counts as an "availability window," and does the user state it once or per week? |
| V2 | Where do public Miami events come from, and who is responsible for them being real? |
| V3 | Does `LATER` resurface once and then expire, or keep resurfacing? Pick one and write it down. |
| V4 | `NOT THEM` — suppress that person for *this card type*, or for that *occasion type* generally? |
| V5 | What is the import UX for "existing friends import at the stage the user says"? |
| V6 | Do the existing `dunbar_tier` rings survive the pivot, get replaced by garden stages, or coexist? They currently have zero backend readers (doctrine, Part 4). |
