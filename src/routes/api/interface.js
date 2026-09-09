import express, { Router } from 'express';
import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { supabase } from '../../lib/supabase.js';
import { createRequireUser } from './auth.js';
import { readCapabilities } from '../../services/auth/capabilities.js';
import { resolveCallerScope } from '../../services/auth/callerScope.js';
import { forUser, cosEnv } from '../../services/cos/client.js';
import {
  readWorkstreams, readOpenLoops, readDecisions, readAgentRuns, READER_COLUMNS, COS_LIMITS,
} from '../../services/cos/reader.js';
import { alreadySentToday } from '../../services/cos/ledger.js';
import { readTodaysProgram } from '../../services/programs/today.js';

// ─────────────────────────────────────────────────────────────────────────
// INTERFACE ROUTER (A3.2) — /api/interface, the per-person read API.
//
// Four reads, every one scoped to the caller the choke point verified:
//
//   GET /session      who am I, what this session is (aal, methods, expiry),
//                     the closed capability vocabulary as booleans, and the
//                     skin-preference SLOT (null: the Engine has no column
//                     for it yet — a slot, not an invented value).
//   GET /status       per-service state for this person: brief delivery,
//                     CoS link, today's program, SMS, agents.
//   GET /brief/today  the brief the daily job composed for this person and
//                     wrote back to CoS today — the real today_brief_v1 row —
//                     or an honest "no brief today" with a reason.
//   GET /workspace    this person's workstreams, open loops and decisions,
//                     in the reader's own projections (READER_COLUMNS).
//
// Response shapes: src/routes/api/interface.shapes.d.ts. A parallel session
// builds the interface adapter against the same Engine shapes; A3.3
// reconciles. Nothing here invents a field the Engine does not have — every
// value is a column, a claim, or a function the Engine already exposes.
//
// SCOPE RULES, restated because this file cannot edit routes/api/index.js:
//   • every route sits behind requireUser (JWT verified IN CODE, aal2
//     required, account_status active) — see ./auth.js;
//   • identity is the verified session. NO handler reads a user id from the
//     body, path, query or a header; a forged id is ignored by construction
//     and Bundle 47 proves it;
//   • the person's CoS scope comes from THEIR user_settings row
//     (services/auth/callerScope.js), never from COS_USER_ID or any other
//     process-wide variable;
//   • every CoS read goes through forUser(cosUserId) (reader.js), so an
//     unscoped read is unexpressible here;
//   • no shared token, no service credential ever reaches a client.
//
// A read that FAILED is a 503 with a code, never a 200 that looks like "no
// data" (Lesson 1). "Not linked" and "reader disarmed" are legitimate states
// of this person on this deploy and are returned as available:false with the
// reason named.
// ─────────────────────────────────────────────────────────────────────────

const MSG_INTERNAL = 'Something went wrong on my end. Try that again in a moment.';

export const INTERFACE_ROUTES = Object.freeze(['/session', '/status', '/brief/today', '/workspace']);

/**
 * The columns /brief/today asks CoS for. Every name is one the Engine already
 * reads or writes against production: READER_COLUMNS.today_briefs (checked
 * against CoS's live schema by test/cos-schema-check.mjs) plus two keys of
 * the row writer.js INSERTS (structured_output, expires_at). Bundle 47 pins
 * this list to those two sources, so a column nobody has used against CoS
 * cannot be added here by accident (Lesson 20).
 */
export const BRIEF_READ_COLUMNS = Object.freeze([
  ...READER_COLUMNS.today_briefs, 'structured_output', 'expires_at',
]);

/** Calendar date of `at` in `timeZone` as YYYY-MM-DD; UTC when the zone is unknown, and says so. */
export function resolveDate(at, timeZone) {
  try {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    return { date, timezone: timeZone };
  } catch {
    return { date: at.toISOString().slice(0, 10), timezone: 'UTC' };
  }
}

function pick(row, columns) {
  const out = {};
  for (const c of columns) out[c] = row && row[c] !== undefined ? row[c] : null;
  return out;
}

/** A typed error the wrapper turns into {error, message}; the detail goes to the log only. */
function failure(status, code, detail) {
  logger.event('web.interface.read_failed', {
    level: 'error', error_category: 'db_error', status_code: status, outcome: 'fail_closed',
    message: `${code}: ${detail}`,
  });
  const e = new Error(detail);
  e.status = status; e.code = code; e.publicMessage = MSG_INTERNAL;
  return e;
}

