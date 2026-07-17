import dotenv from 'dotenv';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: missing required env var ${name}`); process.exit(1); }
  return v;
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

  if (problems.length) {
    for (const p of problems) console.error(`FATAL(config): ${p}`);
    process.exit(1);
  }
}
