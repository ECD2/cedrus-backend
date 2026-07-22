import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { openai } from '../lib/openai.js';
import { logger } from '../utils/logger.js';
import { understand } from '../pipeline/05_understand.js';
import { isTautologicalFact } from '../pipeline/07_persist.js';
import * as people from './people.js';
import * as usage from './usage.js';
import { canonicalFactKey, SINGLE_VALUED_KEYS } from './memory.js';
import { sanitizeSearchResults } from './search.js';
import { parseChatExport, ImportParseError } from '../parsers/chatExport.js';
import { classifyFactTheme, containsSecret, scoreMessage, MIN_SCORE } from './importScope.js';
import { createImportStore } from './importJobs.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHAT MEMORY IMPORT (NF2-IMPORT) — "extract your memories from ChatGPT and
// Claude into Cedrus so it already has a picture of you."
//
// Beta scope: FILE-UPLOAD import only. Never live API access, never OAuth to
// an AI provider (S12 — a hard "never" in the parser discipline). Upload →
// parse (parsers/chatExport.js) → batched runs through the EXISTING
// extraction entry point understand() — used read-only, exactly as SMS and
// web capture use it — → PROPOSED people/facts only → review-confirm.
// Propose-then-confirm is law: nothing durable exists until the user
// explicitly accepts specific items (discipline §7).
//
// Where each discipline rule is enforced:
//   • untrusted data, never instructions — user-authored turns only (parser);
//     every excerpt passes sanitizeSearchResults() (the same injection
//     neutralizer the web-search path uses: markers defanged, URLs reduced,
//     control chars stripped) BEFORE the model sees it; the injected client
//     has no .responses surface, so performWebSearch() inside understand()
//     structurally no-ops — imported content can never trigger outbound
//     fetches; model output passes the allow-list whitelists below.
//   • six closed themes — importScope.classifyFactTheme(); unmatched = gone.
//   • crisis content — understand()'s Priority-0 gate + model second net run
//     unchanged on every batch. A crisis batch is QUARANTINED: nothing from
//     it is proposed or echoed, only a count survives (safety spec §7 — and
//     never turned into cheerful facts).
//   • raw retention 0 — the upload buffer is parsed and released inside
//     startImport(); the job object holds proposals + capped evidence quotes
//     only, never the file, never full messages.
//   • quota before model — lifetime cap counted from durable agent_runs rows
//     (never a mutable counter), in-flight cap from the store, both checked
//     before any model call. Parse rejections are free.
//   • provenance — every model call logs agent_runs run_type='chat_import';
//     confirm anchors one deterministic message row and every fact carries
//     source='imported' + source_message_id.
//
// Deviations from the older technical design §3, forced by tonight's rules
// (NEW FILES ONLY, no hosted-DB changes), all flagged in docs/MOUNT_IMPORT.md:
//   • previews live in the in-memory store, not ingested_items.
//   • facts are written by this file with source='imported' instead of
//     memory.addFact() (which can't take a source without an edit) — same
//     canonicalFactKey(), but NO supersession: a historical import must
//     never retire a fact the user told Cedrus directly. Single-valued keys
//     (memory.SINGLE_VALUED_KEYS — the one shared registry, not a local copy)
//     are skipped entirely when a current value exists; historical never
//     clobbers present.
//   • consent_events can't record import_confirmed (CHECK constraint allows
//     four SMS event types only) — audit rides the structured log stream,
//     agent_runs, and the anchor message row instead.
// ─────────────────────────────────────────────────────────────────────────────

// ── Knobs (env-tunable, safe defaults; no src/config.js edit needed) ────────
const envInt = (name, dflt) => {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};
export const limits = {
  get maxUploadBytes() { return envInt('IMPORT_MAX_BYTES', 50 * 1024 * 1024); },
  get maxJsonBytes() { return envInt('IMPORT_MAX_JSON_BYTES', 100 * 1024 * 1024); },
  get charBudget() { return envInt('IMPORT_CHAR_BUDGET', 120_000); },
  get batchChars() { return envInt('IMPORT_BATCH_CHARS', 3_500); },
  get maxModelCalls() { return envInt('IMPORT_MAX_MODEL_CALLS', 25); },
  get lifetimeMax() { return envInt('IMPORT_LIFETIME_MAX', 3); },
};

