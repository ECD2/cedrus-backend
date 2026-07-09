import { supabase } from '../lib/supabase.js';
import { config } from '../config.js';
import { timezoneFromPhone } from '../utils/time.js';
import { normalizePhone } from '../utils/phone.js';

export async function findOrCreateByPhone(rawPhone) {
  // Fix C1: Twilio sends "+17869727469"; we store digits-only ("17869727469")
  // so SMS users and web-login users resolve to the SAME app_users row.
  const phone = normalizePhone(rawPhone);
  const { data: existing, error } = await supabase
    .from('app_users').select('*').eq('phone', phone).maybeSingle();
  if (error) throw error;
  if (existing) return { user: existing, isNew: false };

  // First contact = the opt-in moment. Default timezone from area code.
  const timezone = timezoneFromPhone(phone, config.defaultTimezone);
  const { data: created, error: insErr } = await supabase
    .from('app_users')
    .insert({ phone, timezone, sms_consent_at: new Date().toISOString(), consent_source: 'first_message' })
    .select('*').single();
  if (insErr) throw insErr;
  // NOTE: the DB trigger auto-creates this user's is_self person row.
  return { user: created, isNew: true };
}

export async function touchActive(userId) {
  await supabase.from('app_users').update({ last_active_at: new Date().toISOString() }).eq('id', userId);
}

export async function setOptedOut(userId, optedOut) {
  await supabase.from('app_users').update({
    opted_out: optedOut, opted_out_at: optedOut ? new Date().toISOString() : null,
  }).eq('id', userId);
}

export async function markOnboarded(userId, fields = {}) {
  await supabase.from('app_users').update({ onboarding_complete: true, ...fields }).eq('id', userId);
}

// TODO: replace read-modify-write with a Postgres rpc for atomic increment.
export async function incrementShowingUp(userId) {
  const { data } = await supabase.from('app_users').select('showing_up_count').eq('id', userId).single();
  await supabase.from('app_users')
    .update({ showing_up_count: (data?.showing_up_count || 0) + 1 }).eq('id', userId);
}

// ── Brief support ────────────────────────────────────────────────────
export async function listActiveForBrief() {
  const { data } = await supabase.from('app_users')
    .select('id, phone, name, timezone, brief_day, brief_time, plan, billing_status, opted_out')
    .eq('opted_out', false);
  return data || [];
}

export async function recordBriefSent(userId) {
  const { data } = await supabase.from('app_users').select('total_briefs_sent').eq('id', userId).single();
  await supabase.from('app_users').update({
    last_brief_sent_at: new Date().toISOString(),
    total_briefs_sent: (data?.total_briefs_sent || 0) + 1,
  }).eq('id', userId);
}

// ── Nudge support (daily sweeps) ─────────────────────────────────────
export async function listNudgeable() {
  const { data } = await supabase.from('app_users')
    .select('id, phone, name, timezone, plan, billing_status, quiet_hours_start, quiet_hours_end')
    .eq('opted_out', false);
  return data || [];
}