export function createInterfaceRouter(deps = {}) {
  const {
    db = supabase, env = process.env, now = () => new Date(), auth, verifier, production,
  } = deps;
  const router = Router();

  // Self-contained JSON parsing (same 100kb cap as the app-wide parser in
  // index.js; harmless double-mount), so the router also works mounted
  // standalone in tests.
  router.use(express.json({ limit: '100kb' }));
  router.use(createRequireUser({ auth, db, verifier, production, env, now: () => now().getTime() }));

  // Wrap a handler with correlation context + the contract's error shape.
  // Same wrapper as routes/api/goals.js `handle` — keep them in step.
  const handle = (name, fn) => async (req, res) => {
    const t0 = Date.now();
    const requestId = crypto.randomUUID();
    req.cedrusRequestId = requestId;
    await logger.runWithContext(
      { correlation_id: crypto.randomUUID(), request_id: requestId },
      async () => {
        logger.addContext({ user_ref: 'u_' + req.appUser.id });
        try {
          const result = await fn(req);
          res.json(result);
          logger.event(`web.${name}.handled`, {
            status_code: 200, outcome: 'accepted', latency_ms: Date.now() - t0,
          });
        } catch (err) {
          const known = err && err.status && err.code && err.publicMessage;
          const status = known ? err.status : 500;
          res.status(status).json({
            error: known ? err.code : 'internal',
            message: known ? err.publicMessage : MSG_INTERNAL,
          });
          logger.event(`web.${name}.rejected`, {
            level: status >= 500 ? 'error' : 'warn',
            error_category: status >= 500 ? 'internal' : 'validation',
            status_code: status, latency_ms: Date.now() - t0,
            message: known ? err.code : (err && err.message) || String(err),
          });
        }
      },
    );
  };

  async function scopeFor(req) {
    const scope = await resolveCallerScope({ appUser: req.appUser, db });
    if (!scope.ok) {
      throw failure(503, 'settings_unreadable',
        `user_settings read failed for the caller: ${(scope.error && scope.error.code) || 'unknown'} ${(scope.error && scope.error.message) || ''}`.trim());
    }
    return scope;
  }

  async function capabilitiesFor(req) {
    const caps = await readCapabilities({ userId: req.appUser.id, db });
    if (!caps.ok) {
      throw failure(503, 'capabilities_unreadable',
        `user_capabilities read failed for the caller: ${(caps.error && caps.error.code) || 'unknown'} ${(caps.error && caps.error.message) || ''}`.trim());
    }
    return caps.capabilities;
  }

  // ── GET /session ────────────────────────────────────────────────────────
  router.get('/session', handle('interface.session', async (req) => {
    const u = req.appUser;
    const s = req.authSession || {};
    const capabilities = await capabilitiesFor(req);
    return {
      user: {
        id: u.id,
        name: u.name ?? null,
        display_name: u.display_name ?? null,
        timezone: u.timezone ?? null,
        role: u.role ?? null,
      },
      session: {
        aal: s.aal ?? null,
        methods: Array.isArray(s.methods) ? s.methods : [],
        issued_at: s.issued_at ?? null,
        expires_at: s.expires_at ?? null,
        session_id: s.session_id ?? null,
      },
      capabilities,
      // A SLOT. user_settings has no skin column (2026-09-09); the interface
      // may read this and must not expect to persist it until the Engine
      // grows the column. Null means "no stored preference", never a default.
      preferences: { skin: null },
    };
  }));

  // ── GET /status ─────────────────────────────────────────────────────────
  router.get('/status', handle('interface.status', async (req) => {
    const u = req.appUser;
    const at = now();
    const scope = await scopeFor(req);
    const capabilities = await capabilitiesFor(req);
    const cos = cosEnv(env);
    const s = scope.settings;

    // The send ledger is keyed by the CoS owner id per UTC day (ledger.js);
    // alreadySentToday is the Engine's own read of it.
    let today = 'unknown';
    let sentAt = null;
    if (scope.cosUserId) {
      const pre = await alreadySentToday({ userId: scope.cosUserId, now: at, db });
      if (pre.unavailable) today = 'unknown';
      else if (pre.blocked) { today = pre.reason === 'already_sent' ? 'sent' : 'claimed'; sentAt = pre.sentAt || null; }
      else today = 'not_sent';
    }

    const pr = await readTodaysProgram({ appUserId: u.id, at, db });

    const agents = { capability: capabilities.run_agents, state: 'unlinked', last_run_at: null };
    if (!scope.cosUserId) agents.state = 'unlinked';
    else if (!cos.armed) agents.state = 'disarmed';
    else {
      const r = await readAgentRuns({ userId: scope.cosUserId, env });
      if (r.disarmed) agents.state = 'disarmed';
      else if (r.rows === null) agents.state = 'unreadable';
      else { agents.state = 'ok'; agents.last_run_at = (r.rows[0] && r.rows[0].created_at) || null; }
    }

    return {
      generated_at: at.toISOString(),
      services: {
        brief: {
          settings_row: Boolean(s),
          enabled: s ? s.brief_enabled === true : false,
          email: (s && s.brief_email) || null,
          hour_utc: s && typeof s.brief_hour_utc === 'number' ? s.brief_hour_utc : null,
          timezone: scope.timezone,
          capability: capabilities.receive_brief,
          today,
          sent_at: sentAt,
        },
        cos: { linked: Boolean(scope.cosUserId), reader: cos.armed ? 'armed' : 'disarmed' },
        programs: pr.ok
          ? { state: 'ok', today_items: pr.rows.length, error: null }
          : { state: 'unreadable', today_items: null, error: (pr.error && pr.error.code) || 'unknown' },
        sms: {
          phone_linked: Boolean(u.phone),
          consent_recorded_at: u.sms_consent_at ?? null,
          opted_out: u.opted_out === true,
          capability: capabilities.receive_sms,
        },
        agents,
      },
    };
  }));

  // ── GET /brief/today ────────────────────────────────────────────────────
  router.get('/brief/today', handle('interface.brief.today', async (req) => {
    const at = now();
    const scope = await scopeFor(req);
    const { date, timezone } = resolveDate(at, scope.timezone);
    if (!scope.cosUserId) return { available: false, date, timezone, reason: 'cos_not_linked', latest_generated_at: null };

    // The same selection CoS's own latestStoredBrief() makes (writer.js
    // header): generation_mode='ai', newest first — plus status='ok', because
    // an error row has no structured_output to show.
    const r = await forUser(scope.cosUserId).select('today_briefs', (q) => q
      .eq('generation_mode', 'ai')
      .eq('status', 'ok')
      .order('generated_at', { ascending: false })
      .limit(1), { env, columns: BRIEF_READ_COLUMNS.join(', ') });
    if (r.disarmed) return { available: false, date, timezone, reason: 'cos_disarmed', latest_generated_at: null };
    if (r.rows === null) throw failure(503, 'brief_unreadable', `today_briefs read failed: ${(r.error && r.error.code) || 'unknown'}`);

    const row = r.rows[0];
    if (!row) return { available: false, date, timezone, reason: 'not_generated_today', latest_generated_at: null };
    const rowDate = resolveDate(new Date(row.generated_at), timezone).date;
    if (rowDate !== date) return { available: false, date, timezone, reason: 'not_generated_today', latest_generated_at: row.generated_at };
    if (!row.structured_output || typeof row.structured_output !== 'object') {
      throw failure(503, 'brief_unreadable', 'today_briefs row for today carries no structured_output');
    }
    return {
      available: true,
      date,
      timezone,
      id: row.id,
      generated_at: row.generated_at,
      expires_at: row.expires_at ?? null,
      model: row.model ?? null,
      schema_version: row.schema_version ?? null,
      brief: row.structured_output,
    };
  }));

  // ── GET /workspace ──────────────────────────────────────────────────────
  router.get('/workspace', handle('interface.workspace', async (req) => {
    const scope = await scopeFor(req);
    if (!scope.cosUserId) return { available: false, reason: 'cos_not_linked' };

    // THE scoping line. The only identity that reaches CoS below is the
    // caller's own CoS id, resolved from the verified session. Bundle 47
    // mutates this line to the process singleton and the suite goes red.
    const cosUserId = scope.cosUserId;
    const [ws, ol, dc] = await Promise.all([
      readWorkstreams({ userId: cosUserId, env }),
      readOpenLoops({ userId: cosUserId, env }),
      readDecisions({ userId: cosUserId, env }),
    ]);
    if (ws.disarmed || ol.disarmed || dc.disarmed) return { available: false, reason: 'cos_disarmed' };
    const failed = [['workstreams', ws], ['open_loops', ol], ['decisions', dc]]
      .filter(([, r]) => r.rows === null).map(([name]) => name);
    if (failed.length) throw failure(503, 'workspace_unreadable', `CoS read failed for ${failed.join(', ')}`);

    return {
      available: true,
      workstreams: ws.rows.map((row) => pick(row, READER_COLUMNS.workstreams)),
      open_loops: ol.rows.map((row) => pick(row, READER_COLUMNS.open_loops)),
      decisions: dc.rows.map((row) => pick(row, READER_COLUMNS.decisions)),
      limits: {
        workstreams: COS_LIMITS.workstreams,
        open_loops: COS_LIMITS.open_loops,
        decisions: COS_LIMITS.decisions,
      },
    };
  }));

  return router;
}

// Production router: real Supabase db, real env, the default verifier built
// from SUPABASE_URL on the first request. Mounted in src/index.js BEFORE the
// authed /api catch-all.
export default createInterfaceRouter();
