# Cedrus Consulting — Source of Truth

*v1.0 — 9 September 2026. Supersedes `cedrus-business-vision.md`. This is the document every new chat, Cowork session, and Codex session reads first for the business direction. `CEDRUS.md` in the backend repo remains the engineering canon; this file never overrides it.*

---

## 0. The three names, and what each one means

Getting this straight is what the last draft got wrong.

| Name | What it is | Analogy |
|---|---|---|
| **Cedrus** (Cedrus Consulting) | The company. A consulting platform that sells AI installations, agents, and advisory to small businesses and individuals. | LLM.co is a consulting platform that happens to sell a box. So are we. |
| **Cedrus Engine** | The runtime. Programs, the daily brief, SMS, skills, execution, memory, isolation. The thing that actually runs. Every product below is the Engine with different skills loaded and a different skin on top. | The kernel. |
| **The products** | Named, branded things a customer buys. Each is the Engine configured for a use. | What's on the price list. |

**Rule:** the Engine is one codebase. Products are configurations. Interfaces are skins. We never fork the Engine to make a product.

---

## 1. Thesis

**The output of good thinking has nowhere to live.**

In a company, it's stuck in one person's head — the owner knows the pricing logic, the vendor terms, the reason things are done this way, and none of it is written down.

For an individual, it's stuck in a transcript. You have a long, useful conversation with an AI, it produces a real plan, and the plan sits there as text. To use it you'd have to build the spreadsheet, set the alarms, and re-read the chat every time you forget a detail. Miss one day and it's stale, because nothing maintains it.

**Cedrus takes the result of thinking — a conversation, a transcript, an interview, a head full of process — and turns it into something that runs, remembers, and updates itself.**

### The transcript angle, stated as a product capability

Everyone now records meetings and talks to AI. The transcripts pile up and nothing happens to them. A core Engine capability is: *feed Cedrus a transcript, get a native game plan* — dated, assigned, tracked, visible to everyone who needs it. For an individual that's a training plan from a coaching chat. For a business it's the action list from Monday's meeting, already in the system by Monday afternoon. This is the same skill, run twice.

---

## 2. Purpose, mission, vision

**Purpose.** Small businesses run on knowledge that lives in one person's head. When that person is busy, the company slows down. When that person leaves, the company breaks. Large companies have solved this with six-figure software. Small companies have been handed a chat box that knows nothing about them. Cedrus exists to close that gap.

**Mission.** To give every small business, and every serious individual, the institutional memory and operating leverage that only large organisations could afford.

**Vision.** A decade out: setting up a small business means a lawyer, an accountant, and a Cedrus install. Owning your company's brain is as ordinary as owning your books.

---

## 3. Values (the ones that constrain decisions)

1. **Verified, not asserted.** We show the client the thing working. This is how the Engine is built; it is how it gets sold.
2. **They own it.** Data, machine, and export path belong to the client. If they fire us they keep everything. Said in the sale, because it kills the biggest objection and it's true.
3. **No dependency by design.** Every install has a named owner inside the company and a runbook written for them, not for us.
4. **Say what's unverified.** If we don't know whether something works in their environment, we say so before they pay.

---

## 4. The wedge

Not "AI for your business." Roughly 77% of non-adopting small businesses already believe AI doesn't apply to them; arguing them out of it is a losing sale.

The wedge is a question every owner answers instantly:

> **"If the person who knows how this place runs left tomorrow, what breaks?"**

They always know. That's a felt, expensive, already-budgeted problem, and the fix is exactly what the Engine does. It sidesteps the ChatGPT comparison entirely — ChatGPT doesn't know their vendors.

**The numbers behind it:** knowledge workers spend ~19% of hours searching for information they should already have; ~42% of institutional knowledge sits solely with individual employees; new hires take 6–12 months to full productivity; one departure at a small business costs $15k–$100k+. A 10-person shop losing 45 minutes a day per person to hunting and asking is bleeding nearly a full headcount. We sell against that number, not against a $20 subscription.

---

## 5. Products (branded, buyable)

Everything below is the Engine. The names are what the customer sees.

### Cedrus Second Brain
**The flagship.** A company's brain on a machine it owns — documents, email, process knowledge, and the people who know things — ingested into the Engine, with skills built for the workflows that matter, reachable from anywhere on the company's own tailnet. Sold with hardware (Mac Studio or Mac mini, billed as a visible pass-through) or onto hardware the client already has.

Target: companies of ten or fewer. Buyer: the owner.

