# Cedrus reboot plan — 2026-08-04

**Status: working document, not canon.** `CEDRUS.md` is the single source of truth. Where this file disagrees with it, `CEDRUS.md` wins. This document exists to hold the detail that does not belong in canon: the UX, the data model, the audit evidence, the slices.

**Written from:** the three clean MacBook Pro repositories at `/Users/scu/Developer/Cedrus` (`cedrus-backend@6723c0a`, `cedrus-frontend@63e1fde`, `cedrus-miami@6e07832`). The archived MacBook Air workspace was not read.

**Session scope:** documentation and architecture only. No source code was modified, nothing was pushed, deployed, published, or migrated.

---

## 1. Product in one sentence

Cedrus keeps your day on pace with what you said matters: you tell it what you are trying to do, it sees what your day actually has room for, and it suggests the one next thing that fits.

---

## 2. Acquisition wedge and expansion

**Wedge:** Have a better ~~remote~~ day. Miami, remote and hybrid workers, 25 to 40, flexible weekday hours.

**Expansion, encoded in the strikethrough:** a better remote day, then a better flexible week, then a better day. Remote work is the first recurring context, not the permanent boundary.

**Why the wedge still works after the reboot.** The wedge was never "come to an event." It was "you have control over your day and you are not getting much out of it." That is more true of a goal-aware assistant than it was of a workday host. Nothing about the wedge needed to change; only the thing it pointed at did.

---

## 3. Clear differentiation from a generic connected assistant

A generic assistant with a calendar connection answers the question you typed. Cedrus is different on four specific axes, and each one is a build constraint, not a slogan.

| Axis | Generic assistant | Cedrus |
|---|---|---|
| **Memory of intent** | Remembers the conversation | Remembers what you said matters this month, in your words, and keeps checking the day against it |
| **Direction of initiative** | Waits to be asked | Notices a window and proposes one thing, then records whether it helped |
| **Unit of output** | An answer | A pace card: goal + what happened + available time + one realistic action, with certainty labelled |
| **Definition of success** | You got a good answer | Your real day moved toward what you said you wanted |

**The sentence that keeps this honest:** if Cedrus can be replaced by typing the same question into a general assistant, then for that request it should have been. The differentiation is not in answering better; it is in knowing what you were trying to do before you asked, and in caring whether it worked afterward.

**The trap to avoid.** Building "an assistant that also has your goals" produces a general assistant with a settings page. The product is the reconciliation loop: goals against real time, suggestion, outcome, adjustment. Everything else is an input to it.

---

## 4. First user profile

Miami-Dade. 28 to 38. Fully remote or hybrid three-plus days at home. Works from an apartment in Brickell, Wynwood, Little Havana, Edgewater, Coconut Grove, or the Beach. Controls at least two weekday windows that are not meetings. Has two or three things they genuinely want more of and consistently does not get to: shipping their own thing, seeing people who are not colleagues, moving their body. Has tried and abandoned at least one habit app. Is not looking for friends in the abstract, but would take a specific good suggestion for a specific Thursday.

**What makes them the right first user:** their constraint is *allocation*, not information. They already know what they want and roughly what is out there. What they lack is anything reconciling the two against a real calendar week.

**Explicitly not the first user:** the person who wants a social network, the person who wants a coach, the person with a rigid five-day office schedule, and anyone outside Miami.

---

## 5. The first successful week

Written as an observable sequence, so it can be checked rather than felt.

- **Day 0.** Finds cedrus.miami, understands within one screen what it does, joins with name/email/phone and two separate consents. Receives one honest email with no date and no seat.
- **Day 0 or 1.** Completes onboarding in under three minutes on a phone. Sets one to three goals in their own words. Sees a Today that is already useful with nothing connected.
- **Day 1 to 2.** Receives their first pace card. It references something they actually said. They either act on it, edit it, or reject it. All three are success; silence is not.
- **Day 2 to 4.** Texts Cedrus unprompted at least once, about something Cedrus was not explicitly built for. That message is the most valuable artifact of the week.
- **Day 3 to 5.** Reports back on one thing, prompted or not: "did that," "didn't," "did something else." Progression has its first real row.
- **Day 5 to 7.** Returns to Today without being prompted, or texts again. Optionally connects Calendar, because timing has started to matter to them.
- **End of week.** Can answer "did Cedrus improve a real decision or a real day this week?" with a specific example, yes or no.

**The failure mode this is written against:** a week where the member signs up, sees a nice page, receives nothing that references them, and quietly stops. That week produces a signup number and zero product information.

---

## 6. Founding user loop

```
     ┌──────────────────────────────────────────────────────────┐
     │                                                          │
     ▼                                                          │
  STATE          what matters (goals, in the member's words)     │
     │                                                          │
     ▼                                                          │
  RECEIVE        only authorized, relevant context               │
                 (onboarding facts, messages, Calendar free/busy)│
     │                                                          │
     ▼                                                          │
  NOTICE         what has happened, what has not,                │
                 what window is open                             │
     │                                                          │
     ▼                                                          │
  RECONCILE      goals × available time × prior actions          │
                 × Miami context × people/places/plans           │
     │                                                          │
     ▼                                                          │
  PROPOSE        one pace card: suggest, prepare, or help do     │
     │                                                          │
     ▼                                                          │
  RECORD         acted / edited / rejected / deferred / silent   │
                 and: did it help?                               │
     │                                                          │
     ▼                                                          │
  SHOW           progression over time ─────────────────────────┘
```

**The loop's weakest link is RECORD.** Every other step can be built without the member's cooperation. RECORD cannot. If members do not report outcomes, Progression is fiction and the reconciliation never improves. This is why outcome capture must be one tap in Today and one word by SMS, and why "I didn't" must be exactly as easy as "I did."

---

## 7. Places, People, Plans, Progression

As canonised in `CEDRUS.md` Part I section 4, with the working detail here.

**Places.** Where the day could happen. Inputs: neighborhood, stated work preferences, weather, day of week, the shape of the day (calls vs deep work), and what worked last time. A place surfaces only attached to a window. Founding release: a small hand-curated Miami set, operator-maintained, not a scraped directory. Quality over coverage; ten places Emil would personally send someone to beats four hundred rows.

**People.** Existing relationships the member tells Cedrus about, opted-in members, and specific approved introductions. **Founding release: no introductions.** People in the founding release means "you said you wanted to see Ana more than once a quarter and it has been four months," which needs no other member to exist. Governed by trust law.

**Plans.** The next realistic action. Sized to the window. May be a suggestion, a prepared thing (a drafted message, a place with hours checked), or help scheduling. Never three things.

**Progression.** Whether real days are moving toward what the member selected. Founding release shape: per goal, a plain record of suggestions made, actions taken, and outcomes confirmed, over weeks. No score, no streak, no garden. The honest version is a short list and a sentence, and it is allowed to say "not much moved this week."

---

## 8. Small mobile-first information architecture

Four surfaces. That is the whole product.

```
  PUBLIC                         MEMBER
  ──────                         ──────
  /                              /today          ← home, the default
  /terms                         /card/$id       ← one pace card
  /privacy                       /progress       ← is this working
                                 /settings       ← incl. connections
```

Plus three flows that are entered once and then rarely: `/welcome`, `/onboarding`, `/goals`.

**Design rules.**
- **Thumb-first.** Primary action in the bottom third. Nothing important above the fold that needs a reach.
- **One screen, one job.** If a screen has two jobs it becomes a dashboard, and section 29 of `CEDRUS.md` Part I bans a large dashboard.
- **No tab bar in the founding release.** Four surfaces do not need persistent navigation, and a tab bar is a promise of breadth the product does not have. Today links to the other three.
- **Every list has a designed empty state.** Empty is the normal state in week one and must not read as broken. The `CdSection` pattern in `cedrus-frontend` takes `empty` as a first-class prop; carry that convention over.
- **Unfinished is labelled, never mocked.** A route that exists as a shell says so in plain words. No placeholder data, ever (this is a trust-law adjacent rule: fabricated content and fabricated counts are the same failure).

