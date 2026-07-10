import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { normalizePhone } from '../utils/phone.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────
// FOUNDER ADMIN PANEL (v1)
// Simple browser-URL admin actions, protected by the ADMIN_KEY env var.
// If ADMIN_KEY is not set in Railway, every route here returns 404 —
// the panel simply doesn't exist.
//
//   Check a user:   https://YOUR-DOMAIN/admin/user?phone=7869727469&key=YOURKEY
//   Reset a user:   https://YOUR-DOMAIN/admin/reset?phone=7869727469&key=YOURKEY
//
// "Reset" wipes everything Cedrus remembers (people, facts, messages,
// reminders, goals, nudges, briefs) and puts the account back to
// brand-new: next text gets the full onboarding again. It KEEPS the
// account row itself and its web-login link, and keeps consent history
// (compliance records should never be deleted).
// ─────────────────────────────────────────────────────────────────────

const router = Router();

router.use((req, res, next) => {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return res.status(404).send('Not found');
  if (req.query.key !== expected) return res.status(403).send('Forbidden');
  next();
});

async function findUser(req, res) {
  const phone = normalizePhone(req.query.phone);
  if (!phone) { res.status(400).json({ error: 'Add ?phone=... to the URL' }); return null; }
  const { data: user } = await supabase.from('app_users').select('*').eq('phone', phone).maybeSingle();
  if (!user) { res.status(404).json({ found: false, phone }); return null; }
  return user;
}

async function countFor(table, userId) {
  const { count } = await supabase.from(table)
    .select('*', { count: 'exact', head: true }).eq('user_id', userId);
  return count || 0;
}

// GET /admin/user — quick snapshot of what Cedrus knows about an account
router.get('/user', async (req, res) => {
  const user = await findUser(req, res);
  if (!user) return;
  const [people, facts, messages, reminders] = await Promise.all([
    countFor('people', user.id), countFor('facts', user.id),
    countFor('messages', user.id), countFor('reminders', user.id),
  ]);
  res.json({
    found: true,
    phone: user.phone,
    name: user.name,
    plan: user.plan,
    onboarding_complete: user.onboarding_complete,
    trial_ends_at: user.trial_ends_at,
    counts: { people, facts, messages, reminders },
  });
});

// GET /admin/reset — wipe memory, keep identity. Next text = fresh onboarding.
router.get('/reset', async (req, res) => {
  const user = await findUser(req, res);
  if (!user) return;
  const uid = user.id;
  try {
    // Children first (all carry user_id). consent_events intentionally kept.
    const tables = [
      'pending_prompts', 'nudges', 'brief_items', 'briefs', 'reminders',
      'user_goals', 'contact_events', 'message_people', 'facts',
      'saved_items', 'agent_runs', 'messages',
    ];
    for (const t of tables) {
      const { error } = await supabase.from(t).delete().eq('user_id', uid);
      if (error) throw new Error(`${t}: ${error.message}`);
    }
    // Remove everyone except the self record; blank the self record's name.
    await supabase.from('people').delete().eq('user_id', uid).eq('is_self', false);
    await supabase.from('people').update({
      name: 'Me', last_contact_at: null, last_nudged_at: null,
    }).eq('user_id', uid).eq('is_self', true);
    // Back to brand-new: onboarding again, fresh 14-day trial.
    await supabase.from('app_users').update({
      name: null,
      onboarding_complete: false,
      showing_up_count: 0,
      total_briefs_sent: 0,
      briefs_opened_streak: 0,
      last_brief_sent_at: null,
      plan: 'trialing',
      billing_status: 'trialing',
      trial_started_at: new Date().toISOString(),
      trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      trial_downgraded_at: null,
      opted_out: false,
      opted_out_at: null,
    }).eq('id', uid);

    logger.info(`ADMIN: reset user ${user.phone}`);
    res.json({ reset: true, phone: user.phone, note: 'Next text to Cedrus starts onboarding from scratch.' });
  } catch (err) {
    logger.error('ADMIN reset failed', err);
    res.status(500).json({ reset: false, error: String(err.message || err) });
  }
});

export default router;
