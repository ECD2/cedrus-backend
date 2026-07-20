# Admin Auth — email + password + TOTP (design)

Session BE-ADMIN-AUTH (tonight fleet). Branch `feat/admin-totp`. Branch-only;
Emil reviews and pushes in the morning.

## Goal

Replace the paste-a-token admin UX (`x-admin-key` header) with a real login:
**email + password + TOTP** (authenticator-app / QR), modelled on the Chief of
Staff admin. A successful login returns a short-lived signed **session token**;
every existing `/admin/*` route accepts **either** that token **or** the legacy
`x-admin-key` (legacy kept during migration, removal flagged below).

## Why these choices

### Identity lives in env, not a DB (for now)

Single admin (Emil) for beta. Credentials are seeded via environment variables,
never in code and never plaintext:

| Var | Meaning | Notes |
|-----|---------|-------|
| `ADMIN_EMAIL` | the one admin identity | compared case-insensitively, timing-safe |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the password | `$2a/$2b/$2y$…`; **never** the plaintext |
| `ADMIN_TOTP_SECRET` | base32 TOTP secret | **presence == "TOTP enrolled"** |
| `ADMIN_SESSION_SECRET` | HMAC key that signs session tokens | rotating it revokes all live sessions |
| `ADMIN_SESSION_TTL_HOURS` | session lifetime | optional, default `12` |
| `ADMIN_KEY` | legacy header key (existing) | kept during migration; see §Migration |
| `ADMIN_TOTP_ISSUER` / `ADMIN_TOTP_LABEL` | how it shows in the authenticator app | optional, default `Cedrus Admin` / the email |

Two seams were considered for the TOTP secret and the "enrolled" flag: a DB row,
or an env var. Env wins for beta because:

* **Railway's filesystem is ephemeral** — a local state file (e.g.
  `.totp-enrolled`) is wiped on every deploy, so it cannot be the durable record
  of "already enrolled." Env survives deploys.
* **Tonight's global rule forbids hosted-DB commands** — introducing an
  `admin_totp` table/migration is out of scope for this session. A DB-backed
  store is the natural Cycle-2 upgrade (multi-admin, runtime rotation); it is
  flagged, not built. See §Future.

### Enrollment is one-shot and password-gated

`POST /admin/auth/enroll` provisions the TOTP secret exactly once:

* Callable **only while `ADMIN_TOTP_SECRET` is unset** (not yet enrolled).
  Once the operator sets that env var and redeploys, the route returns **404**
  permanently — the endpoint "doesn't exist."
* **Password-gated**: the caller must supply the admin `email` + `password`
  (the only pre-TOTP credential we have). This stops a stranger from
  provisioning a secret against an un-enrolled instance.
* Returns the `otpauth://` URI, an inline **QR (SVG)**, and the raw base32
  secret **once**, plus the exact env line to set. Within a single running
  process the generated secret is cached, so refreshing the page shows the
  **same** QR rather than a new secret each call.

Flow: operator hits enroll → scans QR / sets `ADMIN_TOTP_SECRET=<secret>` in
Railway → redeploys → enroll now 404s → login requires the 6-digit code.

### Login → short-lived signed session token

`POST /admin/auth/login` with `{ email, password, totp }`:

1. **Fail closed** if the admin isn't fully configured (`ADMIN_EMAIL` /
   `ADMIN_PASSWORD_HASH` / `ADMIN_SESSION_SECRET` missing → `503`) or TOTP isn't
   enrolled (`ADMIN_TOTP_SECRET` unset → `403 totp_not_enrolled`).
2. **Rate-limit** first (see below) → `429` with `Retry-After` when tripped.
3. Verify **email** (case-insensitive, constant-time), **password**
   (`bcrypt.compare`), **TOTP** (`otplib`, ±1 step window), and the **replay
   guard**. Any failure → generic `401 invalid credentials` (never reveal which
   factor failed).
4. On success → mint token, reset that IP's failure counter, return
   `{ token, token_type: "Bearer", expires_at }`.

**Session token format** (opaque, HMAC-signed — the brief's "HMAC, env secret"
option; deliberately *not* a JWT so there is no alg-confusion surface):

```
cadm_v1.<payload_b64url>.<sig_b64url>
payload = { "sub": "admin", "iat": <unix>, "exp": <unix>, "jti": "<hex>" }
sig     = HMAC_SHA256(ADMIN_SESSION_SECRET, "cadm_v1.<payload_b64url>")
```

Verification recomputes the HMAC over the exact signed string, compares it with
`crypto.timingSafeEqual`, then checks `exp`. Stateless (no server session
store): a valid signature + unexpired `exp` == authenticated. `jti` is a random
id logged for audit correlation (never a secret). The frontend stores the whole
string and sends it as `Authorization: Bearer <token>`; it never parses it.

### Authorizing the existing routes without editing them

Requirement: **all** existing `/admin/*` routes accept the session token OR the
legacy key. The two existing routers authenticate differently and this session
owns only some of them:

* `src/routes/admin.js` (founder admin: `/admin/user`, `/admin/reset-user`) —
  **not owned by this session.** Checks `x-admin-key` == `ADMIN_KEY`
  (constant-time).
* `src/routes/adminPanel.js` (N1 panel: `/admin/users*`, `/admin/testers`) —
  **owned.** Checks `x-admin-key` == `ADMIN_PANEL_TOKEN || ADMIN_KEY`.

So the design adds one middleware and makes one small owned-file edit:

