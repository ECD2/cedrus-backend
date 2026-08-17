# CEDRUS

**The single source of truth. Frozen 31 July 2026. Part I revised 4 August 2026 (the reboot). Change only by explicit decision, recorded with a date.**

This document replaces `CEDRUS_V1_MASTER.md` and `CEDRUS_OPERATING_DOCTRINE.md`. `CEDRUS_V1_SPEC.md` is **retired**: it describes a superseded product direction and must not be read as canon.

**2026-08-04.** Part I was reconciled with the approved connected, goal-aware product direction. Every changed decision is recorded with its prior wording in **Part I section 22**. **Part II was not touched and is byte-for-byte unchanged.** Part III was corrected only where an audit of current `main` produced direct evidence, and each correction names that evidence. The working documents for the reboot are `docs/CEDRUS_REBOOT_PLAN_2026-08-04.md` (product, UX, architecture, reuse matrix, language audit) and `docs/NEXT_BUILD_PROMPT_CEDRUS_MIAMI.md` (the first implementation slice). Neither is canon. Where they disagree with this file, this file wins.

---

## How to read this document

**Do not read all of it every time.** It is in three parts, and most sessions need one or two.

| You are | Read |
|---|---|
| Emil, or a session doing product, strategy, or copy | **Part I** |
| A session about to write, review, push, or merge code | **Parts II and III** |
| A session touching a repo for the first time | **Part III first**, then II |
| A session debugging anything | **II.4** (lessons) and **II.5** (verified environment facts) *before* forming a hypothesis |
| Anyone about to publish something public | **Part I section 13**, the language doctrine |
| A session adding or widening any connection | **Part I sections 18 and 19**, plus section 7. Widening a calendar scope changes a trust promise and needs Emil, not a code review. |
| A session building anything a member will read as advice | **Part I section 20**, pace cards. The four kinds of statement must stay distinguishable. |

Every session prompt should name which parts to read. A prompt that says "read CEDRUS.md" and nothing else is a bad prompt.

### Status labels

Nothing in Part I is a requirement unless it says LOCKED.

| Label | Meaning |
|---|---|
| **LOCKED** | Build it and communicate it now. Do not relitigate. |
| **TEST** | A hypothesis. Build the smallest version that produces evidence. |
| **LATER** | Directionally right, not in the founding release. |
| **NOT NOW** | Explicitly prohibited until the validation gate is passed. |

Part II has no labels. Sections II.0 through II.4 are law. Sections II.5 through II.7 are the verified record — facts, open flags, and history — and are corrected in place when reality moves (Law 12).

---

# PART I. THE COMPANY

What we are building, for whom, and in what words. Read by humans and by any session doing product or copy work.

**Revised 2026-08-04 (the reboot).** Sections 1 through 17 were reconciled with the approved connected, goal-aware direction. Sections 18 through 22 are new. Every decision that changed is recorded in section 22 with its prior wording and the reason it moved. Nothing was silently deleted. Part II was not touched.

## 1. The company in one line

> Cedrus keeps your day on pace with what you said matters.

**Status: LOCKED as the orienting definition. NOT approved as public copy.**

This is the sentence every decision gets checked against. It is not a headline. Public wording goes through the language doctrine in section 13, where the current public company line is under audit.

A longer internal formulation, useful when the one liner is too compressed:

> Cedrus connects what matters to you with the time and opportunities your real day actually has.

**What Cedrus is not.** Not a generic AI assistant, not a chatbot with a Miami accent, not a productivity tracker, not a fitness app, not an events company. The difference is that Cedrus holds two things at once: what you said you wanted, and what your day actually looks like. A generic assistant answers the question you typed. Cedrus notices the question you did not type, because it knows what you are trying to do this month and how much of today is still unspoken for.

**Geographic line: use "Built for Miami" in marketing.** "Built for life in Miami" reads well in a document and reads long on a page. The short version is the CTA version.

**Prior version, replaced 2026-08-04:** "Cedrus helps you have a better day. Find where to go, who to meet, and what to do." It survives as a candidate public line in section 13, where it is classified REVISE. It was demoted from the orienting definition because it describes a directory of options rather than a system that tracks whether the day moved.

---

## 2. The wedge and the expansion

**Tagline (LOCKED):**

> Have a better ~~remote~~ day.

The strikethrough is not decoration. It encodes the expansion path: a better remote day first, a better flexible week next, a better day eventually.

**Written down so it never gets forgotten:** remote work is the acquisition wedge and the first recurring use case. It is not Cedrus's permanent market boundary.

**Geography (LOCKED):** Built for life in Miami. Miami only, on purpose. No second city until Miami passes its gate.

Unchanged by the reboot. The wedge was never the problem.

---

## 3. The business engine

This is the mechanism by which Cedrus becomes more valuable over time. Every feature should serve one of these steps.

1. The landing page attracts Miami remote and hybrid workers.
2. Onboarding and a small number of stated goals give Cedrus usable context about each member.
3. Today and the SMS assistant create value for one member, alone, on day one, with no other members and no connected accounts.
4. Authorized connections (Calendar first) make that value better targeted, because Cedrus stops guessing at when the day is actually open.
5. Confirmed outcomes ("that helped", "I did it", "not today") teach Cedrus which suggestions are worth making again.
6. Manual fulfillment by Emil exposes repeated demand before anything is automated. What he ends up doing by hand twice a week is the next feature.
7. Lightweight Miami experiments test real world needs cheaply, without committing to a recurring hosted event.
8. Optional physical activations run only where evidence already shows demand.
9. Accumulated usage improves Places, People, Plans, and Progression for every member.
10. Network utility emerges after individual utility works, never before.
11. Membership monetizes recurring utility first and access second.

**The load bearing change, 2026-08-04.** Step 4 of the previous engine was "Cedrus workdays create reliable local activity that does not depend on density," and the whole engine rested on it. It has been removed as a required step. **Cedrus must be useful during a week in which Emil hosts nothing.** If the engine only turns when a founder is standing in a room, it is an events business with software attached.

The assistant serves the member. Accumulated member outcomes improve the assistant. The local network improves both, later.

---

## 4. Places, People, Plans, Progression

**Status: LOCKED as the product system.** If a proposed feature does not sit under one of these four, it does not get built. The four names are unchanged. What they mean was widened on 2026-08-04, because the previous definitions assumed a hosted workday and a relationship graph that the product no longer leads with.

**Places.** Where the user's day could happen. Uses Miami context, stated preferences, weather, neighborhood, schedule constraints, and what worked the last time. Not a directory. A place only surfaces when it fits a specific window in a specific day.

**People.** Existing relationships the user tells Cedrus about, opted in Cedrus members, and specific approved introductions when they are actually relevant. Governed entirely by the trust law in section 7. Cedrus does not introduce anyone to anyone in the founding release.

**Plans.** The next realistic action Cedrus can suggest, prepare, or help schedule. Realistic is the operative word: a plan that does not fit the time the user actually has is not a plan, it is a suggestion that produces guilt.

**Progression (LOCKED as a founding concept, TEST as an implementation).** Whether the user's real days are moving toward the goals, relationships, places, routines, and experiences the user selected. Progression is the answer to "is this working," and it is what separates Cedrus from a recommender.

Progression explicitly does not count: opening the app, app use streaks, messages sent, screens viewed, tasks checked off solely inside Cedrus, or arbitrary wellness scores. It counts confirmed movement in the real day.

**Changed 2026-08-04.** Progression was LATER and explicitly deferred ("For the first 25 members it stays conceptual. The garden does not get built yet."). It is now a founding concept because the reboot makes progression the product's core claim rather than a reward layer. The *garden visualisation* stays unbuilt. Progression in the founding release is a small honest record of what was suggested, what the user did, and whether it helped.

---

## 5. The initial customer

**Status: LOCKED.**

Remote and hybrid workers in Miami-Dade, roughly 25 to 40, with flexible weekday hours and disposable income, who want more out of the days they already control.

Not: people who commute to an office five days a week, or people outside Miami.

People who explicitly want to meet new people are **in scope and welcome**. Cedrus does not introduce anyone to anyone yet, and the trust law governs how it ever will, but wanting a fuller social life is a reason to join rather than a reason to be filtered out.

**Clarified 2026-08-04.** Attendance at a hosted Cedrus workday is **not** part of this definition and never was a filter. The previous founding release made attendance the main event, which quietly narrowed the customer to "people who will come to a thing on a Friday." The customer is a person with a controllable day, whether or not they ever meet Emil in person.

---

## 6. The founding release

Eight things. This replaces the previous five item release and its 21 August deadline.

Nothing here is gated on a hosted event, a venue, or a date.

### 6.0 Fix the door (PREREQUISITE, not a feature)

Carried forward unchanged in intent, and still true. No stranger can complete a path into Cedrus today. Web onboarding wrote answers to browser storage without sending them, the phone step was suppressed by a dry run flag, and texting START returns a returning-user reply that skips the onboarding script. Every item below is untestable until a real stranger can get in. The 2026-07-29 work (`POST /api/onboarding/answers`, `GET /api/me`) built part of this and **is pushed, and therefore deployed** (Law 6).

**Corrected 2026-08-05 (Law 12).** That sentence previously read "is unpushed, so it is not live." Evidence for the correction: `main == origin/main @ 6723c0a`, observed 2026-08-05. Two things this does *not* change: the endpoints being live does not open the door, because the frontend surface that would call them is still mock-wired on `main`, so this prerequisite stands unmet; and live-deploy confirmation against Railway logs is still owed, because a ref comparison proves the code was shipped, not that it is running (Law 10).

### 6.1 cedrus.miami landing and join flow (LOCKED)

Mobile first. The new positioning, the wedge, one sourced proof point, an honest description of what Cedrus does on day one, and a form collecting name, email, and phone with separate email and SMS consent. Stored in Supabase.

Naming honesty rule (unchanged): if a person can complete a profile and use Cedrus, the button says join. If they cannot access anything yet, it is a waitlist and it says so.

### 6.2 Fast onboarding and profile (LOCKED)

Neighborhood, remote or hybrid schedule, the windows in the week that are usually flexible, where they like to work, what they are into, what they want from Cedrus, openness to member introductions, phone verification. Every screen is one tap or one short answer. Only name and phone are required.

### 6.3 A small number of user-selected goals (LOCKED)

At most three at first, one per lane:

- one work goal;
- one people or social goal;
- one body, activity, or personal goal.

Three is a ceiling, not a quota. One goal is a valid profile. The lanes exist so Cedrus can tell "I want to ship the beta" apart from "I want to see friends more than once a month," which are reconciled against the day very differently.

### 6.4 Gated SMS assistant (LOCKED)

Unlocked after onboarding. **Open input, narrow promise.** Accepts any text. Reliably handles a small set of jobs: find somewhere to work, suggest what to do with an open window, help make or schedule a simple plan, record what actually happened, and answer questions about the user's own goals and progress. Anything outside that gets an honest answer and a logged request. It is never positioned as a general assistant.

**Configurable tone (LOCKED as intent, TEST as implementation).** Unchanged: a member tells Cedrus how to talk to them, in their own words, and it does. Presets are a shortcut to evidence, not the destination.

Compliance and safety responses are never tone shifted. STOP, HELP, and anything touching a person in distress stay in a fixed register regardless of setting.

**Removed from this list 2026-08-04:** "find Cedrus workdays and local activity" as a *named reliable job*, and the fifth job added by section 15 ("read the admin and community calendar in order to answer questions about upcoming events"). Both existed to serve a recurring hosted workday that is no longer LOCKED. Event questions still get an honest answer and a logged request like anything else. If activations resume, the job comes back with them.

### 6.5 Google Calendar read-only availability connection (LOCKED as the first connection, TEST as a demand hypothesis)

Full scope and boundaries in section 19. Read-only, least privilege, availability first. **Not a prerequisite for the first useful experience.**

### 6.6 Mobile-first Today (LOCKED)

The member's home surface. Small. It answers, for today specifically:

- what is the state of my day;
- what is the one thing Cedrus suggests I do with it;
- did the thing I said I would do actually happen.

Today must be useful **before** Calendar is connected. See section 6.9.

### 6.7 Manually reviewed pace cards (LOCKED)

A pace card is the unit of Cedrus's output. Definition and rules in section 20. In the founding release **every card is reviewed by Emil before it reaches a member.** Manual review is the point, not a limitation: it is how the repeated jobs get discovered before anything is automated.

### 6.8 Clear privacy and connection controls (LOCKED)

A member can see, at any time and in plain language, what Cedrus is connected to, what that connection can read, what it cannot, and how to disconnect it. Disconnecting takes one action and does not require a conversation. This ships **with** the first connection, not after it.

### 6.9 Today before Calendar

Today shows value on day one, with nothing connected. Before Calendar it may use:

- stated goals;
- user-reported plans and commitments;
- neighborhood;
- remote or hybrid schedule and the usual flexible windows;
- stated preferences;
- recent user messages;
- Miami context (weather, day of week, what is on);
- manual operator support.

**After Calendar connection** it may additionally use availability (free/busy) to place a suggestion in a window that is genuinely open, and to stop suggesting things into a wall of meetings.

**The rule: Calendar improves timing. It does not unlock the product.** A member who never connects anything must still get a useful Today. If Today is empty without Calendar, the connection is carrying weight the product should be carrying.

---

## 7. Trust law

**Status: LOCKED. This is doctrine, not preference. No session invents its own answers here.**

Unchanged by the reboot except for item 9, which is clarified rather than weakened, and item 10, which is new and follows from connections.

1. No passive or continuous location sharing.
2. Map activity represents explicit RSVPs, check ins, or venue level sharing only.
3. No fabricated activity counts, ever. If three people are going, it says three.
4. Introductions are double opt in.
5. Phone numbers are not revealed before both people consent, per introduction. A blanket setting at signup is not consent to a specific person months later.
6. Cedrus does not contact a person who is not a member. Cedrus may contact an existing member about a specific introduction only with the consent this law requires, and only at the initiating member's request.
7. Members control whether they can be recommended, and can turn it off at any time.
8. The founding beta exposes no browsable public directory.
9. **Exact calendars stay private.** Connected calendar data is used to understand *when the day is open*, never rendered back as a calendar, never used to build a picture of who the member meets, and never shown to another member in any form.
10. **Connected data is used only for the purpose the member authorized.** Data from one connection is not silently reused for an unrelated feature. A new use of already-connected data is a new authorization.

---

## 8. Later

Not in the founding release. Directionally right.

**Weekly pace report (LATER).** The natural successor to the Sunday brief now that email is no longer carrying event logistics. Personal rather than civic: what you said mattered, what your week actually held, what moved, and one thing to try next week. It ships only after pace cards have been running long enough that the report has something true to say. See section 15.

**Introductions (LATER, and gated by the trust law).** Not built in the founding release.

**The garden (LATER).** The visual expression of Progression. Progression itself is a founding concept (section 4); the garden is its eventual surface and stays unbuilt until there is real progression data to draw.

**Prior version, replaced 2026-08-04:** "Sunday brief (LATER) ... about Miami and the community, not about the individual ... Ships after 25 members exist." The civic brief assumed a community calendar and a hosted cadence. The personal pace report fits the new direction and does not depend on Emil hosting anything.

---

## 9. Explicitly not building

**Status: NOT NOW.** Written down so no session invents them.

Personal Google Calendar rendering or sync. Gmail integration. Any calendar write access, including autonomous event creation and autonomous meeting scheduling. A direct Strava or fitness-device integration. A public member directory. Direct phone number disclosure. Event hosting software. Payments and promoted events. Complex matching. A generic habit system. Multiple subscription tiers. An advanced garden. Multi city infrastructure. Member hosted events. A large dashboard.

Note on member hosted events specifically: at 100 members, three member hosted events draw four people each and all three read as dead. Emil is the concentrator until density can fill a member's event.

**Added 2026-08-04:** calendar write access of any kind, direct fitness integrations (see section 21), and a large dashboard. **Removed 2026-08-04:** nothing. Every prior prohibition still stands.

---

## 10. The founding test

**Replaces "The 21 day launch." Status: LOCKED as the shape. No date is locked.**

The previous plan was a three week countdown to a hosted workday on Friday 21 August 2026. That date is removed as a commitment. What replaces it is behavior driven: the founding test ends when the validation gate in section 11 is answered, not when a calendar day arrives.

**The August 21 workday was never a public commitment.** The test email went only to Emil. No venue was confirmed. No money was committed. Nobody outside the founder was promised a room. This is recorded so that removing it is understood as cancelling an internal plan, not breaking a promise. See section 22 for the full record, and III.3 for the code and schema that still encode the date.

### Phase 1. The door works
A stranger can join at cedrus.miami, complete onboarding, set at least one goal, and receive something useful. No hosted event required. No connection required.

### Phase 2. Cedrus is useful once
At least one member receives a pace card, acts on it or explicitly rejects it, and confirms whether it helped. This is the first real signal in the entire company.

### Phase 3. Cedrus is useful repeatedly
Members come back. Requests start clustering. Emil is doing the same manual thing more than twice a week, which names the next feature.

### Phase 4. The gate
Section 11, answered with evidence.

Customer contact happens every week regardless of phase. Without it, a behavior driven plan becomes an internal build cycle with no clock at all, which is a worse failure than a missed date.

---

## 11. The validation gate

Signups are acquisition data, not product proof. This was true before the reboot and is more true now that there is no event to count attendance at.

**A better day** is recorded when a member confirms Cedrus helped them do one of: work or spend time somewhere Cedrus suggested, make or keep a plan, spend time with another person, start or continue a recurring activity they told Cedrus mattered, or use a window of their day for something they said they wanted instead of letting it pass.

