import twilio from 'twilio';
import { config } from '../config.js';
import { toE164 } from '../utils/phone.js';

export const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);

// Verify a webhook genuinely came from Twilio. Used by every inbound route
// (SMS pipeline Stage A, and the delivery-status callback).
//
// Item 4 hardening:
//  • No Host-header fallback. The signed URL is built ONLY from the
//    configured PUBLIC_BASE_URL; deriving it from the attacker-controllable
//    Host header is a spoof/self-DoS vector. If PUBLIC_BASE_URL is unset while
//    validation is on, we FAIL CLOSED (reject) rather than trust `Host`.
//    (assertSecureBoot() already refuses to boot in this state in production.)
//  • The VALIDATE_TWILIO_SIGNATURE=false bypass remains only as a local-dev
//    escape hatch and is forbidden in production by assertSecureBoot().
export function validateTwilioSignature(req) {
  if (!config.validateTwilioSignature) return true; // local dev only; blocked in prod at boot
  if (!config.publicBaseUrl) return false;          // fail closed — never trust Host
  const signature = req.header('X-Twilio-Signature');
  if (!signature) return false;
  const url = config.publicBaseUrl.replace(/\/+$/, '') + req.originalUrl;
  return twilio.validateRequest(config.twilioAuthToken, signature, url, req.body);
}

// Absolute URL Twilio should POST delivery-status callbacks to (item 8).
// Null when PUBLIC_BASE_URL is unset (dev without a public tunnel) — sends
// still work, just without delivery receipts.
export function statusCallbackUrl() {
  if (!config.publicBaseUrl) return null;
  return config.publicBaseUrl.replace(/\/+$/, '') + '/sms/status';
}

// Used by the async path and by scheduled jobs (briefs/nudges/reminders). The
// inbound route replies via TwiML, so it doesn't call this.
export async function sendSms(to, body) {
  // `to` arrives as our stored digits-only format; Twilio needs "+".
  const params = { from: config.twilioFromNumber, to: toE164(to), body };
  // Ask Twilio to report delivered/failed back to us so failed sends stop
  // being invisible (item 8). Only when we have a public URL to receive them.
  const cb = statusCallbackUrl();
  if (cb) params.statusCallback = cb;
  return twilioClient.messages.create(params);
}

export { twilio };
