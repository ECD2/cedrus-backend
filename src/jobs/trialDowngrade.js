import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
// import * as coreFive from '../services/coreFive.js';

// Flip expired trials to free and auto-pick their core five.
//
// Both statements below discarded their Supabase error. supabase-js resolves
// { data, error } rather than throwing, so this job had two silent modes:
//
//   1. SCAN FAILS  → `expired` is undefined → `|| []` → the loop never runs →
//      nobody is downgraded and nothing says so. Expired trials keep their
//      trial entitlements indefinitely.
//   2. UPDATE FAILS → that user silently stays on `trialing`, AND the summary
//      line counted `expired.length` (how many we FOUND) rather than how many
//      we actually changed — so a run where every update failed still logged
//      "Downgraded 2 expired trial(s) to free". A false success line, which is
//      worse than no line at all.
//
// Control flow is unchanged and stays FAIL-SAFE in direction: a scan failure
// still no-ops (users keep more access, not less), and one failed user does not
// abort the rest. The summary now counts actual successes, because a log that
// claims work it did not do is the disease this sweep exists to remove.
export async function runTrialDowngrades() {
  const { data: expired, error: scanErr } = await supabase.from('app_users')
    .select('id').eq('plan', 'trialing').lt('trial_ends_at', new Date().toISOString());

  if (scanErr) {
    logger.event('trial.downgrade.scan_failed', {
      level: 'error', error_category: 'db_error', error_code: scanErr.code || 'unknown',
      outcome: 'no_op',
      message: 'expired-trial scan failed; NO user was downgraded this tick and expired trials ' +
        'keep their trial entitlements until a later tick succeeds: ' +
        (scanErr.message || String(scanErr)),
    });
  }

  let downgraded = 0;
  for (const u of expired || []) {
    // TODO: await coreFive.recomputeCoreFive(u.id, { reason: 'trial_downgrade' });
    const { error: updErr } = await supabase.from('app_users')
      .update({ plan: 'free', trial_downgraded_at: new Date().toISOString() })
      .eq('id', u.id);
    if (updErr) {
      logger.event('trial.downgrade.failed', {
        level: 'error', error_category: 'db_error', error_code: updErr.code || 'unknown',
        user_ref: 'u_' + u.id, outcome: 'still_trialing',
        message: 'downgrade write failed; this user remains on plan=trialing past their ' +
          'trial_ends_at: ' + (updErr.message || String(updErr)),
      });
      continue;
    }
    downgraded += 1;
  }

  if (downgraded) logger.info(`Downgraded ${downgraded} expired trial(s) to free`);
}
