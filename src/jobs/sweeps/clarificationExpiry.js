import { supabase } from '../../lib/supabase.js';
import { logger } from '../../utils/logger.js';
import { sweepExpired } from '../../services/clarifications.js';
import { persist } from '../../pipeline/07_persist.js';

// ── Clarification expiry sweep (docs/ENTITY_RESOLUTION_V2.md §2.3).
// A held dedup question the user never answered resolves, on timeout, to a NEW
// person (create + apply the held write) — NEVER a guessed merge; a duplicate is
// cheaply merged later, a wrong merge silently corrupts. Then the next queued
// clarification for that user is activated (FIFO). Runs on the same ~15-min cadence
// as dailySweeps. The default-to-create resolution is SILENT (no user-facing
// message), so it honors the safety suppression window without needing to read it.
async function loadUser(userId) {
  const { data } = await supabase.from('app_users').select('id, timezone').eq('id', userId).maybeSingle();
  return data || { id: userId };
}

export async function runClarificationExpiry() {
  const { resolved } = await sweepExpired({ persist, loadUser });
  if (resolved) logger.event('clarification.expiry.swept', { outcome: 'accepted', count: resolved });
  return { resolved };
}
