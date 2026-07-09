import dotenv from 'dotenv';
dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`FATAL: missing required env var ${name}`); process.exit(1); }
  return v;
}

export const config = {
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

  // When true, the brief job composes + records but LOGS instead of sending via Twilio.
  // Lets you tune the brief before A2P registration completes.
  briefDryRun: process.env.BRIEF_DRY_RUN === 'true',
};
