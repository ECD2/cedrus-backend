import { supabase } from '../lib/supabase.js';
import { logger } from '../utils/logger.js';
// import * as coreFive from '../services/coreFive.js';

// Flip expired trials to free and auto-pick their core five.
export async function runTrialDowngrades() {
  const { data: expired } = await supabase.from('app_users')
    .select('id').eq('plan', 'trialing').lt('trial_ends_at', new Date().toISOString());

  for (const u of expired || []) {
    // TODO: await coreFive.recomputeCoreFive(u.id, { reason: 'trial_downgrade' });
    await supabase.from('app_users')
      .update({ plan: 'free', trial_downgraded_at: new Date().toISOString() })
      .eq('id', u.id);
  }
  if (expired?.length) logger.info(`Downgraded ${expired.length} expired trial(s) to free`);
}
