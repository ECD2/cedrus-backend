import { supabase } from '../../lib/supabase.js';
import { logger } from '../../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// Today's program — the brief's computed block.
//
// Same pattern as the workspace-state block in services/cos/compose.js:
// deterministic lines computed from rows, never asked of the model, no
// citations (the model is not given program items at all — V10 approval
// item 4: no program citations in today_brief_v1). The block is rendered
// FIRST in the brief, because the day's fixed commitment is the thing the
// rest of the brief has to fit around.
//
// THE READ IS ONE rpc TO todays_program_items(p_user_id, p_at). The owner is
// a required argument — the function refuses NULL — and "today" is computed
// in SQL from each program's own time_zone, not from the server's clock.
// This module never queries program_items directly: there is no code path
// here that could read another person's rows by forgetting a filter.
//
// WHOSE PROGRAM. The brief run knows a CoS user id (the owner of the CoS
// records). The Cedrus app_users id is resolved from user_settings.cos_user_id
// (rows, not env — the multi-user rule), falling back to COS_BRIEF_USAGE_USER_ID,
// the one Cedrus id the job already treats as "this person" for spend. When
// neither resolves, the block is skipped and the skip is LOGGED (Lesson 7).
// ─────────────────────────────────────────────────────────────────────────

export const TODAY_RPC = 'todays_program_items';

/**
 * @returns {Promise<{ appUserId: string|null, source: 'settings'|'env'|'unresolved' }>}
 */
export async function resolveProgramOwner({ env = process.env, cosUserId = null, db = supabase } = {}) {
  if (typeof cosUserId === 'string' && cosUserId.trim() !== '') {
    try {
      const { data, error } = await db.from('user_settings').select('user_id').eq('cos_user_id', cosUserId.trim()).limit(1);
      if (error) {
        logger.event('programs.owner.settings_unreadable', {
          level: 'warn', outcome: 'fallback', error_code: error.code || 'unknown',
          message: `user_settings could not be read (${error.code || 'unknown'}); falling back to COS_BRIEF_USAGE_USER_ID for the program owner`,
        });
      } else if (Array.isArray(data) && data.length && data[0].user_id) {
        return { appUserId: String(data[0].user_id), source: 'settings' };
      }
    } catch (err) {
      logger.event('programs.owner.settings_unreadable', {
        level: 'warn', outcome: 'fallback',
        message: `user_settings read threw (${(err && err.message) || err}); falling back to COS_BRIEF_USAGE_USER_ID`,
      });
    }
  }
  const fromEnv = (env.COS_BRIEF_USAGE_USER_ID || '').trim();
  if (fromEnv) return { appUserId: fromEnv, source: 'env' };
  return { appUserId: null, source: 'unresolved' };
}

/**
 * ONE read. Returns { ok, rows } or { ok: false, error }.
 */
export async function readTodaysProgram({ appUserId, at = new Date(), db = supabase } = {}) {
  if (typeof appUserId !== 'string' || appUserId.trim() === '') {
    return { ok: false, rows: [], error: { code: 'no_owner', message: 'readTodaysProgram refused: appUserId is required' } };
  }
  const { data, error } = await db.rpc(TODAY_RPC, { p_user_id: appUserId.trim(), p_at: at.toISOString() });
  if (error) return { ok: false, rows: [], error: { code: error.code, message: error.message } };
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayLabel(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WD[t.getUTCDay()]} ${String(isoDate).slice(0, 10)}`;
}

/**
 * Deterministic lines from the rows. Grouped by program; one line per item.
 * An empty row set yields an empty array — NO block, not a "nothing today"
 * line — so a person with no programs sees no section at all.
 */
export function computeTodaysProgram(rows) {
  const out = [];
  if (!Array.isArray(rows) || rows.length === 0) return out;
  const byProgram = new Map();
  for (const r of rows) {
    const key = r.program_id || r.program_title;
    if (!byProgram.has(key)) byProgram.set(key, { title: r.program_title, kind: r.program_kind, tz: r.time_zone, date: r.local_date, items: [] });
    byProgram.get(key).items.push(r);
  }
  for (const p of byProgram.values()) {
    const n = p.items.length;
    out.push(`${p.title} (${p.kind}) — ${dayLabel(p.date)} in ${p.tz}: ${n} item${n === 1 ? '' : 's'}.`);
    for (const i of p.items) {
      let line = `  ${i.category}: ${i.title}`;
      if (i.planned_start_local) line += ` at ${i.planned_start_local}`;
      if (typeof i.planned_duration_minutes === 'number') line += `, ${i.planned_duration_minutes} min`;
      if (i.status && i.status !== 'planned') line += ` [${i.status}]`;
      if (i.instructions) line += ` — ${String(i.instructions).slice(0, 140)}`;
      out.push(line + '.');
    }
  }
  return out;
}
