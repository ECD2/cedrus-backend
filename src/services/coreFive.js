import { supabase } from '../lib/supabase.js'; // eslint-disable-line no-unused-vars

// Closeness-weighted core-five selection (backend logic, per design).
// Score blend = mentions + sentiment + recency + relationship_type, honoring
// pinned/locked people, with hysteresis on the monthly recompute.
export async function recomputeCoreFive(userId, { reason }) { // eslint-disable-line no-unused-vars
  // STEPS:
  //  1) insert a core_circle_runs row (run_reason = reason)
  //  2) score each non-self, non-archived person -> core_circle_candidates (+ score_details)
  //  3) pick top N = app_users.free_core_limit, always keeping core_five_locked pins
  //  4) update people.is_core_five to match, set last_core_evaluated_at
  throw new Error('TODO: implement closeness-weighted core-five recompute');
}
