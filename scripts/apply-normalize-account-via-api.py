#!/usr/bin/env python3
"""
Apply the normalize_account / bind_cos_identity migration (P1.3) using a
Supabase Personal Access Token, via the Management API's SQL endpoint — the
same path that applied the multi-user foundation, provision_user and the
programs foundation.

    python3 scripts/apply-normalize-account-via-api.py

Law 8's sanctioned path is `supabase migration up --linked`; this script is the
equivalent for a machine without the CLI or the database password. It reuses
the token lookup and the SQL endpoint helper from apply-multiuser-via-api.py
and does nothing that file does not already do.

WHAT IT DOES, in order, stopping at the first failure:
  0. proves the token works
  1. pre-check                        (provision_user present, the two new
                                       functions absent, one active admin,
                                       the version not yet in history)
  2. applies the migration            (self-proving; all-or-nothing — four
                                       controls run inside and are unwound)
  3. records it in the CLI's migration history
  4. post-check                       (definer + pinned search_path ×3, grants,
                                       provision_user's body calls
                                       normalize_account, no control rows left,
                                       settings/capability/audit counts
                                       UNCHANGED)

It backfills NO account. That is scripts/backfill-accounts-via-api.py, which
is dry-run by default.
"""
import importlib.util, pathlib, sys

_HELPERS = pathlib.Path(__file__).resolve().parent / "apply-multiuser-via-api.py"
_spec = importlib.util.spec_from_file_location("apply_multiuser_via_api", _HELPERS)
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
CEDRUS, get_token, query, show = _helpers.CEDRUS, _helpers.get_token, _helpers.query, _helpers.show

VERSION = "20260909210000"
MIGRATION = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations" / f"{VERSION}_normalize_account.sql"

PRE_CHECK = (
    "select (select count(*) from pg_proc where proname='provision_user') as provision_user_exists,"
    "       (select count(*) from pg_proc where proname='normalize_account') as normalize_account_exists,"
    "       (select count(*) from pg_proc where proname='bind_cos_identity') as bind_cos_identity_exists,"
    "       (select count(*) from app_users where role='admin' and account_status='active') as active_admins,"
    "       (select count(*) from supabase_migrations.schema_migrations where version='" + VERSION + "') as already_in_history,"
    "       (select count(*) from user_settings) as settings_rows,"
    "       (select count(*) from user_capabilities) as capability_rows,"
    "       (select count(*) from admin_audit) as audit_rows;"
)

POST_CHECK = (
    "select (select count(*) from pg_proc where proname in ('normalize_account','bind_cos_identity','provision_user')"
    "          and prosecdef and 'search_path=public, pg_temp' = any(proconfig)) as definer_pinned_functions,"
    "       has_function_privilege('anon','normalize_account(uuid, uuid, text[])','execute') as anon_can_normalize,"
    "       has_function_privilege('authenticated','normalize_account(uuid, uuid, text[])','execute') as authenticated_can_normalize,"
    "       has_function_privilege('service_role','normalize_account(uuid, uuid, text[])','execute') as service_role_can_normalize,"
    "       has_function_privilege('anon','bind_cos_identity(uuid, uuid, uuid, uuid)','execute') as anon_can_bind,"
    "       has_function_privilege('authenticated','bind_cos_identity(uuid, uuid, uuid, uuid)','execute') as authenticated_can_bind,"
    "       has_function_privilege('service_role','bind_cos_identity(uuid, uuid, uuid, uuid)','execute') as service_role_can_bind,"
    "       has_function_privilege('authenticated','provision_user(uuid, text, text, text[], text)','execute') as authenticated_can_provision,"
    "       (select pg_get_functiondef(oid) ~ 'normalize_account\\s*\\(\\s*p_actor_user_id\\s*,\\s*v_user_id\\s*,\\s*v_caps\\s*\\)' from pg_proc where proname='provision_user') as provision_calls_normalize,"
    "       (select pg_get_functiondef(oid) ~* 'insert\\s+into\\s+user_(settings|capabilities)' from pg_proc where proname='provision_user') as provision_writes_shape_itself,"
    "       has_column_privilege('authenticated','user_settings','cos_user_id','update') as authenticated_can_update_cos_user_id,"
    "       (select count(*) from app_users where phone in ('15550100145','15550100146','15550100147','15550100148')) as control_accounts_left,"
    "       (select count(*) from auth.users where phone in ('15550100145','15550100146','15550100147','15550100148')) as control_identities_left,"
    "       (select count(*) from admin_audit where action in ('normalize_account','bind_cos_identity')) as backfill_audit_rows,"
    "       (select count(*) from user_settings) as settings_rows,"
    "       (select count(*) from user_capabilities) as capability_rows,"
    "       (select count(*) from admin_audit) as audit_rows;"
)