**The evidence the gate needs.** Each of these is a distinct measurable event, not a vibe:

- completed onboarding;
- at least one meaningful goal established, in the member's own words;
- useful context supplied manually, connected via Calendar, or both;
- SMS used at least once unprompted;
- a pace card delivered;
- a pace card acted on, edited, rejected, or deferred (all four are signal; only silence is not);
- a member confirming that Cedrus improved a real decision or a real day;
- return usage after the first week;
- repeated requests clustering around one or two jobs;
- willingness to pay, expressed unprompted or in a direct ask.

**The gate:**

- 25 people genuinely used Cedrus.
- 10 completed at least one better day.
- 5 returned and completed another.
- The most common unprompted SMS requests cluster around one or two repeatable jobs.
- At least some members express willingness to pay.

Nothing labelled LATER gets built until this passes.

**Changed 2026-08-04:** "attend a Cedrus workday" was one of the five ways to record a better day. It has been removed as a *required* path and folded into "make or keep a plan," so that a member who never attends anything can still complete a better day. The five gate thresholds are unchanged.

---

## 12. Membership hypothesis

**Status: TEST. Internal only. Not on the landing page.**

One membership. No tiers. **No price is locked in this session.** The previous $15 per month figure remains the internal starting hypothesis to test after the gate, and it is a hypothesis, not a decision.

It buys the daily utility first and access to the network second, because the utility works at one member and the network does not.

Public founding member language, finite by construction:

> Founding members join the beta free and help shape what Cedrus becomes in Miami. Major changes come directly from Emil.

---

## 13. Language doctrine

Every session that writes copy reads this section first. It overrides any earlier marketing document.

**Audited line by line on 2026-08-04.** The full audit, with prior wording and reasons, is in `docs/CEDRUS_REBOOT_PLAN_2026-08-04.md` section 26. This section carries only the *active* doctrine. A line that was retired is named here so nobody reintroduces it by accident.

### Approved lines

**Tagline (KEEP, LOCKED)**
> Have a better ~~remote~~ day.

**Badge pill above the hero (KEEP, LOCKED): `Building · Miami`.**

Honest about the stage, local, and it replaces the template's "Get early access," which promises access to something that does not exist yet.

**Miami (KEEP)**
> Cedrus starts in Miami because knowing what is actually happening here this week is half the product.

**Proof (KEEP)**
> Remote work gave you more control over your day. Cedrus helps you use it well.
>
> A 2026 study of 588,322 workers found that remote work increased time spent alone by 58%. Cedrus is built for the parts of the day that still need somewhere to go.

Source: Emanuel et al., "Home alone: Remote work, isolation, and mental health," Science, 2026. Link it wherever it appears.

**Founding member language (KEEP)**
> Founding members join the beta free and help shape what Cedrus becomes in Miami. Major changes come directly from Emil.

### Lines under revision

**Company line (REVISE, NEEDS EMIL DECISION).** The current approved public line is:

> Cedrus helps you have a better day. Find where to go, who to meet, and what to do.

It is still true and still usable, but it describes three lookups rather than the thing that makes Cedrus different, which is that it remembers what you said you wanted and checks whether the day moved. Candidate replacements, none approved:

| # | Candidate |
|---|---|
| A | Cedrus helps you have a better day. It knows what you are working toward, and what your day has room for. |
| B | Tell Cedrus what matters. It helps you fit it into the day you actually have. |
| C | Cedrus keeps your day on pace with what you said matters. |
| D | (keep the current line unchanged) |

Emil picks. Until he does, the current line stays approved and in use.

**Hero (REVISE, NEEDS EMIL DECISION).** The current locked waitlist hero is:

> # Have a better ~~remote~~ day.
>
> Have a better day with Cedrus. Where to go? Who to meet? What to do?
>
> **[ Join Cedrus Miami ]**
>
> Name. Email. Phone. That is all.

The H1 and the CTA are KEEP. The subheadline inherits the company line decision above and moves with it. "Name. Email. Phone. That is all." is KEEP and is doing real work: it is the honest answer to "what is this going to cost me."

### Headers under test

Approved for testing. Ranked by Emil, 1 is his current favorite. Run them, do not debate them. **Reduced from six to four on 2026-08-04**; the two retired lines are recorded in section 22.

| Rank | Header |
|---|---|
| 1 | Your local assistant for finding a place, making a plan, and meeting people in Miami. |
| 2 | Places to go. People to meet. Plans worth making. Built for Miami. |
| 3 | Ask where to work, what to do, or who wants to join. Cedrus helps you make the plan. |
| 4 | Cedrus brings together the places, people, and plans that can make today better. |

Note that 1 and 2 are different strategies, not different wordings. Number 1 sells an assistant, number 2 sells a life. Test one against the other first, before testing anything else.

**A fifth strategy is untested and NEEDS EMIL DECISION before it enters the rotation:** a header that leads with the goal-aware claim rather than the lookup claim. Example, not approved: "Tell Cedrus what matters this month. It helps you find the time." This is the only header that expresses the reboot, so testing it against number 1 is probably worth more than testing 3 against 4.

### Retired lines

Do not reuse these. Each is retired because it promises or implies a recurring hosted workday, a confirmed venue, or a date that no longer exists.

| Retired line | Was used for |
|---|---|
| The most remote day of the week. | The Friday workday angle |
| Four days in. One day with us. | The Friday workday angle |
| Friday is everyone's remote day. Let's use it. | The Friday workday angle |
| Find a better place to work and people to spend the day. | Header under test, rank 4 |
| Text Cedrus when you want to get out, find something to do, or meet people nearby. | Header under test, rank 6 |
| A better ~~remote~~ day is coming. | Email 1 opener. "Is coming" promises a dated arrival. |

The Friday angle itself (Friday is the most common work from home day for hybrid workers) is a **true and useful insight** and is preserved in section 15. Only the copy that sold a Friday *event* is retired.

### Trust statements

**Status: KEEP, all of them, strengthened rather than relaxed.** These are the public expression of section 7 and they are not negotiable in copy.

- Cedrus does not contact people who are not members.
- Introductions are double opt in, per introduction.
- Your exact calendar stays private. Cedrus uses it to see when your day is open, not to read your life.
- Connected accounts are used only for what you turned them on for.
- No fabricated activity counts. If three people are going, it says three.
- You can disconnect anything, at any time, in one action.

**Drafting rule for connection copy.** Say what Cedrus reads, say what it does not read, and say it in the same breath. "Cedrus reads when you are free. It does not read who you are meeting or what your events are called." A privacy claim that only lists what is safe is not a privacy claim.

**Do not write forever-promises.** Voice rule 3 already bans never/forever/always/guaranteed and it applies here with force. "Cedrus will never write to your calendar" is a trap: user approved event creation is an explicitly planned future test (section 19). Write the true present-tense version: "Cedrus does not create or change events." That is honest today and does not have to be broken later.

### Voice rules

1. **No em dashes.** Anywhere. Use commas, periods, or parentheses.
2. **No shame, diagnosis, or emotional manipulation.** Cedrus may name real friction. It never tells a reader that they are lonely, failing, behind, or socially unhealthy. Allowed: "working remotely can make ordinary human contact less automatic." Prohibited: "remote work is making you lonely."
3. **No ultra promises.** No never, no forever, no always, no guaranteed.
4. **Specific beats vague.** A time, a day, a neighborhood. Not "during the day" or "somewhere nearby."
5. **Short sentences.** If you run out of breath reading it aloud, cut it in half.
6. **Spanish the way Miami uses it.** One or two words inside an English sentence. Never a whole translated post unless a native speaker writes it.
7. **No statistic without a linkable source in the same place it appears.**
8. **Sentence case everywhere.** Never title case, never all caps.
9. **Real people appear only with permission asked that day.**
10. **No implied progress.** Added 2026-08-04. Cedrus may state what a member did and what they said they wanted. It may not imply momentum that the record does not support. "You have worked from three new places this month" is allowed if it is true. "You are building great habits" is not, because Cedrus cannot know that.

### Banned words

Seamless, unlock, elevate, curated, journey, empower, revolutionize, game changing, effortlessly, at scale, leverage, reimagine, meaningful connections, AI powered.

Note: "AI powered" is banned as marketing filler. Cedrus still discloses plainly that the assistant uses AI in product information, privacy materials, and FAQs. Transparency is not banned along with the cliché.

### Three questions before anything ships

1. Does this promise something Cedrus cannot do today? Kill it.
2. Does it contain a number without a source? Cut the number.
3. Would it make someone feel judged? Rewrite it.

**A fourth, added 2026-08-04:** does this imply a date, a venue, or an event that is not confirmed? Cut it.

---

## 14. Domains

**Status: LOCKED, and changed 2026-08-04.**

`cedrus.miami` is the **active** public and beta product surface. It is where the landing page, the join flow, onboarding, Today, and the product shell live.

`cedrus.life` is **dormant**. It is preserved and untouched. The app at `cedrus-frontend` still serves it and still holds `/terms`, `/privacy`, `/support` and `/sms`, which are registered with Twilio and must keep working. Do not modify, redesign, publish, or reactivate cedrus.life without an explicit decision.

**Eventual consolidation of the two domains is LATER and is not decided.** Neither direction is chosen. Do not build anything that assumes one.

**One practical rule, unchanged in spirit and updated in target.** Anything printed or hard to change later points at the domain that will still be there. Because consolidation is undecided, **print nothing** that hard-codes either domain until it is. Redirects get changed. Printed codes do not.

**Prior version, replaced 2026-08-04:** "`cedrus.miami` is owned. The Lovable waitlist page is built and pointed there for the 21 days. After launch, `cedrus.miami` redirects to `cedrus.life`, which stays the product home." The 21 days no longer exist, and the redirect direction is now an open question rather than a settled one.

---

## 15. Campaigns and email

**Status: the infrastructure and consent rules below are LOCKED. The event sequence is RETIRED.**

Voice rules in section 13 apply to every word of it.

### Email's new role

Email was carrying event logistics for a workday that is no longer happening. Its new job is smaller and permanent:

1. **Transactional confirmation.** A person joins, and receives one honest email saying what they joined and what happens next. No date, no venue, no seat, no countdown.
2. **Occasional founder notes.** What Cedrus is building, what changed, what Emil learned. Marketing, so it carries a clear unsubscribe.
3. **The weekly pace report (LATER).** Section 8. The eventual reason email exists at all.

Email is **not** the product surface and is not on the critical path for the founding release. SMS is the assistant; the web is the home.

### Email stack

**Status: LOCKED. Resend. Not SendGrid, despite Twilio already being in the stack.**

The one vendor argument for SendGrid is weaker than it looks. SendGrid's Email API and Marketing Campaigns are two separately priced and separately billed products, so consolidating under Twilio does not actually buy one integration or one bill. Meanwhile SendGrid's permanent free plan was eliminated in 2025 and replaced with a 60 day trial at 100 emails per day, after which Essentials starts at about $19.95 a month, and the free Marketing Campaigns tier caps at 100 contacts, which this list will pass quickly.

Resend keeps a free transactional tier, prices marketing by stored contacts with unlimited broadcasts inside the tier, which is exactly the shape of a small list emailed often, and integrates natively with Lovable through a Supabase edge function.

Twilio stays the SMS provider. Resend becomes the email provider. Two vendors, each doing the thing it is best at.

**The full stack, by responsibility.** Human inbox and replies: Purelymail, read through Outlook. Outbound transactional and marketing email: Resend. SMS assistant and text campaigns: Twilio. Permanent customer, consent, and activity records: Supabase. One Cedrus brand to the customer, specialized systems underneath.

**Sending identity: send from a subdomain.** From `Emil from Cedrus <emil@updates.cedrus.life>`, reply-to `emil@cedrus.life`. The subdomain isolates campaign reputation from the mailbox Emil actually reads, and it means the Resend DNS records never touch the root SPF record that Purelymail uses. Replies still land in the normal inbox.

**Open item created by section 14.** The sending identity is on `cedrus.life` while the active product is on `cedrus.miami`. That is a deliverability decision, not just a cosmetic one: `updates.cedrus.life` is the verified, warmed sending domain and moving it is not free. **Do not move it as a side effect of the domain change.** Filed in section 17.

**Non-negotiable setup before the first send.** Verify `updates.cedrus.life` in Resend, which supplies SPF and DKIM, then add a DMARC record. Unauthenticated mail from a new domain lands in spam, and the campaign fails silently while looking like disinterest.

### List ownership and consent

**Status: LOCKED. Unchanged by the reboot. These rules exist because this list is a permanent asset, not a one campaign artifact.**

1. **Supabase is canonical. Resend is a delivery projection.** Contact and consent data flows Supabase to Resend. Delivery events, bounces, complaints, and unsubscribes flow back from Resend to Supabase through verified webhooks, because only Resend knows them. Supabase contact IDs are the primary keys; no provider ID is ever a primary key. If the provider changes, the list, the consent history, and the suppression state are already ours.
2. **Record consent at signup:** timestamp, IP address, and the exact wording the person agreed to. This is the defensible record if a complaint ever arrives.
3. **Separate transactional from marketing, and record email and SMS consent separately.** The signup confirmation is transactional: its primary purpose is confirming the action, so it carries a small "manage email preferences" link rather than a prominent unsubscribe. Everything about what Cedrus is building, product news, and the weekly pace report is marketing and must carry a clear unsubscribe.

**SMS consent is a compliance requirement, not a preference.** Twilio requires consent for A2P messaging to be affirmative, separate from general terms, and unchecked by default, with the message type, frequency, message and data rates language, STOP instructions, and links to terms and privacy. Bundled or preselected consent causes campaign rejection, which would take the assistant offline. Email and SMS therefore get two separate checkboxes on the form, and both are recorded as distinct consent events.
4. **Use Resend's own unsubscribe mechanism.** Do not build a parallel custom one alongside Resend's marketing contacts. Every broadcast carries Resend's unsubscribe link; the resulting webhook updates Supabase.
5. **Never buy, scrape, or import a list.** Every address arrives because a person typed it into the form.
6. **Bounces and complaints are suppressed permanently** and never retried. Sending to a hard bounce twice is how domain reputation dies.
7. **Every broadcast filters against current Supabase permission state before sending**, not against whatever Resend last knew.
8. **Export the full contact and consent state periodically**, so a provider outage or account problem is never a data loss event.

**Open compliance gap, found 2026-08-04.** Rule 7 is not currently satisfiable. The unsubscribe path writes a `consent_events` row with `action='withdrawn'` and there is no column anywhere recording current permission state, so "current Supabase permission state" cannot be read, only derived by replaying the event log. There is no broadcast sender today so nothing is being violated, but this must be closed before the first marketing send. See III.3 and section 17.

### The Friday insight (KEEP)

Friday is the single most common work from home day for hybrid workers. That is a real fact about the customer and it survives the retirement of the Friday workday. It is now a **targeting and timing** insight rather than an event hook: Friday is the day with the most reclaimable time in it, which makes it the best day for a pace card and the best day to acquire.

### Retired: the event sequence

The six email sequence, the held/confirmed/declined/expired seat model, the 50 person cap, the invisible cap rule, the provisional seat rule, the day-14 reminder, the QR check in, and the launch SMS are **all retired** as an active plan.

They are not deleted from the record. They are preserved in section 22 and in `docs/CEDRUS_REBOOT_PLAN_2026-08-04.md`, because the *mechanism* was sound and will be reusable if a physical activation is ever run again. What made it wrong was that a whole product depended on it.

**The cap is invisible** and **no fabricated counts** were the two rules protecting the user in that design. Both survive as general law: the first is folded into section 20 (a pace card never manufactures urgency) and the second is trust law item 3.

**Note for the audit:** the live cedrus.miami page currently violates the invisible cap rule. See III.3.

---

## 16. Evidence ledger

Conviction and evidence are different things. This table keeps them separate.

| Claim | Status |
|---|---|
| Remote workers spend substantially more time alone | Externally supported (Science, 2026) |
| Miami has high remote worker density | Assumed, needs a source before public use |
| Remote workers want place recommendations by text | Unvalidated |
| ~~They will attend a recurring Cedrus workday~~ | **Retired 2026-08-04.** Not being tested. Was never tested: no venue, no public invitation, one recipient. |
| Open ended SMS will reveal one or two repeatable jobs | Test hypothesis |
| Members will want introductions to other members | Unvalidated |
| Members will pay | Unvalidated. Price not set. |
| Configurable tone is a differentiator people talk about | Unvalidated |
| **People will state goals honestly to an assistant they just met** | **Unvalidated.** New 2026-08-04, and it is the reboot's first dependency: the whole product assumes the member tells Cedrus what matters. |
| **A goal-aware suggestion beats a generic one** | **Unvalidated.** New 2026-08-04. This is the core product claim and nothing yet tests it. |
| **People will connect a calendar to a two week old product** | **Unvalidated.** New 2026-08-04. This is why Today must work without it. |
| **People will report back whether something helped** | **Unvalidated.** New 2026-08-04. Progression is unmeasurable without it. |

Anything marked unvalidated may appear in internal planning. It may not appear in public marketing as though it were established.

---

## 17. Open decisions

Recorded here rather than assumed by whoever touches the file next. Items marked NEW are from the 2026-08-04 reboot.

