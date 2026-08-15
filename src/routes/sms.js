import { Router } from 'express';
import crypto from 'node:crypto';
import { validateTwilioSignature as defaultValidateSignature, twilio } from '../lib/twilio.js';
import { runInboundPipeline as defaultRunPipeline } from '../pipeline/index.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { evaluateAllowlist, phoneFingerprint } from '../lib/smsAllowlist.js';

// createSmsRouter(deps) is fully injectable (allow-list, signature check,
// pipeline and logger all passed in) so the STAGE A2 arm/disarm matrix is
// testable without a real Twilio signature or a real database — the same shape
// lib/cors.js and routes/adminAuth.js already use. A default instance built
// from config is exported at the bottom for the production mount in index.js.
export function createSmsRouter(deps = {}) {
  const {
    allowedPhones = config.allowedPhones,
    validateSignature = defaultValidateSignature,
    runPipeline = defaultRunPipeline,
    logger = defaultLogger,
  } = deps;

  const router = Router();

  // Twilio inbound SMS webhook. Point your Twilio number's "A MESSAGE COMES IN"
  // to: POST  https://<your-app>/sms/inbound
  router.post('/inbound', async (req, res) => {
    // STAGE A — verify it's really Twilio
    if (!validateSignature(req)) {
      logger.event('sms.inbound.rejected', { level: 'warn', error_category: 'auth', status_code: 403, provider_id: 'twilio' });
      return res.status(403).send('Forbidden');
    }

    const payload = {
      from: req.body.From,
      body: req.body.Body || '',
      messageSid: req.body.MessageSid,
      numSegments: parseInt(req.body.NumSegments || '1', 10),
    };

    // One correlation id ties this inbound SMS across every pipeline stage's log
    // lines (STRUCTURED_LOGGING_SPEC §2). Bound via AsyncLocalStorage so stages we
    // don't own still emit correlated logs without threading a parameter through.
    const correlationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const t0 = Date.now();

    await logger.runWithContext({ correlation_id: correlationId, request_id: requestId }, async () => {
      // ── STAGE A2 — number allow-list (private single-user mode) ─────────────
      // Deliberately ABOVE `sms.inbound.received` and above runInboundPipeline:
      // a number we do not serve must not reach STAGE B1 (which CREATES an
      // app_users row on miss), STAGE B4 (which logs the inbound), or STAGE C
      // (the one OpenAI call). Nothing is created and nothing is spent.
      //
      // The mode line is emitted on EVERY inbound in BOTH states, copying
      // jobs/budgetGuard.js: an unset ALLOWED_PHONES is a DISARMED guard that
      // says so, never a silent pass (Lesson 7).
      const gate = evaluateAllowlist(payload.from, allowedPhones);
      const fromRef = phoneFingerprint(payload.from);
      logger.event('sms.allowlist.check', {
        outcome: gate.allowed ? 'accepted' : 'rejected',
        reason: gate.reason,
        trace_stage: 'compliance',
        provider_id: 'twilio',
        message:
          `mode=${gate.armed ? 'armed' : 'DISARMED (set ALLOWED_PHONES)'} ` +
          `from=${fromRef} allowlist_size=${allowedPhones ? allowedPhones.length : 0}`,
      });

      if (!gate.allowed) {
        logger.event('sms.inbound.not_allowlisted', {
          level: 'warn', error_category: 'auth', status_code: 200,
          outcome: 'rejected', trace_stage: 'finalize', provider_id: 'twilio',
          latency_ms: Date.now() - t0,
          // The fingerprint only. Never the number, and never the body — a
          // message from a number we do not serve leaves no content behind.
          message: `from=${fromRef} reason=${gate.reason}`,
        });
        // Empty TwiML: 200 so Twilio does not retry, and NO <Message> element,
        // so the sender receives nothing at all. Replying to a number we do not
        // serve would start an A2P relationship we never intended; an error
        // status would just make Twilio retry the same message.
        return res.type('text/xml').send(new twilio.twiml.MessagingResponse().toString());
      }

      logger.event('sms.inbound.received', {
        provider_id: 'twilio', provider_message_id: payload.messageSid,
        segments: payload.numSegments, body_len: payload.body.length, trace_stage: 'compliance',
      });

      let replyText = null;
      try {
        replyText = await runPipeline(payload);
      } catch (err) {
        logger.event('sms.pipeline.error', { level: 'error', error_category: 'internal', message: err?.message || String(err) });
        replyText = 'Hmm, something went wrong on my end. Try that again in a moment.';
      }

      // STAGE E (MVP, synchronous) — reply via TwiML. If processing ever exceeds
      // Twilio's ~15s window, switch to: ack 200 here, process in background,
      // send via sendSms(). The whole pipeline already supports that move.
      const twiml = new twilio.twiml.MessagingResponse();
      if (replyText) twiml.message(replyText);
      res.type('text/xml').send(twiml.toString());
      logger.event('sms.inbound.handled', {
        status_code: 200, outcome: 'accepted', trace_stage: 'finalize',
        latency_ms: Date.now() - t0, body_len: replyText ? replyText.length : 0,
      });
    });
  });

  return router;
}

// ── Production instance (mounted at /sms in src/index.js) ───────────────────
const router = createSmsRouter();

export default router;
