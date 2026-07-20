import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

// ─────────────────────────────────────────────────────────────────────────
// Admin session primitives (BE-ADMIN-AUTH). Design: docs/ADMIN_AUTH_DESIGN.md.
//
// Pure, dependency-injectable building blocks for the email + password + TOTP
// admin login. No Express, no config, no process.env here — everything is
// passed in, so every function is unit-testable with fakes and a fake clock.
// The router (src/routes/adminAuth.js) wires these to real config + req/res.
//
// Security choices and why: see the design doc. In short — bcrypt for the
// password, otplib for TOTP (never hand-rolled), an opaque HMAC-signed session
// token (not a JWT, so no alg-confusion surface), constant-time comparisons,
// a monotonic-step TOTP replay guard, and a sliding-window rate limiter.
// ─────────────────────────────────────────────────────────────────────────

export const TOTP_PERIOD_SECONDS = 30;
export const SESSION_TOKEN_PREFIX = 'cadm_v1';

// otplib tuned once: ±1 time-step (±30 s) tolerance for clock skew, 6 digits,
// SHA1 (what every authenticator app defaults to). `check` with this instance
// is what we validate against; `keyuri`/`generateSecret` come off the default.
const totp = authenticator.clone({ window: [1, 1], digits: 6, step: TOTP_PERIOD_SECONDS });

// ── base64url (no deps) ────────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '==='.slice((s.length + 3) % 4), 'base64');
}

// ── constant-time string equality ──────────────────────────────────────────
// Length is not secret (we return early on mismatch); the byte comparison is
// timing-safe so a prefix-guessing attacker learns nothing about the content.
export function timingSafeStrEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Admin email: normalized (trim + lowercase), then timing-safe compared.
export function emailMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  return timingSafeStrEqual(provided.trim().toLowerCase(), expected.trim().toLowerCase());
}

// ── password (bcrypt) ──────────────────────────────────────────────────────
// hash is `ADMIN_PASSWORD_HASH` ($2a/$2b/$2y$…). Returns false (never throws)
// on a malformed hash or non-string input, so a bad env value fails closed.
export async function passwordMatches(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string' || !hash) return false;
  try { return await bcrypt.compare(password, hash); }
  catch { return false; }
}

// ── TOTP ───────────────────────────────────────────────────────────────────
export function generateTotpSecret() { return authenticator.generateSecret(); }

export function totpKeyuri(secret, { label, issuer } = {}) {
  return authenticator.keyuri(label || 'admin', issuer || 'Cedrus Admin', secret);
}

// True if `token` is a currently-valid code for `secret` (±1 step). Never
// throws on garbage input.
export function totpValid(token, secret) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token) || typeof secret !== 'string' || !secret) return false;
  try { return totp.check(token, secret); }
  catch { return false; }
}

// The 30-s time-step index for a given epoch-ms. Used by the replay guard so a
// code cannot be consumed twice in (or before) its own window.
export function totpStep(nowMs) { return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS); }

// Monotonic replay guard. A valid code is rejected if its step is at or below
// the highest step already consumed, or if the exact code was seen recently.
// In-memory (single beta instance — see design doc §Non-goals).
export class TotpReplayGuard {
  constructor() { this.highWaterStep = -1; this.recent = new Map(); }
  // Returns a reason string if this (already TOTP-valid) code is a replay, else null.
  reason(token, step) {
    if (this.recent.has(token)) return 'totp_replayed';
    if (step <= this.highWaterStep) return 'totp_replayed';
    return null;
  }
  commit(token, step) {
    this.highWaterStep = Math.max(this.highWaterStep, step);
    this.recent.set(token, step);
    for (const [t, s] of this.recent) if (s < step - 2) this.recent.delete(t);
  }
}

// ── session token (opaque, HMAC-SHA256) ────────────────────────────────────
// cadm_v1.<payload_b64url>.<sig_b64url>, sig = HMAC(secret, "cadm_v1.<payload>").
export function signSession({ secret, ttlSeconds = 12 * 3600, now = Date.now, jti }) {
  if (!secret) throw new Error('signSession: missing secret');
  const iat = Math.floor(now() / 1000);
  const payload = { sub: 'admin', iat, exp: iat + Math.floor(ttlSeconds), jti: jti || crypto.randomBytes(9).toString('hex') };
  const payloadB64 = b64url(JSON.stringify(payload));
  const signed = SESSION_TOKEN_PREFIX + '.' + payloadB64;
  const sig = b64url(crypto.createHmac('sha256', secret).update(signed).digest());
  return { token: signed + '.' + sig, payload, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

// Verify signature (timing-safe) then expiry. Returns { valid, reason, payload }.
// reason ∈ malformed | bad_signature | expired.
export function verifySession(token, { secret, now = Date.now } = {}) {
  if (!secret || typeof token !== 'string') return { valid: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX) return { valid: false, reason: 'malformed' };
  const signed = parts[0] + '.' + parts[1];
  const expected = b64url(crypto.createHmac('sha256', secret).update(signed).digest());
  if (!timingSafeStrEqual(parts[2], expected)) return { valid: false, reason: 'bad_signature' };
  let payload;
  try { payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')); }
  catch { return { valid: false, reason: 'malformed' }; }
  if (!payload || payload.sub !== 'admin' || typeof payload.exp !== 'number') return { valid: false, reason: 'malformed' };
  if (Math.floor(now() / 1000) >= payload.exp) return { valid: false, reason: 'expired' };
  return { valid: true, reason: null, payload };
}

// ── sliding-window rate limiter (in-memory) ────────────────────────────────
// Per-key (client IP) failure window plus a global ceiling. Success calls
// reset(key). now injected for deterministic tests.
export class RateLimiter {
  constructor({ max = 5, windowMs = 15 * 60 * 1000, globalMax = 50, now = Date.now } = {}) {
    this.max = max; this.windowMs = windowMs; this.globalMax = globalMax; this.now = now;
    this.hits = new Map(); this.global = [];
  }
  _prune(arr, t) { const cut = t - this.windowMs; while (arr.length && arr[0] <= cut) arr.shift(); }
  // Call BEFORE processing an attempt. { limited, retryAfterSec }.
  status(key) {
    const t = this.now();
    const arr = this.hits.get(key) || [];
    this._prune(arr, t); this._prune(this.global, t);
    const overKey = arr.length >= this.max;
    const overGlobal = this.global.length >= this.globalMax;
    if (!overKey && !overGlobal) return { limited: false, retryAfterSec: 0 };
    const oldest = overKey ? arr[0] : this.global[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000));
    return { limited: true, retryAfterSec };
  }
  fail(key) {
    const t = this.now();
    const arr = this.hits.get(key) || [];
    arr.push(t); this.hits.set(key, arr);
    this.global.push(t);
    this._prune(arr, t); this._prune(this.global, t);
  }
  reset(key) { this.hits.delete(key); }
}

// Non-reversible, stable-per-deploy IP fingerprint for audit correlation. Uses
// base64url (letter-rich) so the logger's phone redactor never mangles it, and
// the raw IP never reaches a log line.
export function ipFingerprint(ip, salt) {
  if (!ip) return 'ip_unknown';
  return 'ip_' + b64url(crypto.createHmac('sha256', String(salt || 'cedrus')).update(String(ip)).digest()).slice(0, 12);
}