- Which stat leads on the landing page, and whether it appears above or below the fold.
- The final button copy on the join flow.
- Whether the Instagram account launches before or after the landing page goes live.
- What happens to the existing `/classic` app once founding members are onboarded.
- **NEW.** The public company line and hero subheadline: candidates A to D in section 13.
- **NEW.** Whether the goal-aware header enters the test rotation, and against which incumbent.
- **NEW.** Brand and visual direction. cedrus.miami is dark, DM Sans, glass and orbs. cedrus.life is warm, cream and olive, Cormorant Garamond. These are two different companies visually and one has to win.
- **NEW.** Which domain is the long term home, and therefore which way the eventual redirect points.
- **NEW.** Whether the Resend sending identity stays on `updates.cedrus.life` now that the product is on cedrus.miami.
- **NEW.** Whether SMS identity and web identity are the same account from day one. See the reboot plan section 15.
- **NEW.** Whether the existing `event_registrations` table and its August 21 rows are migrated, archived, or left in place.
- **NEW.** Price. Not set, and deliberately not set in this session.
- ~~The venue and exact time for the 21 August workday.~~ **Closed 2026-08-04, not decided but no longer needed.** There is no committed workday.

---

## 18. Connector doctrine

**Status: LOCKED. New 2026-08-04.**

Connections are inputs. They are not the product. A member who connects nothing must still have a working Cedrus, and a member who connects everything must not have given anything away that Cedrus does not use.

Every connector, without exception:

1. **Explicit authorization.** The member turns it on, knowing what it does. No connection is implied by signup, by another connection, or by continued use.
2. **Least privilege.** Request the narrowest scope that supports the outcome. If a narrower scope exists and costs a feature, drop the feature first and reconsider.
3. **Narrow scope.** One authorized purpose per connection, stated in plain language before the member approves it.
4. **Read-only before write.** No connector gets write access in its first version. Write access is a separate, later, separately justified decision with its own evidence.
5. **No speculative collection.** Cedrus does not read data because it might be useful later. If no shipped feature consumes it, it is not read.
6. **No connector because it is technically possible.** A connector earns its place by supporting a demonstrated user outcome, and the outcome comes first.
7. **Provider policy must permit the exact intended use.** Read the terms for the specific scope, not the general developer policy. A use that a provider forbids is not a use, however technically available.
8. **No silent cross-purpose reuse.** Data from one service is not reused for an unrelated purpose. A new purpose requires new authorization.
9. **Sensitive data stays unavailable unless a defined user outcome needs it.** Health, location history, message content, and contact graphs are not read by default.
10. **Disconnection is one action and is honored immediately.** Stored derived data is deleted or clearly disclosed. A member who disconnects and sees their data still in use has been lied to.

**The test before adding any connector.** Name the user outcome. Name the smallest scope that produces it. Name what breaks if you do not have it. If the answer to the third is "nothing yet," do not build it.

---

## 19. Google Calendar, the first connection

**Status: LOCKED as the first connection. TEST as a hypothesis about demand. New 2026-08-04.**

Calendar is first because time is the constraint that makes every other suggestion real or unreal. Cedrus does not need to know what a member is doing at 2pm. It needs to know that 2pm is not available, and that the 90 minutes after it are.

### Founding scope

- explicit user authorization;
- least privilege;
- **read-only**;
- availability, free/busy, first;
- no full personal calendar rendered inside Cedrus;
- no event-description ingestion unless separately justified and separately approved;
- no attendee harvesting, ever, in any form;
- no Gmail integration;
- no autonomous event creation;
- no autonomous meeting scheduling.

### What Cedrus may conclude from it

That a window is open, that a window is not open, that a day is heavily booked, and that a member's usual free windows do or do not match what they told Cedrus during onboarding. Nothing else.

### What Cedrus may never do with it

Render a calendar. Show it, in any form, to another member. Infer who a member meets. Infer where a member is. Store event titles, descriptions, locations, or attendees. Use it for anything other than placing a suggestion in time.

### Later, separately

**User approved creation of one specific event may be tested as its own piece of work, with its own scope request, its own consent moment, and its own evidence.** It is not in the founding release, and it is not implied by the read-only connection. A member approving each individual event is the only version of this that will ever be considered.

### Boundary that follows from the trust law

Trust law item 9 says exact calendars stay private. The read-only availability scope is the technical expression of that promise, which is why the scope is doctrine and not an implementation detail. **A session that widens the calendar scope has changed a trust promise and needs Emil, not a code review.**

---

## 20. Pace cards

**Status: LOCKED as the definition. TEST as the implementation. New 2026-08-04.**

A pace card is the unit of Cedrus's output and the thing a member actually sees. It is a transparent, bounded recommendation connecting four things:

1. **what the user said matters** (the goal, in their words);
2. **what has happened** (what Cedrus knows or was told);
3. **available time** (the window this fits in);
4. **the next realistic adjustment** (one action, sized to the window).

### The four kinds of statement, and they must be distinguishable

A pace card must make clear, in the card itself, which of these each claim is:

| Kind | Meaning | Example phrasing |
|---|---|---|
| **Known fact** | Cedrus has a record of it | "You set a goal to swim twice a week." |
| **User-reported fact** | The member told Cedrus, unverified | "You said you swam on Tuesday." |
| **Inferred context** | Cedrus worked it out and could be wrong | "Thursday afternoons usually look open for you." |
| **Proposed action** | The suggestion | "Want to put a swim in Thursday at 4?" |

Collapsing these is the single most damaging thing a pace card can do, because a confident wrong inference presented as a known fact teaches the member that Cedrus does not know the difference. That is unrecoverable in a product whose whole claim is that it is paying attention.

### Rules

- **Never overstate certainty.** An inference is offered, not asserted. "Usually," "looks like," and "if that is still right" are correct language, not hedging.
- **One card, one action.** A card proposing three things is a list, and lists get ignored.
- **Sized to the window.** Do not propose a two hour thing into a 40 minute gap.
- **Rejectable without friction.** No, not today, and not ever are all first class answers, and all three are signal.
- **No manufactured urgency.** No countdowns, no scarcity, no "only today." This is the invisible cap rule from section 15, generalized.
- **No implied progress.** Voice rule 10.
- **Every card is reviewable.** In the founding release, Emil reviews each one before it is delivered. The review queue is the research instrument.

### What a pace card is not

Not a notification. Not a nudge in the habit-app sense. Not a task. Not a streak. Not a reminder the member set for themselves, which is a different feature that already exists.

---

## 21. Fitness and activity

**Status: LOCKED as a boundary. New 2026-08-04.**

**No direct Strava or fitness-device integration in the founding release.** Activity context is entered manually by the member, in their own words, when it is relevant.

Cedrus may coordinate a member-selected activity goal with the time their day actually has. That is the whole job.

**Cedrus must not make:**

- medical claims;
- injury assessments;
- clinical recommendations;
- recovery prescriptions;
- training prescriptions inferred from isolated activity data.

**The product distinction, internal.** A fitness app understands a workout. Cedrus understands where that workout fits in the rest of the day. That is a genuinely different job and it is why an integration is not urgent: Cedrus does not need to know a member's heart rate zones to know that they said they wanted to run three times a week and have run once.

**Status of the phrasing: internal only.** It is a clean articulation and it is not approved public copy. If it is wanted publicly it goes through section 13 like anything else.

---

## 22. Part I changelog

Product decisions change. The record of why does not. Append here; never overwrite.

### 2026-08-04, the reboot

**What happened.** The founding release was rebuilt around a connected, goal-aware assistant. The recurring hosted workday was removed as the business engine. The dated launch was replaced with a behavior driven founding test. Google Calendar became the first connection, read-only. Part II was not touched. Part III was corrected only where the current-main audit produced direct evidence.

**Decision: the recurring Cedrus workday is no longer LOCKED.**
- *Prior:* section 6.5, "One recurring Cedrus workday (LOCKED). Same weekday, same time, same general area. Hosted by Emil. This is the liquidity, manufactured by hand, once a week." Section 3 step 4 made it the engine.
- *Now:* physical activations are TEST only, and may be one-time, partner-supported, member-led, or demand-triggered. Cedrus must be useful during a week in which Emil hosts nothing.
- *Why:* the engine required a founder in a room every week. That is not a software business, it does not survive a week when Emil is sick or travelling, and it made every other feature untestable until an event happened. Founder judgment, not new external evidence.
- *Evidence:* none for or against. The hypothesis "they will attend a recurring Cedrus workday" was never tested. That is precisely the problem: an untested assumption was load bearing.

**Decision: the 21 August 2026 launch is removed.**
- *Prior:* section 10, "First Cedrus workday: Friday 21 August 2026," with a three week plan built around it.
- *Now:* section 10 is a four phase behavior driven founding test with no locked date.
- *Why:* the date was internal and was never a public commitment. The test email went only to Emil, no venue was confirmed, and no money was committed. Removing it breaks no promise to anyone.
- *Preserved:* the publishing rule that produced this outcome ("the date does not go on the public page until the venue is confirmed. A public countdown is a promise, and a broken one costs the list") was **correct and is kept**, generalized into section 13's fourth shipping question. Note the live page violated it; see III.3.

**Decision: Progression moves from LATER to a founding concept.**
- *Prior:* section 4, "Progression (LATER) ... For the first 25 members it stays conceptual. The garden does not get built yet."
- *Now:* Progression is the core claim and ships in a minimal honest form. The garden stays unbuilt.
- *Why:* the reboot's differentiation *is* progression. Deferring it defers the thing that makes Cedrus not a recommender.

**Decision: the four pillars keep their names and widen their meanings.**
- *Prior:* Places was "somewhere good to work today." People was "Cedrus workdays, and opt-in members." Plans was "ask Cedrus what to do, who to invite."
- *Now:* section 4. People no longer leads with workdays. Places is time-aware rather than a lookup.
- *Why:* two of the four were defined in terms of the retired event.

**Decision: connections enter the canon, Google Calendar first.**
- *Prior:* section 9 listed "Personal Google Calendar rendering or sync" as NOT NOW, with no connector doctrine at all.
- *Now:* sections 18 and 19. Calendar *rendering and sync* remain prohibited. Read-only availability is approved. These are not in conflict: the prohibition was on rendering a calendar, and it stands.
- *Why:* time is the constraint that makes a suggestion real. Without it every recommendation is a guess about whether the member is free.

**Decision: no direct fitness integration.**
- *Prior:* not addressed.
- *Now:* section 21. Manual entry only, and a hard boundary against medical, clinical, and training claims.
- *Why:* the outcome (fitting an activity into a day) does not require the data. Connector doctrine rule 6 applies directly.

**Decision: cedrus.miami is active, cedrus.life is dormant.**
- *Prior:* section 14, "After launch, `cedrus.miami` redirects to `cedrus.life`, which stays the product home."
- *Now:* cedrus.miami is the active surface. cedrus.life is preserved and dormant. Consolidation is LATER and undecided.
- *Why:* the redirect was tied to a launch that no longer exists, and the Miami-first positioning is stronger on the Miami domain.
- *Unaffected:* `/terms`, `/privacy`, `/support`, `/sms` on cedrus.life stay working. They are registered with Twilio and breaking them breaks compliance verification. This is a Part III preservation law and the reboot does not touch it.

**Decision: the event email sequence is retired, email's role shrinks.**
- *Prior:* section 15's six email sequence, the 50 seat cap, held/confirmed/declined/expired, the day-14 reminder, the QR check in, the launch SMS.
- *Now:* transactional confirmation, occasional founder notes, and a LATER weekly pace report.
- *Why:* every one of them delivered event logistics.
- *Preserved:* the entire list ownership and consent model (LOCKED, unchanged), the sending identity, the Resend over SendGrid reasoning, and the mechanism itself for reuse if an activation is ever run.

**Decision: no price is set.**
- *Prior:* "Initial price to test after the gate: $15 per month."
- *Now:* $15 is the internal starting hypothesis. No price is locked.
- *Why:* the product being priced changed. Re-locking a price for a different product would be inheriting a number rather than choosing one.

**Language decisions.** Six lines retired, two headers dropped from the test rotation, one new voice rule (no implied progress), one new shipping question (no unconfirmed dates or venues), and the company line and hero subheadline sent back to Emil. Full audit with prior wording in `docs/CEDRUS_REBOOT_PLAN_2026-08-04.md` section 26.

**Operating law unaffected.** Part II was not read for revision and was not edited. Every law, lesson, verified fact, and open flag stands exactly as written. In particular: Law 5 (STOP before push, only Emil pushes), Law 6 (push is deploy in all three repos), Law 7 (`.env.production` is sacred), Law 8 (migrations through the runner), and Law 12 (correct your own record) all govern the implementation work this reboot creates. The trust law in Part I section 7 was strengthened, not relaxed.

### 2026-08-05, the labs boardroom amendments to section 20

**What happened.** A boardroom session reconciled ten overnight labs against this document and produced a canonical contract catalog (`CANONICAL_CONTRACT_CATALOG_PROPOSAL_2026-08-05.md`, in the `planning/cedrus-labs-boardroom-2026-08-05` worktree). The labs had each invented their own vocabulary for the same concepts, largely because this revision existed only as uncommitted bytes and six of ten labs were briefed against a canon copy that did not contain sections 18 to 22. Three of the catalog's rulings are amendments to section 20 and therefore belong in canon rather than in a contract package. They are recorded here.

**These are additive precision, not a reversal.** Nothing in section 20 is withdrawn. The four statement kinds, the one card one action rule, the sizing rule, the rejectable without friction rule, the no manufactured urgency rule, the no implied progress rule, and operator review of every card all stand exactly as written.

**Decision: the pace card outcome vocabulary is fixed.**
- *Prior:* section 20 said "No, not today, and not ever are all first class answers, and all three are signal," and named no enum.
- *Now:* `outcome` is one of `did`, `did_something_else`, `did_not`, `deferred`, `silent`. `helped` is recorded separately and may be unanswered. A rejection carries a `scope` of `this_action` or `today`, and a `reason` of `wrong_thing`, `wrong_time`, `wrong_place`, or `unspecified`.
- *Why:* "not this" and "not today" are different member statements and the old prose collapsed them. One suppresses a strategy, the other defers a card. Recording silence as a value rather than a missing row is the same discipline: absence in a window too short to contain the event is Lesson 18's trap.
- *Source:* catalog item 8, from labs 01 and 02.

**Decision: the card lifecycle is fixed, and approval binds to content.**
- *Prior:* section 20 said every card is reviewed by Emil before it reaches a member, and named no states.
- *Now:* `draft` goes to one of `approved`, `edited`, `killed`, or `clarification_requested`; a clarification produces a **new** card linked to its parent rather than mutating the original. An approved or edited card goes to one of `delivered`, `delivery_failed`, or `delivery_unknown`. Approval binds a content hash over the card body and its provenance, delivery re-checks that hash and refuses on mismatch, and `delivery_unknown` is never promoted to `delivered` by the passage of time.
- *Why:* review is only a guarantee if what ships is what was approved. Hash binding makes that mechanical instead of procedural. Promoting an unknown delivery to a delivered one by waiting is the fabrication that trust law item 3 forbids, applied to delivery state.
- *Source:* catalog items 7 and 11, from labs 01, 02 and 06.

**Decision: the fourth statement kind is spelled `proposed_action`.**
- *Prior:* section 20's table names it "Proposed action" in prose only.
- *Now:* stored and transmitted as `proposed_action`.
- *Why:* two labs spelled it differently (`proposed_action` and `proposed`) and the disagreement was costing a rename at every port. Cheap either way, so it is decided rather than left open.
- *Source:* catalog item 1.

**Approved by Emil on 2026-08-05**, as decision (a) of the boardroom's consolidated decision list. The verbatim approval record is in the boardroom planning worktree's `EMIL_APPROVAL_BRIEF_SLICE_1_2026-08-05.md`. The same approval authorizes the canon reconciliation and the scoped Slice 1 implementation.

**What that approval explicitly does not authorize**, recorded here so no later session reads it wider than it is: push, deployment, publication, live migration, the `contacts.email_permission` backfill, widening the Calendar scope, beginning Slice 2, or altering Part II operating law. The existing rollback boundaries and stop conditions are preserved.

**Risk accepted, and written down because it is real.** This vocabulary becomes recorded doctrine before any member has produced a single outcome. If founding usage shows it is wrong, changing it is a decision recorded here plus a migration, not an edit.

---

# PART II. OPERATING LAW

How to work in these codebases without breaking them. Read by every session before touching code.

Sections II.0 through II.4 are law and carry no status labels. Sections II.5 through II.7 are the verified record: environment facts established against live prod, the open flags register, and the changelog. Facts can go stale and must be corrected in place when they do (Law 12); laws do not.

## II.0. How Emil works

Emil is a non-engineer solo founder building by conversation plus Claude Code. Adapt to that.

- **Plain English.** No jargon-first explanations. Say what happened, then what it means.
- **One thing at a time when debugging.** Do not present five hypotheses. Investigate the most likely one, report, then move.
- **A recommendation, not a menu.** If there are options, cost them honestly and then say which one you'd pick and why. "Your call" without a recommendation is work handed back.
- **Complete, copy-paste-ready prompts.** If the next step needs a new session, write the whole prompt. Don't describe what the prompt should say.
- **Celebrate real wins, then recenter.** Say what actually landed, then what's still open.

### Everything runs through Claude Code

This is the strongest preference and it is close to absolute.

- **Do not send Emil to a dashboard, SQL editor, or terminal to hand-run something.** If it can be done from a session, do it from the session. Railway CLI, the migration runner, direct pg access, log reads, env inspection — all of it is set up so he doesn't have to.
- **Do not hand back raw terminal commands** for him to paste. He runs and monitors sessions from his phone. Write the work as a session prompt; the agent runs the bash.
- **Exceptions are the irreversible actions only** — pushes, deploys, and anything the rules below reserve for him.

