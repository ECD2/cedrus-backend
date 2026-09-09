#!/usr/bin/env python3
"""
Backfill the two accounts that predate provisioning — Emil's July row and the
suspended ghost — THROUGH THE PROVISIONING CODE PATH (BUILD_PLAN P1.3), and
bind Emil's Chief-of-Staff identity to his row.

    # dry run (the default): reads, plans, writes NOTHING
    python3 scripts/backfill-accounts-via-api.py --cos-user-id <uuid> --usage-user-id <uuid>

    # the write, after the dry run has been read
    python3 scripts/backfill-accounts-via-api.py --cos-user-id <uuid> --usage-user-id <uuid> --commit

The two uuids are the values that live in Railway today as COS_USER_ID and
COS_BRIEF_USAGE_USER_ID. Emil reads them with `railway variables` and passes
them here. THIS SCRIPT NEVER READS RAILWAY and never reads those variables
from its own environment: the hand-off from env to row is deliberate and
visible in the command line, and it is audited by bind_cos_identity().

Same transport as the apply scripts: the Management API's SQL endpoint with a
Personal Access Token (env, keychain, or hidden prompt), reusing the helper in
apply-multiuser-via-api.py.

WHAT IT DOES, in order, stopping at the first failure:
  0. proves the token works
  1. PRE-CHECK, read-only: every app_users row with its settings, grants and
     audit count; the three functions present; the capability vocabulary read
     from the check constraint (this script carries no copy of it). Identifies
     Emil (the one active admin whose id starts c6cf9fb9) and the ghost (the
     one suspended member). STOPS if either is not exactly one row, or if any
     OTHER account has no settings row — that would be an account this script
     was not written for.
  2. THE PLAN, printed:
       normalize_account(emil, emil,  <every name in the vocabulary>)
       normalize_account(emil, ghost, {})        -- complete shape, can do nothing
       bind_cos_identity(emil, emil, <cos-user-id>, <usage-user-id>)
     Without --commit it stops here. Nothing has been written.
  3. With --commit, after a typed "yes": the three calls, each one request,
     each atomic inside the database, in that order. normalize_account is
     idempotent, so a re-run after a partial failure is safe.
  4. POST-CHECK: reads every row back and ASSERTS the result — Emil has a
     settings row carrying both ids and every capability granted; the ghost
     has a settings row and nothing granted; each has at least one audit row.
     A failed assertion is a non-zero exit, and it is printed.

It does not create an account, promote anyone, record consent, or arm
delivery (brief_enabled stays false). See docs/BACKFILL_ACCOUNTS_2026-09-09.md.
"""
import argparse, importlib.util, json, pathlib, re, sys, uuid

_HELPERS = pathlib.Path(__file__).resolve().parent / "apply-multiuser-via-api.py"
_spec = importlib.util.spec_from_file_location("apply_multiuser_via_api", _HELPERS)
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
CEDRUS, get_token, query, show = _helpers.CEDRUS, _helpers.get_token, _helpers.query, _helpers.show

EMIL_ID_PREFIX = "c6cf9fb9"
MIGRATION_VERSION = "20260909210000"

# One read, one row: everything the pre-check and the post-check need.
REPORT_SQL = """
select jsonb_build_object(
  'functions', (select coalesce(jsonb_object_agg(proname, true), '{}'::jsonb)
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and proname in ('provision_user', 'normalize_account', 'bind_cos_identity')),
  'in_history', (select count(*) from supabase_migrations.schema_migrations where version = '%s'),
  'vocabulary', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'user_capabilities_capability_check'),
  'accounts', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', u.id, 'name', u.name, 'display_name', u.display_name,
                  'role', u.role, 'status', u.account_status, 'created_at', u.created_at,
                  'has_settings', exists (select 1 from user_settings s where s.user_id = u.id),
                  'brief_enabled', (select brief_enabled from user_settings s where s.user_id = u.id),
                  'cos_user_id', (select cos_user_id from user_settings s where s.user_id = u.id),
                  'usage_user_id', (select usage_user_id from user_settings s where s.user_id = u.id),
                  'granted', (select coalesce(jsonb_agg(capability order by capability), '[]'::jsonb)
                                from user_capabilities c where c.user_id = u.id and c.granted),
                  'capability_rows', (select count(*) from user_capabilities c where c.user_id = u.id),
                  'audit_rows', (select count(*) from admin_audit a where a.target_user_id = u.id),
                  'audit_actions', (select coalesce(jsonb_agg(action order by at, id), '[]'::jsonb)
                                      from admin_audit a where a.target_user_id = u.id)
                ) order by u.created_at), '[]'::jsonb) from app_users u),
  'totals', jsonb_build_object(
     'app_users', (select count(*) from app_users),
     'settings', (select count(*) from user_settings),
     'capabilities', (select count(*) from user_capabilities),
     'audit', (select count(*) from admin_audit))
) as report;
""" % MIGRATION_VERSION


