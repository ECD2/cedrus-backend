-- Safety spec §6 — crisis suppression window.
--
-- ███ STATUS: APPLIED TO PROD 2026-07-26 via run-migration.mjs. ███
-- Post-check: app_users 39 -> 40 columns, exactly one added
-- (crisis_suppressed_until | timestamp with time zone | nullable=YES, no default),
-- no other column added/removed/altered, 2 rows unchanged, all values NULL.
-- End-to-end proof against real prod followed (open -> true -> expired -> false,
-- with a control proving "no window" is now distinguishable from "couldn't check").
-- Do not re-run for effect; it is idempotent and would be a no-op.
--
-- src/services/safetyFlags.js has read AND written app_users.crisis_suppressed_until
-- since it shipped. The column was never created (WS-B was not allowed to migrate),
-- so isInSuppressionWindow() has always taken its error branch and returned false =
-- "no cooldown". The 48-hour post-crisis promo pause has therefore never been in
-- effect. This adds the missing column. NO code change is required.
--
-- ADDITIVE + IDEMPOTENT:
--   * ADD COLUMN IF NOT EXISTS — re-running is a no-op.
--   * NULLABLE, no DEFAULT — existing rows get NULL, which isInSuppressionWindow()
--     already treats as "no active window" via `!data[SUPPRESSION_COLUMN]`.
--     A non-null default would hand every existing user a bogus cooldown.
--   * No constraint changes, no grants, no data statements. Table-level privileges
--     (service_role already holds SELECT + UPDATE on app_users) extend to new columns.
--
-- timestamptz, NOT timestamp: openSuppressionWindow writes
-- `new Date(...).toISOString()` (a Z-suffixed absolute instant) and
-- isInSuppressionWindow compares `new Date(value).getTime() > Date.now()`.
-- A naive `timestamp` would drop the offset, and Node would then re-read the
-- returned value as LOCAL time — silently shifting the window by the server's
-- UTC offset. The zone is load-bearing.

-- NOTE: table name is deliberately UNQUALIFIED. run-migration.mjs parses
-- ALTER TABLE with /([A-Za-z_]\w*)/ and cannot handle a schema qualifier —
-- "ALTER TABLE public.app_users" makes it verify a table literally named
-- "public", which then fails the in-txn check and rolls back. (It fails
-- CLOSED, so this is safe, but it will not apply.) Every prior migration in
-- docs/ uses the unqualified form; search_path resolves it to public.

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS crisis_suppressed_until timestamptz;
