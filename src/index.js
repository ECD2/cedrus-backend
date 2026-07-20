import express from 'express';
import { config, assertSecureBoot } from './config.js';
import { logger } from './utils/logger.js';
import smsRouter from './routes/sms.js';
import statusRouter from './routes/deliveryStatus.js';
import healthRouter from './routes/health.js';
import adminRouter from './routes/admin.js';
import adminPanelRouter from './routes/adminPanel.js';
import { adminAuthRouter, adminSessionAdapter } from './routes/adminAuth.js';
import apiRouter from './routes/api/index.js';
import onboardRouter from './routes/api/onboard.js';
import { corsMiddleware } from './lib/cors.js';
import { startScheduler } from './jobs/scheduler.js';

// Item 4/A12: refuse to boot in an insecure production configuration
// (signature bypass on, or PUBLIC_BASE_URL unset while validating).
assertSecureBoot();

const app = express();
// Railway terminates TLS at its proxy; trust one hop so req.ip is the real
// client (the onboarding rate limiter keys on it — MOUNT_WEBONBOARD).
app.set('trust proxy', 1);
// Browser clients (cedrus.life) call this API cross-origin, so CORS preflight
// must be answered and the allowed origin echoed BEFORE the body parsers and
// routers run. Pinned to our origins — never "*". There is no Stripe raw-body
// webhook to precede this yet; if one is added, mount its express.raw route
// ahead of this line so signature verification sees the untouched body.
app.use(corsMiddleware);
// Twilio posts application/x-www-form-urlencoded; JSON is for future web/Stripe
// webhooks. A2/A7: cap body size so a large POST can't be a cheap memory lever.
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

app.use('/health', healthRouter);
app.use('/sms', smsRouter);      // POST /sms/inbound
app.use('/sms', statusRouter);   // POST /sms/status  (Twilio delivery callbacks, item 8)
app.use('/admin', adminAuthRouter);     // MOUNT_ADMIN_AUTH: POST /admin/auth/login, /admin/auth/enroll
app.use('/admin', adminSessionAdapter); // MOUNT_ADMIN_AUTH: Bearer session → req.adminSession + injected x-admin-key
app.use('/admin', adminPanelRouter); // N1 panel — must precede adminRouter (MOUNT_N1)
app.use('/admin', adminRouter);
app.use('/api/onboard', onboardRouter); // PUBLIC website onboarding — must precede the authed /api router (MOUNT_WEBONBOARD)
app.use('/api', apiRouter);      // N3: web capture, priority swap, restore (MOUNT_N3)

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // express.json/urlencoded raise a 400-class error on oversized/malformed
  // bodies; don't 500 those.
  const status = err && (err.status || err.statusCode);
  if (status && status >= 400 && status < 500) {
    logger.event('http.request.rejected', { level: 'warn', status_code: status, error_category: 'validation', message: err.type || 'bad request' });
    return res.status(status).send('Bad request');
  }
  logger.event('http.error.unhandled', { level: 'error', error_category: 'internal', message: err?.message || 'unhandled error' });
  res.status(500).send('Internal error');
});

const server = app.listen(config.port, () => {
  logger.event('server.started', { message: `Cedrus backend listening on :${config.port}` });
  if (config.enableJobs) startScheduler();
  else logger.event('jobs.disabled', { reason: 'ENABLE_JOBS=false' });
});

// ── Item 6: process safety ──────────────────────────────────────────────────
// Railway hard-kills the process on deploy (SIGTERM) and a crash can otherwise
// leave the process running in a corrupt state mid-write. These handlers make
// the two integrity bugs (reminder double-send / brief silent-miss) survivable:
// in-flight work is either finished or safely left retryable, and an unexpected
// throw is logged instead of silently taking the process down mid-request.

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.event('server.shutdown.begin', { reason: signal });
  // Stop accepting new connections; let in-flight requests/cron ticks drain.
  server.close((err) => {
    if (err) logger.event('server.shutdown.error', { level: 'error', error_category: 'internal', message: err.message });
    else logger.event('server.shutdown.complete', { reason: signal });
    process.exit(err ? 1 : 0);
  });
  // Hard cap: Railway gives ~10s before SIGKILL. Force-exit just under that so
  // we exit cleanly rather than being killed mid-flush.
  const t = setTimeout(() => {
    logger.event('server.shutdown.forced', { level: 'warn', reason: 'drain timeout' });
    process.exit(1);
  }, 8000);
  if (typeof t.unref === 'function') t.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Never let an unhandled async error silently corrupt state or crash without a
// trace. We log and, for an uncaughtException (unknown-state process), begin a
// graceful shutdown so the platform restarts us clean rather than continuing on
// a possibly-corrupt heap.
process.on('unhandledRejection', (reason) => {
  logger.event('process.unhandledRejection', {
    level: 'error', error_category: 'internal',
    message: reason instanceof Error ? reason.message : String(reason),
  });
});
process.on('uncaughtException', (err) => {
  logger.event('process.uncaughtException', {
    level: 'fatal', error_category: 'internal', message: err?.message || String(err),
  });
  shutdown('uncaughtException');
});
