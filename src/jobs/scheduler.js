import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { runWeeklyBriefs } from './weeklyBrief.js';
import { runDailySweeps } from './dailySweeps.js';
import { runTrialDowngrades } from './trialDowngrade.js';
import { runMonthlyCoreFive } from './coreFiveRecompute.js';
import { runReminderDispatch } from './reminders.js';
import { runBriefEmails } from './briefEmail.js';
import { runClarificationExpiry } from './sweeps/clarificationExpiry.js';
import { runBudgetGuard } from './budgetGuard.js';
import { runCardSender } from './cardSender.js';
import { runCardFollowup } from './cardFollowup.js';
import { runCosDailyBrief } from './cosDailyBrief.js';
import { shouldRunOutboundJob } from '../services/budget.js';

// Cron times are SERVER time (UTC on Railway). Per-user local timing (e.g. "send
// the brief at 8am THEIR time") is decided inside each job, not by the cron.
//
// `outbound: true` marks jobs that put user-facing messages on the wire (or
// spend provider money composing them — briefs/nudges call OpenAI even under
// BRIEF_DRY_RUN). Those are gated by the budget kill switch HERE, at the single
// choke point every scheduled tick passes through; the scheduler is the only
// caller of these entry points. Data-only jobs (trial downgrades, clarification
// expiry, core five, the budget guard itself) spend nothing and are not gated.
// The registrations, as DATA rather than eleven cron.schedule() calls.
//
// Made a table (2026-08-17) so a test can assert the budget wiring instead of
// grepping this file for the string `outbound: true`. A source-text assertion
// would pass just as happily if `guard` stopped consulting the gate — it is
// the shape of proof Law 3 rejects. With the registry exported, the suite can
// drive the REAL guard with a tripped gate and watch the job not run.
export const JOB_REGISTRY = [
  { name: 'reminder-dispatch',    spec: '*/5 * * * *',  fn: runReminderDispatch,    outbound: true },  // user-set reminders
  { name: 'daily-sweeps',         spec: '*/15 * * * *', fn: runDailySweeps,         outbound: true },  // birthdays/drift/events
  { name: 'clarification-expiry', spec: '*/15 * * * *', fn: runClarificationExpiry, outbound: false }, // held dedup asks past TTL → create
  { name: 'weekly-briefs',        spec: '0 * * * *',    fn: runWeeklyBriefs,        outbound: true },  // hourly: users whose brief hour is now
  { name: 'weekly-brief-emails',  spec: '0 * * * *',    fn: runBriefEmails,         outbound: true },  // WS-F: no-ops unless BRIEF_EMAIL_ENABLED=true
  { name: 'trial-downgrades',     spec: '30 * * * *',   fn: runTrialDowngrades,     outbound: false },
  { name: 'budget-guard',         spec: '10 * * * *',   fn: runBudgetGuard,         outbound: false }, // hourly spend check → kill-switch row (item 1)
  { name: 'card-sender',          spec: '*/15 * * * *', fn: runCardSender,          outbound: true },  // V1 card rail (item 2)
  { name: 'card-followup',        spec: '25 * * * *',   fn: runCardFollowup,        outbound: true },  // "did it happen?" 3d post-YES
  { name: 'monthly-core-five',    spec: '0 3 1 * *',    fn: runMonthlyCoreFive,     outbound: false }, // 1st of month, 03:00 UTC
  // Chief of Staff daily brief. outbound:true — it emails a person AND spends
  // OpenAI money composing, so it belongs behind the budget kill switch on both
  // counts. DISARMED unless COS_SUPABASE_URL + COS_SERVICE_ROLE_KEY are set;
  // it announces that mode on every tick and does nothing else.
  //
  // 11:00 UTC = 07:00 America/New_York in EDT, 06:00 in EST. A fixed UTC cron
  // drifts by one hour across the DST boundary; that is accepted rather than
  // building per-user local-hour selection for a single-owner job. It sits
  // safely mid-UTC-day, so the ledger's UTC-day key has no midnight edge.
  { name: 'cos-daily-brief',      spec: '0 11 * * *',   fn: runCosDailyBrief,       outbound: true },
];

export function startScheduler() {
  for (const job of JOB_REGISTRY) {
    cron.schedule(job.spec, () => guard(job.name, job.fn, { outbound: job.outbound }));
  }
  logger.event('scheduler.started', {
    message: 'jobs: ' + JOB_REGISTRY.map((j) => j.name).join(', '),
  });
}

// Each tick runs inside its own correlation context so every log line the job
// emits shares one correlation_id (SLO job-freshness / tracing).
//
// `gate` is injectable ONLY so the suite can drive a tripped budget without a
// database. Production always uses the default.
export async function guard(name, fn, { outbound = false, gate = shouldRunOutboundJob } = {}) {
  const correlationId = randomId();
  return logger.runWithContext({ correlation_id: correlationId, trace_stage: 'dispatch' }, async () => {
    try {
      // Budget kill switch: outbound jobs skip while spend is over budget.
      // shouldRunOutboundJob fails OPEN (missing table/row/error ⇒ run) and
      // logs budget.job.skipped per skipped tick — never a silent no-op.
      if (outbound && !(await gate(name))) return;
      await fn();
    }
    catch (err) { logger.event('job.failed', { level: 'error', error_category: 'internal', message: `${name}: ${err?.message || String(err)}` }); }
  });
}

function randomId() {
  try { return globalThis.crypto?.randomUUID?.() || String(Date.now()); }
  catch { return String(Date.now()); }
}
