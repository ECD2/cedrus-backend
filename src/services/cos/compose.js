// ─────────────────────────────────────────────────────────────────────────────
// CoS daily-brief composer — pure, dependency-free, side-effect-free.
//
// Deliberately imports NOTHING. No network, no database, no logger, no config.
// That is the same choice CoS made for its own _shared/brief.ts, and for the
// same reason: the job runtime and the test suite must be able to exercise
// byte-identical logic. Every rule that decides what a brief may say lives
// here, where a test can drive it directly.
//
// ── THE CONTRACT ────────────────────────────────────────────────────────────
// The output is CoS's own `today_brief_v1`. Field names, the three-priority
// ceiling, the urgency enum, the 0–1 confidence, the citation rule, and the
// fixed model disclaimer are all copied from
// `supabase/functions/_shared/brief.ts` in the Chief of Staff project and must
// stay in lockstep with it. CoS's frontend reads a stored brief with
// `latestStoredBrief()` and casts `structured_output` straight to its
// `TodayBrief` type — there is no validation on read — so anything wrong here
// renders wrong there.
//
// ── THE ONE DELIBERATE EXTENSION: EMAIL ─────────────────────────────────────
// CoS's brief reads five arrays and NOT email. This one adds two source-ref
// types, `email_message` and `email_analysis`.
//
// This is safe against CoS's UNCHANGED frontend, and that was verified by
// reading it rather than assumed: `TodayBriefPanel.tsx` types citations as
// `Array<{ type: string; id: string }>` (plain string, not the narrow union),
// and `refLabel()` ends with `return ref.type.replaceAll("_", " ")`. An
// unrecognized type therefore renders as the literal words "email message" /
// "email analysis" — it does not throw, blank, or drop the citation. So the
// extension needs ZERO changes in the CoS project, which is the whole point:
// CoS's manual-only, AAL2-only posture is untouched.
//
// Note the asymmetry this creates and accept it knowingly: a brief composed
// HERE may cite email; a brief composed by CoS's own Edge Function never will.
// Both are valid `today_brief_v1`.
//
// ── WHAT IS NEVER STORED ────────────────────────────────────────────────────
// Not the prompt. Not the raw model response. Not a full body. `structured_output`
// holds only the validated brief the owner sees, and `input_fingerprint` is a
// SHA-256 of the minimized payload — a hash, never content. Excerpts are
// bounded to 240 characters at the single boundary below.
// ─────────────────────────────────────────────────────────────────────────────

/** CoS's schema version. Changing this string breaks the CoS renderer. */
export const BRIEF_SCHEMA_VERSION = 'today_brief_v1';

/** CoS's disclaimer, verbatim. Ours to set, never the model's to soften. */
export const MODEL_DISCLAIMER = 'AI-generated recommendation; owner decides.';

/** Marks the row's origin in-band. Inert to CoS's renderer, legible in the data. */
export const COMPOSED_BY = 'cedrus-backend/cos-daily-brief';

export const LIMITS = Object.freeze({
  /** Per free-text field, after which text is truncated with an ellipsis. */
  field_chars: 280,
  /** Bounded excerpt of a capture's original text. Never the full body. */
  capture_excerpt_chars: 240,
  /** Bounded excerpt of an agent report body. Never the full body. */
  agent_excerpt_chars: 240,
  /** Bounded excerpt of an email's already-sanitized plain-text excerpt. */
  email_excerpt_chars: 240,
  /** Ceiling on the serialized payload; lists are trimmed from the tail to fit. */
  total_input_chars: 24_000,
  /** Most priorities the model may return. CoS's ceiling, unchanged. */
  max_priorities: 3,
});

/** Every citation type this brief may emit. The first five are CoS's own. */
export const SOURCE_REF_TYPES = Object.freeze([
  'workstream', 'open_loop', 'decision', 'capture', 'agent_run',
  'email_message', 'email_analysis',
]);

const URGENCIES = Object.freeze(['low', 'medium', 'high', 'critical']);

// ── field bounding ───────────────────────────────────────────────────────────

