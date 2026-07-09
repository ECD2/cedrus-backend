import twilio from 'twilio';
import { config } from '../config.js';
import { toE164 } from '../utils/phone.js';

export const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);

// Verify a webhook genuinely came from Twilio (Stage A of the pipeline).
export function validateTwilioSignature(req) {
  if (!config.validateTwilioSignature) return true; // local testing escape hatch
  const signature = req.header('X-Twilio-Signature');
  const base = config.publicBaseUrl || `https://${req.headers.host}`;
  const url = base + req.originalUrl;
  return twilio.validateRequest(config.twilioAuthToken, signature, url, req.body);
}

// Used by the async path and by scheduled jobs (briefs/nudges). The inbound
// route replies via TwiML, so it doesn't call this.
export async function sendSms(to, body) {
  // `to` arrives as our stored digits-only format; Twilio needs "+".
  return twilioClient.messages.create({ from: config.twilioFromNumber, to: toE164(to), body });
}

export { twilio };
