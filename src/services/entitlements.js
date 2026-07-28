// ─────────────────────────────────────────────────────────────────────────────
// THE plan-tier decision. One copy, for the whole backend.
//
// This replaces six near-identical local copies (jobs/sweeps/select.js,
// jobs/brief/select.js, services/discovery.js, services/briefEngine.js — which
// called it `tierOf` — services/insights.js, services/brief/composer.js). They
// had already drifted: three guarded `user &&` and returned 'free' on a nullish
// user, three did not and threw a TypeError. Same logical function, two
// different failure modes, depending which file you happened to be in.
//
// WHY IT IS NOW TIME-AWARE (flag 23). `v_people_for_agent.proactive_enabled`
// checks `plan = 'trialing' AND trial_ends_at > now()`, so SQL stops treating a
// trial as a trial the instant it expires. The old JS copies checked only
// `plan === 'trialing'`, so they kept granting trial entitlements until the
// hourly downgrade cron rewrote the column. If that cron ever silently no-ops,
// the two disagree permanently: SQL says the user is free while JS says trial.
//
// The rule: a trial that has passed trial_ends_at is not a trial, whatever the
// column says. Entitlement must not depend on a cron having run.
//
// Boundary matches the view exactly: strictly `>`, so at the instant of
// trial_ends_at the trial is already over.
// ─────────────────────────────────────────────────────────────────────────────

export function planTier(user, now = new Date()) {
  if (!user) return 'free';
  if (user.plan === 'pro' && user.billing_status === 'active') return 'pro';
  if (user.plan === 'trialing' && trialStillRunning(user, now)) return 'trial';
  return 'free';
}

// 'pro' and 'trial' get the same content breadth; only 'free' is narrowed to
// the core five. Hoisted here so the six call sites stop re-deriving it.
export function isProLike(tier) {
  return tier === 'pro' || tier === 'trial';
}

// app_users.trial_ends_at is NOT NULL in the schema, so a missing value here
// cannot be a data state — it can only mean a loader that did not SELECT the
// column. That is a code bug, and the safe response is to FAIL OPEN (stay on
// trial) rather than silently downgrade every trialing user at once. Getting
// this backwards is exactly how this fix would have shipped as an outage:
// `undefined > now` is false, which would have moved every live trial to free
// the moment it deployed.
function trialStillRunning(user, now) {
  const raw = user.trial_ends_at;
  if (raw == null) return true;
  const endsAt = new Date(raw).getTime();
  if (Number.isNaN(endsAt)) return true;
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return endsAt > at;
}