function clamp(value, max) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function str(v) { return typeof v === 'string' ? v : null; }

function strArray(v, max, each) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map((x) => clamp(str(x) ?? String(x ?? ''), each)).filter(Boolean);
}

/**
 * Whole days between `then` and `now`. Positive = in the past.
 *
 * Rounded down on purpose: "27 days past target" is a fact, "27.4 days" is
 * noise, and the model is being handed a conclusion, not a measurement.
 */
export function daysPast(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

export function isOverdue(dueAt, status, now) {
  if (!dueAt || status === 'resolved' || status === 'dropped') return false;
  return new Date(dueAt).getTime() < now;
}

// ── minimize ─────────────────────────────────────────────────────────────────

/**
 * Reduce raw CoS rows to the smallest shape that can support prioritization.
 *
 * Everything not listed below stays in the CoS database. Most importantly:
 * no user ids, no auth or MFA state, no credentials, no audit rows, no raw
 * MIME, no HTML, no attachment metadata, and never a full original_text or
 * original_body. Archived workstreams and settled loops are dropped as noise —
 * the same filter CoS applies.
 *
 * `includeExcerpts=false` produces a metadata-only payload: counts and
 * candidacy signals survive, the words do not. Kept as a real switch because
 * it is the difference between sending prose off-box and not.
 */
export function minimizeInput(raw, now = Date.now(), includeExcerpts = true) {
  const workstreams = (raw.workstreams || [])
    .filter((w) => w.archived_at === null || w.archived_at === undefined)
    .map((w) => ({
      id: String(w.id),
      name: clamp(str(w.name), LIMITS.field_chars) ?? 'untitled',
      status: String(w.status ?? 'unknown'),
      priority: String(w.priority ?? 'unknown'),
      health: String(w.health ?? 'unknown'),
      objective: clamp(str(w.objective), LIMITS.field_chars),
      current_stage: clamp(str(w.current_stage), LIMITS.field_chars),
      next_action: clamp(str(w.next_action), LIMITS.field_chars),
      target_date: str(w.target_date),
      // DERIVED, not left for the model to work out. On 2026-08-20 it read a
      // target_date of 2026-07-23, repeated it back in a priority, and never
      // noticed the date was a month gone. The field it needed was right there.
      // Asking a language model to do date arithmetic against "today" is asking
      // for the failure that actually happened; hand it the answer instead.
      target_date_days_past: (() => {
        const d = daysPast(str(w.target_date), now);
        return d !== null && d > 0 ? d : null;
      })(),
    }));

  const open_loops = (raw.open_loops || [])
    .filter((l) => l.status !== 'resolved' && l.status !== 'dropped')
    .map((l) => ({
      id: String(l.id),
      title: clamp(str(l.title), LIMITS.field_chars) ?? 'untitled',
      status: String(l.status ?? 'unknown'),
      priority: String(l.priority ?? 'unknown'),
      waiting_on: clamp(str(l.waiting_on), LIMITS.field_chars),
      next_action: clamp(str(l.next_action), LIMITS.field_chars),
      due_at: str(l.due_at),
      workstream_id: l.workstream_id ? String(l.workstream_id) : null,
      overdue: isOverdue(l.due_at, l.status, now),
      // Same reasoning: how far past due, and how long the loop has been open.
      // Age matters independently of a due date — a loop open for months with
      // no due date is a signal the model cannot derive from a bare timestamp.
      overdue_days: isOverdue(l.due_at, l.status, now) ? daysPast(str(l.due_at), now) : null,
      age_days: daysPast(String(l.created_at ?? ''), now),
    }));

  const decisions = (raw.decisions || []).map((d) => ({
    id: String(d.id),
    question: clamp(str(d.question), LIMITS.field_chars) ?? 'untitled',
    status: String(d.status ?? 'unknown'),
    recommendation: clamp(str(d.recommendation), LIMITS.field_chars),
    // Carried so the model can never mistake an agent's suggestion for a
    // settled call. CoS keeps this field for exactly this reason.
    recommendation_source: String(d.recommendation_source ?? 'unknown'),
    decided_at: str(d.decided_at),
    workstream_id: d.workstream_id ? String(d.workstream_id) : null,
  }));

  const captures = (raw.captures || []).map((c) => {
    const row = {
      id: String(c.id),
      proposed_type: str(c.proposed_type),
      proposed_priority: str(c.proposed_priority),
      proposed_workstream: str(c.proposed_workstream),
      decision_candidate: Boolean(c.decision_candidate),
      open_loop_candidate: Boolean(c.open_loop_candidate),
      created_at: String(c.created_at ?? ''),
    };
    if (includeExcerpts) {
      const excerpt = clamp(str(c.original_text), LIMITS.capture_excerpt_chars);
      if (excerpt) row.excerpt = excerpt;
    }
    return row;
  });

  const agent_runs = (raw.agent_runs || []).map((r) => {
    const row = {
      id: String(r.id),
      agent: str(r.agent),
      model: str(r.model),
      objective: clamp(str(r.objective), LIMITS.field_chars),
      // ALWAYS carried, never defaulted away: an agent's own account of its
      // work stays labelled as self-reported all the way to the page.
      verification_state: String(r.verification_state ?? 'self_reported'),
      unresolved_findings: strArray(r.unresolved_findings, 10, LIMITS.field_chars),
      recommended_next_action: clamp(str(r.recommended_next_action), LIMITS.field_chars),
      created_at: String(r.created_at ?? ''),
    };
    if (includeExcerpts) {
      const excerpt = clamp(str(r.original_body), LIMITS.agent_excerpt_chars);
      if (excerpt) row.excerpt = excerpt;
    }
    return row;
  });

  // Email. `plain_text_excerpt` is already CoS-sanitized and capped at 2000
  // chars in its schema; we re-clamp to 240 here so this module's own bound
  // holds regardless of what upstream did.
  const email_messages = (raw.email_messages || []).map((m) => {
    const row = {
      id: String(m.id),
      subject: clamp(str(m.subject), LIMITS.field_chars),
      // Address, not display name plus address: one identifier is enough to
      // tell messages apart and it is the smaller disclosure.
      from: clamp(str(m.sender_address), LIMITS.field_chars),
      // Which upstream address the copy was sent to — support@ vs affiliate@
      // is often the whole signal about whether something matters today.
      to: clamp(str(m.original_recipient), LIMITS.field_chars),
      received_at: str(m.received_at),
      classification_status: String(m.classification_status ?? 'unclassified'),
      owner_review_status: String(m.owner_review_status ?? 'unreviewed'),
      has_attachments: Boolean(m.has_attachments),
      is_demo: Boolean(m.is_demo),
    };
    if (includeExcerpts) {
      const excerpt = clamp(str(m.plain_text_excerpt), LIMITS.email_excerpt_chars);
      if (excerpt) row.excerpt = excerpt;
    }
    return row;
  });

  const email_ai_analyses = (raw.email_ai_analyses || []).map((a) => ({
    id: String(a.id),
    email_message_id: a.email_message_id ? String(a.email_message_id) : null,
    status: String(a.status ?? 'unknown'),
    // A 'fallback' analysis consulted no model. Kept so a fallback's
    // suggestion is never presented with the weight of a real one.
    generation_mode: String(a.generation_mode ?? 'unknown'),
    suggested_classification: str(a.suggested_classification),
    suggested_priority: str(a.suggested_priority),
    suggested_action_status: str(a.suggested_action_status),
    summary: clamp(str(a.summary), LIMITS.field_chars),
    suggested_next_action: clamp(str(a.suggested_next_action), LIMITS.field_chars),
    suggested_promotion_type: String(a.suggested_promotion_type ?? 'none'),
    // The model's own stated uncertainty, carried through verbatim-but-bounded.
    risks_or_uncertainties: strArray(a.risks_or_uncertainties, 8, LIMITS.field_chars),
    confidence: typeof a.confidence === 'number' ? a.confidence : null,
    created_at: String(a.created_at ?? ''),
  }));

  return {
    today: new Date(now).toISOString().slice(0, 10),
    workstreams, open_loops, decisions, captures, agent_runs,
    email_messages, email_ai_analyses,
  };
}

// ── size budget ──────────────────────────────────────────────────────────────

/**
 * Trim from the tail, array by array, until the serialized payload fits 24k.
 *
 * Order, and the reasoning for each position:
 *   captures            — raw unprocessed thoughts; least structured, first to go.
 *   agent_runs          — self-reported, and CoS trims these second.
 *   decisions           — CoS trims these third.
 *   email_ai_analyses   — derived; a trimmed analysis can be recomputed from
 *                         the message that is still present.
 *   email_messages      — the evidence itself; trimming loses it entirely.
 *   open_loops          — CoS calls these "the point of the brief". Last.
 *
 * The first three and the last preserve CoS's exact relative order. The two
 * email arrays are inserted immediately before `open_loops` because email is
 * this brief's entire reason for existing, so it is trimmed late — but
 * `open_loops` still outranks it, exactly as in CoS.
 *
 * `workstreams` is never trimmed here, matching CoS: it is the frame the rest
 * hangs on and it is already capped at 25 rows by the reader.
 */
export function enforceTotalSize(input) {
  const order = ['captures', 'agent_runs', 'decisions', 'email_ai_analyses', 'email_messages', 'open_loops'];
  const out = { ...input };
  for (const key of order) {
    while (JSON.stringify(out).length > LIMITS.total_input_chars && out[key].length > 0) {
      out[key] = out[key].slice(0, -1);
    }
  }
  return out;
}

export function isEmptyInput(input) {
  return (
    input.workstreams.length === 0 &&
    input.open_loops.length === 0 &&
    input.decisions.length === 0 &&
    input.captures.length === 0 &&
    input.agent_runs.length === 0 &&
    input.email_messages.length === 0 &&
    input.email_ai_analyses.length === 0
  );
}

/** Every id the model is permitted to cite, mapped to its one legal type. */
export function knownIds(input) {
  const map = new Map();
  for (const w of input.workstreams) map.set(w.id, 'workstream');
  for (const l of input.open_loops) map.set(l.id, 'open_loop');
  for (const d of input.decisions) map.set(d.id, 'decision');
  for (const c of input.captures) map.set(c.id, 'capture');
  for (const r of input.agent_runs) map.set(r.id, 'agent_run');
  for (const m of input.email_messages) map.set(m.id, 'email_message');
  for (const a of input.email_ai_analyses) map.set(a.id, 'email_analysis');
  return map;
}

// ── the JSON schema handed to the model ──────────────────────────────────────

export function briefJsonSchema() {
  const sourceRefs = {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', enum: [...SOURCE_REF_TYPES] },
        id: { type: 'string' },
      },
    },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'schema_version', 'generated_at', 'summary', 'top_priorities',
      'decisions_to_make', 'people_or_dependencies_waiting', 'risks',
      'not_enough_evidence', 'model_disclaimer',
    ],
    properties: {
      schema_version: { type: 'string', enum: [BRIEF_SCHEMA_VERSION] },
      generated_at: { type: 'string' },
      summary: { type: 'string' },
      top_priorities: {
        type: 'array',
        maxItems: LIMITS.max_priorities,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rank', 'title', 'reason', 'recommended_action', 'urgency', 'confidence', 'source_refs'],
          properties: {
            rank: { type: 'number' },
            title: { type: 'string' },
            reason: { type: 'string' },
            recommended_action: { type: 'string' },
            urgency: { type: 'string', enum: [...URGENCIES] },
            confidence: { type: 'number' },
            source_refs: sourceRefs,
          },
        },
      },
      decisions_to_make: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['question', 'source_refs'],
          properties: { question: { type: 'string' }, source_refs: sourceRefs },
        },
      },
      people_or_dependencies_waiting: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['who', 'what', 'source_refs'],
          properties: { who: { type: 'string' }, what: { type: 'string' }, source_refs: sourceRefs },
        },
      },
      risks: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['risk', 'source_refs'],
          properties: { risk: { type: 'string' }, source_refs: sourceRefs },
        },
      },
      not_enough_evidence: { type: 'array', items: { type: 'string' } },
      model_disclaimer: { type: 'string' },
    },
  };
}