### Cedrus Personal
A single-user Engine. Three jobs, in order: **proof** (an owner holds the thing before spending $12k), **bridge** (the transcript-to-plan capability is where an individual first feels the thesis), and **R&D lane** (every personal skill enters the library and business installs inherit it).

Not a separate app. Same Engine, same interface, consumer skin.

### Cedrus Agents *(the catalogue)*
Discrete, narrower things the Engine can be sold as: a chatbot for a website, an intake agent, a scheduling agent, a follow-up agent. Individually generic. Collectively, they're the revenue that walks in the door when someone finds us for a reason other than the flagship. Each one is a skill from the library with a front on it.

This is what keeps us a consulting platform rather than a single-product company. Money that would otherwise be left on the table.

---

## 6. Services (how the products get delivered)

These are not products. They're how a client gets from "interested" to "running."

| Service | Price | Time | What it is |
|---|---|---|---|
| **Audit** | $2,500 | 1 week | The Knowledge Risk Map. Interviews, systems inventory, a written document of what breaks and what's recoverable. Deliverable with a laptop and a notebook. Useful even if they never buy anything else — which is the point. Converts to an install at a target of 50%. |
| **Install** | $9,500 + hardware at cost + 15% | 2–3 weeks | The brain download. Ingestion, three skills built for the workflows the Audit named, the machine delivered and configured, team training, runbook handed to a named internal owner. |
| **Operate** | $1,800/month, 60-day cancellation | ongoing | Uptime, monitoring, model costs, updates, up to 4 hours of changes a month. New workflows scoped separately. |
| **Cedrus Personal** | $149/month | — | The single-user product, sold as a subscription. |
| **Advisory / generalist work** | hourly or scoped | — | Whatever a trusted client asks for next. Automate their intake, clean their CRM, build the dashboard. Yes, and an invoice. |

Pricing benchmarks: assessments run $2k–$5k in market; fractional AI officers $2k–$8k/month for SMBs; most SMBs spend $10k–$50k on a first AI project. We price at the low end on purpose — solo operator, no brand tax, win on price against firms.

---

## 7. Scope: narrow pitch, broad delivery

This is a consulting business. Refusing work that pays is how consultancies die.

**What we market is narrow.** One problem, one phrase, one pitch — the company brain — because the generic "AI for your business" position is crowded and the specific one gets us in the room.

**What we deliver is whatever the client will pay for.** Multiple revenue streams are the point: flagship installs, personal subscriptions, agents from the catalogue, advisory. None of them is allowed to be the only one.

The constraint is on the *pitch*, never the *scope*.

**On owning a search term:** worth ~2 hours, not 20. Six clients come from network and referral, not Google. Revisit at 20+ clients.

---

## 8. Economics

**Path to $12k/month:** 6 Operate clients ($10,800) plus ~1 Install per quarter (~$3,200 amortised). Target: six to eight clients. Not a hundred.

**Why it gets better:** install #10 reuses the skills library from installs #1–9. First install might take 60 hours; the fifth should take 25. That delta is the whole business.

**Watch the labour line.** If install hours aren't dropping by client #4, the skills aren't reusable and this is hourly consulting. Price accordingly and stop pretending otherwise.

---

## 9. The skills library — the asset

Everyone in this space sells retrieval: *ask your documents a question.* Cedrus sells **capability**: things the Engine does.

Onboard a new hire · Answer "where is X and what's our policy on it" · Turn a transcript into a dated plan · Draft from house templates · Pull a client's full history before a meeting · Run a ten-week training block · Update the brain when something changes

Each one, built once, is portable across every product and every client. The library is the moat, the margin, and the reason install #10 is profitable. **It is also the thing with no home in the Engine yet** — see §13.

---

## 10. Interface: one engine, two skins

Two products, one component system, one codebase. A theme swap, not a fork.

| | Cedrus (personal) | Cedrus for Business |
|---|---|---|
| Voice | Warm, first-person, "your day" | Plain, operational, "the company" |
| Mascot | Present — the cedar, as *state* not decoration | Reduced to the canopy mark. No face. |
| Density | Airy, one thing at a time | Denser, scannable, tables allowed |
| Home surface | Today | The brain: what's known, what's missing, what's due |

Same surfaces underneath: Now / Day / Programs / Runs / Atlas / Connect. Same data shapes. The skin is a token file and a copy file.

**We may end up naming the skins as different products.** Undecided. What's decided is that they never diverge in code.

---

## 11. Brand

**Cedrus.** Cedar — slow-growing, long-lived, the tree you plant for the next generation. Right for a product about institutional memory.

