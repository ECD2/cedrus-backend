// ─────────────────────────────────────────────────────────────────────────────
// Weekly-note canonical composer (WS-F / N2).
//
// THE invariant this module owns: one canonical generated record per
// (user, week_of) — the existing public.briefs + public.brief_items rows —
// and every channel (SMS preview, email, future web/in-app) RENDERS that
// record. Channels never re-derive, never re-compose, never write a second
// generation. The DB backstop is briefs' UNIQUE (user_id, week_of, brief_type);
// this module is the code path that respects it.
//
// Dependency-injected on purpose: no imports of config/supabase here, so the
// module is directly importable from bun tests and concatenatable in the
// dependency-free bundle runner. The job (src/jobs/briefEmail.js) wires the
// real adapters.
//
//   deps = {
//     briefs:   { createBrief, clearBriefItems, addBriefItem },   // existing service
//     gather:   (user) => candidates,                             // jobs/brief/gather.js
//     select:   (user, candidates) => plan,                       // jobs/brief/select.js
//     db:       { getBrief, listBriefItems, listPeopleNames },    // small read adapter
//   }
//
// voiceGuard is imported directly: it is pure and dependency-free, and the
// band law should never be faked out in tests.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveBand } from '../voiceGuard.js';

// Ensure the canonical record for (user, weekOf) exists and return it loaded.
// Idempotent by construction:
//   • the briefs row is an upsert on (user_id, week_of, brief_type);
//   • items are written ONLY when the record has none yet — if the SMS job (or
//     a previous email run) already recorded items, they are reused verbatim;
//   • re-running any number of times never duplicates a row or an item.
export async function ensureCanonicalBrief(deps, user, weekOf) {
  const brief = await deps.briefs.createBrief({ userId: user.id, weekOf });
  let items = await deps.db.listBriefItems(brief.id);

  if (!items.length) {
    const candidates = await deps.gather(user);
    const plan = deps.select(user, candidates);
    // Same recordable mapping as the SMS job (weeklyBrief.js), so whichever
    // job materializes the week first, the record is identical in shape.
    const recordable = [
      ...(plan.goalFollowup ? [{ type: 'goal_followup', personId: null, detail: plan.goalFollowup.goalText, priority: 50 }] : []),
      ...plan.items,
    ];
    // Guard the invariant against a concurrent first-writer: clear, then write.
    await deps.briefs.clearBriefItems(brief.id);
    for (const it of recordable) {
      await deps.briefs.addBriefItem({
        briefId: brief.id, userId: user.id, personId: it.personId || null,
        itemType: it.type, body: it.detail, priority: it.priority || 50,
      });
    }
    if (plan.teaser) {
      await deps.briefs.addBriefItem({
        briefId: brief.id, userId: user.id, itemType: 'pro_teaser', isProLocked: true, priority: 30,
        body: `${plan.teaser.count} outside circle slipping: ${plan.teaser.names.join(', ')}`,
      });
    }
    items = await deps.db.listBriefItems(brief.id);
  }

  return loadCanonicalBrief(deps, user, weekOf, { brief, items });
}

// Read-only load of the canonical record (no generation). Returns null when
// the week has no record yet. Accepts preloaded rows to avoid re-reads.
export async function loadCanonicalBrief(deps, user, weekOf, preloaded = null) {
  const brief = preloaded?.brief ?? await deps.db.getBrief(user.id, weekOf);
  if (!brief) return null;
  const rawItems = preloaded?.items ?? await deps.db.listBriefItems(brief.id);

  // Person names are joined at load: brief_items stores person_id only.
  const ids = [...new Set(rawItems.map((i) => i.person_id).filter(Boolean))];
  const names = ids.length ? await deps.db.listPeopleNames(ids) : {};

  const items = rawItems
    .map((i) => classifyItem(i, names))
    .sort(byCanonicalOrder);

  return { user, weekOf, brief, items, tier: planTier(user) };
}

// ── Valence classification (voice spec §8: check the band of any fact before
// including it as a data point; safety spec §7: crisis content never appears).
// The stored source_data may some day carry an explicit band/crisis flag from
// the extraction pipeline; until then resolveBand's deterministic escalators
// (loss language → negative) are the marker we key off. Escalate-only.
function classifyItem(row, names) {
  const src = row.source_data || {};
  const modelBand = typeof src.valence_band === 'string' ? src.valence_band : 'routine';
  let band = resolveBand({ modelBand, body: row.body, facts: [] });
  if (src.crisis_flagged === true) band = 'crisis';
  return {
    id: row.id,
    briefId: row.brief_id,
    personId: row.person_id || null,
    personName: row.person_id ? (names[row.person_id] || null) : null,
    type: row.item_type,
    // Copy law: no em or en dashes anywhere in rendered output. Stored bodies
    // are extraction-derived; normalize once here so EVERY channel inherits it.
    body: String(row.body || '').replace(/\s*[—–]\s*/g, ', ').replace(/\s{2,}/g, ' ').trim(),
    priority: row.priority ?? 50,
    isProLocked: row.is_pro_locked === true,
    band,
  };
}

