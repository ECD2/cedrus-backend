import dotenv from 'dotenv';
import { normalizePhone } from './utils/phone.js';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: missing required env var ${name}`); process.exit(1); }
  return v;
}

// Comma-separated phone allow-list → THE ONE TRUE PHONE FORMAT (utils/phone.js).
// Deliberately routed through normalizePhone rather than a local regex: the SMS
// identity lookup (users.findOrCreateByPhone) normalizes the inbound `From` with
// that same function, so an allow-list entry and the number it is meant to match
// cannot drift apart. Empty/unset ⇒ [].
function parsePhoneList(raw) {
  return String(raw || '').split(',').map(normalizePhone).filter(Boolean);
}

// Daily budget envs: a positive number arms that dimension of the budget guard;
// unset/empty/invalid ⇒ null ⇒ that dimension is DISARMED (and the hourly guard
// announces the mode on every run — never silently).
function parseBudgetEnv(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProduction,
  port: process.env.PORT || 3000,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
  enableJobs: process.env.ENABLE_JOBS !== 'false',
  validateTwilioSignature: process.env.VALIDATE_TWILIO_SIGNATURE !== 'false',

  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',

  twilioAccountSid: required('TWILIO_ACCOUNT_SID'),
  twilioAuthToken: required('TWILIO_AUTH_TOKEN'),
  twilioFromNumber: required('TWILIO_FROM_NUMBER'),

  // Header-auth admin key (see routes/admin.js). Unset ⇒ admin routes 404.
  adminKey: process.env.ADMIN_KEY || '',

  // Comma-separated allow-list of phone numbers permitted for POST
  // /admin/reset-user (item 9). Any format; normalized at use. Empty ⇒ the
  // reset-user tool refuses every request.
  testerPhones: parsePhoneList(process.env.TESTER_PHONES),

  // Comma-separated allow-list of phone numbers the inbound SMS webhook will
  // serve at all (routes/sms.js STAGE A2, private single-user mode). Same
  // parsing as testerPhones — one normalizer, no second implementation.
  // UNSET/EMPTY ⇒ DISARMED: every number is served, exactly as before this
  // guard existed, and the route ANNOUNCES that mode on every single inbound
  // (Lesson 7 — silence must never read as "checked and fine").
  allowedPhones: parsePhoneList(process.env.ALLOWED_PHONES),

  // When true, the brief job composes + records but LOGS instead of sending via Twilio.
  // Lets you tune the brief before A2P registration completes.
  briefDryRun: process.env.BRIEF_DRY_RUN === 'true',

  // Budget guard (night build 2026-07-28, item 1; doctrine flag 17). Units:
  // DAILY_TOKEN_BUDGET = total OpenAI tokens per UTC day across ALL users
  // (v_daily_token_usage.total_tokens); DAILY_SMS_BUDGET = SMS segments per UTC
  // day, BOTH directions (v_daily_sms_usage.sms_segments — segments are what
  // Twilio bills). Over budget ⇒ the hourly job arms the kill switch: inbound
  // gets one polite template (crisis exempt), outbound jobs skip.
  dailyTokenBudget: parseBudgetEnv(process.env.DAILY_TOKEN_BUDGET),
  dailySmsBudget: parseBudgetEnv(process.env.DAILY_SMS_BUDGET),

  // WS-F email brief (MOUNT_N2 §2). The job (src/jobs/briefEmail.js) takes an
  // injectable env object and reads process.env itself; these fields carry only
  // presence/mode so assertSecureBoot() can fail closed without secrets being
  // copied around. Full var table: docs/MOUNT_N2.md.
  briefEmailEnabled: process.env.BRIEF_EMAIL_ENABLED === 'true',
  briefEmailTransport: process.env.BRIEF_EMAIL_TRANSPORT || 'mock',
  briefEmailLive: process.env.BRIEF_EMAIL_LIVE === 'true',
  briefEmailLinkSecretSet: Boolean(process.env.BRIEF_EMAIL_LINK_SECRET),
  briefEmailSendgridKeySet: Boolean(process.env.BRIEF_EMAIL_SENDGRID_KEY),

  // ── Chief of Staff daily brief (jobs/cosDailyBrief.js) ────────────────────
  // Presence/mode only — the modules read process.env themselves so tests can
  // inject an env object, and so no secret is copied into a second place.
  //
  // COS_ vars point at the CHIEF OF STAFF Supabase project (kpzyzjhfvjfvxowhusir),
  // which is NOT this backend's project (qjwbtlnwnjjuvrwblkzx). They are
  // deliberately not named SUPABASE_* : those are required() above and aim at
  // Cedrus's own database, and a collision would silently point CoS reads at
  // the wrong DB (Lesson 14 — take your own namespace).
  //
  // Reader DISARMED unless BOTH url and key are set. Delivery additionally
  // requires COS_BRIEF_LIVE=true, RESEND_API_KEY and COS_BRIEF_TO. Every one of
  // these defaults to off, and every mode is announced on each run.
  cosSupabaseUrlSet: Boolean(process.env.COS_SUPABASE_URL),
  cosServiceRoleKeySet: Boolean(process.env.COS_SERVICE_ROLE_KEY),
  cosBriefArmed: Boolean(process.env.COS_SUPABASE_URL && process.env.COS_SERVICE_ROLE_KEY),
  // Its OWN dry-run switch. Never BRIEF_DRY_RUN: that one is the SMS rail's and
  // CEDRUS.md Law 5 reserves flipping it for a named arming session.
  cosBriefDryRun: process.env.COS_BRIEF_DRY_RUN === 'true',
  cosBriefLive: process.env.COS_BRIEF_LIVE === 'true',
  cosBriefToSet: Boolean(process.env.COS_BRIEF_TO),
  resendApiKeySet: Boolean(process.env.RESEND_API_KEY),
};

// ── Fail-closed boot checks for security-relevant config (items 4, A2/A12) ──
// These are NOT enforced by `required()` because they are only dangerous in
// production; in local/dev the developer may legitimately run without them.
export function assertSecureBoot() {
  const problems = [];

  // Item 4: the signature bypass must never be live in production.
  if (isProduction && process.env.VALIDATE_TWILIO_SIGNATURE === 'false') {
    problems.push(
      'VALIDATE_TWILIO_SIGNATURE=false disables inbound authentication and is forbidden in production. ' +
      'Anyone could impersonate any phone number. Unset it (defaults to true).');
  }

  // Item 4: never derive the signed URL from the attacker-controlled Host
  // header. PUBLIC_BASE_URL is required whenever signatures are validated.
  if (config.validateTwilioSignature && !config.publicBaseUrl) {
    const msg =
      'PUBLIC_BASE_URL is required when Twilio signature validation is on: the signed URL must not be ' +
      'derived from the Host header (spoofable).';
    if (isProduction) problems.push(msg);
    else console.warn(`WARN: ${msg} (allowed in ${nodeEnv}; will fail closed in production)`);
  }

  // MOUNT_N2 §2: the email brief must never run without working unsubscribe
  // links, and live sending must be an explicit, fully-specified choice. The
  // job also fails closed at runtime; this makes a misconfigured deploy die
  // loudly at boot instead of silently skipping sends.
  if (isProduction && config.briefEmailEnabled && !config.briefEmailLinkSecretSet) {
    problems.push(
      'BRIEF_EMAIL_ENABLED=true requires BRIEF_EMAIL_LINK_SECRET: unsubscribe links are a compliance ' +
      'requirement, not an optional extra. Set the secret or disable the email brief.');
  }
  if (isProduction && config.briefEmailLive &&
      (config.briefEmailTransport !== 'sendgrid' || !config.briefEmailSendgridKeySet)) {
    problems.push(
      'BRIEF_EMAIL_LIVE=true requires BRIEF_EMAIL_TRANSPORT=sendgrid and BRIEF_EMAIL_SENDGRID_KEY. ' +
      'Live email must be switched on explicitly and completely, or not at all.');
  }

  // CoS daily brief: a half-armed live sender is the dangerous state. Fully
  // disarmed is fine and is the default; fully armed is a deliberate choice.
  // "Live, but missing the recipient or the key" is neither, and it fails at
  // 11:00 UTC in a log nobody is reading — so it dies at boot instead.
  // Each message names the exact variable to set (Lesson 17).
  if (isProduction && config.cosBriefLive && !config.resendApiKeySet) {
    problems.push(
      'COS_BRIEF_LIVE=true requires RESEND_API_KEY: the CoS daily brief cannot send without credentials. ' +
      'Set the key or unset COS_BRIEF_LIVE.');
  }
  if (isProduction && config.cosBriefLive && !config.cosBriefToSet) {
    problems.push(
      'COS_BRIEF_LIVE=true requires COS_BRIEF_TO: there is deliberately no default recipient for the CoS ' +
      'daily brief. Set the address or unset COS_BRIEF_LIVE.');
  }
  if (isProduction && config.cosBriefLive && !config.cosBriefArmed) {
    problems.push(
      'COS_BRIEF_LIVE=true requires COS_SUPABASE_URL and COS_SERVICE_ROLE_KEY: live delivery is armed but ' +
      'the reader is disarmed, so there is nothing to send. Set both, or unset COS_BRIEF_LIVE.');
  }
  // Exactly one of the two reader credentials is always a mistake.
  if (isProduction && config.cosSupabaseUrlSet !== config.cosServiceRoleKeySet) {
    problems.push(
      'COS_SUPABASE_URL and COS_SERVICE_ROLE_KEY must be set together. Exactly one is set, which leaves the ' +
      'CoS reader disarmed while looking configured. Set both, or unset both.');
  }

  if (problems.length) {
    for (const p of problems) console.error(`FATAL(config): ${p}`);
    process.exit(1);
  }
}