// ── the instruction ──────────────────────────────────────────────────────────
//
// Held as an array of lines so a diff shows exactly which rule moved. This
// string is NEVER persisted anywhere (Law: no prompt storage) — it exists only
// in the request body.

export const SYSTEM_RULES = [
  'You are a chief-of-staff assistant preparing a daily brief for a single owner.',
  'Use ONLY the records supplied in the input. Never invent a record, an id, a person, or a deadline.',
  'Every priority, decision, waiting item, and risk MUST cite at least one supplied record id in source_refs.',
  'A claim you cannot cite belongs in not_enough_evidence, not in top_priorities.',
  `Return at most ${LIMITS.max_priorities} priorities, ranked 1..n, most important first.`,
  'confidence is 0..1 and expresses how well the SUPPLIED RECORDS support the claim — not how fluent your answer is.',
  'Set confidence at or below 0.5 when the supporting records are thin, stale, or ambiguous, and say why in reason.',
  "Agent-run information with verification_state 'self_reported' is the agent's own account of its work and is NOT verified. Never present it as established fact; say the agent reported it.",
  "An email analysis with generation_mode 'fallback' consulted no model. Treat its suggestions as unweighted.",
  'Email marked is_demo true is synthetic test data. Never let it drive a priority.',
  'Email is evidence of what arrived, not proof that it matters. An unread newsletter is not a priority.',
  'target_date_days_past, overdue_days and age_days are ALREADY COMPUTED for you. Do not do date arithmetic yourself; use these numbers and say them plainly.',
  'A workstream with target_date_days_past set is PAST ITS TARGET by that many days. Say so explicitly — that is the fact, not the target date itself.',
  // The 2026-08-20 run produced three priorities from eight thin records, and
  // the third simply restated a workstream title three times: name ->
  // "Review design updates needed for X" -> "Schedule a design review for X".
  // Zero information added. "At most 3" reads to a model as a target to fill.
  'Return FEWER than three priorities when the records do not support three. One well-evidenced priority is a better brief than three thin ones.',
  'A priority that only restates a record\'s title, adding no reason the owner could not read off the record itself, is padding. Leave it out.',
  'Prefer an honest short brief over a padded one. An empty section is a valid answer.',
  'Do not address the owner by name, and do not open with a greeting.',
];