// Public copy (voice spec: warm, brief, no em dashes, no exclamation points;
// proposal-stage wording PROPOSES, never announces — discipline §7).
export const MSG_BAD_FILE = "That file doesn't look like a ChatGPT or Claude export. Download the export from your AI's settings and send that exact file over.";
export const MSG_TOO_LARGE = 'That file is bigger than I can take in one go. Export again and send the fresh file, or reach out and we will figure it out.';
export const MSG_EMPTY = "I couldn't find any of your own messages in that file. Double-check it's the export file itself, not a screenshot or a copy-paste.";
export const MSG_IN_FLIGHT = 'One import at a time. Yours is still working, check back in a minute.';
export const MSG_LIFETIME = "You've used all your imports for now. The memories you confirmed are safe, and you can always tell Cedrus new things directly.";
export const MSG_NOT_FOUND = "I couldn't find that import. It may have expired, so upload the file again and I'll take a fresh look.";
export const MSG_NOT_READY = "Still reading through it. Check back in a moment.";
export const MSG_NOTHING_ACCEPTED = 'Pick at least one thing to save, or discard the import.';

const PARSE_ERROR_MAP = {
  unsupported_type: [422, 'unsupported_type', MSG_BAD_FILE],
  invalid_zip: [422, 'invalid_file', MSG_BAD_FILE],
  encrypted_zip: [422, 'invalid_file', MSG_BAD_FILE],
  zip_missing_conversations: [422, 'invalid_file', MSG_BAD_FILE],
  invalid_json: [422, 'invalid_file', MSG_BAD_FILE],
  unsupported_format: [422, 'unsupported_format', MSG_BAD_FILE],
  file_too_large: [413, 'file_too_large', MSG_TOO_LARGE],
  empty_export: [422, 'empty_export', MSG_EMPTY],
};

const httpError = (status, code, message) =>
  Object.assign(new Error(message), { status, code, publicMessage: message });

const EVIDENCE_CHARS = 120; // ~15 words (DATA_INVENTORY §14's preview quota)

// The model client handed to understand(): chat-completions surface only.
// performWebSearch() requires client.responses.create and silently no-ops
// without it, so imported content can NEVER reach the web-search tool. This
// is structural (capability absent), not a prompt hope.
const chatOnlyClient = (real) => ({
  chat: { completions: { create: (args) => real.chat.completions.create(args) } },
});

const defaultStore = createImportStore();

// ── Batch building ──────────────────────────────────────────────────────────
// Score → keep signal → sanitize each excerpt → pack into batches. Sanitizing
// BEFORE batching means the model never sees raw imported bytes at all.
export function buildBatches(messages, { charBudget, batchChars, maxCalls } = {}) {
  const budget = charBudget || limits.charBudget;
  const perBatch = batchChars || limits.batchChars;
  const calls = maxCalls || limits.maxModelCalls;

  // Dedup identical / whitespace-only-different messages BEFORE scoring: a
  // re-pasted or duplicated conversation (a duplicated export, an idempotent
  // re-import) must not spend token budget or double-propose the same fact.
  // Identity is decided on a whitespace-collapsed, lowercased key; the first
  // original spelling is kept so evidence quotes stay faithful.
  const seen = new Set();
  const unique = [];
  for (const text of messages) {
    const norm = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(text);
  }

  const scored = [];
  for (const text of unique) {
    const score = scoreMessage(text);
    if (score >= MIN_SCORE) scored.push({ text, score });
  }
  scored.sort((a, b) => b.score - a.score);

  let used = 0;
  const kept = [];
  for (const m of scored) {
    if (used + m.text.length > budget) continue;
    used += m.text.length;
    kept.push(m.text);
  }

  const batches = [];
  let current = [];
  let currentLen = 0;
  for (const text of kept) {
    const { text: safe } = sanitizeSearchResults(text, { maxChars: 2000 });
    if (!safe) continue;
    if (currentLen + safe.length > perBatch && current.length) {
      batches.push(current.join('\n---\n'));
      current = []; currentLen = 0;
      if (batches.length >= calls) break;
    }
    current.push(safe);
    currentLen += safe.length + 5;
  }
  if (current.length && batches.length < calls) batches.push(current.join('\n---\n'));

  return { batches, consideredMessages: kept.length, scoredOut: unique.length - scored.length };
}