def report(token):
    rows = query(token, CEDRUS, REPORT_SQL)
    if not rows or "report" not in rows[0]:
        sys.exit("STOP: the report query returned nothing readable. Nothing written.")
    r = rows[0]["report"]
    return json.loads(r) if isinstance(r, str) else r


def vocabulary_from(constraint_def):
    """The capability names, read from the check constraint — the ONLY authority."""
    if not constraint_def:
        sys.exit("STOP: user_capabilities_capability_check is absent — the multi-user foundation is not applied. Nothing written.")
    names = re.findall(r"'([a-z_]+)'", constraint_def)
    if len(names) != len(set(names)) or not names:
        sys.exit(f"STOP: could not read the capability vocabulary from the constraint: {constraint_def}")
    return names


def print_accounts(accounts):
    for a in accounts:
        print(f"   {a['id']}  role={a['role']:<6} status={a['status']:<9} name={a.get('name') or a.get('display_name') or '(none)'!s:<14} "
              f"created={str(a['created_at'])[:10]}  settings={'yes' if a['has_settings'] else 'NO '}  "
              f"granted={a['granted']}  cos_user_id={a['cos_user_id'] or '-'}  usage_user_id={a['usage_user_id'] or '-'}  "
              f"audit_rows={a['audit_rows']}")