---

## 9. Route map for cedrus.miami

| Route | Auth | State | Purpose |
|---|---|---|---|
| `/` | public | **redesign, slice 1** | Landing + join |
| `/welcome` | token | **new, slice 1** | Post-signup: what you joined, what happens next |
| `/terms` | public | keep | Twilio-registered, do not break |
| `/privacy` | public | **revise, slice 1** | Must describe connections before slice 4 |
| `/preferences` | token | keep, harden | Email preference / unsubscribe |
| `/onboarding` | member | **new, shell in slice 1** | Fast profile |
| `/goals` | member | **new, shell in slice 1** | The three lanes |
| `/today` | member | **new, shell in slice 1** | Home |
| `/card/$id` | member | **new, slice 3** | Pace card detail |
| `/progress` | member | **new, slice 3** | Progression |
| `/settings` | member | **new, shell in slice 1** | Account, tone, phone |
| `/settings/connections` | member | **new, slice 4** | Connected accounts, scopes, disconnect |
| `/connect/google/start` | member | **new, slice 4** | OAuth initiation |
| `/connect/google/callback` | member | **new, slice 4** | OAuth return |
| `/confirm` | token | **retire, slice 1** | Event seat confirmation |
| `/decline` | token | **retire, slice 1** | Event seat decline |
| `/sitemap.xml` | public | update | Must not list member routes |
| `/api/public/resend-webhook` | signed | **fix, slice 1** | See finding 5 in III.3 |

**Retiring `/confirm` and `/decline`:** they are reachable only from an emailed token and no such email will be sent again. Return a plain "this link is no longer in use" page rather than a 404, because tokens exist in Emil's own inbox from the test send.

---

## 10. Screen-by-screen UX

Mobile-first throughout. Widths are phone-first; desktop is the same layout with a max width.

### Landing (`/`)

**Job:** a stranger understands what Cedrus does and whether it is for them, in one screen, in under fifteen seconds.