**The mascot** — four growth stages: seed → sapling → young tree → full canopy. Maps directly onto the product ladder and onto a program's progress. Design direction for whoever is drawing it:

1. **Use growth as state, not decoration.** A new program is a seedling. It grows as the program completes. That gives the mascot a job.
2. **Name it.** Unnamed mascots don't stick.
3. **Flat-shade a version.** The current render is painterly and detailed; it won't survive 24px as a favicon or app icon. Need a simplified cut.
4. **The eyes are the whole face — use them.** One additional variant where it *looks toward* the thing it wants you to do. That's enough expression; don't build a face library.
5. **Business skin gets the silhouette.** Same canopy shape as a mark, no eyes, no rocks, no moss. Same tree, no face.
6. **Never animate it talking.** It's a companion, not an assistant with a speech bubble.
7. Keep it off invoices and the MSA.

**Voice:** plain and concrete. No "unlock," "supercharge," "transform."

**Retired:** "Cedrus chip." Say "the Cedrus install" or "Cedrus OS."

---

## 12. What we are and are not

- A consulting platform with a flagship product and a catalogue. Not a single-product company.
- Not a *native* SaaS company. Some catalogue items may be SaaS. The flagship is not.
- Not an IT provider. We don't fix printers or manage networks.
- Not an Apple reseller. Hardware is a pass-through at near-zero margin, and it's a differentiator: in a world where everyone builds fast, handing over a box that already works is rare.
- Not venture-backed, and not pretending to be.

---

## 13. Known risks and open decisions

**1. Concurrency — unresolved.** Local model serving queues; one machine handles ~2–3 light concurrent users. Ten employees on one box is not automatic. Needs a real answer before the first multi-user sale. The M5 Ultra with 512GB of unified memory shipped in August, which changes the ceiling — but that's an expected number, not a measured one.

**2. Quality vs. privacy — decision owed in writing before client conversation #1.** Local models are private but weaker; cloud models are strong but undercut the ownership story. Current Engine runs on cloud APIs. Recommended position: **hybrid by default, disclosed plainly, with a fully local option priced higher.** Privacy is the reassurance, not the headline. *Emil to write his version.*

**3. Skills have no home in the Engine.** The ledger has no item that defines what a skill *is* — how it's packaged, loaded, versioned, or shared across accounts. It is the biggest asset and it does not exist as a concept in code. This goes after Phase 6, not before, but it goes in the ledger.

**4. Hardware supply.** Maxed Mac Studios have run 10–12 week lead times at ~$18k. Never promise a delivery date before the machine is ordered.

**5. Support burden.** We become an operational dependency for someone else's company. Mitigated by named owner, runbook, documented export, published response times. Not eliminated.

**6. Founder capacity.** ~20 hours/week. Six clients is the ceiling for one person. That's the goal, so it's fine.

**7. The ceiling.** A good living, not a venture outcome. Chosen on purpose.

---

## 14. How the business direction touches the build

The engineering ledger (`docs/BUILD_PLAN.md`, 54 tasks, currently 11 done) runs from today to "Emil logs in as a normal user." **The business direction does not reorder it.** Everything sellable sits on top of Phases 0–3.

What it changes:

- **Phase 4 (Connect the interface)** becomes the V10 handoff. C4.1's keep/rebuild list is now the brief for a rebranded interface with two skins. See the Codex prompt.
- **Phase 6, R6.2 (programs)** pulls forward as a *data foundation only*. The triathlon plan is both Emil's real use and the sales demo. Three additive tables, no rendering until Phase 4.
- **Phase 8 (Mac Studio)** doubles as install #1 of Cedrus Second Brain, timed. M8.2's benchmark answers the quality/privacy question with measured numbers.
- **New, post-Phase 6:** a skills phase. Not scheduled yet.

Everything else stands.

---

## 15. Next 90 days

**Days 1–14 — prove the install.** Mac Studio arrives. Install #1 is Emil, father, brother. Timed. Log hours and every judgment call a stranger's business wouldn't permit.

**Days 1–14 — test the sale, in parallel.** Three Miami owner conversations. The brain question, then: *"If I spent two weeks getting that out of their head and into a system your team can ask, and it cost ten thousand dollars — yes or no?"* No hardware, no Cedrus mentioned.

**Days 15–45 — first paid Audit.** $2,500, laptop and notebook. Cash before code.

**Days 45–90 — first Install.** One client, done properly, runbook and testimonial. Then stop and look at the hours.

**Kill criteria:** nobody pays $2,500 for an Audit by day 45 → the interest was the free kind. Cedrus stays private and this document goes in a drawer.
