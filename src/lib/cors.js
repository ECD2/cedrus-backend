// ─────────────────────────────────────────────────────────────────────────
// CORS for the browser clients (cedrus.life). Hand-rolled — deliberately no
// `cors` npm dependency — because the policy is tiny and fixed: we pin an
// explicit allowlist of our OWN origins and never reflect arbitrary ones.
//
// Design and why:
//   • Allowlist, never "*". We echo the caller's Origin in
//     Access-Control-Allow-Origin ONLY when it is on the list, and emit
//     `Vary: Origin` so a shared cache never serves one origin's ACAO to
//     another.
//   • Header auth only. The panel token (x-admin-key) and the session/JWT
//     (Authorization: Bearer) travel in headers, never cookies, so we do NOT
//     send Access-Control-Allow-Credentials — the frontend fetches without
//     credentials and a specific ACAO is sufficient.
//   • Preflight (OPTIONS) is answered HERE with 200 + the allow headers and is
//     never passed down to the body parsers or routers.
//   • Server-to-server callers (Twilio delivery/inbound webhooks) send no
//     Origin header, so this middleware is a no-op for them.
//
// createCors(deps) is fully injectable (origins passed in) so it is unit
// testable with fakes; a default instance is built from the environment at the
// bottom for the production mount. It reads process.env directly (not
// config.js) so importing this module in a test never triggers config's
// required()-env process.exit — the same choice src/routes/adminAuth.js makes.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_ORIGINS = ['https://cedrus.life', 'https://www.cedrus.life'];
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'x-admin-key, authorization, content-type';
const MAX_AGE_SECONDS = 600; // cache the preflight for 10 min to cut chatter

/** Split a comma-separated origin list; trims, drops blanks, and refuses the
 *  wildcard so a stray "*" in env can never widen the policy to every site. */
export function parseOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((o) => o !== '*');
}

export function createCors(deps = {}) {
  const { allowedOrigins = DEFAULT_ORIGINS } = deps;
  const allow = new Set((allowedOrigins || []).filter((o) => o && o !== '*'));

  return function cors(req, res, next) {
    const origin =
      (req.get && req.get('origin')) || (req.headers && req.headers.origin) || '';
    const allowed = Boolean(origin) && allow.has(origin);

    if (allowed) {
      // Echo the specific origin (never "*"); Vary so caches stay honest.
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    // Preflight: answer here, before any body parser or router runs. Requests
    // from a non-allowed origin still get a 200 but no ACAO, so the browser
    // blocks them — which is the intent.
    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
        res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
        res.setHeader('Access-Control-Max-Age', String(MAX_AGE_SECONDS));
      }
      return res.status(200).end();
    }

    return next();
  };
}

// ── Production instance (mounted in src/index.js, before the routers) ───────
// Defaults to the cedrus.life origins, so a stock deploy needs NO new env var;
// set CORS_ALLOWED_ORIGINS (comma-separated) to add preview/staging origins.
const _env = typeof process !== 'undefined' && process.env ? process.env : {};
const _origins = _env.CORS_ALLOWED_ORIGINS
  ? parseOrigins(_env.CORS_ALLOWED_ORIGINS)
  : DEFAULT_ORIGINS;

export const corsMiddleware = createCors({ allowedOrigins: _origins });

export default corsMiddleware;