### The downloads workflow

When Emil is given a file (a doc, a config, a script, a spec), he downloads it to `~/Downloads` and nothing more. He does not move it, rename it, or place it.

**A session is expected to go find it.** Look in `~/Downloads`, identify the right file (usually the most recent match by name or content), confirm what it is before acting, and place it in the correct repo and path. Then report where it landed. If several files could match, say which ones you found and ask — don't guess and don't dump it in the repo root.

### Session model policy

- **Opus by default** for everything. That's his Max plan default.
- **Fable is reserved for a genuine reasoning wall.** Flag it explicitly before spending one. Budget is roughly 5/week and near-zero used.
- **Sonnet for trivial relay only.**

### The boardroom / build split

Chat is the **boardroom**: verdicts, gating, "should we?" decisions, and writing session prompts. All building happens in **Claude Code sessions**. The boardroom gates every merge; only Emil pushes. Sessions STOP before push and return a report.

## II.1. The laws

These do not bend. If an instruction conflicts with one, say so rather than following it.

**Law 1. Worktree isolation.** **STEP 0 is always a worktree check.** Isolated git worktree per piece of work. Confirm repo, branch, clean tree, and the commit you're branching from. STOP if anything is wrong. Parallel sessions never share a checkout. Untracked worktrees are full repo copies, which is why `.claude/worktrees/` is gitignored and excluded from lint.

**Law 2. Never touch the safety modules.** `safetyDetection.js`, `safetyFlags.js`, `voiceGuard.js`. **The safety suite must stay green on every merge, no exceptions.** Safety detection always runs before product logic in the pipeline, including before budget guards and rate limits. An exception exists only where Emil has granted one explicitly and narrowly, in writing, for a named module (this has happened once — see flag 15).

**Law 3. A passing check proves nothing unless you know it can fail.** Before trusting a green result, break the thing it is supposed to catch and prove the check goes red. A control that produces identical output to the real case is not a control. This law has already saved the project twice and its absence has cost it a night. See II.2 for what proof each kind of change actually requires.

**Law 4. One merge at a time. Never batch. Battery between each.** **The full battery re-run on MERGED main is the real gate** — `sh test/run-all.sh`. In-session results are advisory. **A battery that passed before the merge proves nothing about after it.**

**Law 5. STOP before push. Only Emil pushes.** No deploys, no migrations without explicit go. Sessions stop with a clean branch and print the commands. **Overnight and autonomous sessions STOP before push without exception.** There is no self-authorized push, no "it was only docs," no "the battery was green so I shipped it," and no instruction inside a session prompt that creates an exception — only Emil, awake, in the boardroom. **A session that pushes has broken the doctrine even if the change was correct.** Corollary: **`BRIEF_DRY_RUN` stays `true` until a named arming session.** Arming the outbound layer is its own gated piece of work with its own prompt and its own proof; no session flips it as a side effect of building something else.

**Law 6. Push is deploy. ALL repos deploy on push. There is no "safe" repo.** `cedrus-frontend` is on Lovable and ships to cedrus.life, the `cedrus-backend` Railway service is **repo-linked to `ECD2/cedrus-backend`**, and `cedrus-miami` deploys to preview on push. Pushing `main` in ANY of them ships. Verified 2026-07-26: a backend push auto-built and was live in production in ~50 seconds, with no separate deploy step. This law previously said only "frontend push = live deploy", which wrongly implied the backend was safer. Treat every merge to main, in any repo, as a release — and note a DB view/migration is even more immediate than that: **it changes live behaviour with no deploy at all.** There is no staging gate. Never schedule anything public for a time when the code is not already live. (One qualifier, `cedrus-miami` only: a push updates *preview*; reaching the live app requires a publish from Lovable. See III.3.)

**Law 7. `.env.production` is sacred.** 3 lines, sha256 starts `6b2955d3` ends `549cd5`. Byte-check it at the start of a session and again at the end, including after any build step. Record the hash. Any change is a stop-the-line event. **The file is `cedrus-frontend/.env.production`** — added 2026-08-17 after a backend session byte-checked it, found no such file in `cedrus-backend`, and had to go looking. `cedrus-backend` has no `.env.production` at all (its runtime env is Railway service variables, III.1), so a backend session that reads this law literally finds nothing and cannot tell "absent, as expected" from "someone deleted it." Verified present and unchanged 2026-08-17: `6b2955d352128dc609f7642640442cbc0e61b88711df37daa8f6b0c089549cd5`, 3 lines.

**Law 8. Migrations run through the runner**, never by hand: `node ~/.config/cedrus/migrate/run-migration.mjs <ddl.sql>`. Additive idempotent DDL auto-runs. **Anything touching existing DATA shows the plan and waits for Emil.** The runner verifies DDL objects only — anything else needs real assertions written by hand (see II.5, Tooling).

**Law 9. Disjoint file ownership for parallel work.** Shared files (`src/index.js` route mounts, `test/run-tests.sh` registrations) are never edited in parallel — they're noted in a `docs/FLAGS_FROM_*.md` and wired at merge time by the merging session. When fanning out to subagents, each subagent owns exactly one file; the parent owns routing, tokens, and integration.

**Law 10. Diagnose from the logs and the database. Not from files.** See Lesson 2. When the logs are closed, get the answer from the data — but see Law 3: indirect evidence must be interrogated before it is trusted.

**Law 11. Schema before code.** Migrations are applied and verified before the code that depends on them ships. Never create a window where deployed code expects an object that isn't there. See Lesson 6.

**Law 12. Correct your own record in the same session.** If a session's own notes or this document become false because of what that session just did, it fixes them before it stops. **If this document contradicts what you observe, the observation wins**, and the document is wrong and must be corrected in the same session. A stale canon is worse than none, because it produces confident wrong answers. This has already happened once (a session recorded `interests` as missing after the migration created it, and corrected its own note).

## II.2. Proof discipline

The failure mode this project keeps hitting is confident reasoning from evidence that could not support it. Specific traps already encountered:

- **Cumulative counters read as recent activity.** Postgres index scan counts are all-time. They cannot date an event.
- **A 200 that was a swallowed exception.** A handler that catches its own error and returns a default will look healthy at the HTTP layer while being completely broken.
- **Absence in a log window too short to contain the event.** Widen the window before concluding anything from a gap.
- **A control that does not discriminate.** `/admin` returned byte-identical 403s for both a real route and a nonsense one, so the probe proved nothing either way.

**The rule: read the actual error before forming a hypothesis.** If the error is not visible, the first task is making it visible, not guessing around it.

### What counts as proof

A green test suite is not proof. Proof is specific to what changed. Match the evidence to the claim.

| Change type | What actually proves it |
|---|---|
| **A route mount** | A real request through the real booted server returning 200, against an **unmounted control path** returning 404 — plus a router-specific discriminator (an error string or response shape that exists only in that router). |
| **A schema migration** | A post-check reading live prod: object exists, constraints as intended, grants scoped, row count as expected — and the user-facing symptom demonstrably gone. |
| **A data write** | Row counts asserted before, inside the transaction, and after. Every other row diffed to prove it didn't drift. |
| **A prompt change** | A live model call against the real configured model, on the exact input that produced the bug. Nothing in the test battery exercises prompts. |
| **A parsing/format fix** | Before/after on the real reported inputs, showing old behavior and new behavior side by side. |
| **A filter added to a shared query** | A regression run proving existing consumers see exactly the rows they saw before — with a guard that fails if the fixture returns nothing. |
| **Graceful degradation** | Reproduce the actual failure condition (real SQLSTATE, real missing relation) and show the code surviving it — plus a test proving the catch isn't over-scoped. |
| **Replacing a view** | The dependent views still exist and still return rows; the output column list is byte-identical (names, types, order); the branch you did NOT mean to change is byte-identical in `pg_get_viewdef` before and after — that sibling branch IS the control; and the new values are hand-verified against their inputs, not just "non-null". Capture the verbatim prior definition as a rollback artifact FIRST. |
| **A new test / regression guard** | **Revert the fix and show the suite goes RED**, then restore it. A test written against already-fixed code has never once been observed to fail, so its passing carries no information. Quote the mutation run's exit code. (Cheap: copy the file, revert, run, restore — under a minute.) |
| **Arming a previously-inert guard** | Drive the REAL module against real prod through all three states — off, ON, and expired — **plus a control proving the "off" answer now comes from the healthy path and not the broken one.** For a boolean guard the two look identical, so reproducing the OLD failure signature side by side is the only thing that separates them. Then enumerate every consumer and confirm none of them can now break. |

**The universal rule: run the control.** Whatever you think proves your claim, ask what result you would get if the claim were false. If it's the same result, you have no proof. This has caught false proofs three separate times in one day.

## II.3. Session hygiene

- **At session start:** read the parts of this document your prompt names. Every session names the parts it read. A prompt that says "read CEDRUS.md" without naming parts is incomplete.
- **When you hit a bug:** search II.4 (Lessons) and II.5 (Verified environment facts) before forming a hypothesis. Several failures in this codebase look like one thing and are another. There is a real chance we have already seen it, already been wrong about it, and already written down the answer.
- **At session end:** if you learned something durable — a new failure mode, a corrected fact about prod, a proof technique that worked — append it. Say plainly what you changed. A lesson that isn't written down will be re-learned at full price.
- Every session reports the exact files it changed, and flags anything outside its declared scope.
- Lint baselines are recorded, not chased. Report the delta; do not fix pre-existing noise you were not asked to fix.

---

## II.4. Lessons

Each one is a real incident. The rule is the takeaway; the story is why it's believable. Lessons 1 to 13 are from the backend and the database. Lessons 14 to 18 are platform lessons and each of these cost real hours too.

### 1. Catch → warn → continue is a disease

**Incident.** Every SMS was silently failing to persist. `persist` caught per-item errors, logged `String(err)` — which renders as `[object Object]` — and continued. Meanwhile the model-authored reply said *"Got it, added that to Luca."* The user got a confirmation; nothing was written.

**Rule.** A swallowed error is worse than a crash, because it produces confident false success. Every catch in a write path logs `err.message`, `err.code` (SQLSTATE), `err.constraint`, and `err.detail`. **Never `String(err)`.** And a reassuring user-facing message must never be emitted on the assumption that a write succeeded.

**Generalization.** Any mechanism that can fail silently will eventually fail silently and cost a day. Look for this shape everywhere: guards that don't run, filters that match nothing, checks that iterate empty lists.

### 2. Files lie. The database doesn't.

**Incident.** Three consecutive confident diagnoses of the same bug, all wrong. (a) A stale `pending_clarifications` row — there were zero active rows. (b) The `pending_clarifications` table doesn't exist in prod — it existed with 19 columns and resolved rows. That second one was "confirmed three independent ways": no migration file, absent from generated types, and a `-- NOT EXECUTED` header. All three were **stale artifacts of the same blind spot** — migrations now run through a runner that doesn't write to the migrations folder, and the type snapshot predated the ship.

**Rule.** Migration folders, generated type files, and comments in SQL files are **not** evidence about prod. Query the database. `SELECT to_regclass('public.<table>')` settles existence in one line.

**Corollary.** Three pieces of evidence that share a common cause are **one** piece of evidence. Ask what would have to be true for all of them to be wrong together.

### 3. A green result is guilty until proven innocent

**Incidents, three in one day.**
- A `401` on `/api/insights` was about to be reported as proof the route was mounted. The control — an *unmounted* path — also returned 401, because the catch-all authenticates the whole prefix.
- A regression check returned "identical" for both scenarios because the fixture rows lacked `user_id`, so the filter excluded everything and the comparison was vacuously true.
- A boot log with zero warnings was about to be read as "all security checks pass." Three of the four checks emit nothing at all when the guard is disarmed. Silence carried no information.

**Rule.** Before reporting a pass, ask: *what result would I see if this were broken?* If the answer is "the same result," you have no proof. Run the control. Add a guard that fails loudly if the fixture is empty.

### 4. A test can encode a falsified belief and never expire

**Incident.** Station 5's isolation test filtered on `status` alone and asserted only the inferred row came back. That test encoded a claim we had just proven false. Left alone, it would have sat in the suite forever as green evidence for a wrong belief. A second test used `'open'` as its *invalid* status value — which had become valid, silently turning the assertion meaningless.

**Rule.** When you change a mechanism, **audit the tests that assert the old mechanism.** A test that passes for the wrong reason is worse than a missing test. When a constant changes value, grep for every assertion that depends on its old meaning, not just its old name.

### 5. Fixing the code does not fix the data

**Incident.** The onboarding self-name bug wrote `"Had"` as the user's name — from *"Had dinner with..."*. Station 3 fixed the extraction so it can't happen again. The greeting still read *"Morning, Had"*, because the bad row was already in `app_users` — and in `people`, since the pipeline writes both.

**Rule.** After fixing an extraction or write bug, **ask what bad rows already landed** and repair them explicitly. Check every table the buggy path wrote to, not just the obvious one.

### 6. Deploy ordering: schema before code, always

**Incident (both directions).** The clarifications code shipped to Railway before its table existed on Supabase — every operation threw 42P01 silently. Later, adding an `origin` filter to `memory.js` would have thrown 42703 across the brief, insights, and discovery if the column weren't already live.

**Rule.** Run and verify the migration **first**, then merge and ship the code that depends on it. Never create a window where deployed code expects an object that isn't there.

### 7. A guard that can't distinguish "checked and fine" from "didn't run"

**Incident.** `NODE_ENV` was unset on the Railway service for a full day. `assertSecureBoot()` gates its hard failures on `isProduction`, so several checks that should refuse to boot silently downgraded — and three of them emitted nothing at all. A clean boot log looked identical to a correctly-configured one.

**Rule.** Every guard must announce which mode it ran in. Absence of a warning is not evidence of a pass. This is the same disease as Lesson 1, wearing a different hat.

**Related.** Before *arming* a previously-inert guard, enumerate what it will enforce and verify each input — otherwise flipping the switch takes the service down on redeploy.

### 8. A bad garnish field must never destroy the memory

**Incident.** An unparseable `event_date` ("tonight") threw on insert, and the entire saved item was lost. The user's memory of a dinner was destroyed by a decorative field.

**Rule.** Distinguish load-bearing fields from decorative ones. A decorative field that fails gets dropped; the record still saves. Parse at **one** boundary, not per call site.

### 9. Don't trust a station's own documentation

**Incident.** Station 5's doc left a literal `OLD_NAME` placeholder for a constraint name, and its code comment claimed `status='active'` was "the LOAD-BEARING isolation" — which was false; the isolation lived in `origin`. Station 7's doc claimed bundle 17, already taken. A `.proposed.sql` header said "NOT EXECUTED" long after it mattered.

**Rule.** Read the **code and the live schema**, not the accompanying prose. Docs record what someone intended at authoring time, not what is true now.

### 10. Push back on bad instructions

**Incident.** Emil (via the boardroom) instructed a session to run a data-write `UPDATE` through the DDL-only migration runner. The session checked, found the runner would verify nothing while printing a success line, refused, and wrote a proper script instead. Separately, an instruction to read "the current warnings" as the list of what would become fatal was wrong — most of the checks emit nothing when disarmed — and the session said so.

**Rule.** If an instruction would produce a false proof or an unsafe action, **say so and propose the correct approach.** Compliance that produces a wrong answer helps nobody. This has already saved us twice.

### 11. The library that never throws makes every catch a lie

**Incident.** The Flag 1 census (2026-07-26) asked how many other guards could be silently inert. The answer was structural, not a list: `supabase-js` resolves `{ data, error }` instead of throwing, and 45 of 101 call sites never bind `error`. So the disease isn't 45 careless catches — it's one library contract that turns *every* unbound call into a silent-failure site, and turns some existing `try/catch` blocks into decoration that can never fire.

Two guards were found actively broken and unable to say so: `isInSuppressionWindow()` returns `false` ("no crisis cooldown") because the column it reads doesn't exist, and `checkRateLimit()` returns `allowed: true` on any quota-query failure, with no log line at all.

**Rule.** When auditing for silent failure, **start from the library contract, not the call sites.** Ask "what does this client do on error?" before reading a single catch block. One wrong assumption about a dependency's error model reproduces itself everywhere the dependency is used.

**Corollary.** A guard that returns a boolean is the highest-risk shape in the codebase, because the failure value is almost always also a legitimate answer. `false` means both "checked, fine" and "couldn't check." Prefer three states, or log the mode.

### 12. Removing the cause is not removing the shape

**Incident.** The §6 crisis cooldown was dead because `app_users.crisis_suppressed_until` didn't exist. One additive column fixed it, no code change, proven end to end (2026-07-26). Tempting to call the bug closed.

It isn't. `isInSuppressionWindow()` still funnels **four** different situations into a bare `return false` with no logging: query error, user row not found, column NULL, thrown exception. Only the third is a legitimate "no window." The migration removed the condition that was firing branch one — it did nothing to the fact that branches one, two and four are still invisible and still indistinguishable from three. Drop the column, rename it, or let PostgREST's schema cache go stale on a redeploy, and the guard silently goes inert again with no signal.

**Rule.** After fixing a silent-failure instance, ask: **would I find out if this broke again tomorrow?** If the answer is no, you fixed the trigger, not the defect. Record the remaining shape as an open flag in the same session — otherwise the green result becomes evidence the whole class is handled.

