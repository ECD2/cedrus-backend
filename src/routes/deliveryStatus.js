import { Router } from 'express';
import { validateTwilioSignature } from '../lib/twilio.js';
import * as messages from '../services/messages.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// Twilio delivery-status callback (WS-A item 8)
//
// Point your Twilio number's status callback (or rely on the per-message
// statusCallback we set in lib/twilio.js sendSms) to:
//   POST  https://<your-app>/sms/status
//
// Twilio POSTs the terminal (and intermediate) status of an outbound message:
//   MessageSid, MessageStatus ∈ queued|sent|delivered|undelivered|failed,
//   ErrorCode (on failure). We record it against the outbound row with that SID
//   so a failed send stops being invisible — it lands in messages.provider_status
//   and shows up in the delivery log instead of being silently lost.
//
// Auth: validates the Twilio signature exactly like the inbound route. An
// unsigned/forged callback is rejected (an attacker must not be able to forge
// "delivered"/"failed" for arbitrary SIDs).
// ─────────────────────────────────────────────────────────────────────────

const router = Router();

const TERMINAL = new Set(['delivered', 'undelivered', 'failed', 'sent']);

router.post('/status', async (req, res) => {
  if (!validateTwilioSignature(req)) {
    logger.event('sms.status.rejected', { level: 'warn', error_category: 'auth', status_code: 403, provider_id: 'twilio' });
    return res.status(403).send('Forbidden');
  }

  const sid = req.body.MessageSid || req.body.SmsSid || null;
  const status = req.body.MessageStatus || req.body.SmsStatus || null;
  const errorCode = req.body.ErrorCode || null;

  // Always 204 quickly; Twilio doesn't need a body and retries on non-2xx.
  if (!sid || !status) return res.status(204).end();

  try {
    const row = await messages.recordDeliveryStatus({
      providerMessageId: sid, status, errorCode, raw: true,
    });
    const failed = status === 'failed' || status === 'undelivered';
    logger.event(failed ? 'sms.delivery.failed' : 'sms.delivery.update', {
      level: failed ? 'error' : 'info',
      provider_id: 'twilio', provider_message_id: sid,
      outcome: status === 'delivered' ? 'sent' : (failed ? 'error' : undefined),
      error_category: failed ? 'provider_error' : undefined,
      error_code: errorCode ? String(errorCode) : undefined,
      message_type: row?.message_type,
      user_ref: row?.user_id ? 'u_' + row.user_id : undefined,
      reason: TERMINAL.has(status) ? status : undefined,
    });
  } catch (err) {
    logger.event('sms.status.error', { level: 'error', error_category: 'db_error', provider_message_id: sid, message: err?.message || String(err) });
  }
  return res.status(204).end();
});

export default router;
