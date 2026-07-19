// N2 weekly-note email — content proofs (composer, renderer, SMS preview).
// Runs directly under bun/node against the REAL modules (real voiceGuard law).
//   bun test/brief-email-content.test.mjs
//
// Covers: canonical-record idempotency, the single-record invariant across
// channels, negative/crisis exclusion, sensitive handling + teaser
// suppression, brand + copy law, caps, muted register, quiet week, and the
// renderer snapshot for a fixture user (golden files in test/fixtures/).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCanonicalBrief, loadCanonicalBrief, renderableItems, smsPreview } from '../src/services/brief/composer.js';
import { renderEmail } from '../src/services/brief/renderer.js';
import { COPY, BRAND } from '../src/services/brief/template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const println = console.log;
let failures = 0;
function check(name, cond, detail) {
  if (cond) println('  PASS  ' + name);
  else { failures++; println('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

const NOW = new Date('2026-07-19T12:00:00.000Z'); // Sunday 08:00 America/New_York
const WEEK = '2026-07-13';

// In-memory store with the live tables' semantics (briefs UNIQUE per
// user/week/type; items append-only rows).
function makeStore(people = {}) {
  const briefs = [];
  const items = [];
  let seq = 0;
  const calls = { select: 0 };
  const briefsSvc = {
    async createBrief({ userId, weekOf }) {
      let b = briefs.find((x) => x.user_id === userId && x.week_of === weekOf && x.brief_type === 'weekly');
      if (!b) { b = { id: 'b' + (++seq), user_id: userId, week_of: weekOf, brief_type: 'weekly', status: 'generated' }; briefs.push(b); }
      return { id: b.id };
    },
    async clearBriefItems(briefId) {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].brief_id === briefId) items.splice(i, 1);
    },
    async addBriefItem({ briefId, userId, personId = null, itemType, body, isProLocked = false, priority = 50 }) {
      items.push({
        id: 'i' + (++seq), brief_id: briefId, user_id: userId, person_id: personId,
        item_type: itemType, body, is_pro_locked: isProLocked, priority, source_data: {},
      });
    },
  };
  const db = {
    async getBrief(userId, weekOf) {
      return briefs.find((x) => x.user_id === userId && x.week_of === weekOf && x.brief_type === 'weekly') || null;
    },
    async listBriefItems(briefId) { return items.filter((x) => x.brief_id === briefId).map((x) => ({ ...x })); },
    async listPeopleNames(ids) { const m = {}; for (const id of ids) if (people[id]) m[id] = people[id]; return m; },
  };
  return { briefs, items, briefsSvc, db, calls };
}

const PEOPLE = { p1: 'Ana', p2: 'Marco', p3: 'Valentina', p4: 'Luis' };

function richPlan() {
  return {
    userName: 'Emil', planTier: 'trial', selfNote: null,
    items: [
      { type: 'birthday', personId: 'p1', personName: 'Ana', detail: 'birthday in 3 days', priority: 100 },
      { type: 'life_event', personId: 'p3', personName: 'Valentina', detail: 'started a new job at the hospital', priority: 66 },
      { type: 'drift', personId: 'p2', personName: 'Marco', detail: "haven't talked in about 3 weeks", priority: 62 },
      { type: 'saved_item', personId: 'p4', personName: 'Luis', detail: 'Jazz night (Jul 24)', priority: 56 },
    ],
    goalFollowup: { goalText: 'make time for dad', personName: null },
    teaser: null, quiet: false,
    closingQuestion: 'Who do you want to make time for this week?',
  };
}

function deps(store, plan) {
  return {
    briefs: store.briefsSvc,
    gather: async () => ({}),
    select: () => { store.calls.select++; return plan; },
    db: store.db,
  };
}

const TRIAL_USER = { id: 'u1', name: 'Emil', timezone: 'America/New_York', plan: 'trialing', billing_status: 'trialing' };
const FREE_USER = { id: 'u1', name: 'Emil', timezone: 'America/New_York', plan: 'free', billing_status: 'canceled' };

function links(record) {
  const actionable = renderableItems(record).items.filter((i) => i.personId).slice(0, 2);
  const itemActions = {};
  for (const it of actionable) itemActions[it.id] = { remindUrl: `https://cedrus.life/note/action/TESTSNOOZE${it.id}` };
  return {
    viewUrl: 'https://cedrus.life/n/TESTVIEWTOKEN',
    privacyUrl: 'https://cedrus.life/privacy',
    controlsUrl: 'https://cedrus.life/settings/note',
    unsubscribeUrl: 'https://cedrus.life/email/unsubscribe/v1.TESTPAYLOAD.TESTMAC',
    itemActions,
  };
}

(async () => {
  // ── canonical record: idempotency + reuse ────────────────────────────────
  println('composer: one canonical record per user per week, re-runs never duplicate');
  {
    const store = makeStore(PEOPLE);
    const d = deps(store, richPlan());
    const r1 = await ensureCanonicalBrief(d, TRIAL_USER, WEEK);
    const nBriefs = store.briefs.length;
    const nItems = store.items.length;
    const r2 = await ensureCanonicalBrief(d, TRIAL_USER, WEEK);
    check('one briefs row after two ensures', store.briefs.length === 1 && nBriefs === 1);
    check('item rows unchanged after re-run', store.items.length === nItems, `${store.items.length} vs ${nItems}`);
    check('both runs return the same brief id', r1.brief.id === r2.brief.id);
    check('generation ran exactly once (record reused, never re-composed)', store.calls.select === 1, String(store.calls.select));
  }

  println('composer: an existing record (e.g. written by the SMS job) is reused verbatim');
  {
    const store = makeStore(PEOPLE);
    // Simulate the SMS job having already materialized this week's record.
    const d0 = deps(store, richPlan());
    await ensureCanonicalBrief(d0, TRIAL_USER, WEEK);
    const before = store.items.map((i) => i.id).join(',');
    // A later email run with a WILDLY different would-be plan must not touch it.
    const d1 = deps(store, { items: [{ type: 'birthday', personId: 'p9', detail: 'birthday is today', priority: 100 }], goalFollowup: null, teaser: null, quiet: false });
    const record = await ensureCanonicalBrief(d1, TRIAL_USER, WEEK);
    check('items identical to the first materialization', store.items.map((i) => i.id).join(',') === before);
    check('the different plan was never generated into the record', store.calls.select === 0 || !record.items.some((i) => i.personId === 'p9'));
  }

  // ── the single-record invariant across channels ──────────────────────────
  println('invariant: SMS preview and full email render from the SAME record');
  {
    const store = makeStore(PEOPLE);
    const record = await ensureCanonicalBrief(deps(store, richPlan()), TRIAL_USER, WEEK);
    const L = links(record);
    const email = renderEmail(record, { now: NOW, links: L });
    const sms = smsPreview(record, { viewUrl: L.viewUrl });
    const recordIds = new Set(record.items.map((i) => i.id));
    check('every rendered email item is a record item', email.meta.renderedItemIds.every((id) => recordIds.has(id)));
    check('every SMS preview item is a record item', sms.items.every((i) => recordIds.has(i.id)));
    check('SMS preview items are a subset of the email rendering', sms.items.every((i) => email.meta.renderedItemIds.includes(i.id)));
    const reload = await loadCanonicalBrief(deps(store, richPlan()), TRIAL_USER, WEEK);
    const again = renderEmail(reload, { now: NOW, links: L });
    check('re-render from a fresh load is byte-identical (deterministic)', again.html === email.html && again.text === email.text);
  }

  // ── SMS preview shape ────────────────────────────────────────────────────
  println('sms preview: 1–3 items, distinct people, date-critical present, 2-segment budget');
  {
    const store = makeStore(PEOPLE);
    const record = await ensureCanonicalBrief(deps(store, richPlan()), TRIAL_USER, WEEK);
    const sms = smsPreview(record, { viewUrl: 'https://cedrus.life/n/TESTVIEWTOKEN' });
    check('opens with the canonical header', sms.text.startsWith('Your week 🌲 '), sms.text);
    check('1–3 items', sms.items.length >= 1 && sms.items.length <= 3, String(sms.items.length));
    const ppl = sms.items.map((i) => i.personId);
    check('all different people', new Set(ppl).size === ppl.length);
    check('a date-critical item is included', sms.items.some((i) => i.type === 'birthday' || i.type === 'saved_item'));
    check('within the 134-char UCS-2 two-segment budget', sms.text.length <= 134, String(sms.text.length));
    check('carries the secure view link (scheme-less display form)', sms.text.includes('Full note: cedrus.life/n/TESTVIEWTOKEN'));
    check('goal follow-up never rides in the preview', !sms.items.some((i) => i.type === 'goal_followup'));
  }

  // ── valence law ──────────────────────────────────────────────────────────
  println('valence: negative-band and crisis-flagged items never render anywhere');
  {
    const store = makeStore(PEOPLE);
    const plan = richPlan();
    plan.items.push({ type: 'life_event', personId: 'p2', personName: 'Marco', detail: 'his father passed away last month', priority: 90 });
    const record = await ensureCanonicalBrief(deps(store, plan), TRIAL_USER, WEEK);
    // Belt-and-suspenders: also plant an explicitly crisis-flagged row.
    store.items.push({ id: 'i99', brief_id: record.brief.id, user_id: 'u1', person_id: 'p3', item_type: 'life_event', body: 'checked into the hospital', priority: 95, is_pro_locked: false, source_data: { crisis_flagged: true } });
    const reloaded = await loadCanonicalBrief(deps(store, plan), TRIAL_USER, WEEK);
    const L = links(reloaded);
    const email = renderEmail(reloaded, { now: NOW, links: L });
    const sms = smsPreview(reloaded, { viewUrl: L.viewUrl });
    check('loss-language item classified negative', reloaded.items.find((i) => /passed away/.test(i.body))?.band === 'negative');
    check('negative item absent from email html', !email.html.includes('passed away'));
    check('negative item absent from email text', !email.text.includes('passed away'));
    check('negative item absent from sms preview', !sms.text.includes('passed away'));
    check('crisis-flagged item absent everywhere', !email.html.includes('checked into') && !sms.text.includes('checked into'));
    check('exclusions are counted for the completion report', email.meta.excludedCount >= 2, String(email.meta.excludedCount));
  }

  println('valence: sensitive-neutral renders muted (no cheer) and suppresses the teaser');
  {
    const store = makeStore(PEOPLE);
    const plan = richPlan();
    plan.items = [
      { type: 'birthday', personId: 'p1', personName: 'Ana', detail: 'birthday in 3 days', priority: 100 },
      { type: 'life_event', personId: 'p3', personName: 'Valentina', detail: 'moving apartments next week', priority: 66 },
    ];
    plan.goalFollowup = null;
    const record = await ensureCanonicalBrief(deps(store, plan), FREE_USER, WEEK);
    // Mark the life event sensitive via the (forward-compat) source_data band,
    // and give the Free user a stored per-person teaser row.
    const sensitive = store.items.find((i) => i.item_type === 'life_event');
    sensitive.source_data = { valence_band: 'sensitive_neutral' };
    sensitive.body = 'moving apartments next week! great fresh start';
    await store.briefsSvc.addBriefItem({ briefId: record.brief.id, userId: 'u1', itemType: 'pro_teaser', isProLocked: true, priority: 30, body: '2 outside circle slipping: Nadia, Tom' });
    const reloaded = await loadCanonicalBrief(deps(store, plan), FREE_USER, WEEK);
    const email = renderEmail(reloaded, { now: NOW, links: links(reloaded) });
    check('sensitive item still renders (it is not negative)', /moving apartments/i.test(email.html));
    check('cheer words stripped beside sensitive content', !/great/i.test(email.html));
    check('no exclamation point beside sensitive content (text part)', !email.text.includes('!'));
    check('no exclamation point in any card body (html)', !/!/.test(email.html.replace(/<!doctype html>/, '')));
    check('teaser suppressed for the whole note when sensitive content renders', !email.html.includes('Pro watches everyone'));
    check('locked per-person names never leak', !email.html.includes('Nadia') && !email.text.includes('Nadia'));
  }

  // ── free/pro + teaser ────────────────────────────────────────────────────
  println('tiering: Free gets exactly the aggregate teaser line, Pro gets none');
  {
    const store = makeStore(PEOPLE);
    const record = await ensureCanonicalBrief(deps(store, richPlan()), FREE_USER, WEEK);
    await store.briefsSvc.addBriefItem({ briefId: record.brief.id, userId: 'u1', itemType: 'pro_teaser', isProLocked: true, priority: 30, body: '2 outside circle slipping: Nadia, Tom' });
    const freeEmail = renderEmail(await loadCanonicalBrief(deps(store, richPlan()), FREE_USER, WEEK), { now: NOW, links: links(record) });
    check('aggregate teaser line renders exactly once, exact copy',
      freeEmail.html.split('There’s more happening outside your five. Pro watches everyone: $9/month.').length === 2);
    check('teaser names never render', !freeEmail.html.includes('Nadia'));
    const proEmail = renderEmail(await loadCanonicalBrief(deps(store, richPlan()), TRIAL_USER, WEEK), { now: NOW, links: links(record) });
    check('trial/pro note carries no upsell at all', !proEmail.html.includes('$9/month') && !proEmail.html.includes('Pro watches'));
  }

  println('tiering: Free is capped at 8 content rows, overflow points into the full note');
  {
    const store = makeStore(PEOPLE);
    const plan = { items: [], goalFollowup: null, teaser: null, quiet: false };
    for (let k = 1; k <= 7; k++) plan.items.push({ type: 'birthday', personId: 'x' + k, detail: `birthday in ${k} days`, priority: 100 - k });
    for (let k = 1; k <= 5; k++) plan.items.push({ type: 'drift', personId: 'y' + k, detail: 'starting to slip', priority: 60 - k });
    const record = await ensureCanonicalBrief(deps(store, plan), FREE_USER, WEEK);
    const email = renderEmail(record, { now: NOW, links: links(record) });
    check('≤8 rendered rows on Free', email.meta.renderedItemIds.length <= 8, String(email.meta.renderedItemIds.length));
    check('overflow note present and linked', email.text.includes(`${COPY.overflowNote} https://cedrus.life/n/TESTVIEWTOKEN`));
  }

  // ── copy law ─────────────────────────────────────────────────────────────
  println('copy law: no em dashes, never the word "brief", one 🌲, brand present');
  {
    const store = makeStore(PEOPLE);
    const plan = richPlan();
    plan.items[1].detail = 'started a new job — finally settling in';
    const record = await ensureCanonicalBrief(deps(store, plan), TRIAL_USER, WEEK);
    const email = renderEmail(record, { now: NOW, links: links(record) });
    const everything = email.subject + '\n' + email.preheader + '\n' + email.html + '\n' + email.text;
    check('no em or en dash anywhere', !/[—–]/.test(everything));
    check('stored em dash was normalized to a comma', /started a new job, finally settling in/i.test(email.html));
    check('the word "brief" never reaches the customer', !/\bbrief\b/i.test(everything));
    check('exactly one 🌲 in the html', email.html.split('🌲').length === 2);
    check('exactly one 🌲 in the text part', email.text.split('🌲').length === 2);
    check('subject is the stable header', email.subject === 'Your week 🌲');
    check('no person names in subject or preheader',
      !['Ana', 'Marco', 'Valentina', 'Luis'].some((n) => email.subject.includes(n) || email.preheader.includes(n)),
      email.preheader);
    check('brand colors present (olive, brown, cream, terracotta)',
      [BRAND.olive, BRAND.brown, BRAND.cream, BRAND.terracotta].every((c) => email.html.includes(c)));
    check('Garamond and Avenir stacks with fallbacks', email.html.includes('Garamond') && email.html.includes('Avenir') && email.html.includes('Georgia') && email.html.includes('Helvetica'));
    check('footer: standing privacy line exact', email.html.includes('Written from what you’ve shared with me. I never sell or share what you tell me about your people.'));
    check('footer: scoped unsubscribe copy exact', email.html.includes('Unsubscribe (email only, texts keep working)'));
    check('footer: delivery-controls line present', email.html.includes('Change when or how this arrives'));
    check('banned vocabulary absent', !/(inactive|locked|slots used|downgraded)/i.test(everything));
    check('no urgency inflation', !/only \d+ days? left/i.test(everything));
    check('under the 100KB clipping ceiling', email.html.length < 100000, String(email.html.length));
    check('goal follow-up renders as a gentle aside', email.html.includes('Still on your mind from last week: make time for dad.'));
    check('per-card snooze link present', /Remind me tomorrow/.test(email.html));
  }

  // ── muted register (suppression window) ──────────────────────────────────
  println('muted register: playful layer off, factual layer intact');
  {
    const store = makeStore(PEOPLE);
    const record = await ensureCanonicalBrief(deps(store, richPlan()), FREE_USER, WEEK);
    await store.briefsSvc.addBriefItem({ briefId: record.brief.id, userId: 'u1', itemType: 'pro_teaser', isProLocked: true, priority: 30, body: '1 outside circle slipping: Nadia' });
    const reloaded = await loadCanonicalBrief(deps(store, richPlan()), FREE_USER, WEEK);
    const muted = renderEmail(reloaded, { now: NOW, links: links(reloaded), muted: true });
    check('no 🌲 anywhere in the muted note', !muted.html.includes('🌲') && !muted.text.includes('🌲') && !muted.subject.includes('🌲'));
    check('no teaser in the muted note', !muted.html.includes('$9/month'));
    check('no one-small-thing suggestion', !muted.html.includes('ONE SMALL THING'));
    check('connection layer (drift) held back', !muted.html.includes('Marco'));
    check('date-critical facts still delivered (birthday)', muted.html.includes('Ana'));
    check('tracked events still delivered', muted.html.includes('Jazz night'));
    check('footer still complete (compliance never muted)', muted.html.includes('Unsubscribe (email only, texts keep working)'));
  }

  // ── quiet week ───────────────────────────────────────────────────────────
  println('quiet week: honest calm, never manufactured items');
  {
    const store = makeStore(PEOPLE);
    const record = await ensureCanonicalBrief(deps(store, { items: [], goalFollowup: null, teaser: null, quiet: true }), TRIAL_USER, WEEK);
    const email = renderEmail(record, { now: NOW, links: links(record) });
    check('quiet line renders', email.html.includes(COPY.quietLine));
    check('no empty section headers', !email.html.includes('THIS WEEK') && !email.html.includes('YOUR PEOPLE') && !email.html.includes('TRACKED EVENTS'));
    check('meta says quiet', email.meta.quiet === true);
  }

  // ── renderer snapshot (fixture user, golden files) ───────────────────────
  println('snapshot: fixture render matches the committed golden files');
  {
    const store = makeStore(PEOPLE);
    const record = await ensureCanonicalBrief(deps(store, richPlan()), TRIAL_USER, WEEK);
    const email = renderEmail(record, { now: NOW, links: links(record) });
    const goldenHtmlPath = path.join(__dirname, 'fixtures', 'weekly-note-golden.html');
    const goldenTextPath = path.join(__dirname, 'fixtures', 'weekly-note-golden.txt');
    fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
    if (!fs.existsSync(goldenHtmlPath) || !fs.existsSync(goldenTextPath)) {
      fs.writeFileSync(goldenHtmlPath, email.html, 'utf8');
      fs.writeFileSync(goldenTextPath, email.text, 'utf8');
      println('  NOTE  golden files created (bootstrap run); re-run to verify');
    }
    check('html matches golden', email.html === fs.readFileSync(goldenHtmlPath, 'utf8'));
    check('text matches golden', email.text === fs.readFileSync(goldenTextPath, 'utf8'));
    check('week range renders from the send moment', email.html.includes('July 19 to 25'));
    check('written line renders in the user timezone', email.html.includes('written Sunday at 8:00am'));
  }

  println('');
  println(failures === 0 ? 'ALL N2 CONTENT TESTS PASSED' : failures + ' TEST(S) FAILED');
  if (failures > 0) process.exit(1);
})();