**Corollary.** This is Lesson 5 ("fixing the code does not fix the data") pointed the other way: fixing the *data* does not fix the *code*.

### 13. Correct your own stale notes

**Incident.** A session recorded `interests` as missing from prod. It then ran the migration that created it — and went back and corrected the note, because a future session reading it would have re-derived a wrong diagnosis.

**Rule.** When you invalidate something you or a previous session wrote down, fix it in the same session. Including in this file.

### 14. Lovable reserves the `SUPABASE_` namespace and will not give you a service role key

This is the single most useful thing learned so far, and it generalizes.

Lovable Cloud reserves any secret name beginning `SUPABASE_` for its own managed integration. You cannot create one. It injects `SUPABASE_URL` into the Worker, but it does **not** inject `SUPABASE_SERVICE_ROLE_KEY`, presumably because that key bypasses RLS entirely and most apps have no business holding it.

The consequence is quiet and expensive. Any server code needing service-role access has no credential, every write fails, and the obvious fix is blocked by the platform.

**The workaround: do not fight the namespace, route around it.** Put the real key in a secret named outside the reserved prefix, `CEDRUS_SERVICE_ROLE_KEY`, and read that first with the reserved name as a fallback:

```
const key = env.CEDRUS_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
```

Generalized rule for every managed platform: **when a platform reserves a namespace, take your own.** Assume any name that looks like it belongs to the vendor may be silently owned by the vendor.

### 15. Worker bindings are not on `process.env`

Cloudflare Worker environment reaches code through `getCloudflareContext()`, not `process.env`. Code written against `process.env` reads undefined in production while working fine locally. Read env through one shared helper so two files cannot drift apart on this.

### 16. Secrets and code both need a publish, not just a push

Changes apply immediately in Lovable preview and reach the live app only on publish. Testing the live URL after a push and before a publish tests the old build.

### 17. Opaque errors cost hours

"Missing Supabase service configuration" hid the cause for a full night. Rewritten to name the specific variable, the same failure took five minutes. **Every thrown configuration error names the exact variable a human would need to go set.** This is a rule, not a preference.

### 18. Indirect evidence lies

Three consecutive hypotheses were wrong because each rested on inference rather than the error itself: cumulative index counters read as proof a query had just run, an HTTP 200 that turned out to be a swallowed exception, and absence from a log window too short to contain the event.

The server function response body, visible in browser devtools under Network, was the correct instrument the entire time.

**Rule: read the actual error before forming a hypothesis.** If the error is not visible, the first task is making it visible, not guessing around it.

---

## II.5. Verified environment facts

Established against live prod. Do not re-derive these from files; if you must re-verify, verify against the database or a real request, and update this section if reality has moved (Law 12).

**Auth and routing**
- `app.use('/api', apiRouter)` is a catch-all that **runs auth before route matching**. Every path under `/api` returns 401 unauthenticated, mounted or not. **A 401 proves nothing about whether a route is mounted.** Use a 200 vs an unmounted-control 404 instead.
- **`/admin` has the SAME shape, and it is the same trap** (verified against live prod 2026-07-29, after the V1-rail deploy). Unauthenticated, `/admin/cards`, `/admin/broadcasts`, `/admin/broadcasts/x/approve` and the nonsense control `/admin/definitely-not-a-route` all return **HTTP 403 with the byte-identical body `Forbidden`**. So **a 403 on `/admin/*` proves nothing about whether a route is mounted** — the panel-auth middleware answers before route matching, exactly like the `/api` catch-all. Proving an `/admin` mount requires an authenticated request returning 200 against an authenticated control returning 404.
- Route mounts go in `src/index.js` **before** the catch-all.

**Dates and timestamps**
- `toTimestamptz()` in `memory.js` is the single parsing boundary for all model-fed timestamps.
- It **deliberately anchors a bare `YYYY-MM-DD` to 12:00Z** so the calendar day survives every US timezone. Noon UTC in the data is correct, not a bug.
- Unparseable date → `null`, and the item still saves. `reminders.trigger_at` is NOT NULL, so a bad time skips **that reminder only**.
- Frontend `formatShortDate` handles null. A bare date-only string would render a day early in negative-offset zones — currently protected by the noon anchor.

**Tooling**
- `run-migration.mjs` takes **one** argument (`<path-to.sql>`). An older note said `<ddl.sql> <table>`; the second arg is read by nothing. Corrected 2026-07-26.
- **`run-migration.mjs` cannot parse a schema-qualified `ALTER TABLE`.** Its regex captures `([A-Za-z_]\w*)`, so `ALTER TABLE public.app_users` makes it verify a table literally named `public` — the in-txn check then fails and it ROLLS BACK. It **fails closed**, so nothing lands and nothing is corrupted, but the migration silently does not apply. **Write table names unqualified**, as every prior `docs/*.proposed.sql` does. (Verified by hitting it, 2026-07-26.)
- **`run-migration.mjs` CANNOT verify a `CREATE OR REPLACE VIEW`.** A view replacement declares no CREATE TABLE / ADD COLUMN / CREATE INDEX, so `parseObjects` returns three empty lists, the in-txn loop iterates nothing, and it prints "all declared objects present" — then COMMITs. It applies the change and vouches for nothing. Write a purpose-built script (see `~/.config/cedrus/migrate/apply-days-since.mjs` for the pattern: pre-check → BEGIN → apply → in-txn asserts incl. a control → COMMIT/ROLLBACK → fresh post-check).
- **`CREATE OR REPLACE VIEW` keeps dependents intact** as long as the output column list is unchanged (or only appended to). `v_agent_person_context` sits on top of `v_people_for_agent`; replacing the latter did not require dropping the former. Verified in-transaction 2026-07-27 — assert it, don't assume it.
- `run-migration.mjs` parses **only DDL objects** (CREATE TABLE / ADD COLUMN / CREATE INDEX). **Never feed it a data write.** It would run the UPDATE inside its transaction while pre-check, in-txn verify, and post-check all iterate empty lists and print "all declared objects present" having verified nothing. Write a data-write script with real row-count assertions instead.
- `test/run-tests.sh` is a **concat rig**: it strips imports and depends on concatenation order. Tests using real ESM imports or `mock.module` cannot run under it — register those in `run-all.sh` instead. `run-all.sh` invokes `run-tests.sh` first, so either way they execute inside the one gating battery.
- **Bundle numbers in use: 17 (model-timestamps), 18 (interests), 19 (goals), 20 (§6 suppression read), 21 (quota reads), 22 (crisis vs pre-model short-circuits), 23 (relationships writes), 24 (memory silent failures), 25 (consent audit trail), 26 (trial downgrade), 27 (entitlements), 28 (budget guard), 29 (budget vs pipeline ordering), 30 (card rail state machine), 31 (card failure honesty), 32 (card replies vs pipeline ordering), 33 (admin broadcasts), 34 (web onboarding answers), 35 (contracts on POST /api/goals), 36 (inbound SMS allow-list), 37 (outbound SMS allow-list), 38 (CoS daily brief) — 28–34 merged to local `main` 2026-07-29 morning** (they were branch-only until then). Next free: **39.** (**Corrected 2026-08-17, Law 12:** this line read "Next free: 35" while 35, 36 and 37 were already registered in `run-all.sh` — the note went stale when those three merged and nobody moved it, which is the exact failure it warns about. 38 was taken by the CoS daily brief the same day.) Station docs have claimed already-taken numbers more than once — and so has this line. **Check every rig, not just `test/run-tests.sh`:** bundles 35–38 are registered in `test/run-all.sh`, not in the concat rig, so grepping only `run-tests.sh` returns 34 and reads as "35 is free." The reliable command is `grep -rhoE 'Bundle [0-9]+' test/*.sh | sort -u`.
- **THERE ARE THREE CONCAT RIGS, not one** (corrected 2026-07-27): `test/run-tests.sh`, `test/run-n2-brief-email.sh`, and `test/run-admin-tests.sh`. `run-all.sh` drives all three. **If you change a `src/` file's imports, every rig that concatenates it must be updated**, not just `run-tests.sh` — the strip removes the import line, so a newly-imported helper must be concatenated ahead of its consumer or the bundle dies with `X is not defined`. This bit the entitlements collapse: the in-worktree `run-tests.sh` run was green and the merged-main battery crashed. Grep all three: `grep -rln 'strip\b' test/*.sh`.
  Two more strip facts, both hit 2026-07-29: (a) the strip removes only lines that START with `import ` — a **multi-line `import {...}`** leaves its continuation lines behind as orphaned syntax ("Unexpected }"), so every import in a rig-concatenated file must be single-line; and (b) an **aliased named import** (`import { create as createPerson }`) dies under concat because the alias identifier is never defined — use `import * as ns` and let the rig's `echo 'const ns = { … };'` line build the namespace (Bundle 1's pattern).
- **The concat rig can host failure-branch tests — but not with `reliability-core.js`.** Its fake Supabase is a working in-memory DB: it always resolves `{ error: null }` and can never throw, so it cannot drive an error path. It also declares `const supabase`, so you cannot add your own alongside it. For a suite that needs a *programmable* seam, write a dedicated prelude declaring its own `supabase` / `logger` / `makeChecker` and skip `reliability-core.js` entirely (`test/prelude-suppression.js` is the worked example; Bundle 16 set the precedent). This is usually better than reaching for `mock.module`, which forces the suite out of the rig and into `run-all.sh` and needs bun.
- `run-all.sh` deliberately excludes the live extraction eval; it needs `OPENAI_API_KEY` and makes real paid calls. **Zero battery suites exercise the extraction prompt.**

**Data model**
- Reminder delivery state is the linked `messages.provider_status`, **not** a column on `reminders`.
- `user_goals`: `week_of` is NOT NULL (a `date`); `user_goals_status_check` allows only `open / completed / missed / canceled`. `origin` defaults to `'cedrus_inferred'`; user-set goals use `'user_set'`. Isolation between the two populations is enforced by **`origin`**, not status.
- `getOpenGoals` orders `week_of DESC`, and **Postgres defaults to NULLS FIRST on DESC** — a NULL `week_of` row sorts to position `[0]`, which `briefEngine` quotes verbatim into the weekly brief. NULL `week_of` + `status='open'` is a hijack scenario. Always stamp `week_of`.
- `getOpenGoals` feeds **three** consumers: `jobs/brief/gather.js`, `services/insights.js`, `services/discovery.js`. Changing it is never local.
- `app_users.id` is a uuid. `u_c6cf9fb9` in logs is a **truncated log label** (`'u_' + user.id`), not a text primary key.
- `discovery.js` has **no importers in `src/`** — it is the inert Pro planner. Hardening it protects a path that isn't live yet.
- Frontend `createInterestsClient` (`src/lib/cedrus/interests.ts`) still returns a **localStorage mock**. That file is the single wiring point to the real endpoint.

**Supabase client behaviour — the single most load-bearing fact in this file**
- **`supabase-js` does NOT throw on a database error.** It resolves `{ data, error }`. Verified 2026-07-26: **45 of 101 `supabase.from()` call sites in `src/` never bind `error`.** Each is a place where a DB failure yields no exception, no log, and a plausible return value.
- **Corollary that has already bitten us:** a `try/catch` wrapped around a service function that doesn't check `error` is **decorative — it can never fire.** `07_persist.js:97` wraps `rel.logContact()` this way — still true after the 2026-07-27 sweep, which added logging but deliberately did NOT start throwing. Before trusting any catch on a write path, confirm the callee actually converts `error` into a throw.
- Which write paths genuinely **throw**: `memory.js` `addFact` / `addSavedItem` / `addReminder` / `addGoal` (the post-incident fix, and it works). Everything else resolves.
- **Sweep progress (flag 14).** TEN call sites hardened as of 2026-07-27; the crude bind-count moved 56 → 60 of 101. None changed control flow — they still resolve, they just say so now: `usage.js` `getMessageQuota`/`getNudgeUsage` → `quota.read.failed`; `relationships.js` `logContact`/`linkMessagePerson` → `relationships.write.failed`; `memory.js` supersession `.update()` → `facts.supersede.failed`; `memory.js` `getOpenGoals`/`getOpenGoalsThisWeek` → `goals.read.failed`; `consent.js log` → `consent.write.failed`; `trialDowngrade.js` scan + per-user update → `trial.downgrade.scan_failed` / `trial.downgrade.failed`. Bundles 21, 23, 24, 25, 26, each mutation-checked. **~39 sites remain**, mostly in `people.js` and `users.js`.
- **`test/stubs.js`'s logger now carries `event`** — bundles 1/15/17 concatenate the real `memory.js`, so any new `logger.*` method used there must be added to that stub or those three bundles break. Same trap applies to `reliability-core.js`, which declares **no logger at all**.
- **Next sweep candidate and its obstacle:** `briefEngine.js:355` (`catch { interests = [] }`, whose comment still claims the interests table might be missing — it exists). `briefEngine.js` does **not import logger**, and its two bundles (11, 12) use `reliability-core.js`, which declares no logger. Hardening it means editing a shared prelude used by ~14 bundles — wider than the sweep recipe covers. Deliberately deferred 2026-07-27.

**Contact tracking and the person panel** (verified live 2026-07-26)
- `contact_events` **ARE** written on the saved-item path — Flag 3's premise was wrong. Written by `relationships.js:12` from `07_persist.js:99`, gated on the model's `contact_signal` being one of `explicit_contact / confirmed_contact / implied_contact`. The DB trigger correctly freshens `people.last_contact_at`.
- **`people.contact_frequency_days` has no writer anywhere** — not backend, not frontend, no column default, 0 of 4 prod rows populated.
- `v_people_for_agent.days_since_contact` was NULL-gated on **`contact_frequency_days`**, a field it does not need. **FIXED IN PROD 2026-07-27** — that one condition removed from the days-since branch only. Both Lucas now read `days_since_contact = 2`, hand-verified. Artifacts: `docs/DAYS_SINCE_CONTACT.proposed.sql` and `.rollback.sql` (verbatim prior definition).
- **`relationship_health_score` is STILL NULL for every person, and that is CORRECT.** Its guard on `contact_frequency_days` is load-bearing — the field is its denominator (`NULLIF(contact_frequency_days * 2, 0)`). It was deliberately not touched. The health bar and the "drifting" pill therefore stay hidden, and the backend drift nudge / drift brief moment stay dormant because both `gate on relationship_health_score == null → continue`, NOT on days-since. The real remaining gap is that **nothing ever sets `contact_frequency_days`** — see flag 19.
- **What the days-since fix woke up** (Lesson 7 enumeration, all verified by reading the consumers): person-panel "Last touch" now shows a real value; `insights.js` **recency** insights can now fire for the first time (core ≥14d, regular ≥30d) and flow into the weekly brief and `/api/insights`; frontend `today.ts` drift moments can now fire (≥45d); `people.ts` row subtitle "no word since {month}" can now appear (≥45d). Nothing treated NULL as an affirmative signal — every consumer read it as "no data, skip" — so these are the features working for the first time, not regressions. Backend drift nudges are NOT among them (health-gated, still dormant).
- The two person panels read **different tables, and both are authoritative for what they show**: WHAT CEDRUS KNOWS → `facts` (`is_current=true`); SAVED FOR LATER → `saved_items` (`is_current=true`, `status IN ('active','surfaced')`). A dinner logged as an *event* lands in `saved_items` and produces **no** `facts` row — so "Nothing saved yet" above a populated saved list is accurate copy, not a bug.
- `app_users.crisis_suppressed_until` — **CORRECTED same day.** It did not exist when the census ran (39-column dump, 2026-07-26 ~19:20), which is why `safetyFlags.js` had been inert since it shipped. **It EXISTS as of 2026-07-26 ~23:30**: `timestamptz`, nullable, no default, added by `docs/SAFETY_SUPPRESSION_COLUMN.proposed.sql`. The §6 cooldown is now armed and proven end to end against prod. **Schema-only — no code change was needed**, and `safetyFlags.js` was not touched (Law 2).
- Arming it enforces suppression in **six** live consumers: `dailySweeps.js:31`, `weeklyBrief.js:37` + `:117`, `briefEmail.js:212`, `briefEngine.js:310`, `pipeline/index.js:133` (`discovery.js:396` is inert). **Every one of them only REMOVES optional content** — playful nudges, Pro teasers, clarification re-asks. None blocks a core function or can throw. That is why flipping this switch was safe, and it is the enumeration Lesson 7 demands before arming any inert guard.
- `app_users` carries `trg_app_users_updated_at` (BEFORE UPDATE → `set_updated_at()`). **Any write bumps `updated_at`, so a write test can never restore the table byte-for-byte.** Nothing in `src/` reads `app_users.updated_at`. Don't try to forge it back — that needs a trigger disable on a live table, which is riskier than the drift.
- ~~No test anywhere imports the real `safetyFlags.js`~~ — **fixed the same day.** Bundle 20 (`test/suppression-read.test.js`) is the first suite to exercise it. Every OTHER suite still injects its own `isInSuppressionWindow` stub, so coverage of that module is Bundle 20 and nothing else: if you change `safetyFlags.js`, that bundle is the only thing standing under you.

