# MOUNT_ADMIN_AUTH — wiring admin TOTP auth into the app

One-line-per-change integration note for the morning merge. This session
(`feat/admin-totp`) does **not** edit `src/index.js` — it is outside the write
boundary and a sibling session may also touch it tonight. Apply these edits at
integration. `test/adminAuth.test.mjs` builds the app in exactly this order, so
the wiring is already proven.

## 1. `src/index.js` — import (next to the other route imports, ~line 8)

```js
import adminPanelRouter from './routes/adminPanel.js';
import { adminAuthRouter, adminSessionAdapter } from './routes/adminAuth.js'; // ADD
```

## 2. `src/index.js` — mount (the `/admin` block, currently ~lines 25–26)

The auth router and the session adapter must both precede the existing panel and
founder routers. Result:

```js
app.use('/admin', adminAuthRouter);      // MOUNT_ADMIN_AUTH: POST /admin/auth/login, /admin/auth/enroll
app.use('/admin', adminSessionAdapter);  // MOUNT_ADMIN_AUTH: Bearer session → req.adminSession + injected x-admin-key
app.use('/admin', adminPanelRouter);     // (existing) N1 panel — precedes adminRouter (MOUNT_N1)
app.use('/admin', adminRouter);          // (existing) founder admin
```

Why this order:
* `adminAuthRouter` owns only `/admin/auth/*`; every other `/admin/*` request
  falls through it untouched.
* `adminSessionAdapter` runs next: a **valid** `Authorization: Bearer` token sets
  `req.adminSession` and injects `x-admin-key` so both existing routers authorize
  as they already do; **no** Bearer header ⇒ it calls `next()` and the legacy
  `x-admin-key` path is completely unchanged; an **invalid** Bearer ⇒ `401`.

No changes to `src/routes/admin.js`. `src/routes/adminPanel.js` already carries
its half of the change (it honors `req.adminSession` in `requirePanelAuth`).

## 3. Environment variables

Required for login to function (see `docs/ADMIN_AUTH_CONTRACT.md` for the full
table and `scripts/hash-admin-password.mjs` to generate the hash + secret):

```
ADMIN_EMAIL=emil@…
ADMIN_PASSWORD_HASH=$2b$12$…        # bcrypt; never the plaintext
ADMIN_SESSION_SECRET=<32+ random bytes, base64url>
ADMIN_TOTP_SECRET=<set AFTER enrolling; presence = "enrolled">
# optional:
ADMIN_SESSION_TTL_HOURS=12
ADMIN_TOTP_ISSUER=Cedrus Admin
ADMIN_TOTP_LABEL=emil@…
ADMIN_KEY=<existing legacy key — keep during migration>
```

Boot order for a fresh deploy: set `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` /
`ADMIN_SESSION_SECRET` → deploy → `POST /admin/auth/enroll` (email+password) →
copy the returned secret into `ADMIN_TOTP_SECRET` → redeploy. Enroll now 404s;
login requires the 6-digit code.

## 4. Retiring the legacy `ADMIN_KEY` (later, optional)

Founder-admin routes (`/admin/user`, `/admin/reset-user`) currently accept a
session via the adapter's injected `x-admin-key`, which needs `ADMIN_KEY` set.
To drop `ADMIN_KEY` entirely, first add the same guard the panel uses to the top
of `router.use` in `src/routes/admin.js`:

```js
router.use((req, res, next) => {
  if (req.adminSession) return next();   // ADD — accept a valid admin session
  if (!config.adminKey) return res.status(404).send('Not found');
  // …existing x-admin-key check…
});
```

`src/services/adminOps.js#dispatchFounderAdmin` also sends `config.adminKey`
in-process for the panel's reset pass-through; keep `ADMIN_KEY` set until that
path is migrated too, or give it a session-aware bypass. Full rationale:
`docs/ADMIN_AUTH_DESIGN.md#migration`.