* **`adminSessionAdapter`** (new), mounted on `/admin` **before** both routers:
  * No `Authorization: Bearer` header → `next()` unchanged. Legacy callers and
    the login/enroll routes are untouched (**legacy path preserved**).
  * `Bearer` present + **valid** → set `req.adminSession = { jti, exp }` and
    **inject `req.headers['x-admin-key'] = ADMIN_KEY`** so the unowned
    founder-admin router authenticates as it always has. (Injecting the server's
    own key *after* a strong-authenticated session is an internal trust
    elevation, not a bypass.)
  * `Bearer` present + **invalid/expired** → `401`. Presence of a Bearer header
    means "I am using session auth"; we don't silently fall back to header auth.
* **`adminPanel.js` edit (owned):** `requirePanelAuth` passes when
  `req.adminSession` is set, *or* the existing token logic passes. This makes the
  panel accept sessions even when `ADMIN_PANEL_TOKEN` differs from `ADMIN_KEY`
  (the injected `x-admin-key` alone couldn't satisfy a distinct panel token).

`admin.js` is **not** modified. It keeps working via the injected header while
`ADMIN_KEY` remains set. See §Migration for retiring `ADMIN_KEY`.

`index.js` is **not** modified by this session (it is outside the ownership
boundary and a sibling session may also touch it tonight). The exact mount
lines are documented in `docs/MOUNT_ADMIN_AUTH.md`; the morning integration step
applies them, and `test/adminAuth.test.mjs` proves that exact wiring by building
the app the same way.

## Security properties

* **No plaintext secrets at rest**: password is bcrypt-hashed in env; TOTP secret
  is env-only; session secret signs but is never emitted.
* **Constant-time comparisons**: email, session signature (`timingSafeEqual`);
  password via `bcrypt.compare`; the existing key checks are already timing-safe.
* **Rate limiting**: sliding window per client IP (default 5 failures / 15 min →
  `429` + `Retry-After`), plus a global failure ceiling. Success resets the IP.
  In-memory (single beta instance); a shared store is the multi-instance upgrade
  (flagged §Future).
* **TOTP replay**: monotonic 30-s step guard — a step index at/below the last
  consumed one is rejected, so a code cannot be reused within (or before) its
  window even if intercepted.
* **Audit log every attempt**: `logger.event` with `outcome` + `reason` +
  `status_code`, plus `meta.ip_hash` (salted SHA-256 prefix — raw IP is never
  logged) and `meta.jti` on success. **No password, TOTP code, secret, or token
  ever reaches a log line** (and the logger's redaction pass is a second net).
* **Fail closed**: misconfiguration (missing admin identity / session secret /
  TOTP) rejects rather than allowing.

## Non-goals / known limits (beta)

* In-memory rate-limit + replay state is per-process; two instances wouldn't
  share it. Acceptable at beta scale (single instance); flagged for Cycle 2.
* No persistent account lockout, no password reset flow (single operator; rotate
  `ADMIN_PASSWORD_HASH` in env).
* Single admin only.

## Migration: retiring `ADMIN_KEY`

Legacy `x-admin-key` stays valid so nothing breaks mid-cutover. To retire it:

1. Confirm the frontend and any curl runbooks use session tokens.
2. Founder-admin routes (`/admin/user`, `/admin/reset-user`) reach the session
   via the injected `x-admin-key`, which requires `ADMIN_KEY` to still be set.
   Before unsetting `ADMIN_KEY`, migrate those two routes to the shared
   `req.adminSession` check (a one-line change mirroring the `adminPanel.js`
   edit — flagged in `docs/MOUNT_ADMIN_AUTH.md`). `adminOps.resetUserById` also
   dispatches with `ADMIN_KEY`; keep it set until that path is migrated.
3. Unset `ADMIN_KEY` (and `ADMIN_PANEL_TOKEN`). Session auth then stands alone.

## Future (Cycle 2)

* DB-backed admin(s): `admin_users` + `admin_totp` tables, runtime secret
  rotation, multiple operators, per-admin audit.
* Shared rate-limit / replay store (Redis / Postgres) for multi-instance.
* Optional WebAuthn / passkeys.

## Files

New: `src/services/adminSession.js`, `src/routes/adminAuth.js`,
`scripts/hash-admin-password.mjs`, `docs/ADMIN_AUTH_DESIGN.md` (this),
`docs/ADMIN_AUTH_CONTRACT.md`, `docs/MOUNT_ADMIN_AUTH.md`,
`test/adminAuth.test.mjs`, `test/run-admin-auth-tests.sh`.
Edited (owned): `src/routes/adminPanel.js`. Edited (additive): `package.json`
(`otplib`, `bcryptjs`, `qrcode`). Not edited: `src/index.js`,
`src/routes/admin.js`, `test/run-all.sh`.

## Test plan (maps to the brief's required tests)

| Brief requirement | Test |
|---|---|
| wrong password rejected | login with bad password → 401, audit `bad_password` |
| wrong TOTP rejected | login with bad code → 401, audit `bad_totp` |
| reused TOTP window rejected | same code twice → 2nd → 401 `totp_replayed` |
| rate limit triggers | N+1 failures → 429 + `Retry-After` |
| session expiry enforced | token minted in the past → adapter 401 |
| legacy key still works | `x-admin-key`, no Bearer → panel/founder route 200 |
| enrollment locks after first use | enroll unset → 200 + QR; enrolled → 404 |
| audit entries written | assert `logger.event` audit lines per case |
| session accepted by existing routes | Bearer → panel 200 and founder route 200 |