def parse_args(argv):
    ap = argparse.ArgumentParser(description="P1.3 backfill — dry run by default; --commit to write.")
    ap.add_argument("--cos-user-id", required=True, help="Emil's user id inside Chief of Staff (today: COS_USER_ID on Railway)")
    ap.add_argument("--usage-user-id", required=True, help="the id token spend is booked to (today: COS_BRIEF_USAGE_USER_ID on Railway)")
    ap.add_argument("--commit", action="store_true", help="actually write; without it nothing is written")
    args = ap.parse_args(argv)
    for name in ("cos_user_id", "usage_user_id"):
        val = getattr(args, name)
        try:
            setattr(args, name, str(uuid.UUID(val)))
        except (ValueError, AttributeError, TypeError):
            sys.exit(f"STOP: --{name.replace('_', '-')} is not a uuid: {val!r}. Nothing written.")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    mode = "COMMIT" if args.commit else "DRY RUN"
    print(f"== P1.3 backfill — {mode} ==")
    token = get_token()

    print("\n== 0/4  token check ==")
    show(query(token, CEDRUS, "select current_database() as db, current_user as who;"))

    print("\n== 1/4  pre-check (read-only) ==")
    before = report(token)
    fns = before["functions"]
    for f in ("provision_user", "normalize_account", "bind_cos_identity"):
        if not fns.get(f):
            sys.exit(f"STOP: {f}() is not present — apply supabase/migrations/{MIGRATION_VERSION}_normalize_account.sql first "
                     f"(scripts/apply-normalize-account-via-api.py). Nothing written.")
    print(f"   functions present: provision_user, normalize_account, bind_cos_identity"
          f"   (migration {MIGRATION_VERSION} in history: {before['in_history']})")
    vocab = vocabulary_from(before["vocabulary"])
    print(f"   capability vocabulary, from the check constraint: {vocab}")
    if len(vocab) != 4:
        sys.exit(f"STOP: expected the four-name vocabulary, the constraint has {len(vocab)}. Nothing written.")

    accounts = before["accounts"]
    print(f"   app_users rows: {len(accounts)}")
    print_accounts(accounts)

    emils = [a for a in accounts if str(a["id"]).startswith(EMIL_ID_PREFIX)]
    if len(emils) != 1:
        sys.exit(f"STOP: expected exactly one account whose id starts {EMIL_ID_PREFIX}, found {len(emils)}. Nothing written.")
    emil = emils[0]
    if emil["role"] != "admin" or emil["status"] != "active":
        sys.exit(f"STOP: {emil['id']} is {emil['role']}/{emil['status']}, not an active admin — it cannot act as the actor. Nothing written.")
    ghosts = [a for a in accounts if a["role"] == "member" and a["status"] == "suspended"]
    if len(ghosts) != 1:
        sys.exit(f"STOP: expected exactly one suspended member (the ghost), found {len(ghosts)}. Nothing written.")
    ghost = ghosts[0]
    others = [a for a in accounts if a["id"] not in (emil["id"], ghost["id"]) and not a["has_settings"]]
    if others:
        sys.exit("STOP: these accounts are neither Emil nor the ghost and have NO settings row — this script was not written for them:\n"
                 + "\n".join(f"   {a['id']} role={a['role']} status={a['status']}" for a in others) + "\nNothing written.")

    print(f"\n   Emil  = {emil['id']}  (settings: {'present' if emil['has_settings'] else 'ABSENT'}, granted {emil['granted']})")
    print(f"   ghost = {ghost['id']}  (settings: {'present' if ghost['has_settings'] else 'ABSENT'}, granted {ghost['granted']})")
    if emil["has_settings"] and ghost["has_settings"]:
        print("   NOTE: both already have settings rows — this is a re-run. normalize_account is idempotent; each call adds one audit row.")
    if ghost["granted"]:
        print(f"   NOTE: the ghost currently has {ghost['granted']} granted; the empty set will REVOKE them (rows kept, granted=false).")

    print("\n== 2/4  the plan ==")
    calls = [
        ("normalize Emil with every capability",
         f"select normalize_account('{emil['id']}'::uuid, '{emil['id']}'::uuid, "
         f"array[{', '.join(repr(v) for v in vocab)}]::text[]) as result;"),
        ("normalize the ghost with the EMPTY set",
         f"select normalize_account('{emil['id']}'::uuid, '{ghost['id']}'::uuid, '{{}}'::text[]) as result;"),
        ("bind Emil's CoS identity",
         f"select bind_cos_identity('{emil['id']}'::uuid, '{emil['id']}'::uuid, "
         f"'{args.cos_user_id}'::uuid, '{args.usage_user_id}'::uuid) as result;"),
    ]
    for i, (what, sql) in enumerate(calls, 1):
        print(f"   {i}. {what}\n      {sql}")

    if not args.commit:
        print("\nDRY RUN — nothing written. Read the plan and the rows above, then re-run with --commit.")
        return 0

    if input("\nWrite these three calls? Type yes to continue: ").strip() != "yes":
        sys.exit("Stopped. Nothing written.")

    print("\n== 3/4  writing (three requests, in order; each is one transaction; stops at the first failure) ==")
    for i, (what, sql) in enumerate(calls, 1):
        rows = query(token, CEDRUS, sql)
        print(f"   {i}. {what}: ok")
        show(rows)

    print("\n== 4/4  post-check — every row read back ==")
    after = report(token)
    print_accounts(after["accounts"])
    print(f"   totals before: {before['totals']}")
    print(f"   totals after:  {after['totals']}")

    by_id = {a["id"]: a for a in after["accounts"]}
    e, g = by_id.get(emil["id"]), by_id.get(ghost["id"])
    problems = []
    if not e or not e["has_settings"]:
        problems.append("Emil has no settings row")
    else:
        if sorted(e["granted"]) != sorted(vocab):
            problems.append(f"Emil's granted set is {e['granted']}, expected {sorted(vocab)}")
        if str(e["cos_user_id"]) != args.cos_user_id or str(e["usage_user_id"]) != args.usage_user_id:
            problems.append(f"Emil's row carries cos_user_id={e['cos_user_id']} usage_user_id={e['usage_user_id']}, expected the two arguments")
        if e["brief_enabled"] is not False:
            problems.append(f"Emil's brief_enabled is {e['brief_enabled']}; the backfill must not arm delivery")
        if int(e["audit_rows"]) < 1 or "normalize_account" not in e["audit_actions"] or "bind_cos_identity" not in e["audit_actions"]:
            problems.append(f"Emil's audit trail is {e['audit_actions']}")
    if not g or not g["has_settings"]:
        problems.append("the ghost has no settings row")
    else:
        if g["granted"]:
            problems.append(f"the ghost has {g['granted']} granted, expected nothing")
        if int(g["audit_rows"]) < 1 or "normalize_account" not in g["audit_actions"]:
            problems.append(f"the ghost's audit trail is {g['audit_actions']}")
    expected_settings = int(before["totals"]["settings"]) + (0 if emil["has_settings"] else 1) + (0 if ghost["has_settings"] else 1)
    if int(after["totals"]["settings"]) != expected_settings:
        problems.append(f"user_settings has {after['totals']['settings']} rows, expected {expected_settings}")
    if int(after["totals"]["app_users"]) != int(before["totals"]["app_users"]):
        problems.append("the app_users row count moved — this script creates no account")
    if problems:
        print("\nPOST-CHECK FAILED:")
        for pr in problems:
            print(f"   - {pr}")
        sys.exit(1)
    print("\nDone. Both accounts now have the shape a fresh account gets, from the same code, and Emil's CoS identity is on his row.")
    print("Keep the pre-check and post-check output with the session report. P1.4 makes the brief read the row.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