// Deterministic order (ranking spec): priority desc, then created-at implied
// insert order via id string compare as the stable final tie-break.
function byCanonicalOrder(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return String(a.id) < String(b.id) ? -1 : 1;
}

// Same tier logic as the SMS selector (module-private there, tiny, restated).
export function planTier(user) {
  if (user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user.plan === 'trialing') return 'trial';
  return 'free';
}

// ── Renderable view of the record ────────────────────────────────────────────
// The single content gate every channel shares. Tonight's law (N2): the crisis
// suppression flag is not queryable yet (needs WS-C schema), so anything with
// negative valence markers is EXCLUDED outright, and crisis-band content is
// excluded unconditionally (safety §7). Sensitive-neutral items stay, but the
// renderer must not frame them cheerfully, and their presence suppresses the
// Pro teaser for the whole note (voice §4 / ranking stage-0 gate 9).
export function renderableItems(record) {
  const visible = record.items.filter((i) => !i.isProLocked);
  const kept = visible.filter((i) => i.band !== 'negative' && i.band !== 'crisis');
  const excluded = visible.length - kept.length;
  const hasSensitive = kept.some((i) => i.band === 'sensitive_neutral');
  const teaserStored = record.items.some((i) => i.isProLocked && i.type === 'pro_teaser');
  return {
    items: kept,
    excludedCount: excluded,
    hasSensitive,
    // Aggregate line only, Free only, and never beside sensitive content.
    showTeaser: teaserStored && record.tier === 'free' && !hasSensitive,
  };
}

// ── SMS preview (1–3 items) ─────────────────────────────────────────────────
// The SMS is a preview of the SAME record: top 1–3 kept items, all different
// people, at least one date-critical item when one exists, plus the secure
// view link. Budget: 2 UCS-2 segments = 134 chars once the 🌲 is present;
// over budget drops whole items, never truncates mid-sentence.
const SMS_BUDGET = 134;
const DATE_CRITICAL = new Set(['birthday', 'saved_item']);

export function smsPreview(record, { viewUrl }) {
  const { items } = renderableItems(record);
  const picked = pickPreviewItems(items, 3);
  // Display form drops the scheme ("cedrus.life/n/…" per the product
  // examples); SMS clients still link it, and the budget gains 8 chars.
  const displayUrl = String(viewUrl).replace(/^https?:\/\//, '');

  for (let n = picked.length; n >= 1; n--) {
    const text = previewText(picked.slice(0, n), displayUrl);
    if (text.length <= SMS_BUDGET) return { text, items: picked.slice(0, n) };
  }
  const quiet = `Your week 🌲 A quiet one. Full note: ${displayUrl}`;
  return { text: quiet, items: [] };
}

function pickPreviewItems(items, max) {
  const out = [];
  const seenPeople = new Set();
  const ordered = [...items];
  // Guarantee a date-critical lead when one exists anywhere in the note.
  const dateIdx = ordered.findIndex((i) => DATE_CRITICAL.has(i.type));
  if (dateIdx > 0) ordered.unshift(ordered.splice(dateIdx, 1)[0]);
  for (const it of ordered) {
    if (out.length >= max) break;
    if (it.personId && seenPeople.has(it.personId)) continue;
    if (it.type === 'goal_followup') continue; // an aside, not a preview item
    if (it.personId) seenPeople.add(it.personId);
    out.push(it);
  }
  return out;
}

function previewText(items, viewUrl) {
  const parts = items.map(previewSentence).filter(Boolean);
  const body = parts.length ? parts.join(' ') + ' ' : 'A quiet one. ';
  return `Your week 🌲 ${body}Full note: ${viewUrl}`;
}

// One short sentence per item, deterministic, warm, no cheer words needed.
function previewSentence(it) {
  const name = it.personName;
  switch (it.type) {
    case 'birthday':
      return name ? `${name}'s ${it.body}.` : `A ${it.body}.`;
    case 'drift':
      return name ? `${name}: ${it.body}.` : null;
    case 'life_event':
      return name ? `${name}, ${it.body}.` : null;
    case 'saved_item':
      return name ? `${it.body} with ${name} coming up.` : `${it.body} coming up.`;
    default:
      return it.body ? `${it.body}.` : null;
  }
}