**Rings, cadence, and the proactive layer** (established read-only 2026-07-27, flag 19 design pass)
- **The ring selector is cosmetic today.** `dashboard.tsx:335` writes `dunbar_tier` + `dunbar_tier_source='manual'`, and **`dunbar_tier` has ZERO references anywhere in the backend `src/`.** Nothing reads it. The UI copy "Where someone sits sets how often Cedrus checks in about them" is not true in any functional sense.
- ~~`is_core_five` has no writer either~~ — **WRONG, corrected 2026-07-27.** `is_core_five` HAS a live writer: the `set_priority_people(target_user_id, priority_person_ids, max_priority, selection_source)` RPC (exists in prod, EXECUTE to service_role only), called by `prioritySwap.js` from `POST /api/priority/swap`. The earlier claim came from grepping for `update|insert`, which misses an `.rpc()` call — **grep for `.rpc(` too when hunting writers.** The real gap is that **the frontend never calls that endpoint** (zero references to `priority/swap`), so the writer exists and is unreachable from the UI.
- `coreFive.js:recomputeCoreFive()` IS a `throw new Error('TODO')` stub, but it is the *auto* fallback, not the primary path. **The throw is unreachable:** `runMonthlyCoreFive()` has its import commented out and its body is only `logger.info('...not yet implemented')`. So the `0 3 1 * *` cron has never failed — it succeeds at doing nothing. `trialDowngrade.js` is the same shape, EXCEPT the downgrade itself is live and will flip both trials to `free` on Aug 6/8.
- **Two disconnected notions of "the five".** `dunbar_tier` ('core'|'close'|'meaningful'|'network') is written by the ring UI and has zero backend readers. `is_core_five` is what every backend free-tier gate gets read from, and what the frontend maps to `isPriority` (`data.ts:82`). `mapPerson` produces `circle` and `isPriority` from these two independent fields, and nothing keeps them in sync — so dragging someone into "Inner 5" sets `dunbar_tier='core'` and leaves `is_core_five` false, and the app's own `isPriority` does not reflect the ring just chosen.
- **Nothing in the proactive layer sends SMS today.** `BRIEF_DRY_RUN=true` on Railway, and ALL THREE outbound paths honour it: `weeklyBrief.js:77`, `dailySweeps.js:54`, `reminders.js:100`. The only real outbound SMS is the synchronous TwiML reply to an inbound message. Arming the proactive layer therefore takes TWO independent switches — populate `is_core_five` (decides what content is selectable) AND set `BRIEF_DRY_RUN=false` (decides whether anything is sent). Neither alone puts a message on the wire. Note briefs still make their OpenAI call under dry-run.
- **Consequence nobody had filed: on the FREE plan the proactive layer is entirely dead.** `v_people_for_agent.proactive_enabled` is `plan=pro AND active` → `plan=trialing AND not expired` → `is_core_five` → `is_self` → else false. A free, non-trial user has no pro branch and `is_core_five` is always false, so every person evaluates to `proactive_enabled = false`. Both current prod users are `trialing` (to 2026-08-06 / 08-08), so this is masked right now and will surface the moment a trial lapses. See flag 22.
- So the chain is dead in **four** independent places: ring not read → `is_core_five` never set → `contact_frequency_days` never set → `relationship_health_score` NULL → both drift paths skip. Fixing any one alone changes nothing.
- **Health-score formula** (from `v_people_for_agent`): `clamp(0..100, round(100 − days_since / (2 × contact_frequency_days) × 100))`. So 100 at 0 days, 50 at exactly one cadence, 0 at two. Drift (`< 60`) therefore fires at **0.8 ×** cadence and urgent (`< 40`) at **1.2 ×**. Two quirks worth knowing before relying on it: it flags drift *before* the cadence has actually elapsed, and it saturates at 0 by 2 × cadence, so someone 10 × overdue ranks identically to someone 2 × overdue in the nudge priority (the frontend re-sorts by `daysSinceContact`, the backend does not). `NULLIF(freq * 2, 0)` also means a cadence of **0** silently disables health for that person rather than erroring.
- **All four prod people are `dunbar_tier='network'`** with `source='auto'`. Under the recommended tier→cadence mapping (network ⇒ no cadence) that means a cadence rollout would activate for **nobody** until Emil actually sorts people into rings — the safest possible arming path.

**Entitlement (`planTier`)** — collapsed and made time-aware 2026-07-27
- **One copy, `src/services/entitlements.js`**, exporting `planTier(user, now = new Date())` and `isProLike(tier)`. It replaced **six** local copies (`jobs/sweeps/select.js`, `jobs/brief/select.js`, `services/discovery.js`, `services/briefEngine.js` — where it was called `tierOf` — `services/insights.js`, `services/brief/composer.js`). An earlier note said five; the sixth was `brief/composer.js`.
- They had **drifted**: three guarded `user &&` and returned `'free'` on a nullish user, three did not and threw a `TypeError`. Same logical function, two different failure modes by file.
- It is now **time-aware**, matching `v_people_for_agent` exactly, including the strict `>` so a trial is over at the instant of `trial_ends_at`. A trial past its expiry is not a trial whatever the `plan` column says — entitlement no longer depends on the downgrade cron having run.
- **LOAD-BEARING: three loaders did not SELECT `trial_ends_at`** — `users.listActiveForBrief`, `users.listNudgeable`, and both of `briefEmail`'s queries. Those feed every job-path tier call. Shipping the time check alone would have made `undefined > now` false and moved **every live trial to free on deploy**. The column was added to all four in the same commit.
- **The helper fails OPEN on a missing/unparseable `trial_ends_at`** (returns `'trial'`). `app_users.trial_ends_at` is NOT NULL, so absence can only mean a loader that forgot the column — a code bug. Failing closed there would mass-downgrade silently; failing open degrades to the old behaviour. **Any new loader feeding a tier decision must select `trial_ends_at`,** or the feature quietly won't engage for those users.

**The trial→free transition** (verified read-only 2026-07-27; both live trials lapse Aug 6 / Aug 8)
- **The downgrade job WILL work.** Proven by running the real UPDATE inside a transaction and rolling it back: `user_plan` contains `'free'`, no CHECK constraint blocks it, the write returns `plan='free'`, and prod was verified untouched afterwards. `service_role` has UPDATE on `app_users`. The scan predicate (`plan='trialing' AND trial_ends_at < now()`) currently matches 0 rows, correctly. The job is idempotent — after the write the scan can't match that user again. It runs hourly at `:30`, so worst-case lag past expiry is ~1 hour.
- **It leaves `billing_status='trialing'` on a `plan='free'` user.** Harmless for entitlements — every `planTier()` pro-branch requires `plan==='pro'` too — but it is surfaced in the admin user list (`adminOps.js:83`), where "free / trialing" reads as a bug. Cosmetic, not functional.
- **SPLIT-BRAIN RISK — the SQL and JS entitlement checks disagree when the job doesn't run.** `v_people_for_agent.proactive_enabled` is time-aware: `plan='trialing' AND trial_ends_at > now()`. `planTier()` — duplicated in **five** places (`sweeps/select.js:78`, `brief/select.js:119`, `briefEngine.js:64`, `discovery.js:120`, `insights.js:89`) — is **not**: it returns `'trial'` for `plan==='trialing'` with no clock check. So the view self-corrects the instant a trial expires, while the JS keeps granting trial entitlements until the cron rewrites the column. If the downgrade silently no-ops, `proLike` stays true and the free-tier gates at `sweeps/select.js:36` and `:47` never engage — the user keeps trial-breadth goal follow-ups and birthday nudges indefinitely, while the same user's `proactive_enabled` reads false. See flag 23. *(Superseded by the entitlements collapse above — kept because it is the reasoning that produced the fix.)*
- Nothing else keys off the transition: no email, no notification, no Stripe call, and the `coreFive.recomputeCoreFive()` call is commented out (flag 21).

**Spend, quotas, and the crisis ordering**
- **`checkRateLimit()` is the ONLY per-user spend ceiling in the application.** It fronts the one OpenAI call on both the inbound SMS path (`pipeline/index.js:97`, STAGE B3) and web capture (`capture.js:154`). Free cap is 20 inbound/day (`v_message_quota`).
- ~~Nothing reads `v_daily_token_usage` or `v_daily_sms_usage`~~ — **a budget guard is MERGED to local `main` and its `system_flags` table IS IN PROD as of 2026-07-29 (morning ceremony).** (Corrects the earlier note on this line, which said branch-only and "NOT in prod yet".) `services/budget.js` + `jobs/budgetGuard.js` (hourly, :10) sum both views for the UTC day, compare against `DAILY_TOKEN_BUDGET` / `DAILY_SMS_BUDGET` (env, unset = that dimension DISARMED and announced every run), and upsert a `system_flags` kill-switch row. Readers: pipeline STAGE B3.5 (after the per-user cap, before the model call, crisis-exempt) and the scheduler's outbound-job gate. Every read fails OPEN via `quota.read.failed`. Facts that stay true about the views: per-user/per-day rows, `day` = `date_trunc('day', …)` **UTC**, bigints arrive as **strings** through supabase-js, and `sms_segments` sums BOTH directions — including `provider_status='dry_run'` rows, so dry-run rehearsal inflates the SMS count (set the budget with headroom until arming). **The schema is live and the guard is deployed, but it is NOT yet enforcing in prod:** neither budget env var is set — an unset dimension is DISARMED. (**Corrected 2026-08-05, Law 12:** this sentence previously read "local `main` is unpushed, so Railway is still running pre-merge code." Evidence: `main == origin/main @ 6723c0a`, observed 2026-08-05. Railway runs the merged code. Live-deploy confirmation against Railway logs is still owed — a ref comparison proves the code shipped, not that it is running.) The account-level OpenAI/Twilio caps remain unverified (flag 18) — verify them in those dashboards, don't assume the code has you covered.
- **The Priority 0 crisis gate lives INSIDE `understand()` (STAGE C).** The comment in `05_understand.js` about crisis "short-circuiting earlier" means earlier *within* `understand()`, not earlier than anything in the pipeline. Every early return above STAGE C therefore bypasses crisis detection entirely. **This still decides the fail-open/fail-closed question for every quota guard on the inbound path: failing closed can answer a crisis message with a cap message.**
- **STAGE B2.5 (added 2026-07-26) is the fix.** `const crisisOverride = evaluateSafety(body).action === 'crisis'` — pure, no model, no I/O — sits after compliance and gates the `needsFreshStart` and STAGE B3 short-circuits. It deliberately builds NO reply: the crisis response is authored in exactly one place, `understand()`'s gate, which re-runs the same pure function. Scope is `'crisis'` only, NOT `isSafetyOverride()` (which also covers the substance `'boundary'`).
- **The exemption cannot buy model calls.** The predicate that skips the cap is the same predicate that makes `understand()` short-circuit pre-model, so a bypassed message can only ever cost one fixed-template SMS. Bypass-scope and no-model-call are one condition, not two that could drift.
- **`evaluateSafety()` is free enough to run anywhere.** `safetyDetection.js` has **zero imports**, zero `async`, 457 lines of regex. Measured 2026-07-26: **5.94 µs** on a typical SMS, 2.39 µs on a crisis hit (early exit), 78 µs at 1600 chars, 5.7 ms at the 100kb express limit. **Scaling is linear — no catastrophic backtracking**, so it is safe to run on untrusted input before a rate limit. For scale, the OpenAI call it protects takes 1–3 seconds.
- The third pre-cap early return, `loneName`, is **not** reachable with crisis text — verified: a crisis phrase never matches `bareName()` and a bare name never trips the detector. Bundle 22 asserts this so it stays true.
- STOP/START/HELP (STAGE B2) still outrank the crisis pre-check, deliberately — opt-out is a legal obligation. Note the carrier-mandated `HELP` reply is compliance boilerplate, which is what someone texting "HELP" in distress receives. Not currently changeable.
- Both quota reads now emit `quota.read.failed` (`error_category: 'db_error'`, `outcome: 'fail_open'`, `error_code`) on error OR missing row; healthy reads stay silent. The views are `... FROM app_users u`, so a missing row means the id isn't a user — abnormal in itself.
- `sweeps/eligibility.js:22` guards with `if (budget && ...)`, so a nullish budget **skips the weekly nudge cap entirely** rather than clamping it. Fail-open there too, now announced.
- A *thrown* quota read was never silent — it propagates to the `routes/sms.js:41` catch and logs `sms.pipeline.error`. Only the `{ data, error }` path was invisible.

**Config**
- `NODE_ENV` must be set to `production` on the Railway backend service. `assertSecureBoot()` gates its hard failures on it; unset means several checks silently downgrade to warnings or emit nothing at all. **Verified set to `production` 2026-07-26**, alongside `VALIDATE_TWILIO_SIGNATURE=true` and `PUBLIC_BASE_URL`. The guard is armed again — but it still cannot announce which mode it ran in, so Lesson 7 stands.
- **The `run-all.sh` false-pass trap — measured 2026-07-26.** The script prints **"ALL WS-B SUITES PASSED" at line 1096 of 2404 — 46% of the way through — with THIRTEEN more suites still to run** (CORS, N1 admin panel, N3 web API, WS-F email ×3, admin auth, web onboarding, import, interests, insights, reminders). `set -e` protects the exit code, so the gate itself is sound. But the banner is a mid-run status line for one workstream, not a verdict. **Gate on `echo $?` — never on that line, and never on eyeballing the tail.** A session that greps for "PASSED" and stops reading will report a green battery it never observed. There is a second banner, "ALL BATTERY SUITES PASSED", at the true end; even that is weaker proof than the exit code.
- **When you cross-check the log, grep `^  FAIL`, not `FAIL`.** A bare `grep -c FAIL` matches prose — a section heading reading "still FAILS OPEN" made an all-green run report a failure (2026-07-26). The assertion prefix is two spaces + `FAIL`; `TEST(S) FAILED` is the other real marker. Corollary: **never put the token `FAIL` in a test's section heading.**

**Frontend gates** (established 2026-07-29 at the morning merge ceremony)
- **`npm run lint` in cedrus-frontend does NOT pass, and has not for some time.** On `main` at `d14fa28` — *before* any V1 work — `npx eslint src` reports **103 errors / 9 warnings**, all `prettier/prettier` formatting on pre-existing files (`terms.tsx`, `privacy.tsx`, `support.tsx`, `sms.tsx`, `index.tsx`, …). Typecheck, vitest and build are all genuinely green; **lint is the one red gate and it is inherited debt, not anyone's regression.** Do not report "lint clean" without saying which paths you linted.
- **`npm run lint` is `eslint .`, and `.` includes `.claude/worktrees/`.** Untracked worktrees are full repo checkouts, so eslint lints them too and every finding appears **once per worktree plus once for real** — 314 reported errors where 104 exist. This looks exactly like "the merge tripled the lint errors." **Scope to `npx eslint src`**, and consider ignoring `.claude` in `eslint.config.js`. (Cost this ceremony ~10 minutes before the control explained it.)
- **The control that settles a red gate after a merge:** `git worktree add --detach <tmp> <pre-merge-sha>`, symlink `node_modules` into it, run the same scoped command, and diff the normalized findings. Renames make raw counts lie — moving `src/routes/index.tsx` to `src/routes/classic/index.tsx` moved 38 pre-existing errors to a new path, which reads as 38 new errors until you diff by finding rather than by count.
- **The frontend dev server's FIRST page load after boot can fail to hydrate** (2026-07-29): the inline bootstrap imports `virtual:tanstack-start-client-entry` and that URL can 404 until the server has warmed — the page then renders as static SSR with NO React attached, so every interactive surface silently freezes at its initial frame. It looks exactly like broken app code and cost a session ~40 minutes. Reload before diagnosing anything interactive in dev. Prod uses the bundled entry — different mechanism, not affected.
- **Browser-based verification lies when no window is visible** (2026-07-29): both the app's preview pane and a connected-but-minimized Chrome run `document.visibilityState === "hidden"`, which suspends IntersectionObserver and rAF and throttles timers to ~1/s — IO-gated reveals never fire and self-playing loops crawl, while screenshots still composite (each screenshot delivers exactly one frame of rAF/IO). Overnight, drive the page in headless Playwright instead: its pages report `visible` and run full rendering semantics. Two probe corollaries proven the same night: Playwright's `isVisible()` ignores CSS opacity (an opacity-0 reveal counts as visible — assert `getComputedStyle(el).opacity` instead), and lovable-tagger's `data-tsd-source` column numbers can mismatch SSR vs client, producing a cosmetic dev-only hydration-attribute warning.

---

## II.6. Open flags register

Live list. Close them at the root, not the surface. Update as they resolve.

