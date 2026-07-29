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
export function startScheduler() {
  cron.schedule('*/5 * * * *',  () => guard('reminder-dispatch', runReminderDispatch, { outbound: true })); // user-set reminders
  cron.schedule('*/15 * * * *', () => guard('daily-sweeps', runDailySweeps, { outbound: true }));     // birthdays/drift/events
  cron.schedule('*/15 * * * *', () => guard('clarification-expiry', runClarificationExpiry)); // held dedup asks past TTL → create
  cron.schedule('0 * * * *',    () => guard('weekly-briefs', runWeeklyBriefs, { outbound: true }));    // hourly: users whose brief hour is now
  cron.schedule('0 * * * *',    () => guard('weekly-brief-emails', runBriefEmails, { outbound: true })); // WS-F: no-ops unless BRIEF_EMAIL_ENABLED=true
  cron.schedule('30 * * * *',   () => guard('trial-downgrades', runTrialDowngrades));
  cron.schedule('10 * * * *',   () => guard('budget-guard', runBudgetGuard)); // hourly spend check → kill-switch row (item 1)
  cron.schedule('0 3 1 * *',    () => guard('monthly-core-five', runMonthlyCoreFive)); // 1st of month, 03:00 UTC
  logger.event('scheduler.started', { message: 'jobs: reminder-dispatch, daily-sweeps, clarification-expiry, weekly-briefs, weekly-brief-emails, trial-downgrades, budget-guard, monthly-core-five' });
}

// Each tick runs inside its own correlation context so every log line the job
// emits shares one correlation_id (SLO job-freshness / tracing).
async function guard(name, fn, { outbound = false } = {}) {
  const correlationId = randomId();
  return logger.runWithContext({ correlation_id: correlationId, trace_stage: 'dispatch' }, async () => {
    try {
      // Budget kill switch: outbound jobs skip while spend is over budget.
      // shouldRunOutboundJob fails OPEN (missing table/row/error ⇒ run) and
      // logs budget.job.skipped per skipped tick — never a silent no-op.
      if (outbound && !(await shouldRunOutboundJob(name))) return;
      await fn();
    }
    catch (err) { logger.event('job.failed', { level: 'error', error_category: 'internal', message: `${name}: ${err?.message || String(err)}` }); }
  });
}

function randomId() {
  try { return globalThis.crypto?.randomUUID?.() || String(Date.now()); }
  catch { return String(Date.now()); }
}
