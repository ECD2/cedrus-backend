import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { runWeeklyBriefs } from './weeklyBrief.js';
import { runDailySweeps } from './dailySweeps.js';
import { runTrialDowngrades } from './trialDowngrade.js';
import { runMonthlyCoreFive } from './coreFiveRecompute.js';
import { runReminderDispatch } from './reminders.js';
import { runBriefEmails } from './briefEmail.js';

// Cron times are SERVER time (UTC on Railway). Per-user local timing (e.g. "send
// the brief at 8am THEIR time") is decided inside each job, not by the cron.
export function startScheduler() {
  cron.schedule('*/5 * * * *',  () => guard('reminder-dispatch', runReminderDispatch)); // user-set reminders
  cron.schedule('*/15 * * * *', () => guard('daily-sweeps', runDailySweeps));     // birthdays/drift/events
  cron.schedule('0 * * * *',    () => guard('weekly-briefs', runWeeklyBriefs));    // hourly: users whose brief hour is now
  cron.schedule('0 * * * *',    () => guard('weekly-brief-emails', runBriefEmails)); // WS-F: no-ops unless BRIEF_EMAIL_ENABLED=true
  cron.schedule('30 * * * *',   () => guard('trial-downgrades', runTrialDowngrades));
  cron.schedule('0 3 1 * *',    () => guard('monthly-core-five', runMonthlyCoreFive)); // 1st of month, 03:00 UTC
  logger.event('scheduler.started', { message: 'jobs: reminder-dispatch, daily-sweeps, weekly-briefs, weekly-brief-emails, trial-downgrades, monthly-core-five' });
}

// Each tick runs inside its own correlation context so every log line the job
// emits shares one correlation_id (SLO job-freshness / tracing).
async function guard(name, fn) {
  const correlationId = randomId();
  return logger.runWithContext({ correlation_id: correlationId, trace_stage: 'dispatch' }, async () => {
    try { await fn(); }
    catch (err) { logger.event('job.failed', { level: 'error', error_category: 'internal', message: `${name}: ${err?.message || String(err)}` }); }
  });
}

function randomId() {
  try { return globalThis.crypto?.randomUUID?.() || String(Date.now()); }
  catch { return String(Date.now()); }
}
