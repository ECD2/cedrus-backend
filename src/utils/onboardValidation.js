// ─────────────────────────────────────────────────────────────────────────
// WEB ONBOARDING — input validation (pure, no I/O)
//
// A visitor on cedrus.life submits a phone (and optional email). This is a
// PUBLIC, unauthenticated surface, so every value is hostile until proven
// otherwise. These helpers are the server-side gate the brief demands:
// "verify the phone format server-side, refuse disposable/obviously invalid
// numbers".
//
// Phone format is THE ONE TRUE FORMAT (utils/phone.js): digits-only with
// country code. We reuse normalizePhone so a web-submitted number and the
// same person's inbound SMS resolve to ONE app_users row.
//
// Scope note (flagged in docs/WEB_ONBOARD_CONTRACT.md): this is a *structural*
// filter (NANP shape, reserved/fake ranges). It cannot tell a real mobile from
// a disconnected line or a VoIP/burner number — that needs a Twilio Lookup
// carrier call (per-lookup cost), which is a deliberate follow-up, not MVP.
// ─────────────────────────────────────────────────────────────────────────

import { normalizePhone } from './phone.js';

// N11 codes (211, 311, … 911) are reserved service codes, never assignable as
// an area code or a central-office exchange.
function isN11(threeDigits) {
  return threeDigits[1] === '1' && threeDigits[2] === '1';
}

// Validate + normalize a submitted phone. Returns { ok, digits } on success or
// { ok:false, reason } with a machine reason (never surfaced verbatim to the
// client — the route maps every failure to one generic message).
//
// MVP supports NANP (+1) only: Cedrus texts from a US toll-free number, and
// messaging an arbitrary international number from it has cost + A2P/compliance
// implications. Non-NANP input is rejected with reason 'unsupported_country'
// (documented; internationalization is a tracked follow-up).
export function validatePhone(raw) {
  if (raw == null || typeof raw !== 'string') return { ok: false, reason: 'missing' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'missing' };

  // A leading '+' is allowed (E.164); anything else non-digit is just stripped
  // by normalizePhone. But reject inputs with letters — they signal a bad form
  // field, not a phone (e.g. someone typed a name).
  if (/[a-zA-Z]/.test(trimmed)) return { ok: false, reason: 'not_a_number' };

  const digits = normalizePhone(trimmed); // "+1 (786) 972-7469" -> "17869727469"
  if (!digits) return { ok: false, reason: 'missing' };

  // NANP: 11 digits, country code 1.
  if (digits.length !== 11 || digits[0] !== '1') {
    return { ok: false, reason: 'unsupported_country' };
  }

  const area = digits.slice(1, 4);
  const exchange = digits.slice(4, 7);
  const subscriber = digits.slice(7, 11);
  const national = digits.slice(1); // 10 national digits

  // NXX rules: area code and exchange both start 2-9, neither is an N11 code.
  if (area[0] < '2' || exchange[0] < '2') return { ok: false, reason: 'invalid_nxx' };
  if (isN11(area) || isN11(exchange)) return { ok: false, reason: 'reserved_nxx' };

  // 555-0100..555-0199 is the reserved fictional range (film/TV/docs).
  if (exchange === '555' && subscriber.slice(0, 2) === '01') {
    return { ok: false, reason: 'fictional' };
  }

  // Obvious fakes: all 10 national digits identical, or a straight run.
  if (/^(\d)\1{9}$/.test(national)) return { ok: false, reason: 'repeated' };
  if (national === '2345678901' || national === '1234567890' || national === '0123456789') {
    return { ok: false, reason: 'sequential' };
  }

  return { ok: true, digits };
}

// A small, high-signal blocklist of disposable/throwaway email providers. Not
// exhaustive — a full list is a maintained dependency; this catches the common
// ones so a marketing list is not immediately poisoned. Extend as needed.
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'getnada.com',
  'maildrop.cc', 'dispostable.com', 'mailnesia.com', 'fakeinbox.com',
  'mintemail.com', 'mohmal.com', 'emailondeck.com',
]);

// Practical email validator: a single @, non-empty local + domain, a dotted
// TLD-bearing domain, sane length caps, no whitespace or consecutive dots.
// Returns the LOWERCASED address (app_users.brief_email has a lowercase CHECK).
export function validateEmail(raw) {
  if (raw == null || typeof raw !== 'string') return { ok: false, reason: 'missing' };
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'missing' };
  if (email.length > 254) return { ok: false, reason: 'too_long' };

  // Structure: local@domain, no spaces, exactly one @, dotted domain.
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return { ok: false, reason: 'shape' };
  const [local, domain] = email.split('@');
  if (!local || local.length > 64) return { ok: false, reason: 'local' };
  if (!domain || domain.length > 253) return { ok: false, reason: 'domain' };
  if (email.includes('..')) return { ok: false, reason: 'dots' };
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-')) {
    return { ok: false, reason: 'domain' };
  }
  // Domain must have a label + a >=2 alpha TLD.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false, reason: 'domain' };

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return { ok: false, reason: 'disposable' };

  return { ok: true, email };
}
