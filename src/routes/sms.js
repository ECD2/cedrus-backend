import { Router } from 'express';
import { validateTwilioSignature, twilio } from '../lib/twilio.js';
import { runInboundPipeline } from '../pipeline/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Twilio inbound SMS webhook. Point your Twilio number's "A MESSAGE COMES IN"
// to: POST  https://<your-app>/sms/inbound
router.post('/inbound', async (req, res) => {
  // STAGE A — verify it's really Twilio
  if (!validateTwilioSignature(req)) {
    logger.warn('Rejected webhook: bad Twilio signature');
    return res.status(403).send('Forbidden');
  }

  const payload = {
    from: req.body.From,
    body: req.body.Body || '',
    messageSid: req.body.MessageSid,
    numSegments: parseInt(req.body.NumSegments || '1', 10),
  };

  let replyText = null;
  try {
    replyText = await runInboundPipeline(payload);
  } catch (err) {
    logger.error('Pipeline error', err);
    replyText = 'Hmm, something went wrong on my end. Try that again in a moment.';
  }

  // STAGE E (MVP, synchronous) — reply via TwiML. If processing ever exceeds
  // Twilio's ~15s window, switch to: ack 200 here, process in background,
  // send via sendSms(). The whole pipeline already supports that move.
  const twiml = new twilio.twiml.MessagingResponse();
  if (replyText) twiml.message(replyText);
  res.type('text/xml').send(twiml.toString());
});

export default router;
