// Render the N2 sample weekly-note emails Emil can open in the morning.
//   bun scripts/render-n2-samples.mjs
// Writes docs/n2-samples/: for each scenario a .eml (open in Mail), a .html
// (open in a browser), the plaintext part, and the paired SMS preview.
// Deterministic: fixed send moment, fixed fixture data, sample-only secret.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCanonicalBrief, loadCanonicalBrief, renderableItems, smsPreview } from '../src/services/brief/composer.js';
import { renderEmail } from '../src/services/brief/renderer.js';
import { issueActionToken, issueUnsubscribeToken } from '../src/services/brief/tokens.js';
import { buildMime } from '../src/services/brief/transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'docs', 'n2-samples');
fs.mkdirSync(OUT, { recursive: true });

const NOW = new Date('2026-07-19T12:00:00.000Z'); // Sunday 08:00 America/New_York
const WEEK = '2026-07-13';
const LINK_BASE = 'https://cedrus.life';
const SAMPLE_SECRET = 'n2-sample-secret-not-production';

function makeStore(people = {}) {
  const briefs = [];
  const items = [];
  let seq = 0;
  const briefsSvc = {
    async createBrief({ userId, weekOf }) {
      let b = briefs.find((x) => x.user_id === userId && x.week_of === weekOf);
      if (!b) { b = { id: 'b' + (++seq), user_id: userId, week_of: weekOf, brief_type: 'weekly', status: 'generated' }; briefs.push(b); }
      return { id: b.id };
    },
    async clearBriefItems(briefId) { for (let i = items.length - 1; i >= 0; i--) if (items[i].brief_id === briefId) items.splice(i, 1); },
    async addBriefItem({ briefId, userId, personId = null, itemType, body, isProLocked = false, priority = 50 }) {
      items.push({ id: 'i' + (++seq), brief_id: briefId, user_id: userId, person_id: personId, item_type: itemType, body, is_pro_locked: isProLocked, priority, source_data: {} });
    },
  };
  const db = {
    async getBrief(userId, weekOf) { return briefs.find((x) => x.user_id === userId && x.week_of === weekOf) || null; },
    async listBriefItems(briefId) { return items.filter((x) => x.brief_id === briefId).map((x) => ({ ...x })); },
    async listPeopleNames(ids) { const m = {}; for (const id of ids) if (people[id]) m[id] = people[id]; return m; },
  };
  // token store (in-memory, sample only)
  const tokens = [];
  const tokenDb = {
    async insertToken(row) { const r = { id: 't' + tokens.length, ...row }; tokens.push(r); return r; },
    async supersedeTokens() {},
  };
  return { briefsSvc, db, tokenDb, briefs, items };
}

async function buildLinks(store, record) {
  const view = await issueActionToken({ db: store.tokenDb }, { userId: record.user.id, briefId: record.brief.id, actionType: 'view_full_brief', now: NOW });
  const itemActions = {};
  const actionable = renderableItems(record).items.filter((i) => (i.band === 'routine' || i.band === 'positive') && i.personId).slice(0, 2);
  for (const it of actionable) {
    const snooze = await issueActionToken({ db: store.tokenDb }, { userId: record.user.id, briefId: record.brief.id, briefItemId: it.id, actionType: 'remind_tomorrow', now: NOW });
    itemActions[it.id] = { remindUrl: `${LINK_BASE}/note/action/${snooze.raw}` };
  }
  const unsub = issueUnsubscribeToken({ secret: SAMPLE_SECRET, userId: record.user.id, now: NOW });
  return {
    viewUrl: `${LINK_BASE}/n/${view.raw}`,
    privacyUrl: `${LINK_BASE}/privacy`,
    controlsUrl: `${LINK_BASE}/settings/note`,
    unsubscribeUrl: `${LINK_BASE}/email/unsubscribe/${unsub}`,
    itemActions,
  };
}

