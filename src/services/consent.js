import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';

// consent_events is the auditable record of STOP / START / HELP — the evidence
// that an opt-out was honoured. The insert discarded its error entirely, so a
// failed write left no row AND no trace.
//
// Enforcement is NOT here: users.setOptedOut() is what actually stops messages,
// and 03_compliance.js calls it first. So a lost row does not keep messaging an
// opted-out user; it loses the PROOF that we stopped. That is a carrier/TCPA
// exposure, which is why this logs at error and names the event type.
//
// Control flow unchanged: still resolves without throwing, so a logging failure
// can never block the compliance reply.
export async function log({ userId, eventType, source = 'sms', messageId = null, rawText = null }) {
  const { error } = await supabase.from('consent_events').insert({
    user_id: userId, event_type: eventType, source, message_id: messageId, raw_text: rawText,
  });
  if (error) {
    logger.event('consent.write.failed', {
      level: 'error', error_category: 'db_error', error_code: error.code || 'unknown',
      user_ref: 'u_' + userId, outcome: 'audit_row_lost',
      message: `consent_events insert failed for event_type '${eventType}': the opt-out was still ` +
        `enforced by setOptedOut(), but the audit record is MISSING — ` + (error.message || String(error)),
    });
  }
}