/**
 * The request body.
 *
 * NOTE the surface difference from CoS: CoS calls the Responses API
 * (`text.format.json_schema`), because that is what its Deno Edge Function
 * uses. This repo's shared client (`src/lib/openai.js`) is the `openai` v4
 * package and every existing caller uses `chat.completions.create`, so this
 * uses the Chat Completions structured-output surface instead. The JSON SCHEMA
 * ITSELF is identical — only the envelope differs. Matching the house client
 * beats matching CoS's transport, because a second calling convention in this
 * repo is a maintenance trap and buys nothing.
 *
 * temperature 0.2: this is prioritization over supplied records, not voice.
 * The house brief composer uses 0.6 because it is writing warm SMS prose.
 */
export function buildRequestBody(input, model) {
  return {
    model,
    temperature: 0.2,
    max_tokens: 2_000,
    messages: [
      { role: 'system', content: SYSTEM_RULES.join('\n') },
      { role: 'user', content: JSON.stringify(input) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: BRIEF_SCHEMA_VERSION,
        strict: true,
        schema: briefJsonSchema(),
      },
    },
  };
}

// ── validation ───────────────────────────────────────────────────────────────

/**
 * Server-side validation of whatever the model returned.
 *
 * Structured output is a strong constraint, not a guarantee. This re-checks
 * shape, enforces the three-priority ceiling, and — the part that matters most —
 * rejects any citation the model invented. A brief that cites a record we never
 * sent is not shown, is not emailed, and is not written back.
 */
