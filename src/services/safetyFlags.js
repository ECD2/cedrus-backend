// ─────────────────────────────────────────────────────────────────────────────
// Cedrus Priority 0 — crisis suppression window (§6) + sensitivity logging (§7)
//
// Two jobs, both "emit the signal, don't build the consumers" (per the WS-B
// brief). Downstream suppression consumers live in other workstreams (WS-E game
// suppression, WS-D brief rendering); this module makes the signal exist and be
// readable, and records that a crisis event fired WITHOUT logging its content.
//
// Durable 48h persistence needs a schema field this workstream is not allowed to
// migrate (see docs/WSB_FLAGS_FOR_WSC.md). Until that lands, the persist call is
// best-effort and NEVER blocks or breaks the safety reply — the fixed crisis
// response is the thing that must always reach the user; the flag is secondary.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// Confirmed by Emil, 2026-07-16 (spec §6, §8): 48-hour promo/playful cooldown.
export const SUPPRESSION_WINDOW_HOURS = 48;

// Intended durable location, pending WS-C schema (flagged). Kept as a constant so
// the eventual column rename is one edit, not a grep.
const SUPPRESSION_COLUMN = 'crisis_suppressed_until';

// Record that a crisis-track event fired. Content-free by construction: we pass
// ONLY the category letter and template version — never the user's words (§7).
// Uses WS-A's logger; the structured `sensitivity: 'crisis'` marker is what WS-A
// wires into the logger's sensitivity field (see docs/WSB_FLAGS_FOR_WSA.md).
export function recordCrisisSignal({ userId, category, boundary, templateVersion, source }) {
  try {
    logger.info('safety_event', {
      sensitivity: 'crisis',        // WS-A logger sensitivity field
      userId,                       // id only — never message content
      category: category || null,   // 'A'|'B'|'C'|'D'
      boundary: boundary || null,   // 'substance' for the content boundary
      source: source || 'deterministic', // 'deterministic' regex gate | 'model_band' second net
      templateVersion,
    });
  } catch {
    // logging must never break the safety path
  }
}

// Open the §6 cooldown. Best-effort; a missing column/table is swallowed and
// logged as a flag reminder, never surfaced to the user.
export async function openSuppressionWindow({ userId, category }) {
  const untilIso = new Date(Date.now() + SUPPRESSION_WINDOW_HOURS * 3600 * 1000).toISOString();
  try {
    const { error } = await supabase
      .from('app_users')
      .update({ [SUPPRESSION_COLUMN]: untilIso })
      .eq('id', userId);
    if (error) {
      logger.warn('safetyFlags: suppression persist unavailable (needs WS-C schema)', error.message || String(error));
      return { persisted: false, until: untilIso };
    }
    return { persisted: true, until: untilIso };
  } catch (err) {
    logger.warn('safetyFlags: suppression persist threw (needs WS-C schema)', String(err));
    return { persisted: false, until: untilIso };
  }
}

// Readable by downstream services later (§6). Returns false whenever the flag is
// unavailable, so a not-yet-migrated schema fails OPEN for ordinary reminders/
// tasks (which the spec says must keep working) and only gates promo content
// when the flag genuinely exists and is active.
export async function isInSuppressionWindow(userId) {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select(SUPPRESSION_COLUMN)
      .eq('id', userId)
      .maybeSingle();
    if (error || !data || !data[SUPPRESSION_COLUMN]) return false;
    return new Date(data[SUPPRESSION_COLUMN]).getTime() > Date.now();
  } catch {
    return false;
  }
}
