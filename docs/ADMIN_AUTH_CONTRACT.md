# Admin Auth — frontend contract

For the morning FE wiring. Backend: `feat/admin-totp`. Design rationale:
`docs/ADMIN_AUTH_DESIGN.md`. Everything below is what the implemented routes
actually return (proven by `test/adminAuth.test.mjs`).

## The model in one paragraph

Admin logs in with **email + password + 6-digit TOTP** (authenticator app). A
successful login returns a **short-lived Bearer token** (default 12 h). Send it
as `Authorization: Bearer <token>` on every `/admin/*` request. The legacy
`x-admin-key` header still works during migration, so nothing breaks if a token
is missing — but the UI should use tokens.

## Endpoints

### `POST /admin/auth/login`

Request (JSON):

```json
{ "email": "emil@…", "password": "…", "totp": "123456" }
```

Responses:

| Status | Body | Meaning / UI action |
|-------|------|---------------------|
| `200` | `{ "token": "cadm_v1.…", "token_type": "Bearer", "expires_at": "2026-…Z" }` | Store token; proceed. |
| `401` | `{ "error": "invalid email, password, or code" }` | Show one generic error (never say which factor failed). |
| `403` | `{ "error": "TOTP is not enrolled" }` | Admin not yet enrolled — run the one-time enrollment (below). |
| `429` | `{ "error": "too many attempts, try again later", "retry_after_seconds": N }` + `Retry-After` header | Disable submit for N seconds. |
| `503` | `{ "error": "admin login is not configured" }` | Backend env not set; surface to the operator. |

The `totp` field is the 6-digit code; validate the input to `^\d{6}$` client-side.

### Authenticated requests

Send the token on every admin call:

```
Authorization: Bearer cadm_v1.<payload>.<sig>
```

If the adapter rejects it:

| Status | Body | UI action |
|-------|------|-----------|
| `401` | `{ "error": "invalid or expired session" }` | Token missing/expired/forged → clear it and route to the login screen. |

(The individual routes then return their own `200/400/403/404` as documented in
`docs/ADMIN_API_CONTRACT.md`.)

### `POST /admin/auth/enroll` — one-time, operator-only

Provisions the TOTP secret. Callable **only before** `ADMIN_TOTP_SECRET` is set;
returns `404` forever afterward. Password-gated.

Request: `{ "email": "emil@…", "password": "…" }`

`200`:

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_uri": "otpauth://totp/Cedrus%20Admin:emil%40…?secret=…&issuer=Cedrus%20Admin",
  "qr_svg": "<svg …>…</svg>",
  "next_steps": ["Scan the QR …", "Set ADMIN_TOTP_SECRET …", "Redeploy …"]
}
```

Render `qr_svg` inline (it's a self-contained SVG string) or build a QR from
`otpauth_uri`. Other statuses: `401` (bad email/password), `404` (already
enrolled), `429`, `503`. This is a bootstrap tool, not part of the daily UI —
a minimal operator page is enough.

## Session storage guidance

* **Preferred:** keep the token in memory (a module variable / app state). Most
  XSS-resistant; the admin re-logs in after a full reload. Given ~12 h lifetime
  and a single operator, this is the recommended default.
* **Acceptable:** `sessionStorage` (cleared when the tab closes) if surviving
  reloads matters.
* **Avoid:** `localStorage` (persists indefinitely and is the easiest token to
  exfiltrate via XSS) and cookies (not needed; this is a header-Bearer scheme,
  and a non-cookie scheme sidesteps CSRF).
* On **any** `401` from an admin call, drop the stored token and show the login
  screen. Optionally pre-empt expiry using `expires_at`.
* Never log the token or put it in a URL/query string.

## Header name summary

| Purpose | Header |
|---------|--------|
| New session auth (use this) | `Authorization: Bearer <token>` |
| Legacy (still accepted during migration) | `x-admin-key: <ADMIN_KEY>` |

## Minimal client sketch

```js
async function adminLogin(email, password, totp) {
  const r = await fetch('/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, totp }),
  });
  if (r.status === 429) { const j = await r.json(); throw new RetryLater(j.retry_after_seconds); }
  if (!r.ok) throw new Error((await r.json()).error);
  const { token, expires_at } = await r.json();
  session.token = token; session.expiresAt = expires_at;   // in-memory
}

function adminFetch(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${session.token}` },
  }).then((r) => { if (r.status === 401) { session.token = null; goToLogin(); } return r; });
}
```