export function validateBrief(raw, input, now = new Date()) {
  const fail = (detail) => ({ ok: false, category: 'invalid_schema', detail });
  if (typeof raw !== 'object' || raw === null) return fail('response is not an object');
  const b = raw;

  if (b.schema_version !== BRIEF_SCHEMA_VERSION) return fail('unknown schema_version');
  if (typeof b.summary !== 'string') return fail('summary missing');
  if (!Array.isArray(b.top_priorities)) return fail('top_priorities missing');
  if (b.top_priorities.length > LIMITS.max_priorities) return fail('too many priorities');

  for (const key of ['decisions_to_make', 'people_or_dependencies_waiting', 'risks', 'not_enough_evidence']) {
    if (!Array.isArray(b[key])) return fail(`${key} missing`);
  }

  const refs = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return false;
    for (const item of value) {
      if (typeof item !== 'object' || item === null) return false;
      if (typeof item.type !== 'string' || typeof item.id !== 'string') return false;
      refs.push({ type: item.type, id: item.id });
    }
    return true;
  };

  for (const [index, item] of b.top_priorities.entries()) {
    if (typeof item !== 'object' || item === null) return fail(`priority ${index} is not an object`);
    const p = item;
    if (typeof p.title !== 'string' || typeof p.reason !== 'string') return fail(`priority ${index} incomplete`);
    if (typeof p.recommended_action !== 'string') return fail(`priority ${index} has no action`);
    if (!URGENCIES.includes(String(p.urgency))) return fail(`priority ${index} urgency`);
    if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {
      return fail(`priority ${index} confidence out of range`);
    }
    if (!collect(p.source_refs)) return fail(`priority ${index} source_refs malformed`);
    // A ranked priority with no evidence is exactly the kind of claim this
    // system refuses to display.
    if (p.source_refs.length === 0) return fail(`priority ${index} cites nothing`);
  }
  for (const key of ['decisions_to_make', 'people_or_dependencies_waiting', 'risks']) {
    for (const item of b[key]) {
      if (typeof item !== 'object' || item === null) return fail(`${key} entry is not an object`);
      if (!collect(item.source_refs)) return fail(`${key} source_refs malformed`);
    }
  }

  const known = knownIds(input);
  for (const ref of refs) {
    const actual = known.get(ref.id);
    if (!actual) {
      return { ok: false, category: 'invalid_citations', detail: 'cites an unknown record id' };
    }
    if (actual !== ref.type) {
      return { ok: false, category: 'invalid_citations', detail: 'cites a record as the wrong type' };
    }
  }

  return {
    ok: true,
    brief: {
      ...b,
      // Ours, not the model's, so it cannot be softened or dropped.
      model_disclaimer: MODEL_DISCLAIMER,
      // Same reasoning, and it is not hypothetical: on the 2026-08-20 run the
      // model emitted generated_at "2026-08-20T12:00:00Z" for a brief composed
      // at 19:17Z. It passed validation, because the schema only requires the
      // field to be a string — nothing could have checked it against reality.
      //
      // Nothing renders it today (the CoS panel reads the today_briefs COLUMN,
      // not this key), which is exactly why it would have gone on being wrong.
      // A hallucinated timestamp that survives validation is a bug whether or
      // not anything currently displays it: it is stored data asserting a
      // falsehood, and the next consumer has no way to know.
      generated_at: now.toISOString(),
      // Origin marker. CoS's TypeScript type does not declare these, but a TS
      // cast validates nothing at runtime, so they are inert to its renderer
      // while making the row's provenance unambiguous to anyone reading it.
      composed_by: COMPOSED_BY,
      source_system: 'cedrus',
    },
  };
}

/** Every distinct ref the validated brief cites, for the `source_refs` column. */
export function collectSourceRefs(brief) {
  const seen = new Set();
  const out = [];
  const add = (list) => {
    for (const r of list || []) {
      const k = `${r.type}:${r.id}`;
      if (!seen.has(k)) { seen.add(k); out.push({ type: r.type, id: r.id }); }
    }
  };
  for (const p of brief.top_priorities || []) add(p.source_refs);
  for (const key of ['decisions_to_make', 'people_or_dependencies_waiting', 'risks']) {
    for (const item of brief[key] || []) add(item.source_refs);
  }
  return out;
}
