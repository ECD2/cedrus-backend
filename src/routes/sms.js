import { Router } from 'express';
import crypto from 'node:crypto';
import { validateTwilioSignature, twilio } from '../lib/twilio.js';
import { runInboundPipeline } from '../pipeline/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Twilio inbound SMS webhook. Point your Twilio number's "A MESSAGE COMES IN"
// to: POST  https://<your-app>/sms/inbound
router.post('/inbound', async (req, res) => {
  // STAGE A — verify it's really Twilio
  if (!validateTwilioSignature(req)) {
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
    logger.event('sms.inbound.received', {
      provider_id: 'twilio', provider_message_id: payload.messageSid,
      segments: payload.numSegments, body_len: payload.body.length, trace_stage: 'compliance',
    });

    let replyText = null;
    try {
      replyText = await runInboundPipeline(payload);
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

export default router;
