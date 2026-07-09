import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { runWeeklyBriefs } from './weeklyBrief.js';
import { runDailySweeps } from './dailySweeps.js';
import { runTrialDowngrades } from './trialDowngrade.js';
import { runMonthlyCoreFive } from './coreFiveRecompute.js';

// Cron times are SERVER time (UTC on Railway). Per-user local timing (e.g. "send
// the brief at 8am THEIR time") is decided inside each job, not by the cron.
export function startScheduler() {
  cron.schedule('*/15 * * * *', () => guard('daily-sweeps', runDailySweeps));     // birthdays/drift/events
  cron.schedule('0 * * * *',    () => guard('weekly-briefs', runWeeklyBriefs));    // hourly: users whose brief hour is now
  cron.schedule('30 * * * *',   () => guard('trial-downgrades', runTrialDowngrades));
  cron.schedule('0 3 1 * *',    () => guard('monthly-core-five', runMonthlyCoreFive)); // 1st of month, 03:00 UTC
  logger.info('Scheduler started (jobs: daily-sweeps, weekly-briefs, trial-downgrades, monthly-core-five)');
}

async function guard(name, fn) {
  try { await fn(); } catch (err) { logger.error(`Job ${name} failed`, err); }
}
