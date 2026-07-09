// ─────────────────────────────────────────────────────────────────────
// THE ONE TRUE PHONE FORMAT (Fix C1)
// Everywhere inside Cedrus, a phone number is DIGITS ONLY with country
// code: "+1 (786) 972-7469" -> "17869727469".
// Why: Supabase Auth stores phone digits-only, so the web login and the
// SMS pipeline must agree or the same human becomes two accounts.
// The "+" exists ONLY at the Twilio API boundary (toE164).
// ─────────────────────────────────────────────────────────────────────

export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length === 10 ? '1' + d : d; // bare 10-digit US number -> add the 1
}

export function toE164(phone) {
  const d = normalizePhone(phone);
  return d ? '+' + d : '';
}
