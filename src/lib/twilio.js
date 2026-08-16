import twilio from 'twilio';
import { config } from '../config.js';
import { toE164 } from '../utils/phone.js';
import { logger as defaultLogger } from '../utils/logger.js';
import { evaluateAllowlist, phoneFingerprint, OUTBOUND_REFUSED } from './smsAllowlist.js';

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
//
// ── STAGE O — outbound number allow-list (private single-user mode) ──────────
// THIS IS THE ONE CHOKE POINT. All six outbound paths — weekly-briefs,
// daily-sweeps, reminder-dispatch, card-sender, card-followup and broadcasts —
// reach Twilio through this function and only through this function, so the
// guard lives here rather than in six call sites. Two properties make that the
// right call and not merely the convenient one:
//
//   1. IT CANNOT BE BYPASSED BY NEW CODE. A future job that sends SMS must call
//      sendSms(); it inherits the guard without anyone remembering to add it.
//      Six patched call sites would not have that property.
//   2. REFUSING HERE CANNOT PRODUCE A FALSE SUCCESS. Every caller already wraps
//      this in try/catch and, on a throw, reverts state instead of recording a
//      send — so throwing provably prevents markSent(), logOutbound() and
//      recordBriefSent() from running. That is exactly the bug the DRY-RUN
//      branch has today: it skips the wire but still records a send, which is
//      why the non-allowlisted row reads total_briefs_sent=3.
//
// The refusal is tagged OUTBOUND_REFUSED because it is PERMANENT, unlike a
// Twilio outage. Callers that would otherwise revert to a retryable state must
// cancel on this code instead of retrying a number forever.
//
// Arm/disarm mirrors the inbound guard exactly (routes/sms.js STAGE A2) and
// announces its mode on EVERY send, in both states (Lesson 7).
export async function sendSms(to, body, deps = {}) {
  const allowedPhones = deps.allowedPhones ?? config.allowedPhones;
  const log = deps.logger ?? defaultLogger;

  const gate = evaluateAllowlist(to, allowedPhones);
  const toRef = phoneFingerprint(to);
  log.event('sms.outbound.allowlist.check', {
    outcome: gate.allowed ? 'accepted' : 'rejected',
    reason: gate.reason,
    trace_stage: 'dispatch',
    provider_id: 'twilio',
    message:
      `mode=${gate.armed ? 'armed' : 'DISARMED (set ALLOWED_PHONES)'} ` +
      `to=${toRef} allowlist_size=${allowedPhones ? allowedPhones.length : 0}`,
  });

  if (!gate.allowed) {
    log.event('sms.outbound.not_allowlisted', {
      level: 'warn', error_category: 'auth', outcome: 'rejected',
      trace_stage: 'dispatch', provider_id: 'twilio',
      // Fingerprint only. Never the number, never the body.
      message: `to=${toRef} reason=${gate.reason}`,
    });
    const err = new Error('outbound refused: recipient is not on ALLOWED_PHONES');
    err.code = OUTBOUND_REFUSED;
    err.notAllowlisted = true;
    throw err;
  }

  // `to` arrives as our stored digits-only format; Twilio needs "+".
  const params = { from: config.twilioFromNumber, to: toE164(to), body };
  // Ask Twilio to report delivered/failed back to us so failed sends stop
  // being invisible (item 8). Only when we have a public URL to receive them.
  const cb = statusCallbackUrl();
  if (cb) params.statusCallback = cb;
  return twilioClient.messages.create(params);
}

export { twilio };
