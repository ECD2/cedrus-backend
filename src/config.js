import dotenv from 'dotenv';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: missing required env var ${name}`); process.exit(1); }
  return v;
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
  testerPhones: (process.env.TESTER_PHONES || '')
    .split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean)
    .map((d) => (d.length === 10 ? '1' + d : d)),

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

  if (problems.length) {
    for (const p of problems) console.error(`FATAL(config): ${p}`);
    process.exit(1);
  }
}
