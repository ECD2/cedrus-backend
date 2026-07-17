// ─────────────────────────────────────────────────────────────────────────
// Cedrus structured logger (WS-A, item 7)
//
// Replaces the old console-only logger. Emits one JSON object per line (JSONL)
// to stdout/stderr (Railway captures both). Implements the subset of
// session5-reliability-observability/STRUCTURED_LOGGING_SPEC.md that WS-A owns:
//   • frozen core fields (timestamp/level/event/service/environment)
//   • correlation_id / request_id / job_id / provider_message_id (Twilio SID)
//     / error_category — so one inbound SMS or one cron tick is traceable
//   • a MANDATORY redaction pass inside the logger (never trust call sites):
//       - message bodies are never logged (only body_len)
//       - phone numbers are reduced to their last 4 digits
//       - API keys / tokens / secrets are stripped
//   • a `sensitivity` lane. `sensitivity: 'restricted'` means: emit that the
//     event FIRED, with its low-cardinality structural fields, but DROP all
//     free-form content (message/meta). This is the lane WS-B's crisis/safety
//     escalation detector needs to log "a Category A/B/C/D signal fired"
//     without logging the disclosure itself (safety spec §7). WS-A only builds
//     the lane; it implements no detection logic.
//
// Back-compat: logger.info/warn/error keep their old signatures so the ~60
// existing call sites keep working; they now route through the same JSON
// pipeline (and the same redaction) as logger.event().
// ─────────────────────────────────────────────────────────────────────────

// Static import: present in Node/Bun (the real runtime). The dependency-free
// jsc test runner strips `import` lines, leaving AsyncLocalStorage undefined —
// every use below is guarded by `typeof`, so the module still loads there.
import { AsyncLocalStorage } from 'node:async_hooks';

const SERVICE = 'cedrus-backend';
const RESTRICTED = 'restricted';

// Per-request/per-job ambient context. logger.event() merges whatever the
// current run put here (correlation_id, request_id, job_id, user_ref) into
// every record, so pipeline stages we don't own still get correlated logs
// without threading a parameter through them.
const contextStore =
  typeof AsyncLocalStorage !== 'undefined' ? new AsyncLocalStorage() : null;

function currentContext() {
  if (!contextStore) return {};
  try { return contextStore.getStore() || {}; } catch { return {}; }
}

// Fields that are safe to emit verbatim: low-cardinality, no free-form content.
// Anything NOT in here (e.g. a stray `phone` or `body`) is dropped, per the
// spec's "structured-first, reject-disallowed-keys" rule.
const STRUCTURAL_FIELDS = new Set([
  'correlation_id', 'request_id', 'trace_stage', 'job_id', 'brief_id',
  'model_run_id', 'reminder_id', 'user_ref', 'person_ref', 'provider_id',
  'provider_message_id', 'latency_ms', 'outcome', 'retry_count',
  'error_category', 'error_code', 'status_code', 'message_type', 'run_type',
  'reason', 'segments', 'body_len', 'count', 'category', 'sensitivity',
]);

const ERROR_CATEGORIES = new Set([
  'auth', 'validation', 'parse_error', 'rate_limit', 'quota',
  'provider_timeout', 'provider_error', 'db_error', 'idempotent_skip',
  'state_conflict', 'config', 'internal',
]);

function envVar(name) {
  try {
    return (typeof process !== 'undefined' && process.env) ? process.env[name] : undefined;
  } catch { return undefined; }
}

function environment() {
  const e = envVar('NODE_ENV');
  return (e === 'production' || e === 'staging' || e === 'development') ? e : 'development';
}

function nowIso() { return new Date().toISOString(); }

// ── Redaction ──────────────────────────────────────────────────────────────
// Belt-and-braces pass over any free-form string that survives to `message`
// or a `meta` string value. The primary defense is the field allow-list above;
// this catches PII/secrets that slip into prose.
export function scrub(input) {
  if (typeof input !== 'string') return input;
  let s = input;
  // Secrets / tokens first (before the phone pass, which would otherwise eat
  // the digits inside a token).
  s = s.replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[secret]'); // JWT
  s = s.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[secret]');   // OpenAI
  s = s.replace(/\bSG\.[A-Za-z0-9_.-]{12,}/g, '[secret]'); // SendGrid
  s = s.replace(/\b(?:AC|SK)[0-9a-fA-F]{32}\b/g, '[secret]'); // Twilio SID/key
  s = s.replace(/\beyJ[A-Za-z0-9_-]{6,}\b/g, '[secret]');  // lone JWT-ish
  // Phone numbers → last 4 only. Matches E.164 and loosely-formatted numbers
  // with >=7 digits; keeps short numerics (segment counts, ids) intact.
  s = s.replace(/\+?\d[\d\-\s().]{5,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return m;
    return '[phone:' + digits.slice(-4) + ']';
  });
  return s;
}

