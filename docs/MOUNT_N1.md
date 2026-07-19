# Mounting the N1 admin panel (Emil applies this — 2 lines)

N1's write boundary excludes `src/index.js`, so the panel ships built and
tested but NOT wired. To mount it:

**`src/index.js`** — add the import next to the other routers:

```js
import adminPanelRouter from './routes/adminPanel.js';
```

and mount it **immediately BEFORE** the existing admin mount (the panel has
no router-level middleware, so founder-admin paths pass through it either
way, but panel-token auth only works independently of `ADMIN_KEY` in this
order):

```js
app.use('/admin', adminPanelRouter); // N1 panel — must precede adminRouter
app.use('/admin', adminRouter);
```

## Env

| Var | Required? | Behavior |
|---|---|---|
| `ADMIN_PANEL_TOKEN` | optional | Panel auth token (browser-held, rotatable alone). |
| `ADMIN_KEY` | for reset | Fallback panel token; also gates the inner reset tool — without it `POST /admin/users/:id/reset` answers 503 and everything else still works. |
| neither set | — | Every panel route 404s. Fail closed; nothing to do for "off". |

## Smoke test after mounting

```sh
export T=$ADMIN_PANEL_TOKEN   # or $ADMIN_KEY
curl -sS https://YOUR-DOMAIN/admin/users -H "x-admin-key: $T" | head -c 400
curl -sS https://YOUR-DOMAIN/admin/testers -H "x-admin-key: $T"
# and confirm the old founder endpoints still answer:
curl -sS -X POST https://YOUR-DOMAIN/admin/user \
     -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
     -d '{"phone":"YOUR-TEST-PHONE"}'
```

## Tests

`test/run-all.sh` is outside N1's boundary, so the panel suite has its own
runner. Full battery for this branch:

```sh
sh test/run-all.sh && sh test/run-admin-tests.sh
```