async function renderScenario(slug, user, plan, people, extraItems = []) {
  const store = makeStore(people);
  const deps = { briefs: store.briefsSvc, gather: async () => ({}), select: () => plan, db: store.db };
  let record = await ensureCanonicalBrief(deps, user, WEEK);
  for (const it of extraItems) await store.briefsSvc.addBriefItem({ briefId: record.brief.id, userId: user.id, ...it });
  record = await loadCanonicalBrief(deps, user, WEEK);

  const links = await buildLinks(store, record);
  const email = renderEmail(record, { now: NOW, links });
  const sms = smsPreview(record, { viewUrl: links.viewUrl });
  const { mime } = buildMime({ to: 'emil.chaia@gmail.com', subject: email.subject, html: email.html, text: email.text, unsubscribeUrl: links.unsubscribeUrl, now: NOW });

  fs.writeFileSync(path.join(OUT, `${slug}.eml`), mime, 'utf8');
  fs.writeFileSync(path.join(OUT, `${slug}.html`), email.html, 'utf8');
  fs.writeFileSync(path.join(OUT, `${slug}.txt`), email.text, 'utf8');
  fs.writeFileSync(path.join(OUT, `${slug}.sms-preview.txt`), `${sms.text}\n(${sms.text.length} chars, ${sms.items.length} preview item(s) from the same record)\n`, 'utf8');
  console.log(`rendered ${slug}: ${email.meta.renderedItemIds.length} rows, teaser=${email.meta.teaserShown}, excluded=${email.meta.excludedCount}`);
}

const PEOPLE = { p1: 'Ana', p2: 'Marco', p3: 'Valentina', p4: 'Luis', p5: 'Sam' };

// 1 — Trial user, a full week: birthday, life event, drift, tracked event,
//     last week's intention. Also proves the valence gate: one stored item
//     carries loss language and is excluded from every channel.
await renderScenario('01-trial-full-note',
  { id: 'u1', name: 'Emil', timezone: 'America/New_York', plan: 'trialing', billing_status: 'trialing' },
  {
    items: [
      { type: 'birthday', personId: 'p1', personName: 'Ana', detail: 'birthday in 3 days', priority: 100 },
      { type: 'life_event', personId: 'p3', personName: 'Valentina', detail: 'started a new job at the hospital', priority: 66 },
      { type: 'drift', personId: 'p2', personName: 'Marco', detail: "haven't talked in about 3 weeks", priority: 62 },
      { type: 'saved_item', personId: 'p4', personName: 'Luis', detail: 'Jazz night (Jul 24)', priority: 56 },
      { type: 'life_event', personId: 'p5', personName: 'Sam', detail: 'his father passed away last month', priority: 90 },
    ],
    goalFollowup: { goalText: 'make time for dad' },
    teaser: null, quiet: false,
  },
  PEOPLE);

// 2 — Free user: five in focus, the single aggregate Pro line (exact copy,
//     no names), a per-person locked teaser row that must NOT leak names.
await renderScenario('02-free-note-with-teaser',
  { id: 'u2', name: 'Emil', timezone: 'America/New_York', plan: 'free', billing_status: 'canceled' },
  {
    items: [
      { type: 'birthday', personId: 'p1', personName: 'Ana', detail: 'birthday is tomorrow', priority: 100 },
      { type: 'drift', personId: 'p2', personName: 'Marco', detail: "haven't talked in about 5 weeks", priority: 62 },
    ],
    goalFollowup: null, teaser: null, quiet: false,
  },
  PEOPLE,
  [{ itemType: 'pro_teaser', isProLocked: true, priority: 30, body: '3 outside circle slipping: Nadia, Tom' }]);

// 3 — Quiet week: honest calm, one small thing, nothing manufactured.
await renderScenario('03-quiet-week',
  { id: 'u3', name: 'Emil', timezone: 'America/New_York', plan: 'trialing', billing_status: 'trialing' },
  { items: [], goalFollowup: null, teaser: null, quiet: true },
  PEOPLE);

console.log(`\nsamples in ${OUT}`);