// Build the final record object (pure — no I/O). Exposed for tests.
export function buildLogRecord(level, event, fields = {}) {
  const ctx = currentContext();
  const rec = {
    timestamp: nowIso(),
    level,
    event,
    service: SERVICE,
    environment: environment(),
  };

  const merged = { ...ctx, ...fields };
  const restricted = merged.sensitivity === RESTRICTED;

  // Copy allow-listed structural fields (context + explicit fields).
  for (const k of Object.keys(merged)) {
    if (k === 'message' || k === 'meta') continue;
    if (!STRUCTURAL_FIELDS.has(k)) continue;
    const v = merged[k];
    if (v === undefined || v === null) continue;
    rec[k] = typeof v === 'string' ? scrub(v) : v;
  }

  // error/fatal must carry an error_category; default to internal if omitted.
  if ((level === 'error' || level === 'fatal') && !ERROR_CATEGORIES.has(rec.error_category)) {
    rec.error_category = 'internal';
  }

  if (restricted) {
    // Elevated-restriction lane: the event fired and its structural fields are
    // recorded, but NO free-form content is emitted. This is the whole point of
    // the sensitivity flag — WS-B can prove a safety event happened without the
    // content ever reaching a log line.
    rec.sensitivity = RESTRICTED;
    return rec;
  }

  if (typeof merged.message === 'string' && merged.message.length) {
    rec.message = scrub(merged.message);
  }
  if (merged.meta && typeof merged.meta === 'object') {
    const m = {};
    for (const k of Object.keys(merged.meta)) {
      const v = merged.meta[k];
      m[k] = typeof v === 'string' ? scrub(v) : v;
    }
    rec.meta = m;
  }
  return rec;
}

function serialize(rec) {
  try { return JSON.stringify(rec); }
  catch { return JSON.stringify({ timestamp: nowIso(), level: 'error', event: 'log.serialize.failed', service: SERVICE, environment: environment(), error_category: 'internal' }); }
}

function emit(rec) {
  const line = serialize(rec);
  const c = (typeof console !== 'undefined') ? console : null;
  if (c) {
    if (rec.level === 'error' || rec.level === 'fatal') { (c.error || c.log).call(c, line); return; }
    if (rec.level === 'warn') { (c.warn || c.log).call(c, line); return; }
    c.log(line);
    return;
  }
  if (typeof print === 'function') print(line); // jsc fallback
}

// Turn the varargs of the legacy info/warn/error API into a single scrubbed
// message string. Error objects contribute their message only (never a stack,
// which can embed message content / paths).
function argsToMessage(args) {
  return args.map((a) => {
    if (a == null) return '';
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message || a.name || 'Error';
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return '[object]'; } }
    return String(a);
  }).filter(Boolean).join(' ');
}

function emitLevel(level, args) {
  emit(buildLogRecord(level, level, { message: argsToMessage(args) }));
}

export const logger = {
  // Legacy API — preserved. Now JSON + redacted.
  info: (...a) => emitLevel('info', a),
  warn: (...a) => emitLevel('warn', a),
  error: (...a) => emitLevel('error', a),

  // Structured entrypoint. `fields` may include any STRUCTURAL_FIELDS plus
  // `level`, `message`, and `meta`. Set `sensitivity: 'restricted'` to use the
  // content-suppressing safety lane.
  event: (name, fields = {}) => {
    const level = fields.level || 'info';
    emit(buildLogRecord(level, name, fields));
    return name;
  },

  // Run `fn` with ambient correlation context. Every logger.event/info/warn/
  // error emitted inside fn auto-includes these fields. No-op passthrough when
  // AsyncLocalStorage is unavailable (jsc test runner).
  runWithContext: (store, fn) => {
    if (!contextStore) return fn();
    return contextStore.run({ ...store }, fn);
  },

  // Merge more fields into the current ambient context (e.g. user_ref once the
  // user is resolved mid-request).
  addContext: (fields) => {
    if (!contextStore) return;
    const cur = contextStore.getStore();
    if (cur) Object.assign(cur, fields);
  },

  // Test/introspection hooks.
  _build: buildLogRecord,
  _scrub: scrub,
};

// Pseudonymous user reference for logs (never the raw phone). Prefers the
// internal app_users uuid (a non-PII surrogate); falls back to a phone
// last-4 tag pre-resolution. See STRUCTURED_LOGGING_SPEC §3.
export function userRef({ id, phone } = {}) {
  if (id) return 'u_' + id;
  if (phone) { const d = String(phone).replace(/\D/g, ''); return d ? 'ph_' + d.slice(-4) : undefined; }
  return undefined;
}