| # | Flag | Root question |
|---|---|---|
| 1 | **ANSWERED 2026-07-26.** `assertSecureBoot()` can't distinguish "checked" from "didn't run" | Census done — the answer was structural, see Lesson 11 and the new flags 10–13. `NODE_ENV` is set again, so this specific guard is armed. The *shape* is unfixed. |
| 2 | `NODE_ENV` root cause unknown | Who or what removed it? Only the Railway Activity feed can say. If a variable can vanish without an actor, others can too. Still open — the variable is back, but nobody knows who took it. |
| 3 | **CLOSED / DISPROVEN 2026-07-26.** "Last touch: no record yet" after a logged dinner | `contact_events` ARE written; `last_contact_at` IS set. Real cause is the `days_since_contact` NULL guard in `v_people_for_agent` — see flag 12. |
| 4 | **CLOSED / NOT A BUG 2026-07-26.** "Nothing saved yet" while SAVED FOR LATER lists items | Different tables, both authoritative: `facts` vs `saved_items`. Prod had 0 facts and 3 saved items. It is a copy problem — see flag 13. |
| 5 | Insights `gated` is tagged, not enforced | The frontend is the only thing preventing Pro content reaching free users. Needs a test that fails if a gated insight renders. |
| 6 | Reminders has no entitlement model at all | Product decision, not a bug: free forever, or capped? Decide deliberately. |
| 7 | Interests frontend still on localStorage mock | Safe to wire now. Frontend change = live deploy, so it needs its own gated session. |
| 8 | Onboarding infers the user's name from an open reply | The rebuild should ask for the name in its own explicit step. |
| 9 | Extractor once emitted the same saved-item title for two different messages | Never root-caused, not currently reproducible. |
| 10 | ~~The §6 crisis cooldown has never worked~~ **CLOSED 2026-07-26.** Column added and the cooldown proven end to end; the read now announces its abnormal branches and is covered by Bundle 20. | Closed at the root, not the surface: the instance (missing column) AND the shape (a `false` that couldn't say why) are both addressed. |
| 11 | ~~`checkRateLimit()` fails OPEN with zero log output~~ **CLOSED 2026-07-26.** Both quota reads now emit `quota.read.failed`; verdicts unchanged. | Answered deliberately: stays OPEN, because STAGE B3 precedes the Priority 0 crisis gate and failing closed could answer a crisis with the rate-limit template. Covered by Bundle 21, mutation-checked. **The spend ceiling is now observable, not enforced any harder — see flags 17 and 18.** |
| 12 | ~~`days_since_contact` NULL-gated on the never-written `contact_frequency_days`~~ **VIEW HALF CLOSED 2026-07-27.** Fixed in prod, hand-verified, health-score branch untouched as the control. | **Still open — the frontend half:** `healthRes.error` is unchecked at `data.ts:197` (`healthRes.data ?? []`), so a failed health query still renders "no record yet", indistinguishable from no data. Latent second path to the identical symptom. Frontend change = live deploy (Law 6), so it needs its own gated session. |
| 13 | "Nothing saved yet" is facts-only copy sitting above the saved-items panel | Copy/IA, not data. Scope the string to facts. |
| 14 | ~~45~~ **~41 of 101 `supabase.from()` sites don't bind `error`** | IN PROGRESS. Eight hardened (bundles 21/23/24/25, all mutation-checked): quota reads, `logContact`, `linkMessagePerson`, fact supersession, both goal reads, `consent.log`. Remainder is mostly `people.js` and `users.js`. Next candidate `briefEngine.js:355` is blocked on `reliability-core.js` having no logger — see II.5. |
| 15 | ~~`isInSuppressionWindow()` collapses 4 states into a silent `return false`~~ **CLOSED 2026-07-26** under an explicit narrow Law-2 exception from Emil. | Logging only; control flow unchanged; still fails OPEN. Covered by Bundle 20 and mutation-checked. **The same shape is still live in flags 11 and 14** — this fixed one instance, not the class. |
| 16 | ~~A rate-limited user in crisis gets the cap message~~ **CLOSED 2026-07-26.** STAGE B2.5 exempts a crisis message from both the cap AND the first-message onboarding return. | Scope turned out to be WIDER than filed: `needsFreshStart` was the worse path — a first-ever crisis message got the Twilio opt-in script. Both fixed, Bundle 22, mutation-checked. Residual risk accepted by Emil: a crisis message bypasses the cap, so fixed-template replies are uncapped (Twilio cost only, no model spend; inbound SMS costs the sender). |
| 17 | ~~No cost monitoring anywhere~~ **CONSUMER MERGED + SCHEMA LIVE 2026-07-29 (morning ceremony).** Budget guard merged to local `main` (`19cdf87`); `system_flags` applied to prod through the runner. Hourly job + kill-switch row + inbound/outbound gates, mutation-checked (Bundles 28/29). | **Two remaining. Corrected 2026-08-05 (Law 12):** the entry previously listed "`main` is UNPUSHED so Railway runs pre-merge code" as open. That is false — `main == origin/main @ 6723c0a`, observed 2026-08-05 — so the guard is deployed, and the claim is removed. Done: branch merged, `system_flags` migration run, code deployed. Still open: `DAILY_TOKEN_BUDGET`/`DAILY_SMS_BUDGET` are NOT set on Railway (unset = DISARMED); no `budget.check` line has been observed in prod, and live-deploy confirmation against Railway logs is still owed. `quota.read.failed` still has no alert consumer — the guard will enforce, it pages nobody. |
| 18 | No spend ceiling outside the app is verified | OpenAI and Twilio account-level caps are the only real backstops and they live outside this repo. Confirm they exist and are set before beta. |
| 19 | **Nothing ever sets `people.contact_frequency_days`** | Root cause behind the still-dead `relationship_health_score`, the hidden health bar, the "drifting" pill, and the dormant backend drift nudge + drift brief moment (all four gate on health being non-null). Unlike days-since this guard is CORRECT — the field is the score's denominator. So the fix is a product decision, not a view edit: who sets a per-person contact cadence, and what is the default? Probably derives from `dunbar_tier`. |
| 20 | **Should `addFact` fail closed when supersession fails?** | DECISION NEEDED. Today the retirement failure is logged (`facts.supersede.failed`) and the insert proceeds, so the person can end up with two current values for a single-valued slot. Alternative is to abort the insert, which loses the user's newest correction instead. I chose "keep the correction, log loudly" as the lesser harm — but it is a real product call. |
| 21 | **`coreFive.js:recomputeCoreFive()` is a `throw new Error('TODO')` stub** | ANSWERED 2026-07-27: the throw is **unreachable** — `runMonthlyCoreFive()` never calls it (import commented out, body is a log line), so the cron has never failed. The stub is the *auto* fallback; the primary path is the user-chosen `set_priority_people` RPC, which works but is unreachable from the UI. |
| 22 | **On the FREE plan the proactive layer is entirely dead** | Still true, but re-scoped 2026-07-27: it is currently moot because `BRIEF_DRY_RUN=true` means NOBODY gets proactive SMS. The live consequence on Aug 6/8 is **in-app**, not SMS — `today.ts` free-gates its drift feed on `isPriority` (= `is_core_five`), so the Today feed empties out. Fix is to wire the UI to `POST /api/priority/swap`, which already exists end to end. |
| 23 | ~~`planTier()` is not time-aware, but the view is~~ **CLOSED 2026-07-27.** One helper in `services/entitlements.js`, time-aware, six copies collapsed, four loaders fixed. Bundle 27, mutation-checked, ship-dark verified. | Was duplicated in 6 files (not 5); all return `'trial'` for `plan='trialing'` regardless of `trial_ends_at`, while `v_people_for_agent` checks the clock. A silently-failed downgrade therefore grants trial entitlements forever in JS while SQL says otherwise. Cheapest fix: add the `trial_ends_at > now()` check to `planTier()` so entitlement stops depending on a cron having run. Consider collapsing the five copies into one helper at the same time. |

Flags carried over from `cedrus-miami` are tracked as known open bugs in III.3, not here.

---

## II.7. Changelog

Append here when the operating law changes. Date, what changed, why. Entries before 2026-07-31 are from `CEDRUS_OPERATING_DOCTRINE.md`, which this part replaces.

- **2026-07-31 (consolidation)** — `CEDRUS_OPERATING_DOCTRINE.md` and `CEDRUS_V1_SPEC.md` were retired and deleted; this document became the single source of truth. Part II was reconciled against the doctrine line by line: the whole of "How Emil works" (now II.0) had been dropped and was restored; Law 6 had been narrowed to the frontend and `cedrus-miami` and was **omitting `cedrus-backend`**, the exact error the doctrine had corrected on 2026-07-27; Laws 4 and 8 were missing entirely and are restored to their own numbers; Laws 1, 2, 5, 7, 9 and 12 were restored to their full text; the proof table (10 rows) and "run the control" were folded into II.2; the doctrine's thirteen lessons were folded into II.4 ahead of the five platform lessons, keeping their original numbers so existing cross-references still resolve; the verified environment facts (II.5) and open flags register (II.6) were carried over whole.
- **2026-07-29 (Landing V2 + Onboarding V2 overnight)** — Added three facts to the Frontend gates: the dev server's first-load hydration race (a 404 on the virtual client entry renders a frozen static page that mimics broken code), the hidden-window verification trap (no visible browser window ⇒ IO/rAF suspended and timers throttled; screenshots still composite one frame — verify with headless Playwright, whose pages run visible semantics), and the two probe corollaries (Playwright `isVisible()` is opacity-blind; lovable-tagger `data-tsd-source` can produce a cosmetic dev-only hydration warning). Session report in `SESSION_NOTES_2026-07-29.md`: four frontend commits on `feat/night-2026-07-29-landing-onboarding`, unmerged, nothing pushed.
- **2026-07-29 (morning merge ceremony)** — Integrated the three overnight branches on `main` in both repos. **Schema first (Lesson 6):** four additive migrations through the runner, each verified — `system_flags`, `opportunity_cards` + `suppressed_pairings` + 4 indexes + `people.met_confirmed_count`/`last_met_confirmed_at`, `broadcasts`, and `app_users.member_status` (both live rows read `'founding'`; `updated_at` byte-identical before and after, proving `ADD COLUMN` does not fire `trg_app_users_updated_at`). Then `feat/night-2026-07-28-v1-rail` → backend `main` (`19cdf87`), full battery **exit 0 / 1848 PASS / 0 `^  FAIL`**, re-run identically at the end. Then `feat/v1-wfh-frontend` and `docs/marketing-launch-kit` → frontend `main` (`af6be72`); tsc clean, vitest 137/137, build exit 0, `.env.production` `6b2955d3…549cd5` byte-identical at every checkpoint including after the production build (Law 7). **NOTHING PUSHED** (Law 5) — both repos sit ahead of origin. Corrected three now-false claims (branch unmerged, `system_flags` not in prod, bundles 28–34 branch-only) and re-scoped flag 17 to what actually remains: push + two Railway env vars + an observed `budget.check`. Added the **Frontend gates** block — frontend `lint` is red with 103 pre-existing prettier errors and was red before any V1 work, and `eslint .` walks `.claude/worktrees/` and triplicates every finding.
- **2026-07-29 (overnight V1 rail build)** — One branch, five commits, unmerged, STOP before push honored: budget guard (flag 17's consumer — kill switch + hourly job + pipeline STAGE B3.5 + scheduler outbound gate), the opportunity-card rail (admin queue → dry-run sender with the 3/user/rolling-7d cap → YES/SKIP/LATER/NOT THEM/NEVER as STAGE B2.6 → 3-day follow-up → `met_confirmed`, the only tree-advancing event), admin broadcasts (draft → explicit approve-to-send; quiet hours 21–09 ET, 1/ET-day, 500-recipient refusal; web feed at `GET /api/broadcasts/active`), `app_users.member_status` + `GET /api/me`, and `POST /api/onboarding/answers` into the facts/people layer. Four proposed migrations, none applied (Law 5). Bundles 28–34; worktree battery 1848 PASS exit 0; SEVEN guard mutations each proven red then restored. Two new strip facts recorded (multi-line imports and aliased imports die under concat), bundle numbers through 34. Flag 17 re-scoped to "pending merge + migration + env + observed budget.check". Full report in `SESSION_NOTES_2026-07-28.md`.
- **2026-07-28 (THE PIVOT)** — Cedrus became **the daytime social layer for people who work from home**, launch city Miami, web-primary with SMS secondary. Created `CEDRUS_V1_SPEC.md` as the product canon (itself superseded on 2026-07-31 by Part I of this document). Strengthened **Law 5**: overnight and autonomous sessions STOP before push *without exception* — no self-authorized push, and no session prompt can create one — and recorded that **`BRIEF_DRY_RUN` stays `true` until a named arming session**, so building the card engine is in scope while sending is not. Opened `SESSION_NOTES_2026-07-28.md` as the single append-only file overnight sessions report into, so morning review is one file. No code, schema, or config was touched in this session.
- **2026-07-27 (entitlements)** — Closed flag 23. Collapsed **six** drifted `planTier`/`tierOf` copies into one time-aware `services/entitlements.js`; net −17 lines. Found the copies had two different nullish-user behaviours (three threw, three returned free). **The critical finding was that three loaders never selected `trial_ends_at`**, so the obvious version of this fix would have downgraded every live trial on deploy — the column was added to all four loaders and the helper fails open on a missing value. Ship-dark verified (both trials end Aug 6/8; every verdict unchanged today). Bundle 27, mutation-checked (clock-blind helper fails 5 assertions). Also corrected a real gap: **there are three concat rigs, not one**, and missing the second one crashed the merged-main battery after an all-green worktree run — Law 4 doing its job.
- **2026-07-27 (trial-downgrade sweep)** — Hardened `trialDowngrade.js`, the flag-14 site with a date on it: both the expired-trial scan and the per-user update now report (`trial.downgrade.scan_failed` / `trial.downgrade.failed`), and the summary line counts rows CHANGED instead of rows FOUND — it previously logged "Downgraded 2 expired trial(s)" even when every update failed. Bundle 26, mutation-checked, battery green (1613 PASS). Then traced the transition read-only and confirmed the job will work on Aug 6/8 by running the real UPDATE inside a rolled-back transaction. Found and filed flag 23.
- **2026-07-27 (autonomous run)** — Flag 19 design pass, read-only: established that the ring selector is cosmetic (`dunbar_tier` has no backend reader), that `is_core_five` has no writer at all (`coreFive.js` is a TODO stub), and that consequently the free-plan proactive layer is dead — filed as flags 21 and 22, neither previously known. Documented the health-score formula and its two quirks. Continued the flag-14 sweep: hardened `relationships.js` ×2, `memory.js` ×3 and `consent.js`, as bundles 23/24/25, each mutation-checked and each merged separately with a full green battery (1590 PASS, safety 161). Deferred `briefEngine.js:355` because it needs a shared prelude edit affecting ~14 bundles. Removed 9 merged worktrees under `.claude/worktrees/`. Verified prod: `/health` 200, `environment="production"` on all 342 log lines, all 7 cron jobs registered, zero error-level lines. Opened flag 20 (supersession fail-closed decision).
- **2026-07-27** — Corrected **Law 6** first: BOTH repos deploy on push (the Railway service is repo-linked), where it previously said only the frontend did — which implied the backend was safer. Then un-gated `days_since_contact` in `v_people_for_agent` (removed `OR contact_frequency_days IS NULL` from that branch only). Applied to prod with a purpose-built script because the runner's verification is vacuous for a view replacement; both Lucas now read 2 days, hand-verified; the health-score branch was the in-transaction control and is byte-identical. Shipped a verbatim rollback artifact. Recorded that `CREATE OR REPLACE VIEW` preserves dependents when the column list is unchanged, and added a proof row for view replacements. Enumerated what the fix wakes up (insights recency, frontend drift + row subtitles). Flag 12's view half closed, frontend half still open; flag 19 opened for the never-written `contact_frequency_days` behind the still-dead health score.
- **2026-07-26 (last)** — Closed flag 16, and it was wider than filed: `needsFreshStart` returned the Twilio opt-in script for a first-ever crisis message, which is worse than the cap case. Added **STAGE B2.5** to `pipeline/index.js` — a pure `evaluateSafety(body).action === 'crisis'` pre-check gating both short-circuits, building no reply so the crisis response keeps exactly one author. Four functional lines. Benchmarked `evaluateSafety` (5.94 µs typical, linear scaling, no ReDoS) to justify running it before a rate limit. Added **Bundle 22**; mutation-checked — reverting `index.js` fails 10 assertions and prints the opt-in script as the reply to "i want to kill myself". `safetyDetection.js` imported, never edited; import authorized by Emil.
- **2026-07-26 (latest)** — Closed flag 11. `getMessageQuota` / `getNudgeUsage` now emit a structured `quota.read.failed` event on error or missing row; healthy reads stay silent; return contracts and every verdict unchanged. **Kept failing OPEN deliberately** — the deciding factor was not cost but that STAGE B3 precedes the Priority 0 crisis gate, so failing closed could answer a crisis message with the rate-limit template. Recorded the spend picture (only ceiling, no cost consumers, no alerting) and the `grep '^  FAIL'` discipline after a section heading reading "FAILS OPEN" made a green run look red. Added **Bundle 21**, mutation-checked. Opened flags 16, 17 and 18.
- **2026-07-26 (late)** — Closed the §6 work at the root. `isInSuppressionWindow()` now logs its three abnormal branches (query error / no user row / thrown) and stays silent on the legitimate NULL branch; control flow unchanged, still fails OPEN. Made under an **explicit narrow Law-2 exception from Emil** — `isInSuppressionWindow` only; `safetyDetection.js` and `voiceGuard.js` untouched. Added **Bundle 20**, the first suite anywhere to run the real `safetyFlags.js`, and mutation-checked it (reverting the fix turns it red, exit 1). New proof row: a new test is not proof until you have watched it fail. Recorded that `reliability-core.js`'s fake Supabase cannot drive error/throw branches, so failure-path suites need their own prelude. Flags 10 and 15 closed.
- **2026-07-26 (evening)** — Armed the §6 crisis cooldown. One additive column (`app_users.crisis_suppressed_until`, timestamptz/nullable/no default) applied via the runner; **no code change, `safetyFlags.js` untouched (Law 2)**. Corrected the same-day note that said the column does not exist. Added: the `run-migration.mjs` schema-qualifier parse failure (fails closed, but silently doesn't apply), the measured `run-all.sh` false-pass trap (banner at 46%, 13 suites after it), the `app_users` `updated_at` trigger, and the fact that no test imports `safetyFlags.js`. New proof row for arming an inert guard. New Lesson 12 (removing the cause is not removing the shape); old 12 → 13. Flag 10 half-closed; flag 15 opened for Emil's Law-2 decision.
- **2026-07-26** — Moved into the `cedrus-backend` repo root and made load-bearing (`CLAUDE.md`, `README.md`, `NOTES.md` all now open with a pointer to it). Added the silent-guard census results: the `supabase-js` never-throws contract and the 45 unbound call sites (new Lesson 11), the crisis-suppression column that doesn't exist, the `days_since_contact` NULL guard, and the `run-all.sh` mid-script success line. Closed flags 3 and 4 — flag 3 was **disproven** (contact events are written; the bug is a view guard) and flag 4 was **not a bug** (two panels, two tables, both accurate). Answered flag 1. Opened flags 10–14. Renumbered old Lesson 11 to 12.
- **2026-07-25** — Created after a day that began with three consecutive wrong diagnoses of a live silent-write incident and ended with six stations merged and deployed. Every lesson from 1 to 13 is from that day.

---

# PART III. SYSTEMS INVENTORY

What each repo is, where it deploys, how environment variables actually reach the runtime, and what is currently broken in it. **A session touching a repo for the first time reads this part first.** This part exists because `cedrus-miami` surprised us repeatedly, and every surprise is now written down here instead.

## III.1. `cedrus-backend`

The SMS assistant and its rail. Node, Postgres on Railway.

- **Deploys:** Railway, on push to main, roughly 40 to 50 seconds.
- **Env:** Railway service variables, read normally.
- **Tests:** `sh test/run-all.sh`. **Gate on `echo $?`, never on the banner.** `ALL WS-B SUITES PASSED` prints around 46% of the way through with a dozen suites still to run. Assert the count of suite banners appearing after it.
- **Rigs:** there are **three** concat rigs. Grep all three whenever imports change.
- **Migrations:** run through the runner, in order, before the code that needs them. The runner verifies DDL only.
- **Untouchable:** `safetyDetection.js`, `safetyFlags.js`, `voiceGuard.js`.
- **Open:** `BRIEF_DRY_RUN` stays `true` until a named arming session. `DAILY_TOKEN_BUDGET` and `DAILY_SMS_BUDGET` unset on Railway, so the budget guard is deployed but disarmed. The two admin router mounts remain unproven.

**Added 2026-08-04, from the reboot audit of current `main` (`6723c0a`).** Source-read only; nothing was run against prod.

- **There is no calendar or OAuth code anywhere in this repo.** `grep -rniE '\bcalendar\b|oauth|googleapis|google' src/` returns only unrelated hits: a Twilio auth token, two comments about calendar *dates* (`07_persist.js:62`, `memory.js:119`), a "google" verb inside `search.js`'s web-search intent regexes, one brief renderer string, and `chatImport.js:19`'s note that import is file-upload only and "never OAuth." **The Google Calendar connection is greenfield.** No scaffolding to reuse, and none to trip over.
- **There is no Today surface in this repo.** Today is a frontend concept (`cedrus-frontend/src/lib/cedrus/today.ts`). The backend serves its ingredients (goals, reminders, insights, briefs) and has no Today endpoint. A backend Today or pace-card rail is new work, not a rewiring.
- **Goals infrastructure is real and is the strongest asset for the reboot.** `services/goals.js` + `routes/api/goals.js` (`/api/goals`) implement user-authored goals, partitioned from the pipeline's inferred weekly intentions by `origin` in **both** directions (`user_set` vs `cedrus_inferred`), plus a pure deterministic `selectVitalFew()` ranking with a 3 to 5 focus band. The founding release's three goal lanes fit this without a schema change.
- **Onboarding steps already match the new direction.** `onboardingAnswers.js:28` — `work_setup, neighborhood, free_windows, activities, current_groups, people, social_prefs`. `neighborhood`, `free_windows`, `work_setup` and `activities` are exactly the pre-Calendar Today inputs Part I section 6.9 names. Answers land as facts on the user's `is_self` person row via `memory.addFact`, which throws on failure, so a saved step really landed.
- **Phone identity is stored digits-only here and E.164 on the website.** `users.findOrCreateByPhone` calls `normalizePhone` and stores `17869727469`; `cedrus-miami` stores `phone_e164` as `+17869727469` (`cedrus.functions.ts:38`, `parsePhoneE164` in `cedrus.ts`). **These do not join without normalization.** Any work reconciling a website signup with an SMS user must normalize on one side; do not assume a string match. See the reboot plan section 15.
- **`app_users` has no location or neighborhood column.** `discovery.js:342` says so in a comment on its default user-location read. Neighborhood currently lives only as an onboarding fact. Places work that assumes a structured location field is assuming a column that is not there.

**Added 2026-08-05 — stale worktree registrations.** `git worktree list` in this repo carries **two registrations pointing at a dead `/sessions/rcw-01k1dddomdq8n4ukfcopnrmc/mnt/Cedrus/_worktrees/` mount** left by the cloud-machine migration: `goals-lane` (`feat/goals-lane` @ `0990199`) and `voice-personas` (`feat/voice-personas` @ `58ee981`). Git reports both **prunable**. The directories that exist locally under `_worktrees/` with those names are **content-only copies with broken `.git` pointers** — they are not the registered worktrees and are not checkouts. **Both branch tips are safe as refs in this repo**, so nothing is at risk; `git worktree prune` is metadata cleanup that deletes no files. Two more of the same shape live in `cedrus-frontend` (III.2). Observed 2026-08-05.

## III.2. `cedrus-frontend`

The main web app at cedrus.life. The pre-pivot experience lives intact at `/classic`.

- **Deploys:** on push to main. **Push is deploy.**
- **Preservation law:** `/classic` and everything under it stays working. `/terms`, `/privacy`, `/support`, `/sms` stay at root because they are registered with Twilio; breaking them breaks compliance verification.
- **Tests:** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- **Lint baseline:** roughly 103 pre-existing prettier errors. Report the delta only.
- **Note:** `routeTree.gen.ts` is generated. Regenerate it, never hand-edit.

**Added 2026-08-04, from the reboot audit (`63e1fde`). Read-only; this repo was not modified.**

- **This repo and `cedrus-miami` are two different visual identities, not two skins of one.** Here: `src/styles.css` `:root` is warm and light, olive/brown/cream raws (`--brand-olive #737f45`, `--brand-cream #f2efe6`), display face Cormorant Garamond with Nunito Sans body, plus a second `--v1-*` token set using Fraunces and a full motion vocabulary (`v1-arrive`, `v1-stagger`, `v1-scene`, `v1-grow-in`). In `cedrus-miami`: near-black `oklch(0.07 0 0)`, DM Sans throughout, glass cards, shimmer and floating orbs. **Neither is wrong; they cannot both be Cedrus.** Filed as an open decision in Part I section 17.
- **Reusable without the retired product attached:** the `--v1-*` token set and motion primitives, `components/v1/` (`V1Shell`, `WindowChip`, `ui.tsx`), and the `CdSection` pattern behind `components/cedrus/TodaySections.tsx` (titled section, first-class `empty` state, optional `accent`). The empty-state-as-a-prop convention is worth carrying over: a Today that is honestly empty is a requirement of Part I section 6.9, not an edge case.
- **Belongs to the retired direction:** `components/v1/screens/Garden.tsx`, `Seedling.tsx`, `TreeGlyph.tsx` and the friendship-stage vocabulary; the ring / Dunbar-tier selector (cosmetic, see II.5); and the relationship-CRM framing of `people.tsx` and `PersonProfile.tsx`. Do not port these forward as the wedge.
- **Preservation law is unchanged by the reboot.** `/classic`, `/terms`, `/privacy`, `/support`, `/sms` all stay. cedrus.life being dormant (Part I section 14) means *do not develop it*; it does not mean let it break.

**Added 2026-08-05 — stale worktree registrations.** Same shape as III.1's, two more of them: `git worktree list` here carries `life-reboot` (`feat/life-reboot` @ `cf79437`) and `life-product-experience-v2` (`feat/life-product-experience-v2` @ `f2f322b`), both pointing at the dead `/sessions/rcw-01k1dddomdq8n4ukfcopnrmc/mnt/Cedrus/_worktrees/` mount and both reported **prunable**. Local `_worktrees/` directories of those names are content-only copies with broken `.git` pointers. Both branch tips are safe as refs in this repo. Four dead registrations across the two repos in total. Observed 2026-08-05 — note the boardroom report of the same date records `life-product-experience-v2` at `9c90803`; the observed tip is `f2f322b`, and the observation wins (Law 12).

## III.3. `cedrus-miami`

The waitlist page at cedrus.miami. Built in Lovable. **This is the repo that has caused every recent surprise.**

- **Stack:** Vite, Bun, TanStack Router, Supabase.
- **Server code:** `.server.ts` files running on **Cloudflare Workers via Lovable Cloud**. There are no Supabase edge functions in this project.
- **Deploys:** on push, but **a push updates preview only. Reaching the live app requires a publish from Lovable.** Testing the live URL after a push and before a publish tests the old build.
- **Two writers:** Lovable writes to this repo every time it is prompted, and so do you. One editor at a time. `git pull` before and after every Lovable session.

### Environment variables, the part that cost eighteen hours

**Worker bindings are not on `process.env`.** Read them through `getCloudflareContext()`, via the shared `getEnv()` helper in `auth.server.ts`. Code written against `process.env` works locally and reads undefined in production.

**Lovable reserves the `SUPABASE_` prefix** for its own managed integration and refuses to create a secret with that name. It injects `SUPABASE_URL` but **not** `SUPABASE_SERVICE_ROLE_KEY`. The workaround is `CEDRUS_SERVICE_ROLE_KEY`, set by hand in Lovable Cloud Secrets, read first with the reserved name as fallback.

**Two separate secret stores exist** and are easy to confuse. Lovable Cloud → Secrets holds the Worker environment. Supabase → Manage secrets holds edge function secrets, which this project does not use.

### Data

Supabase project `cedrus-waitlist`, ref `mnptemyleobxgsuuoppq`, us-east-1.

Three tables: `contacts`, `consent_events`, `event_registrations`. All RLS-enabled with a single `TO service_role` policy each and nothing for `anon`. The anon key is hardcoded in `client.ts`, so **RLS is doing one hundred percent of the security work.** Never write a policy granting `anon` SELECT on any of these tables.

`create_cedrus_registration` is `SECURITY DEFINER` with a pinned `search_path`, revoked from PUBLIC, granted to `service_role` only.

### Known open bugs

**All six re-audited against current `main` (`6e07832`) on 2026-08-04, by reading source only.** No prod query was run, so per Lesson 2 nothing below is evidence about the live database. Nothing was closed.

1. **No transaction. STILL OPEN, confirmed.** `src/lib/cedrus.functions.ts` `submitCedrusSignup` does four independent round-trips: duplicate check (`:61`), contact insert (`:75`), consent insert (`:94`), registration RPC (`:115`). An RPC failure leaves an orphan contact, and that person is then told "already on the list" forever with no seat. Unchanged since the flag was filed.
2. **Consent inserts are unchecked. STILL OPEN, confirmed, and there are two sites not one.** `cedrus.functions.ts:94` (`await supabase.from("consent_events").insert([...])`) and `:245` (the withdrawal write in `updateEmailPreference`) both discard the result. `supabase-js` resolves `{ data, error }` rather than throwing (Lesson 11), so a failed compliance write produces no exception, no log, and a successful-looking response. This is the compliance record, so it is the worst place in the codebase for a silent failure.
3. **`consent_events` has no `created_at` column. REWORDED 2026-08-04, not closed.** The authored schema declares **`occurred_at timestamptz NOT NULL DEFAULT now()`** (`supabase/migrations/20260731003901_*.sql`), so the consent record is not undated, which is what this flag implied. The real issue is narrower: the column is named `occurred_at`, and any code or export written against `created_at` will fail or silently read nothing. **Migration files are not evidence about prod (Lesson 2)** — settle prod with `SELECT to_regclass` / a column read before relying on either name.
4. **`position` is a Postgres reserved word. STILL OPEN, and it is currently unquoted.** Both versions of `create_cedrus_registration` use bare `MAX(position)` and a bare `position` in the INSERT column list (`20260731003901_*.sql`, `20260731105004_registration_position_race.sql`). It parses today in these positions; it threw once already during migration work. Quote it everywhere.
5. **Three files still read `process.env`. STILL OPEN, and they are not equally dangerous.** Confirmed by `grep -rn "process\.env" src/`:
   - `src/routes/api/public/resend-webhook.ts:8` — **this is the live one.** It is a real mounted route, and Worker bindings are not on `process.env` (Lesson 15), so `RESEND_WEBHOOK_SECRET` reads `undefined` in production. The handler then logs a warning and **returns HTTP 200**, so Resend sees success and every delivery, bounce, and complaint event is silently discarded. That is Lesson 1's exact shape, and it breaks the "Resend events flow back to Supabase" half of the consent model the moment broadcasts start.
   - `src/integrations/supabase/client.server.ts:33-34` and `src/integrations/supabase/auth-middleware.ts:36-37` — both are Lovable-generated ("do not edit directly") and both have **zero importers anywhere in `src/`**. They are dead code today. `client.server.ts` also reads `SUPABASE_SERVICE_ROLE_KEY`, the name Lovable will not inject (Lesson 14), so if anything ever did import it it would fail twice over. The live signup path does not use it: it uses `createServiceClient()` in `src/lib/cedrus.server.ts`, which correctly goes through `getEnv()` and reads `CEDRUS_SERVICE_ROLE_KEY` first.
6. **Something still probes for a `waitlist` table. UNRESOLVED — no code evidence found, and NOT closed.** A full search of `src/` and `supabase/` finds no query, RPC, or type referencing a `waitlist` table. The only hits are a `contacts.source` column default of `'waitlist_page'`, component names (`WaitlistForm`, `WaitlistCounter`), and prose. **Absence from the code is not proof the 404s stopped** (Lesson 3: what result would I see if this were still happening?) — the probe could come from the Supabase client's schema cache, a Lovable-injected integration, or a stale generated type. Settle it with a network trace on a real page load or the Supabase API logs, not another grep.

### Further findings from the 2026-08-04 reboot audit

Source-read only, current `main` (`6e07832`).

7. **The live page violates the invisible-cap rule (Part I section 15).** `src/components/WaitlistCounter.tsx` polls `getHeldRegistrationCount()` every 30 seconds and renders "**N** seats held". The rule is explicit: "The page never mentions a number. No '50 spots,' no counter, no scarcity theater." The count is real, so trust law item 3 (no fabricated counts) is not breached, but the doctrine is. The reboot retires the seat model entirely, which removes this.
8. **The live page runs a public countdown to an unconfirmed event.** `src/components/CountdownTimer.tsx` counts down to `config.eventDate = "2026-08-21T11:00:00"`. Part I section 10's publishing rule was "the date does not go on the public page until the venue is confirmed. A public countdown is a promise, and a broken one costs the list." The venue was never confirmed. **The rule was right and it was shipped past.** Worth recording as an incident, not just a task.
9. **August 21 is hard-coded in six places**, three of them in the database rather than the code: `config.ts:eventDate`; `cedrus.functions.ts:118` (`_event_date: "2026-08-21"`); `cedrus.functions.ts:266` (the count filter); `index.tsx:50` (JSON-LD `Event.startDate`, which publishes the date to search engines); the `event_registrations.event_date` column **default**; and the `create_cedrus_registration(_event_date date DEFAULT '2026-08-21')` argument default. Removing the date from the page does not remove it from the schema.
10. **Unsubscribe is recorded but not enforced.** `updateEmailPreference` writes a `consent_events` row with `action='withdrawn'` and nothing else. `contacts` has no permission-state column (`id, full_name, email_normalized, phone_e164, source, created_at`), so current permission cannot be read, only reconstructed by replaying the event log. Harmless today because no broadcast sender exists. **It must be closed before the first marketing send** or rule 7 of the consent model (filter against current Supabase permission state) is unsatisfiable. See Part I section 15.
11. **Over-cap signups are written as `status='expired'`.** The RPC assigns `held` for positions 1 to 50 and `expired` for 51 onward, so someone who never had a place is stored in the state meaning "had a place, lost it," colliding with the documented lifecycle `held → confirmed → declined → expired → attended → no_show`. Any analysis of the existing rows must account for this.
12. **The position race was fixed and the fix is real.** `20260731105004_registration_position_race.sql` adds `pg_advisory_xact_lock(hashtext(_event_date::text))` inside the RPC plus a `UNIQUE (event_date, position)` backstop. Recorded because the earlier read-then-insert shape is the kind of thing that gets re-flagged.
13. **`getHeldRegistrationCount` is an unauthenticated server function** returning a live count of held registrations. It exists only to feed the counter in finding 7 and should go with it.

## III.4. External services

| Service | Role | Notes |
|---|---|---|
| Resend | All outbound email | Sends from `updates.cedrus.life`, reply-to `emil@cedrus.life`. Webhook not yet created; needed before the first broadcast. |
| Twilio | SMS only | A2P consent must be affirmative, unbundled, unchecked by default. |
| Purelymail | Human inbox | Owns the root DMARC via CNAME, policy `p=reject`. Never edit root records to suit a sending subdomain. |
| Supabase | Canonical customer and consent record | Resend is a delivery projection; its events flow back by webhook. |
| Porkbun | Registrar and DNS | Cloudflare-powered. Root of trust for everything. 2FA enabled 31 July 2026. |
| Railway | `cedrus-backend` hosting | |
| Lovable Cloud | `cedrus-miami` hosting, on Cloudflare Workers | |

**Cleanup owed:** the DNS zone still carries leftover SendGrid records on the root domain, which authorize an old SendGrid account to DKIM-sign as cedrus.life. Remove once launch is stable.
