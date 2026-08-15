import crypto from 'node:crypto';
import { normalizePhone } from '../utils/phone.js';

// ─────────────────────────────────────────────────────────────────────────
// Inbound SMS number allow-list (routes/sms.js STAGE A2).
//
// Cedrus is being repositioned to a private single-user assistant. Today ANY
// number that texts the Twilio number gets an app_users row, an is_self person
// row (DB trigger), a logged message, and a model-authored reply — because
// pipeline STAGE B1 calls users.findOrCreateByPhone, which creates on miss.
// This guard sits ABOVE all of that so a stranger's message costs nothing and
// creates nothing.
//
// Design and why:
//   • DECIDE HERE, ACT IN THE ROUTE. evaluateAllowlist() is pure — no I/O, no
//     clock, no env — so the arm/disarm matrix is exhaustively testable.
//   • ONE NORMALIZER. Both sides of the comparison go through normalizePhone
//     (utils/phone.js, "THE ONE TRUE PHONE FORMAT"). config.parsePhoneList
//     builds the list with it and we normalize the inbound `From` with it, so
//     "+17869727469" and "786-972-7469" resolve identically and this guard can
//     never disagree with the identity lookup it is protecting.
//   • DISARMED IS A REAL, ANNOUNCED STATE, not an absence. An empty list means
//     serve everyone — the pre-guard behaviour — and the caller is required to
//     log the mode every time (Lesson 7: a guard that cannot distinguish
//     "checked and fine" from "didn't run" is the disease this codebase keeps
//     re-catching). `armed` is returned explicitly for exactly that reason.
//   • FAIL OPEN, DELIBERATELY. An unset env disarms rather than blocking every
//     message. Blocking on absence would make a lost variable look identical to
//     a working guard while silently bricking inbound SMS. The outer gate is
//     STAGE A (Twilio signature), which is unaffected either way.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pure allow-list decision.
 * @param {string} from  raw inbound `From` (Twilio sends E.164, e.g. "+1786…")
 * @param {string[]} allowedPhones  already-normalized digits-only entries
 * @returns {{armed: boolean, allowed: boolean, reason: string}}
 */
export function evaluateAllowlist(from, allowedPhones) {
  const list = Array.isArray(allowedPhones) ? allowedPhones : [];
  const armed = list.length > 0;
  if (!armed) return { armed: false, allowed: true, reason: 'disarmed' };

  const digits = normalizePhone(from);
  if (!digits) return { armed: true, allowed: false, reason: 'unparseable_from' };

  return list.includes(digits)
    ? { armed: true, allowed: true, reason: 'allowlisted' }
    : { armed: true, allowed: false, reason: 'not_allowlisted' };
}

/**
 * Non-reversible, stable-per-deploy fingerprint of a phone number, for audit
 * correlation without ever putting the number in a log line. Mirrors
 * ipFingerprint() in services/adminSession.js, including base64url output —
 * letter-rich so the logger's phone redactor (utils/logger.js scrub()) cannot
 * mangle it into "[phone:1234]".
 */
export function phoneFingerprint(phone, salt = 'cedrus') {
  const digits = normalizePhone(phone);
  if (!digits) return 'ph_unknown';
  const mac = crypto.createHmac('sha256', String(salt || 'cedrus')).update(digits).digest();
  const b64url = mac.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'ph_' + b64url.slice(0, 12);
}