def main():
    if not MIGRATION.exists():
        sys.exit(f"migration file not found: {MIGRATION}")
    sql = MIGRATION.read_text()
    tok = get_token()

    print("\n0. token check")
    show(query(tok, CEDRUS, "select current_database() as db, current_user as who;"))

    print("\n1. pre-check (expect provision_user_exists 1, normalize_account_exists 0, bind_cos_identity_exists 0,")
    print("   active_admins >= 1, already_in_history 0; note the three row counts — the post-check must repeat them)")
    pre = query(tok, CEDRUS, PRE_CHECK)
    show(pre)
    row = pre[0] if isinstance(pre, list) and pre else {}
    if int(row.get("provision_user_exists", 0)) != 1:
        sys.exit("STOP: provision_user is absent — apply 20260909120000 first (one migration at a time). Nothing applied.")
    if int(row.get("active_admins", 0)) < 1:
        sys.exit("STOP: no active admin exists. The migration's controls need one to act (BUILD_PLAN F0.1). Nothing applied.")
    if int(row.get("already_in_history", 0)) != 0:
        sys.exit("STOP: this version is already in the migration history. Nothing applied.")
    if int(row.get("normalize_account_exists", 0)) or int(row.get("bind_cos_identity_exists", 0)):
        print("   NOTE: a function this file creates already exists; the migration is CREATE OR REPLACE and will redefine it.")

    if input("\nApply the migration? Type yes to continue: ").strip() != "yes":
        sys.exit("Stopped. Nothing applied.")

    print(f"\n2. applying {MIGRATION.name} ({len(sql)} bytes) — one transaction; the four controls run inside it")
    query(tok, CEDRUS, sql)
    print("   applied (the file committed, so every assertion and control inside it passed and was unwound)")

    print("\n3. recording in supabase_migrations.schema_migrations")
    try:
        query(tok, CEDRUS,
              f"insert into supabase_migrations.schema_migrations (version, name) values ('{VERSION}', 'normalize_account') "
              "on conflict (version) do nothing;")
        print("   history row recorded")
    except SystemExit as e:
        print(f"   could not record history (bookkeeping only, schema is applied): {e}")

    print("\n4. post-check (expect definer_pinned_functions 3; anon f / authenticated f / service_role t for both;")
    print("   authenticated_can_provision f; provision_calls_normalize t; provision_writes_shape_itself f;")
    print("   authenticated_can_update_cos_user_id f; control_accounts_left 0; control_identities_left 0;")
    print("   backfill_audit_rows 0; settings_rows, capability_rows, audit_rows UNCHANGED from the pre-check)")
    show(query(tok, CEDRUS, POST_CHECK))
    print("\nDone. No account was backfilled. That is the next, separate step:")
    print("   python3 scripts/backfill-accounts-via-api.py --cos-user-id <COS_USER_ID> --usage-user-id <COS_BRIEF_USAGE_USER_ID>")
    print("   (dry run; add --commit to write)")


if __name__ == "__main__":
    main()