// ── Proposal assembly ───────────────────────────────────────────────────────
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const cleanName = (s) => String(s || '').trim().slice(0, 80);

function harvestBatch({ parsed, ownedIds, groups, evidenceByFactId, batchText }) {
  // People first: build mention → group key. The model proposes resolutions
  // against KNOWN PEOPLE; code disposes — a person_id outside this user's
  // people is DROPPED and the mention downgrades to 'new' (the same
  // cross-tenant backstop web capture applies before storing a proposal).
  const mentionToGroup = new Map();
  for (const p of parsed.people || []) {
    let personId = p.person_id && ownedIds.has(p.person_id) ? p.person_id : null;
    if (p.person_id && !personId) {
      logger.event('import.scrubbed_person_id', {
        level: 'warn', error_category: 'validation',
        message: "model proposed a person_id outside this user's people",
      });
    }
    const proposedName = cleanName(p.proposed_name || p.mention_text);
    if (!personId && (!proposedName || containsSecret(proposedName))) continue;
    // Self-facts ride on the user's own person; imports keep them too.
    const key = personId ? `p:${personId}` : `n:${normName(proposedName)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        person_id: personId,
        name: personId ? null : proposedName, // display name for existing ids filled later
        relationship: !personId && p.proposed_relationship
          ? cleanName(p.proposed_relationship).slice(0, 100) : null,
        matched_existing: Boolean(personId),
        mention_count: 0,
        facts: [],
      });
    }
    const g = groups.get(key);
    g.mention_count += 1;
    if (!g.relationship && !personId && p.proposed_relationship) {
      g.relationship = cleanName(p.proposed_relationship).slice(0, 100);
    }
    if (p.mention_text) mentionToGroup.set(p.mention_text, key);
  }

  // Facts: whitelist fields, canonicalize the key, then the six-theme gate.
  for (const f of parsed.facts || []) {
    const groupKey = f.person_ref != null && mentionToGroup.get(f.person_ref);
    if (!groupKey) continue; // a fact with no in-scope person is not memory
    const factValue = String(f.fact_value || '').trim().slice(0, 500);
    if (!factValue) continue;
    if (isTautologicalFact(f.fact_key, factValue)) continue;
    const theme = classifyFactTheme({ fact_type: f.fact_type, fact_key: f.fact_key, fact_value: factValue });
    if (!theme) continue; // out of the six themes → never stored, never echoed
    const key = canonicalFactKey(f.fact_key) || 'note';
    const g = groups.get(groupKey);
    const dupe = g.facts.find((x) => x.fact_key === key && x.fact_value.toLowerCase() === factValue.toLowerCase());
    const confidence = typeof f.confidence === 'number' && isFinite(f.confidence)
      ? Math.min(1, Math.max(0, f.confidence)) : 0.6;
    if (dupe) { dupe.confidence = Math.max(dupe.confidence, confidence); continue; }
    const id = crypto.randomUUID();
    const fact = {
      id,
      fact_type: ['preference', 'interest', 'life_event', 'relationship_detail'].includes(f.fact_type)
        ? f.fact_type : 'preference',
      fact_key: key,
      fact_value: factValue,
      confidence,
      theme,
      already_known: false,
    };
    g.facts.push(fact);
    // Evidence: a short quote from the SANITIZED batch containing the value's
    // first words — capped, never the raw file (DATA_INVENTORY: 15-word quotes).
    const probe = factValue.split(/\s+/).slice(0, 3).join(' ');
    const at = probe ? batchText.toLowerCase().indexOf(probe.toLowerCase()) : -1;
    evidenceByFactId.set(id, at >= 0
      ? batchText.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_CHARS)
      : null);
  }
}

// ── The extraction runner (async job body) ──────────────────────────────────
async function runExtraction({ job, user, messages, deps }) {
  const d = deps;
  try {
    const known = await d.listForUser(user.id);
    const ownedIds = new Set(known.map((p) => p.id));
    const nameById = new Map(known.map((p) => [p.id, p.name]));

    const { batches, consideredMessages } = d.buildBatches(messages, {});
    job.counts.considered_messages = consideredMessages;
    job.progress.batches_total = batches.length;

    // Lifetime quota row: written once, only when model work actually starts
    // (a no-signal export costs nothing). Durable on purpose — the count
    // survives restarts because it's rows, not a counter (discipline §10).
    if (batches.length) {
      await d.logAgentRun({
        userId: user.id, runType: 'chat_import_job', model: 'import-job', success: true,
      });
    }

    const groups = new Map();
    const evidenceByFactId = new Map();
    const client = chatOnlyClient(d.client);

    for (const batchText of batches) {
      const t0 = Date.now();
      let parsed;
      try {
        parsed = await d.understand({
          user,
          body: batchText,
          // KNOWN PEOPLE exactly as buildContext supplies it; no open prompts,
          // no recent messages — an import is not a conversation.
          context: { people: known, openPrompts: [], recentMessages: [] },
          client,
        });
      } catch (err) {
        job.counts.failed_batches += 1;
        job.progress.batches_done += 1;
        await d.logAgentRun({
          userId: user.id, runType: 'chat_import', model: 'unknown',
          success: false, errorMessage: String(err && err.message || err).slice(0, 200),
          latencyMs: Date.now() - t0,
        });
        continue; // one bad batch never kills the job
      }

      await d.logAgentRun({
        userId: user.id, runType: 'chat_import', model: parsed._model || 'unknown',
        promptTokens: parsed._usage && parsed._usage.prompt_tokens,
        completionTokens: parsed._usage && parsed._usage.completion_tokens,
        latencyMs: Date.now() - t0, success: true,
      });

      // Crisis quarantine (safety spec §7): the batch contributes NOTHING.
      // Content-free by construction — we keep a count, never the text.
      if (parsed._suppressPersistence || parsed._band === 'crisis') {
        job.counts.quarantined_batches += 1;
        job.progress.batches_done += 1;
        logger.event('import.batch.quarantined', {
          level: 'warn', outcome: 'quarantined',
          meta: { flags: parsed.flags || null }, // category tag only, never content
        });
        continue;
      }

      harvestBatch({ parsed, ownedIds, groups, evidenceByFactId, batchText });
      job.progress.batches_done += 1;
    }

    // Fuzzy backstop for NEW names (catches "Anna" ≈ existing "Ana" the model
    // missed) — dedup against the user's existing people is a hard
    // requirement of this feature, not a nicety.
    for (const g of groups.values()) {
      if (g.person_id) { g.name = nameById.get(g.person_id) || g.name; continue; }
      const match = await d.fuzzyFind(user.id, g.name);
      if (match && match.score >= 0.6) {
        g.person_id = match.id;
        g.matched_existing = true;
        g.name = nameById.get(match.id) || g.name;
      }
    }
    // Merging may have produced two groups for one person (model-resolved id +
    // fuzzy-matched name). Fold them together.
    const byIdentity = new Map();
    for (const g of groups.values()) {
      const key = g.person_id ? `p:${g.person_id}` : g.key;
      const into = byIdentity.get(key);
      if (!into) { byIdentity.set(key, g); continue; }
      into.mention_count += g.mention_count;
      for (const f of g.facts) {
        const dupe = into.facts.find((x) => x.fact_key === f.fact_key &&
          x.fact_value.toLowerCase() === f.fact_value.toLowerCase());
        if (dupe) dupe.confidence = Math.max(dupe.confidence, f.confidence);
        else into.facts.push(f);
      }
    }

    // Mark facts the user's memory already holds (same person, same canonical
    // key, same value): the review UI default-unchecks them and confirm
    // skips them, so re-importing can't duplicate memory.
    const existingIds = [...byIdentity.values()].filter((g) => g.person_id).map((g) => g.person_id);
    if (existingIds.length) {
      const { data: existing } = await d.db.from('facts')
        .select('person_id, fact_key, fact_value')
        .eq('user_id', user.id).eq('is_current', true).in('person_id', existingIds);
      // Canonicalize the stored key (D5): proposed keys are canonical, so a
      // legacy alias row (e.g. 'employer') must fold to 'job' to be recognised
      // as already-known and default-unchecked in the review UI.
      const have = new Set((existing || []).map((r) =>
        `${r.person_id}|${canonicalFactKey(r.fact_key)}|${String(r.fact_value).toLowerCase()}`));
      for (const g of byIdentity.values()) {
        if (!g.person_id) continue;
        for (const f of g.facts) {
          if (have.has(`${g.person_id}|${f.fact_key}|${f.fact_value.toLowerCase()}`)) f.already_known = true;
        }
      }
    }

    const groupList = [...byIdentity.values()]
      .filter((g) => g.facts.length || !g.matched_existing)
      .sort((a, b) => b.facts.length - a.facts.length || b.mention_count - a.mention_count);
    for (const g of groupList) {
      for (const f of g.facts) f.evidence = evidenceByFactId.get(f.id) || null;
    }

    job.proposals = { people: groupList };
    job.counts.people_proposed = groupList.length;
    job.counts.facts_proposed = groupList.reduce((n, g) => n + g.facts.length, 0);
    job.status = 'ready';
    logger.event('import.ready', {
      outcome: 'accepted',
      meta: {
        format: job.format,
        people: job.counts.people_proposed, facts: job.counts.facts_proposed,
        quarantined: job.counts.quarantined_batches, batches: job.progress.batches_total,
      },
    });
  } catch (err) {
    job.status = 'failed';
    job.error = 'extract_failed';
    logger.event('import.failed', {
      level: 'error', error_category: 'internal',
      message: (err && err.message) || String(err), // internal log only, client gets a code
    });
  }
}

// ── Public API: start ───────────────────────────────────────────────────────
export async function startImport({ user, buffer }, deps = {}) {
  if (!user || !user.id) throw new Error('startImport: user is required (ownership guard)');
  const d = {
    store: defaultStore, db: supabase, client: openai, understand,
    listForUser: people.listForUser, fuzzyFind: people.fuzzyFind,
    logAgentRun: usage.logAgentRun, buildBatches, now: Date.now, ...deps,
  };

  if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError(422, 'invalid_request', MSG_BAD_FILE);
  if (buffer.length > limits.maxUploadBytes) throw httpError(413, 'file_too_large', MSG_TOO_LARGE);

  // Parse first: local, free, and a rejected file must cost no quota
  // (discipline §10 — gate rejections never consume anything).
  let parsedFile;
  try {
    parsedFile = parseChatExport(buffer, { maxJsonBytes: limits.maxJsonBytes });
  } catch (err) {
    if (err instanceof ImportParseError) {
      const [status, code, msg] = PARSE_ERROR_MAP[err.code] || [422, 'invalid_file', MSG_BAD_FILE];
      logger.event('import.rejected', {
        level: 'warn', error_category: 'validation', outcome: 'rejected',
        message: err.code, // code only — never file content
      });
      throw httpError(status, code, msg);
    }
    throw err;
  }

  // Idempotent re-upload: same user, same bytes → the same job.
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = d.store.findByDigest(user.id, digest);
  if (existing) return { job: existing, done: Promise.resolve(existing), reused: true };

  // Quota gates, before any model work (in-flight from the store; lifetime
  // from durable agent_runs rows — counted, never incremented).
  if (d.store.countInFlight(user.id) >= 1) throw httpError(429, 'import_in_flight', MSG_IN_FLIGHT);
  const { count } = await d.db.from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('run_type', 'chat_import_job');
  if ((count || 0) >= limits.lifetimeMax) throw httpError(429, 'import_quota_exhausted', MSG_LIFETIME);

  const now = d.now();
  const job = {
    id: crypto.randomUUID(),
    userId: user.id,
    digest,
    format: parsedFile.format,
    status: 'extracting',
    createdAt: now,
    expiresAt: now + d.store.ttlMs,
    progress: { batches_done: 0, batches_total: null },
    counts: {
      conversations: parsedFile.conversations,
      user_messages: parsedFile.messages.length,
      considered_messages: 0,
      quarantined_batches: 0,
      failed_batches: 0,
      people_proposed: 0,
      facts_proposed: 0,
    },
    proposals: null,
    results: null,
    error: null,
  };
  d.store.put(job);

  logger.event('import.received', {
    outcome: 'accepted',
    meta: { format: job.format, bytes: buffer.length, user_messages: job.counts.user_messages },
  });

  // Raw retention 0: nothing below this line can reach the buffer or the
  // full message list — extraction gets the messages array, the job never
  // holds either, and both fall out of scope when this call returns.
  const done = runExtraction({ job, user, messages: parsedFile.messages, deps: d });
  return { job, done, reused: false };
}

// ── Public API: status ──────────────────────────────────────────────────────
export function publicJob(job) {
  const status = job.status === 'confirming' ? 'ready' : job.status;
  const out = {
    id: job.id,
    status,
    format: job.format,
    created_at: new Date(job.createdAt).toISOString(),
    expires_at: new Date(job.expiresAt).toISOString(),
    progress: job.progress,
    counts: job.counts,
    error: job.error,
  };
  if (status === 'ready' && job.proposals) out.proposals = job.proposals;
  if (status === 'confirmed' && job.results) out.results = job.results;
  return out;
}

export function getImport({ user, importId }, deps = {}) {
  if (!user || !user.id) throw new Error('getImport: user is required (ownership guard)');
  const d = { store: defaultStore, ...deps };
  const job = d.store.get(importId, user.id);
  if (!job) throw httpError(404, 'not_found', MSG_NOT_FOUND);
  return { import: publicJob(job) };
}

// ── Public API: confirm ─────────────────────────────────────────────────────
// accept = { all: true } | { people: [groupKey…], facts: [factId…] }.
// Accepting a person's key accepts that person + ALL its listed facts;
// accepting individual fact ids accepts those facts + their person. A person
// with none of its facts accepted is still created when its key is accepted
// (name + relationship only). already_known facts are never re-written.
export async function confirmImport({ user, importId, accept }, deps = {}) {
  if (!user || !user.id) throw new Error('confirmImport: user is required (ownership guard)');
  const d = {
    store: defaultStore, db: supabase, createPerson: people.create,
    fuzzyFind: people.fuzzyFind, listForUser: people.listForUser, ...deps,
  };

  const a = accept && typeof accept === 'object' ? accept : {};
  const wantAll = a.all === true;
  const wantPeople = new Set(Array.isArray(a.people) ? a.people.filter((s) => typeof s === 'string') : []);
  const wantFacts = new Set(Array.isArray(a.facts) ? a.facts.filter((s) => typeof s === 'string') : []);
  if (!wantAll && !wantPeople.size && !wantFacts.size) {
    throw httpError(422, 'invalid_request', MSG_NOTHING_ACCEPTED);
  }

  const job = d.store.takeForConfirm(importId, user.id);
  if (!job) {
    const peek = d.store.get(importId, user.id);
    if (peek && peek.status === 'extracting') throw httpError(409, 'not_ready', MSG_NOT_READY);
    throw httpError(404, 'not_found', MSG_NOT_FOUND);
  }

  try {
    const groups = (job.proposals && job.proposals.people) || [];
    const chosen = [];
    for (const g of groups) {
      const groupAccepted = wantAll || wantPeople.has(g.key);
      const facts = g.facts.filter((f) => !f.already_known &&
        (groupAccepted || wantFacts.has(f.id)));
      if (groupAccepted || facts.length) chosen.push({ g, facts });
    }
    if (!chosen.length) {
      d.store.restoreAfterFailedConfirm(job);
      throw httpError(422, 'invalid_request', MSG_NOTHING_ACCEPTED);
    }

    // Durable write #1 — the deterministic anchor message (template copy,
    // no imported content; discipline: finalized copy is never model text).
    // A retry after a mid-confirm failure reuses the existing anchor row, so
    // the whole confirm is idempotent end to end.
    const factCount = chosen.reduce((n, c) => n + c.facts.length, 0);
    const sourceName = job.format === 'chatgpt' ? 'ChatGPT' : 'Claude';
    const { data: priorAnchor } = await d.db.from('messages')
      .select('*').eq('user_id', user.id).eq('provider', 'import')
      .eq('provider_message_id', job.id).maybeSingle();
    let anchor = priorAnchor;
    if (!anchor) {
      const { data: inserted, error: anchorErr } = await d.db.from('messages').insert({
        user_id: user.id, direction: 'inbound', channel: 'web', provider: 'import',
        provider_message_id: job.id, message_type: 'import',
        body: `Imported from ${sourceName} export: ${chosen.length} people, ${factCount} facts confirmed.`,
        received_at: new Date().toISOString(),
      }).select('*').single();
      if (anchorErr) throw anchorErr;
      anchor = inserted;
    }

    // Existing current facts, re-fetched at commit time: the idempotency and
    // the historical-never-clobbers-present rules both key off this.
    const owned = new Set((await d.listForUser(user.id)).map((p) => p.id));
    const results = { people_created: 0, people_matched: 0, facts_saved: 0, facts_skipped: 0 };

    for (const { g, facts } of chosen) {
      let personId = g.person_id;
      let isNew = false;
      if (personId && !owned.has(personId)) {
        // Store integrity backstop; a foreign id in a stored group should be
        // impossible (scrubbed at harvest), but confirm re-checks anyway.
        results.facts_skipped += facts.length;
        continue;
      }
      if (!personId) {
        // A person may have appeared since extraction (an SMS conversation,
        // another import): fuzzy-match once more before creating.
        const match = await d.fuzzyFind(user.id, g.name);
        if (match && match.score >= 0.6) {
          personId = match.id;
          results.people_matched += 1;
        } else {
          const created = await d.createPerson(user.id, {
            name: g.name, relationship: g.relationship || null,
          });
          personId = created.id;
          isNew = true;
          results.people_created += 1;
        }
      } else {
        results.people_matched += 1;
      }

      const { data: currentRows } = await d.db.from('facts')
        .select('fact_key, fact_value').eq('user_id', user.id)
        .eq('person_id', personId).eq('is_current', true);
      // Key the idempotency + single-valued guard off the CANONICAL fact_key so
      // a legacy row stored under a non-canonical alias (e.g. 'employer' folds
      // to 'job') is still seen. Proposed facts are already canonical
      // (harvestBatch), so without this the guard misses legacy rows and an
      // import can add a duplicate row or fork a single-valued slot
      // (docs/EXTRACTION_AUDIT.md D5).
      const currentByKey = new Map();
      for (const r of currentRows || []) {
        const rk = canonicalFactKey(r.fact_key);
        if (!rk) continue;
        if (!currentByKey.has(rk)) currentByKey.set(rk, new Set());
        currentByKey.get(rk).add(String(r.fact_value).toLowerCase());
      }

      for (const f of facts) {
        const values = currentByKey.get(f.fact_key);
        // Idempotent: an identical current fact is a skip, not a duplicate.
        if (values && values.has(f.fact_value.toLowerCase())) { results.facts_skipped += 1; continue; }
        // Historical never clobbers present: single-valued keys are only
        // written when the person has NO current value for that key. Never
        // superseded from an import.
        if (SINGLE_VALUED_KEYS.has(f.fact_key) && values && values.size && !isNew) {
          results.facts_skipped += 1; continue;
        }
        const { error } = await d.db.from('facts').insert({
          user_id: user.id, person_id: personId, fact_type: f.fact_type,
          fact_key: f.fact_key, fact_value: f.fact_value, confidence: f.confidence,
          source: 'imported', source_message_id: anchor.id,
        });
        if (error) {
          logger.event('import.fact.skipped', {
            level: 'warn', error_category: 'db_error', message: error.message,
          });
          results.facts_skipped += 1;
          continue;
        }
        if (!currentByKey.has(f.fact_key)) currentByKey.set(f.fact_key, new Set());
        currentByKey.get(f.fact_key).add(f.fact_value.toLowerCase());
        results.facts_saved += 1;
      }
    }

    d.store.finishConfirm(job, results);
    logger.event('import.confirmed', {
      outcome: 'accepted',
      meta: { ...results, message_id: anchor.id, format: job.format },
    });
    return { confirmed: true, message_id: anchor.id, results };
  } catch (err) {
    if (!(err && err.status)) d.store.restoreAfterFailedConfirm(job);
    throw err;
  }
}

// ── Public API: discard ─────────────────────────────────────────────────────
export function discardImport({ user, importId }, deps = {}) {
  if (!user || !user.id) throw new Error('discardImport: user is required (ownership guard)');
  const d = { store: defaultStore, ...deps };
  const job = d.store.discard(importId, user.id);
  if (!job) throw httpError(404, 'not_found', MSG_NOT_FOUND);
  logger.event('import.discarded', { outcome: 'accepted', meta: { format: job.format } });
  return { discarded: true };
}