- Badge: `Building · Miami`.
- H1: `Have a better ~~remote~~ day.` The strikethrough is the brand and animates in once.
- Subheadline: the company line (pending Emil's choice, section 26).
- **Then the thing the current page does not do: say what it actually does.** Three short lines, one per pillar, each phrased as something Cedrus does for you, not a category name. Not "Places / People / Plans" as bare nouns.
- One sourced proof point (the Science 2026 stat), with the link in the same place.
- Join form (below), then Terms/Privacy line.
- **No countdown. No counter. No date. No venue. No seat.**

**Removed from the current page:** `CountdownTimer`, `WaitlistCounter`, the JSON-LD `Event` block, and the "Join the first workday" page title.

### Join (in-page on `/`)

- Three fields: full name, email, phone. Phone formats as you type.
- Two separate consent checkboxes, unchecked by default, email and SMS, each recording its exact wording. **This is a Twilio A2P compliance requirement, not a design choice.**
- Button: `Join Cedrus Miami`.
- Under-form: `Name. Email. Phone. That is all.`
- Error states inline; the already-on-list case is friendly and not an error.
- On success: navigate to `/welcome`, do not swap the form out in place. The member should land somewhere that can hold more than one sentence.

### Welcome (`/welcome`)

**Job:** convert a signup into an onboarded member while intent is highest.

- "You are on the list" honesty: say plainly whether they can use anything yet.
- What happens next, in two lines, with no dates.
- Primary action: **Start onboarding** (once slice 2 ships). Before that: "I will text you when your account is ready," and mean it.

### Onboarding (`/onboarding`)

**Job:** enough context for a useful Today, in under three minutes, on a phone, one thumb.

Seven steps, each one tap or one short answer, each skippable except phone verification. The steps already exist in the backend (`onboardingAnswers.js`): `work_setup`, `neighborhood`, `free_windows`, `activities`, `current_groups`, `people`, `social_prefs`.

- One question per screen. Big tap targets. Progress shown as dots, not a percentage.
- `free_windows` is the highest-value step and should not be last: it is what makes Today work before Calendar.
- Name is asked **explicitly in its own step** (flag 8: onboarding previously inferred the name from an open reply, and wrote "Had" from "Had dinner with...").
- Ends by handing straight to goals, not to a congratulations screen.

### Goals (`/goals`)

**Job:** capture up to three goals, in the member's own words, sorted into lanes.

- Three lanes, each optional: **work**, **people**, **body or personal**.
- Free text, one line each, with two or three examples per lane as ghost text rather than a picker. A picker would collect our categories instead of their intent, and their words are what the pace card has to quote back.
- "One is enough" stated explicitly. Three is a ceiling.
- Optional: roughly how often, in plain language ("a couple of times a week"). Stored as text, not parsed into a schedule.
- Editable at any time from Today, without a settings detour.

### Connection setup (`/settings/connections`, slice 4)

**Job:** an informed yes or no, and a reversible one.

Before the Google screen ever appears:
- What Cedrus will read: **when you are busy and when you are free.**
- What it will not read: **event names, descriptions, locations, guests, or anything in Gmail.**
- What it will do with it: **place suggestions in time that is actually open.**
- What it will never do: **create or change events** (present tense, per the forever-promise rule).
- Then, and only then, the Google button.

After connecting: connection state, the exact scope in plain language, when it last read, and **Disconnect** as a single visible action, not buried. Disconnect states what happens to already-derived data.

### Today (`/today`)

**Job:** the state of the day and the one next thing.

Vertical, single column, three zones:

1. **The day.** One or two lines: what today looks like. Before Calendar: derived from stated schedule and free windows ("Thursday, usually an open afternoon for you"). After Calendar: real ("you are booked until 2, then clear"). Always says which one it is.
2. **The card.** The current pace card, if there is one. Full card, not a teaser. Actions: do it, adjust, not today, not this. Tapping opens `/card/$id`.
3. **Your goals.** The one to three goals, each with a one-line status in plain language, and a tap to report an outcome.

Plus a persistent, unmissable **text Cedrus** affordance, because SMS is the assistant and the web should keep handing off to it.

**Empty state (week one, nothing connected, no card yet):** honest, specific, and actionable. It names what Cedrus knows so far and what it is waiting for. It never shows an example card.

### Pace card detail (`/card/$id`)

**Job:** show the reasoning, so the recommendation is inspectable rather than magic.

Renders the four parts as four visually distinct blocks, in the order of the definition (`CEDRUS.md` Part I section 20):

1. **Because you said** — the goal, quoted in their words. Labelled as a known fact.
2. **What I know** — user-reported facts and known facts, separated and labelled.
3. **What I think** — inferred context, always hedged, always marked as an inference.
4. **What I suggest** — one action, sized to the window.

Then: **Do it · Adjust · Not today · Not this.** All four equally weighted. "Not this" asks one optional question ("wrong thing, wrong time, or wrong place?") because that answer is worth more than the card was.

**The typographic requirement:** the four kinds of statement must be distinguishable without reading carefully. Different weight or a small label per block, not one paragraph of prose. Collapsing them is the single most damaging thing this screen can do.

### SMS handoff

**Job:** move the member from the web to the channel where the product actually lives.

- Today shows the Cedrus number and a prefilled `sms:` link on mobile.
- After onboarding, one SMS from Cedrus introducing itself and stating the narrow promise plainly.
- Every pace card can be answered by text as well as by tap, with the same four outcomes. A member who never opens the web again must still be a full user.
- Anything outside the promise gets an honest answer and a logged request. **The log of those requests is the roadmap.**

### Progression (`/progress`)

**Job:** answer "is this working," honestly, including when the answer is no.

- Per goal: what you said, what was suggested, what you did, over the last few weeks.
- Plain sentences and small counts. No score, no ring, no streak, no garden.
- Allowed to say "nothing moved on this one." That honesty is the feature; a progress bar that only goes up is the thing every abandoned habit app has.
- Nothing here counts app opens, messages sent, or cards received.

### Settings (`/settings`)

Account (name, phone, email), tone preference, SMS on/off, email preferences, delete account, and a link to connections. Small and boring on purpose.

### Privacy and connected accounts (`/settings/connections` + `/privacy`)

The settings screen is the operational view (section above). `/privacy` is the legal document, and it must be updated **before** slice 4 ships, not with it: describing a connection after it is live is a compliance problem, not a documentation lag.

---

## 11. Today before Calendar

The default experience, and it must be good on its own.

**Inputs:** stated goals; user-reported plans; neighborhood; remote/hybrid schedule; stated usual free windows; stated preferences; recent SMS; Miami context (day of week, weather, what is on); manual operator input.

**What Today can honestly say:** "Thursday afternoons are usually open for you. You said you wanted to swim twice a week and you have mentioned once this week. There is a pool ten minutes from Brickell that is quiet at 4."

**How the uncertainty is expressed:** *usually*. Every pre-Calendar timing claim is an inference and is labelled as one. The member is invited to correct it, and the correction is worth more than the guess.

**The bar:** a member who never connects anything gets a real product. If the pre-Calendar Today is a stub with a "connect your calendar" button in it, the connection is carrying the product and the product has not been built.

---

## 12. Today after Calendar

**What changes:** timing accuracy. Nothing else.

- "Usually open" becomes "open." Inference becomes known fact, and the label changes with it.
- Cedrus stops proposing into a wall of meetings.
- Cedrus can notice the gap the member did not: "your 3pm moved, you have two hours."
- Cedrus can compare stated free windows against real ones and ask about the drift, once, without nagging.

**What does not change:** the goals, the pillars, the card format, the outcome loop, and the fact that Cedrus never renders a calendar or reads an event's contents.

**Degradation:** if the connection breaks, expires, or is revoked, Today falls back to the pre-Calendar behaviour and **says so**. It does not silently start guessing while looking certain. (Lesson 7: a guard that cannot distinguish "checked and fine" from "did not run" is the recurring failure in this codebase. Connection state is exactly that shape.)

---

## 13. Manual user-reported activity and outcomes

The whole Progression loop rests on this, so it gets designed rather than assumed.

**Two capture paths, same data:**
- **Tap:** on a card or a goal in Today. One tap for the common answers.
- **Text:** free-form SMS. "did the swim", "skipped it", "went somewhere else".

**What is captured:** which card or goal, what happened (`did / did_something_else / did_not / deferred`), optionally whether it helped, optionally one line of free text. Timestamp. Source (tap or text).

**Design rules:**
- **"I didn't" is exactly as easy as "I did."** If the negative is harder, the data is worthless and the product becomes a guilt machine.
- **Never ask twice.** One prompt per card. Silence is a valid answer and gets recorded as silence, not retried.
- **Unverified stays unverified.** Self-reported activity is a *user-reported fact* everywhere it is used, including inside future pace cards. It never gets promoted to a known fact.
- **No streaks and no scores derived from it.** Trust-law adjacent: an inferred score is a fabricated count wearing a chart.
- **Fitness and activity are typed in, not integrated** (`CEDRUS.md` Part I section 21). Manual entry is the deliberate design, not a gap waiting for Strava.

---

## 14. Pace-card generation

**Founding release: assisted, not autonomous. Every card is reviewed by Emil before delivery.**

**Pipeline:**
1. **Candidate detection.** For each active member, is there a reason to say something today? A goal with no recent movement, an open window, a Miami context hit, an unanswered prior card. If no, **no card.** Silence is the correct default and the most common output.
2. **Assembly.** Gather the four parts, each tagged with its kind (known / user-reported / inferred / proposed). The tag travels with the value from the moment it is read. It is not applied at render time, because by then the provenance is gone.
3. **Draft.** Model-authored language, from a structured plan, in the member's tone preference.
4. **Review.** Into a queue. Emil approves, edits, or kills. **Every kill and every edit is logged with a reason** — that log is the training signal for what to automate, and it is the single most valuable dataset the founding release produces.
5. **Deliver.** Web (Today) and SMS.
6. **Record.** Outcome capture per section 13.

**Hard constraints:**
- **One card per member per day, maximum**, and most days none. Two cards means neither is the one thing.
- **No card without a goal to hang it on.** A suggestion with no stated intent behind it is a recommendation engine, which is what this product is trying not to be.
- **A card that cannot label its own certainty does not ship.** If assembly cannot say which of the four kinds a claim is, the claim is dropped from the card.
- **Rate limits and the budget guard apply.** The existing per-user cap and `system_flags` kill switch are the ceiling (II.5); card generation is a model call and must sit behind them.
- **`BRIEF_DRY_RUN` stays `true`.** Card *sending* is a separate, named arming session with its own proof (Law 5). Building the rail is in scope; putting SMS on the wire is not.

---

## 15. Website and SMS identity reconciliation

**The problem, verified in source.** `cedrus-miami` stores `contacts.phone_e164` as `+17865551234`. `cedrus-backend` stores `app_users.phone` digits-only as `17865551234` (`users.findOrCreateByPhone` → `normalizePhone`). **These do not join on a string comparison.** A member who signs up on the web and then texts Cedrus creates two unlinked records today.

There is also a **two-database split**: miami writes to the Supabase project `cedrus-waitlist` (`mnptemyleobxgsuuoppq`); the backend uses a different Supabase project holding `app_users`, `people`, `facts`, `user_goals`. They share no foreign keys.

**Recommendation (needs Emil, section 28).**

- **`app_users` is canonical for members.** It already carries identity, consent timestamps, timezone, plan, onboarding state, and the whole assistant's data model. Rebuilding that in the miami project would be the second-worst outcome; splitting the member across both permanently is the worst.
- **`contacts` stays canonical for acquisition and consent.** It is the compliance record and Part I section 15 makes Supabase-as-canonical a locked rule. Do not move it.
- **Link on normalized phone, at the moment of onboarding, explicitly.** Store the link (`contacts.app_user_id`, or a join table) rather than re-deriving it. Normalize on write, in one shared helper, on both sides. Deriving a join by transforming strings at read time is how two systems drift.
- **Phone verification is the identity event.** Email is not identity: two people share a household email more often than a mobile number, and the assistant is a phone product.

**What must not happen:** a session "fixing" this by loosening `normalizePhone` or by writing E.164 into `app_users.phone`. That column is matched against Twilio's `From` on every inbound SMS. Changing its format is a live-traffic change to the one path that currently works.

---

## 16. Google Calendar authorization flow

Scope, boundaries, and the doctrine are canon (`CEDRUS.md` Part I sections 18 and 19). The mechanics:

1. **Entry.** From `/settings/connections` only. Never from onboarding, never as a modal, never as a gate on any screen. A connection prompt inside a flow the member is trying to finish is coercion by placement.
2. **Pre-consent screen.** Ours, before Google's. Reads / does not read / will do / will not do. The member can leave from here with nothing having happened.
3. **OAuth.** `/connect/google/start` → Google → `/connect/google/callback`. Request the **narrowest calendar scope that returns free/busy** and no more. Read the provider's terms for that specific scope before writing the request (doctrine rule 7).
4. **Token storage.** Server side only. Never in the client bundle, never in a cookie, never in `localStorage`. Refresh tokens encrypted at rest. This is a service-role-only table.
5. **State and PKCE.** Standard CSRF protection on the state parameter. The callback validates state before doing anything else.
6. **Confirmation.** Back to `/settings/connections`, connection shown as live, with the plain-language scope and the disconnect action visible on the same screen.
7. **Failure.** A denied or failed authorization returns to the pre-consent screen with a plain explanation and no partial state. Half-connected is not a state that exists.
8. **Disconnect.** One action. Revokes at Google, deletes the tokens, states what happens to derived availability data, and Today visibly falls back to pre-Calendar behaviour.

**Reading pattern.** Pull free/busy for a bounded forward window (a few days) on a schedule, not on demand per render, and store only what section 17 permits. Never proxy a live calendar read through a page load.

---

## 17. Calendar data boundaries

**Store:** busy intervals (start, end) for a short forward window, per member. A last-synced timestamp. Connection status.

**Never store, never request, never log:** event titles, descriptions, locations, attendees, organizers, conference links, recurrence rules, colors, calendar names, or free-text of any kind.

**Never do:** render a calendar view; show any calendar-derived data to another member; infer who a member meets or where they are; use calendar data for anything except placing a suggestion in time; retain busy intervals for past windows beyond what Progression needs (and Progression needs outcomes, not intervals).

**The enforcement point is the fetch, not the render.** If titles are fetched and then not displayed, they are in the logs, in the response cache, and in the error reports. **Request the free/busy shape so the sensitive fields never enter the system.** This is the difference between a policy and a guarantee.

**Trust-law link:** item 9 ("exact calendars stay private") is a promise to the member. The read-only free/busy scope is the technical form of that promise, which is why widening it is Emil's call and not a code review's.

---

## 18. Privacy and least-privilege design

- **Nothing is collected without a shipped feature consuming it.** If no screen and no card reads a field, it is not stored.
- **Service-role access is server-only.** `cedrus-miami` has RLS doing one hundred percent of the security work with a hardcoded anon key (III.3). Every new table gets RLS enabled and a `TO service_role` policy, and **no `anon` policy, ever**.
- **Consent is per purpose and recorded with its exact wording.** Already true for email and SMS. Connections join the same model: what was authorized, when, and in what words.
- **Deletion is real.** Account deletion removes member data and revokes connections. The consent audit trail is retained deliberately, because it is the legal record of a permission that was granted; that retention is disclosed.
- **Logs are a data store.** Personal content does not go into log lines. The backend logger already carries structured events rather than payloads; keep it that way for calendar and card data.
- **Least privilege applies to Emil too.** The review queue shows what a card says and why. It should not become a window onto everything the system knows about a member.

---

## 19. Proposed data model

Additive only. No existing table is altered destructively. Names are proposals.

**In the backend Supabase project (member data):**

| Table | Purpose | Key columns |
|---|---|---|
| `user_goals` | **exists.** The three lanes reuse it. | `origin='user_set'`, `priority`, plus a proposed `lane` (`work` / `people` / `body`) |
| `pace_cards` | One card | `user_id`, `goal_id`, `status` (`draft/approved/edited/killed/delivered`), `window_start`, `window_end`, `created_at`, `delivered_at` |
| `pace_card_parts` | The four blocks, provenance preserved | `card_id`, `kind` (`known/user_reported/inferred/proposed`), `text`, `source_ref` |
| `card_outcomes` | The RECORD step | `card_id`, `user_id`, `outcome` (`did/did_something_else/did_not/deferred/silent`), `helped` (nullable bool), `note`, `source` (`tap/sms`), `recorded_at` |
| `member_activity` | Manual activity and outcome reports not tied to a card | `user_id`, `goal_id` nullable, `text`, `happened_at`, `source` |
| `connections` | One row per authorized connection | `user_id`, `provider`, `scope`, `status`, `authorized_at`, `last_sync_at`, `revoked_at` |
| `connection_tokens` | Separate, service-role only | `connection_id`, encrypted access/refresh, `expires_at` |
| `availability_windows` | Busy intervals only | `user_id`, `starts_at`, `ends_at`, `source` (`calendar/stated`), `synced_at` |

**In the miami Supabase project (acquisition and consent):**

| Table | Change |
|---|---|
| `contacts` | **add** `app_user_id` (nullable, the identity link) and `email_permission` (current state, closing the finding-10 gap). Additive. |
| `consent_events` | unchanged. Append-only. Note the timestamp column is `occurred_at`, not `created_at`. |
| `event_registrations` | **untouched.** Retired, not dropped. It is the record of an experiment. |

**Why `pace_card_parts` is a table and not a JSON blob.** The provenance tag is load-bearing (Part I section 20). A column the database enforces is harder to lose in a refactor than a key in a JSON object, and this is the field whose loss is unrecoverable.

**What is deliberately absent:** any score, streak, points, level, or health metric. Progression reads outcomes directly.

---

## 20. Migration sequence

**Law 11: schema before code, always. Law 8: through the runner. Anything touching existing data shows the plan and waits for Emil.**

| # | Migration | Repo / project | Type | Gate |
|---|---|---|---|---|
| 1 | `contacts.email_permission` + backfill from `consent_events` | miami | additive + **data** | Emil approves the backfill plan explicitly |
| 2 | `user_goals.lane` (nullable, no default) | backend | additive | runner |
| 3 | `pace_cards`, `pace_card_parts`, `card_outcomes` | backend | additive | runner |
| 4 | `member_activity` | backend | additive | runner |
| 5 | `contacts.app_user_id` | miami | additive | runner |
| 6 | `connections`, `connection_tokens`, `availability_windows` | backend | additive | runner, + a hand-written post-check on grants |

**Rules for every one of them:**
- Unqualified table names. `run-migration.mjs` cannot parse `ALTER TABLE public.x` and will roll back silently (II.5).
- RLS enabled, `TO service_role` policy, no `anon` policy.
- Quote `position` if it appears anywhere near `event_registrations`.
- The runner verifies DDL objects only. Migration 1 is a data write and **must not** go through the runner (Lesson 10) — it needs a purpose-built script with row-count assertions before, inside the transaction, and after.
- Migration 6 needs a hand-written post-check: the runner will happily report success on a table whose grants are wrong, and `connection_tokens` is the one table in this system where a grant mistake is a credential leak.

---

## 21. Ownership boundaries

| System | Owns | Does not own |
|---|---|---|
| **cedrus.miami** (Lovable Cloud / Cloudflare Workers) | Public landing, join, consent capture, the member web surfaces (Today, goals, cards, progress, settings), OAuth entry and callback | Card generation, model calls, SMS, scheduling, the assistant |
| **cedrus-backend** (Railway) | The assistant, the pipeline, goals, reminders, briefs, card generation and review, calendar sync jobs, all scheduled work, all model calls | Anything a browser renders |
| **Supabase (miami project)** | `contacts`, `consent_events`, `event_registrations`. The acquisition and compliance record of record. | Member product data |
| **Supabase (backend project)** | `app_users`, `people`, `facts`, `user_goals`, and everything in section 19's backend list. Canonical member data. | Consent capture at signup |
| **Railway** | Backend hosting and env. Push to main is a live deploy in ~50s. | Any frontend |
| **Lovable Cloud** | Miami hosting, Worker env/secrets. **Push updates preview only; live needs a publish.** | Backend anything |
| **Resend** | Outbound email delivery, and the only authority on bounces, complaints, and unsubscribes | The list. Supabase is canonical; Resend is a delivery projection. |
| **Twilio** | SMS transport, A2P compliance surface, STOP/HELP | Conversation logic |

**The boundary that will be violated first:** cedrus.miami will want to generate or personalize a card in a server function, because the data is right there. It must not. Cards are generated in the backend, behind the rate limiter and the budget guard, and reviewed in one queue. A second generation path means a second unreviewed path.

**Two writers on cedrus-miami.** Lovable writes to that repo whenever prompted, and so do sessions. One editor at a time; `git pull` before and after every Lovable session.

---

## 22. Email's new role after retiring the mandatory workday

Three jobs, and it is not on the critical path.

1. **Transactional confirmation.** One email on signup. Says what they joined, what Cedrus is, what happens next. **No date, no venue, no seat, no countdown, no position.** Carries a small "manage email preferences" link, not a prominent unsubscribe, because it is transactional.
2. **Occasional founder notes.** What is being built, what changed, what Emil learned. Marketing: clear unsubscribe, filtered against current permission state before send.
3. **The weekly pace report (LATER).** The eventual reason email matters: what you said mattered, what your week held, what moved, one thing to try. Ships only when pace cards have produced enough history for it to be true.

**Blocking work before job 2 or 3 can run:** the permission-state column (finding 10) and the webhook fix (finding 5). Today, an unsubscribe is recorded but unenforceable, and every Resend delivery event is silently dropped. Neither matters until the first broadcast, and both are fatal on the day of it.

**Retained from the retired plan:** the entire list-ownership and consent model, the Resend-over-SendGrid reasoning, the sending identity and its DNS setup, and the transactional/marketing split. Those were correct and are untouched.

---

## 23. Future weekly pace report

**LATER. Specified here so it is not reinvented.**

- **Personal, not civic.** The retired Sunday brief was about Miami and the community. This is about the member, because that is what the product now claims.
- **Shape:** what you said mattered · what your week actually held · what moved · one thing for next week.
- **Honest by construction.** It must be able to say "not much moved." A report that only reports wins is a report nobody trusts on week four.
- **Same provenance rules as a pace card.** Known, user-reported, and inferred stay distinguishable.
- **Email plus an SMS preview**, matching the existing brief infrastructure's shape.
- **Precondition:** enough card and outcome history that the report has something true to say. Sending it early trains members to ignore it.

---

## 24. Validation events and analytics

Instrument the loop, not the pageviews. Each event below maps to a line in the validation gate.

| Event | Answers |
|---|---|
| `signup.completed` | acquisition (not product proof) |
| `onboarding.started` / `.step_completed` / `.completed` | does the door work |
| `goal.set` (with lane) | did they state what matters |
| `context.supplied` (manual) / `connection.authorized` | is Cedrus getting real inputs |
| `sms.inbound.unprompted` | is the assistant being used voluntarily |
| `sms.request.out_of_scope` (with text) | **the roadmap.** What they want that we do not do |
| `card.generated` / `.reviewed` (approved/edited/killed + reason) | is generation good enough to automate |
| `card.delivered` | did it reach them |
| `card.outcome` (did / did_something_else / did_not / deferred) | the core signal |
| `card.helped` (yes/no) | **a better day**, the gate's central definition |
| `return.visit` / `return.sms` after 7 days | retention |
| `connection.revoked` | did we lose trust |
| `payment.intent_expressed` | willingness to pay |

**Rules.** No vanity metrics on any dashboard: not signups, not pageviews, not messages sent, not app opens. Analytics carry ids and enums, never message content or calendar data. **A member who does nothing is a data point, not a gap** — record silence explicitly rather than inferring it from absence, because absence in a window too short to contain the event is Lesson 18's exact trap.

---

## 25. Reuse matrix

From the current-main audit of all three repos. **KEEP** = use as is. **REPURPOSE** = the mechanism is good, the framing changes. **RETIRE** = belongs to the old direction. **UNKNOWN** = needs proof before a decision.

### cedrus-miami

| Item | Verdict | Note |
|---|---|---|
| Supabase `contacts` table + write path | **KEEP** | Works. Compliance record of record. |
| `consent_events` model + exact-wording capture | **KEEP** | Locked doctrine. Timestamp column is `occurred_at`. |
| Two separate unchecked consent checkboxes | **KEEP** | Twilio A2P requirement. Do not touch the shape. |
| `createServiceClient()` + `getEnv()` + `CEDRUS_SERVICE_ROLE_KEY` | **KEEP** | The eighteen-hour lesson, correctly implemented. Do not "simplify". |
| Resend send path (`sendResendEmail`) | **KEEP** | Works via the Lovable connector gateway. |
| `/preferences` route + token model | **REPURPOSE** | Keep the route, make the opt-out actually enforce (finding 10). |
| `parsePhoneE164` / `formatPhone` / `normalizeEmail` | **KEEP** | Reuse for identity linking, but see section 15 on the format mismatch. |
| shadcn/ui component set | **KEEP** | Standard, unopinionated, mobile-capable. |
| Landing page structure (`index.tsx`) | **RETIRE** | Rebuilt mobile-first. Says nothing about what Cedrus does. |
| `CountdownTimer` | **RETIRE** | Public countdown to an unconfirmed event. Doctrine violation. |
| `WaitlistCounter` + `getHeldRegistrationCount` | **RETIRE** | Violates the invisible-cap rule. |
| JSON-LD `Event` block | **RETIRE** | Publishes an unconfirmed date to search engines. |
| Held / expired email templates | **RETIRE** | Event logistics. Replaced by one founding-beta confirmation. |
| `/confirm`, `/decline` | **RETIRE** | Seat model. Serve a graceful "no longer in use" page. |
| `event_registrations` + `create_cedrus_registration` | **RETIRE, do not drop** | Preserve the rows. The mechanism is reusable for a future activation. |
| `client.server.ts`, `auth-middleware.ts` | **RETIRE** | Lovable-generated, zero importers, both read `process.env`. Dead code that looks live. |
| `resend-webhook.ts` | **REPURPOSE** | Fix the env read and the swallowed 200 before it is ever needed. |
| Dark / DM Sans / glass / orbs visual system | **UNKNOWN** | Blocked on the brand decision (section 28). |

### cedrus-backend

| Item | Verdict | Note |
|---|---|---|
| SMS identity (`findOrCreateByPhone`, `normalizePhone`) | **KEEP** | Works. Format differs from the website; link, do not change. |
| Inbound pipeline + stage ordering | **KEEP** | Safety, compliance, crisis pre-check, caps, budget guard. Hard-won. |
| Safety modules | **KEEP, UNTOUCHABLE** | Law 2. |
| `services/goals.js` + `/api/goals` + `selectVitalFew` | **KEEP** | The strongest existing asset. Three lanes fit with one additive column. |
| `origin` partitioning of user-set vs inferred goals | **KEEP** | Prevents a life goal hijacking the brief's follow-up slot. |
| `onboardingAnswers.js` steps | **KEEP** | Already the right seven questions. Ask name explicitly (flag 8). |
| `POST /api/onboarding/answers`, `GET /api/me` | **KEEP** | Built, merged locally, **unpushed** so not live. |
| Facts / self-person model | **KEEP** | Where onboarding answers land. `addFact` throws on failure. |
| Reminders | **KEEP** | Member-set reminders are a distinct, working feature. Not pace cards. |
| Rate limiter + budget guard + `system_flags` | **KEEP** | Card generation must sit behind both. |
| Entitlements (`planTier`) | **KEEP** | Time-aware, six copies collapsed. Do not re-fork it. |
| Brief infrastructure (`briefEngine`, `brief/*`, `briefEmail`) | **REPURPOSE** | The rails for the LATER weekly pace report. Retarget from civic to personal. |
| Opportunity-card rail (`cards.js`, `cardSender`, `cardFollowup`, admin queue) | **REPURPOSE** | **The closest existing thing to pace cards**: a draft → admin review → capped send → reply-handling → follow-up loop already exists. Reframe from pairings to goal-aware suggestions. Biggest single reuse win. |
| Admin broadcasts | **KEEP** | Draft-then-approve, quiet hours, daily cap. |
| Dunbar rings / `dunbar_tier` | **RETIRE** | Cosmetic; zero backend readers (II.5). Do not revive. |
| `relationship_health_score`, drift nudges, `contact_frequency_days` | **RETIRE as the wedge** | The relationship-CRM direction. Flag 19 stays open; do not build on it. |
| `discovery.js` | **RETIRE** | No importers. Inert Pro planner. |
| `coreFive.js` / `is_core_five` | **UNKNOWN** | Flag 22: on free plans the proactive layer is dead. Only matters if the new product gates on it. Decide before it bites. |
| Calendar / OAuth | **NONE EXISTS** | Greenfield. |

### cedrus-frontend (inspection only, not modified)

| Item | Verdict | Note |
|---|---|---|
| `--v1-*` design tokens + motion vocabulary | **REPURPOSE** | Extract, do not import. Best-developed system of the three. |
| `CdSection` pattern (title + first-class `empty` + accent) | **REPURPOSE** | Empty-state-as-a-prop is exactly right for a week-one Today. |
| `components/v1/` shell, `WindowChip`, `ui.tsx` | **REPURPOSE** | `WindowChip` in particular: a time window is the new core object. |
| Onboarding screen patterns | **REPURPOSE** | One question per screen, big targets. |
| Warm olive/cream + Cormorant visual system | **UNKNOWN** | Blocked on the brand decision. |
| Garden, Seedling, TreeGlyph, friendship stages | **RETIRE** | Progression is not a garden in the founding release. |
| `people.tsx`, `PersonProfile.tsx`, relationship CRM | **RETIRE as the wedge** | Keep running at `/classic`. Do not port forward. |
| `/classic`, `/terms`, `/privacy`, `/support`, `/sms` | **KEEP, PRESERVATION LAW** | Twilio-registered. Dormant does not mean broken. |

---

## 26. Language-doctrine audit

Every language item in the pre-reboot Part I, classified. Active doctrine is in `CEDRUS.md` Part I section 13; this is the full record with prior wording.

### KEEP

| Line | Purpose |
|---|---|
| `Have a better ~~remote~~ day.` | Tagline. Encodes the expansion path. |
| `Building · Miami` | Badge. Honest about stage. |
| Proof block (Science 2026, 588,322 workers, 58%) | The one sourced claim. |
| `Cedrus starts in Miami because knowing what is actually happening here this week is half the product.` | Geography rationale. |
| `Founding members join the beta free and help shape what Cedrus becomes in Miami. Major changes come directly from Emil.` | Founding member framing, finite by construction. |
| `Name. Email. Phone. That is all.` | Answers "what will this cost me." |
| `Join Cedrus Miami` | CTA. |
| All nine voice rules; all banned words; the three shipping questions | Unchanged. |
| All trust statements | Strengthened, not relaxed. |
| Headers under test, ranks 1, 2, 3, 5 | Still testable without an event. |

### REVISE

| Item | Prior wording | Prior purpose | Why it no longer fits | Replacement |
|---|---|---|---|---|
| Company line | "Cedrus helps you have a better day. Find where to go, who to meet, and what to do." | Orienting public definition | Describes three lookups. Says nothing about remembering intent or checking whether the day moved, which is now the whole differentiation. | Candidates A–D in Part I section 13. **NEEDS EMIL DECISION.** Current line stays approved until then. |
| Hero subheadline | "Have a better day with Cedrus. Where to go? Who to meet? What to do?" | Hero support | Inherits the company line. | Moves with the company line decision. |
| Headers under test | Six ranked headers | Test rotation | Two assumed an event or a purely social frame. | Reduced to four; a fifth goal-aware strategy proposed and **NEEDS EMIL DECISION**. |
| "The cap is invisible" | "The page never mentions a number. No '50 spots,' no counter, no scarcity theater." | Protected the user from false urgency at signup | The 50-seat cap no longer exists. | **Generalized, not retired.** Now a pace-card rule (Part I section 20): no manufactured urgency anywhere. **The live page currently violates the original rule** (III.3 finding 7). |
| Page title | "Cedrus Miami - Join the first workday" | SEO / share title | There is no first workday. | New title describing the product, not an event. |
| Meta description | "Cedrus is coming to Miami. Where to go, who to meet, what to do." | SEO | "Is coming" promises an arrival. | Present tense, describing what Cedrus does. |
| Email consent checkbox | "Email me Cedrus updates, **workday invitations**, and the weekly brief. I can unsubscribe anytime." | Compliance record | Names workday invitations, which will not be sent. | Reworded. **Existing `consent_events` rows keep their original text and must not be rewritten** — that is the point of storing the wording per row. |
| SMS consent checkbox | "Text me about Cedrus access, **workday logistics**, and requests I send to the Cedrus assistant. Message frequency varies..." | Twilio A2P compliance | Same. | Reworded, keeping every required A2P element (frequency, rates, STOP, HELP, Terms, Privacy) **exactly**. Changing those elements is a compliance change, not copy. |
| Confirmation subtext | "Check your inbox for a note from Emil." | Post-signup | Still true. Verify the email actually sends before promising it. | Keep if true; otherwise say what will happen. |

### RETIRE

| Line | Prior purpose | Why |
|---|---|---|
| "The most remote day of the week." | Friday workday angle | Sells an event that no longer exists |
| "Four days in. One day with us." | Friday workday angle | Same |
| "Friday is everyone's remote day. Let's use it." | Friday workday angle | Same |
| "Find a better place to work and people to spend the day." | Header rank 4 | "Spend the day" implies a shared day, i.e. the workday |
| "Text Cedrus when you want to get out, find something to do, or meet people nearby." | Header rank 6 | Purely social framing; omits goals and time, the new core |
| "A better ~~remote~~ day is coming." | Email 1 and launch SMS opener | "Is coming" promises a dated arrival |
| Email 1, "You are in" (full body) | Signup confirmation | Promises a room on August 21 |
| Email 1b, "You are on the list" (full body) | Over-cap confirmation | Announces a filled workday and a queue position |
| Email 6, "Thank you, and your Cedrus account" | Post-event | There is no event |
| Launch SMS ("You signed up for the August 21 workday...") | Assistant launch | Same |
| The six-email sequence table | Event nurture | Every email carried event logistics |
| "The spot is provisional until confirmed" + held/confirmed/expired copy | Seat management | No seats |
| Capacity section, "the event is capped at 50 people" | Seat management | No cap |
| The QR check-in | Attendance measurement | No attendance |
| Held email: "You have a seat on August 21" | Live confirmation email | Currently sends. Must go in slice 1. |
| Expired email: "The August 21 workday is currently full" | Live confirmation email | Same |

**The Friday insight survives.** Friday is the most common work-from-home day for hybrid workers. That is a true fact about the customer and it is preserved in Part I section 15 as a targeting and timing insight. Only the copy that sold a Friday *event* is retired.

### NEEDS EMIL DECISION

1. The public company line: A, B, C, or D (keep current).
2. The hero subheadline, which follows from 1.
3. Whether the goal-aware header enters the test rotation, and against which incumbent.
4. Whether "A fitness app understands a workout. Cedrus understands where that workout fits in the rest of the day." becomes public copy or stays internal. Recommendation: internal for now. It is sharp, and it invites a fitness comparison the product cannot yet win.
5. Whether "pace card" is a public term or an internal one. Recommendation: **internal.** Members should see the thing, not the noun. Naming the mechanism invites evaluation of the mechanism.

### Trust protections: preserved and strengthened

No trust statement was weakened. Two were made more precise:

- **Item 6** now reads "Cedrus does not contact a person who is not a member," which is a clearer statement of the same promise, plus the member-contact case the trust law already governed.
- **Item 9** now says what calendar data is used for and what it is not, which is a stronger and more checkable promise than "exact calendars stay private" alone.
- **Item 10 is new** and follows from connections existing at all.

**The forever-promise trap, avoided deliberately.** "Cedrus will never write to your calendar" would be an easy trust line and a future liability, because user-approved event creation is an explicitly planned test (Part I section 19). The present-tense version, "Cedrus does not create or change events," is true today, is not weaker to a reader, and does not have to be broken later. Voice rule 3 already banned never/forever/always; this is that rule doing real work.

---

## 27. Risks and unknowns

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **Members will not state goals honestly to a two-week-old product** | The entire loop starts here | Ask in their words, three lanes max, one is enough, no picker. Watch `goal.set` conversion in onboarding. |
| 2 | **Members will not report outcomes** | Progression is fiction without it | One tap and one word. "I didn't" as easy as "I did." Never ask twice. |
| 3 | **A goal-aware suggestion may not actually beat a generic one** | This is the core product claim and it is unvalidated | The card review queue is the instrument. If Emil's edits consistently strip the goal reference, the claim is wrong. |
| 4 | **Nobody connects a calendar** | Slice 4 wasted | Exactly why Today must be good without it. Treat connection rate as a finding, not a failure. |
| 5 | **Manual review does not scale past ~25 members** | It is not supposed to | It is a research instrument. The kill/edit log names what to automate first. Plan for the wall; do not pretend it is not there. |
| 6 | **The two-database split hardens into permanent duplication** | Members become two records forever | Decide identity ownership before slice 2 (section 28). |
| 7 | **Brand fork between the two domains** | Two visual identities is one too many | Decision required before slice 1's redesign, or the redesign has to be redone. |
| 8 | **The unenforced unsubscribe becomes a real violation** | Compliance | Fix before the first broadcast. Not urgent; fatal on the day. |
| 9 | **The Resend webhook silently drops every event** | No bounce or complaint suppression | Fix in slice 1. It returns 200, so nothing will ever alert you. |
| 10 | **August 21 is in the schema, not just the copy** | Removing it from the page does not remove it | Six sites, three in the database (III.3 finding 9). |
| 11 | **`BRIEF_DRY_RUN` gets flipped as a side effect** | Live SMS to real people, unreviewed | Law 5 corollary. Arming is its own named session with its own proof. |
| 12 | **A pace card collapses its four statement kinds** | The one unrecoverable product failure | Provenance is a database column, tagged at read time, not at render time. |
| 13 | **Calendar scope creep** | A trust promise, not a feature flag | Widening the scope requires Emil. Written into the canon's reading table. |
| 14 | **Cedrus becomes a generic assistant by accretion** | Loses the only differentiation | Every feature attaches to a pillar. No card without a goal behind it. |
| 15 | **A second card-generation path appears in miami server functions** | Unreviewed output, outside the budget guard | Ownership boundary, section 21. |

**Genuine unknowns, no mitigation, just watch:** whether Miami's remote density is real (still unsourced, still not usable publicly); whether SMS or web ends up being the primary surface; whether members want introductions once individual utility works; what price, if any, this supports.

---

## 28. Decisions requiring Emil

Ordered by what blocks what.

1. **Brand and visual direction.** Dark/DM Sans/glass (miami) or warm/olive/Cormorant (life), or a third thing. **Blocks slice 1's landing redesign.** Recommendation: commit to the miami dark direction for the product surface and retire the warm system with cedrus.life, because the active domain should not be the one that changes.
2. **The public company line.** Candidates A–D. **Blocks slice 1 copy.**
3. **Identity ownership: one member record or two.** Recommendation: `app_users` canonical for members, `contacts` canonical for acquisition and consent, linked on normalized phone at onboarding. **Blocks slice 2.**
4. **Does the miami web surface talk to the backend API directly, or does it get its own read layer?** Recommendation: directly, authenticated, so there is one member data store. **Blocks slice 3.**
5. **Push the two pending documentation commits?** `cedrus-frontend@63e1fde` and `cedrus-miami@6e07832`, each one docs-only commit ahead of origin. Push is deploy in both (miami to preview only). Not urgent; not this session.
6. **Miami's `archive/local-main-2026-08-03` branch.** Preserved, unpushed, superseded by `6e07832` which does the same thing. Recommendation: leave it. It costs nothing.
7. **What happens to `event_registrations` and its existing rows.** Recommendation: leave in place, stop writing to it. It is the record of an experiment and dropping it destroys that record.
8. **Does the Resend sending identity stay on `updates.cedrus.life`?** Recommendation: yes, for now. It is verified and warmed; moving it is a deliverability cost with no product benefit yet.
9. **Price.** Deliberately not set. $15/mo remains the internal hypothesis.
10. **Is "pace card" a public term?** Recommendation: internal only.
11. **Does the goal-aware header enter the test rotation?** Recommendation: yes, against rank 1, before anything else is tested.
12. **Whether Emil reviews every card indefinitely or sets a stopping rule now.** Recommendation: set the rule now (for example, automate a card type once 20 consecutive cards of that type ship unedited), because the queue will otherwise become the reason to stop growing.

---

## 29. Four independently testable implementation slices

Each is independently shippable and independently valuable. Each stops before push.

### Slice 1 — Harden the door and retire the event

**Repo:** `cedrus-miami` only. **Goal:** an honest, mobile-first front door with no event in it, a signup path that cannot silently lose a compliance record, and empty shells for what comes next.

Scope: transactional integrity on signup; check every consent write; retire countdown, counter, seat model, and all event copy; rewrite the confirmation email; rebuild the landing page mobile-first; add labelled shells for `/welcome`, `/onboarding`, `/goals`, `/today`, `/settings`; fix the Resend webhook env read; add `contacts.email_permission`; graceful retirement of `/confirm` and `/decline`.

Out of scope: any Google OAuth, any backend change, any real product functionality behind the shells.

### Slice 2 — Onboarding, goals, and one member record

**Repos:** `cedrus-backend` + `cedrus-miami`. **Goal:** a stranger can go from signup to a profile with stated goals, as one identity.

Scope: `user_goals.lane` migration; onboarding UI on miami driving the existing `POST /api/onboarding/answers`; explicit name step; goals UI against `/api/goals`; identity link on normalized phone; phone verification; SMS gated on completion.

### Slice 3 — Today before Calendar, and the pace-card rail

**Repos:** `cedrus-backend` + `cedrus-miami`. **Goal:** the loop runs end to end with nothing connected, and every card is reviewed.

Scope: card/parts/outcome migrations; candidate detection and assembly with provenance tagged at read time; repurpose the existing opportunity-card admin queue for review; Today, `/card/$id`, `/progress`; outcome capture by tap and by SMS reply. **`BRIEF_DRY_RUN` stays `true`.**

### Slice 4 — Google Calendar, read-only

**Repos:** `cedrus-backend` + `cedrus-miami`. **Goal:** timing gets accurate for members who opt in, and nothing changes for members who do not.

Scope: connections/tokens/availability migrations with hand-written grant post-checks; OAuth start and callback; pre-consent screen; free/busy sync job; Today's inference-to-known transition; connection controls and disconnect; `/privacy` updated **before** ship.

---

## 30. Acceptance criteria

### Slice 1

- A signup that fails at any step leaves **no orphan contact**. Proven by forcing a failure at each of the four steps and asserting row counts before and after.
- Every consent write binds and checks `error`. Proven by a **mutation test**: break the insert, watch the path report failure; restore.
- `grep -rn "2026-08-21\|August 21\|workday" src/` returns **zero** hits in shipped copy.
- No countdown, no counter, no seat, no position, no `Event` JSON-LD on `/`.
- The confirmation email contains no date, no venue, no seat, and renders correctly in a mobile client.
- Lighthouse mobile: no horizontal scroll at 360px; primary CTA reachable in the bottom third; tap targets ≥ 44px.
- Shell routes render, are reachable, and **each says in plain words that it is not finished**. No placeholder data anywhere.
- `resend-webhook.ts` reads its secret through `getEnv()` and **returns a non-200 when unconfigured**, so a misconfiguration is visible rather than swallowed.
- `contacts.email_permission` exists, is backfilled from `consent_events`, and the backfill's row counts are asserted before, inside the transaction, and after.
- `bun run build` exit 0, `bun run lint` exit 0 (baseline: 0 errors, 8 `react-refresh` warnings).
- **Nothing pushed. Nothing published.**

### Slice 2

- A stranger completes signup → onboarding → goals on a phone in under three minutes, with no operator help.
- Name is captured in its own explicit step and never inferred from prose.
- Each onboarding step persists server-side; a mid-flow reload loses nothing. Proven against the database, not the UI.
- Goals write with `origin='user_set'` and the correct `lane`; `getOpenGoals` (which feeds the brief, insights, and discovery) returns **exactly** what it returned before. A guard fails if the fixture is empty.
- Web signup and SMS resolve to one member record; the link is stored, not re-derived. Proven with a phone number in both formats.
- Backend battery `sh test/run-all.sh` gated on `echo $?`, on **merged main**, not in the worktree.

### Slice 3

- A card cannot be assembled without a goal; asserted by test.
- Every part carries its provenance kind, tagged at read time; a part with an unknown kind is dropped and the drop is logged.
- Cards render with the four kinds visually distinguishable.
- A card is delivered only after explicit approval. **Mutation-check the review gate: bypass approval and prove the suite goes red.**
- All four outcomes recordable by tap and by SMS; "did not" is one action.
- One card per member per day maximum, enforced server side.
- Card generation sits behind the rate limiter and the budget kill switch. Proven by tripping the switch and showing generation stops.
- `BRIEF_DRY_RUN` is still `true` at the end of the slice. Byte-check it.

### Slice 4

- The scope requested is the narrowest that returns free/busy. The exact scope string is recorded in the session report.
- No event title, description, location, or attendee is ever fetched. Proven by inspecting the **actual API response body**, not by reading the mapping code.
- Tokens are absent from every client bundle. Proven by grepping the built output.
- Disconnect revokes at Google, deletes tokens, and Today visibly reverts to pre-Calendar behaviour **and says so**.
- A broken or expired connection degrades to the pre-Calendar experience with a visible state, never a silent wrong-confidence one. Proven by expiring a token and observing the UI.
- `/privacy` describes the connection **before** it ships.
- Grants on `connection_tokens` verified by a hand-written post-check, not by the runner.

---

## 31. Repository, branch, tests, deployment, rollback per slice

**Standing rules for all four.** Isolated worktree per slice, branched from a verified-clean `main` (Law 1). Disjoint file ownership if any work runs in parallel (Law 9). Schema before code (Law 11). Every session reports the exact files it changed. **STOP before push; only Emil pushes (Law 5).** Every merge to main in every repo is a release (Law 6).

| | Slice 1 | Slice 2 | Slice 3 | Slice 4 |
|---|---|---|---|---|
| **Repo** | `cedrus-miami` | backend + miami | backend + miami | backend + miami |
| **Branch** | `feat/miami-founding-beta-shell` | `feat/onboarding-goals` | `feat/pace-card-rail` | `feat/calendar-readonly` |
| **Worktree** | `_worktrees/miami-founding-beta-shell` | `_worktrees/onboarding-goals-{be,miami}` | `_worktrees/pace-card-rail-{be,miami}` | `_worktrees/calendar-readonly-{be,miami}` |
| **Tests** | `bun run build`, `bun run lint`, manual mobile pass at 360/390/430px | backend battery on merged main + miami build/lint | backend battery + mutation checks on the review gate | backend battery + a real OAuth round trip in a dev project |
| **Deploy behaviour** | Push updates **preview only**; live needs a Lovable publish | Backend push = live in ~50s; miami preview only | Same | Same |
| **Rollback boundary** | Revert the branch. No schema change except the additive `email_permission`; the backfill needs its own reversal plan. | Revert code; `user_goals.lane` is additive and nullable, so leaving it costs nothing | Revert code; new tables are unread by old code, so leaving them is safe | Revert code, **and revoke tokens**. Reverting code does not un-authorize a connection at Google. |

**Rollback rules that apply everywhere.**
- **A revert of code is not a revert of schema, and a revert of schema is not a revert of data.** Name all three before starting.
- Additive nullable columns and unread tables are the cheapest rollback in this system. Prefer them.
- The one genuinely irreversible step in the whole plan is **slice 1's `email_permission` backfill**, because it writes to existing rows. It gets its own script with row-count assertions and Emil's explicit approval (Law 8).
- Slice 4's rollback has an external component: revoking at Google. Code reverting alone leaves a live grant.

---

## Appendix: audit evidence index

Every claim in section 25 and in the III.3 findings traces to a file read on 2026-08-04 from the three clean repos. No prod query was run and no live request was made, so **nothing here is evidence about the live database or the live site** (Lesson 2). Claims that need prod verification are marked as such in `CEDRUS.md` III.3.

| Claim | Evidence |
|---|---|
| Signup is four un-transacted round-trips | `cedrus-miami/src/lib/cedrus.functions.ts:61,75,94,115` |
| Consent writes unchecked, two sites | same file `:94`, `:245` |
| `consent_events` timestamp is `occurred_at` | `supabase/migrations/20260731003901_*.sql` |
| `position` unquoted | both migrations, `MAX(position)` and the INSERT column list |
| `process.env` in three files, one live | `grep -rn "process\.env" src/` |
| `client.server.ts` / `auth-middleware.ts` have no importers | `grep -rn "supabaseAdmin\|client\.server\|requireSupabaseAuth" src/` |
| No `waitlist` table reference in code | `grep -rni waitlist src/ supabase/` |
| Live counter renders "N seats held" | `src/components/WaitlistCounter.tsx:27` |
| Live countdown to 2026-08-21 | `src/components/CountdownTimer.tsx` + `src/lib/config.ts:eventDate` |
| August 21 in six places | `config.ts`, `cedrus.functions.ts:118,266`, `index.tsx:50`, and two schema defaults |
| Unsubscribe records but does not enforce | `cedrus.functions.ts:217-256` + `contacts` column list |
| Position race fixed | `20260731105004_registration_position_race.sql` |
| No calendar/OAuth in backend | `grep -rniE '\bcalendar\b\|oauth\|googleapis\|google' src/` |
| No Today surface in backend | `grep -rniE '\btoday\b' src/` |
| Goals infrastructure | `src/services/goals.js`, `src/routes/api/goals.js` |
| Onboarding steps | `src/services/onboardingAnswers.js:28` |
| Phone format mismatch | `users.js:6-24` + `cedrus-miami/src/lib/cedrus.ts:parsePhoneE164` |
| No location column on `app_users` | `src/services/discovery.js:342` |
| Two visual systems | `cedrus-frontend/src/styles.css` vs `cedrus-miami/src/styles.css` |
