#!/usr/bin/env python3
"""
Apply the provision_user() migration (P1.2) using a Supabase Personal Access
Token, via the Management API's SQL endpoint — the same path that applied the
multi-user foundation on 2026-08-31.

    python3 scripts/apply-provision-user-via-api.py

Law 8's sanctioned path is `supabase migration up --linked`; this script is the
equivalent for a machine without the CLI or the database password. It reuses
the token lookup and the SQL endpoint helper from apply-multiuser-via-api.py
and does nothing that file does not already do.

WHAT IT DOES, in order, stopping at the first failure:
  0. proves the token works           (select 1 against the Cedrus project)
  1. pre-check                        (foundation present, one active admin,
                                       provision_user absent)
  2. applies the migration            (self-proving; all-or-nothing — the
                                       function's positive and negative
                                       controls run inside and are unwound)
  3. records it in the CLI's migration history
  4. post-check                       (definer + pinned search_path, grants,
                                       no control rows left behind)

It creates NO account. The first real provisioning is P1.3.
"""
import importlib.util, pathlib, sys

# apply-multiuser-via-api.py has hyphens in its name, so it is loaded by path.
# Its module body is definitions only; main() runs under __main__ alone.
_HELPERS = pathlib.Path(__file__).resolve().parent / "apply-multiuser-via-api.py"
_spec = importlib.util.spec_from_file_location("apply_multiuser_via_api", _HELPERS)
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
CEDRUS, get_token, query, show = _helpers.CEDRUS, _helpers.get_token, _helpers.query, _helpers.show

VERSION = "20260909120000"
MIGRATION = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations" / f"{VERSION}_provision_user.sql"

PRE_CHECK = (
    "select (select count(*) from information_schema.tables where table_schema='public'"
    "          and table_name in ('user_capabilities','user_settings','admin_audit')) as foundation_tables,"
    "       (select count(*) from app_users where role='admin' and account_status='active') as active_admins,"
    "       (select count(*) from pg_proc where proname='provision_user') as provision_user_exists,"
    "       (select count(*) from user_settings) as settings_rows,"
    "       (select count(*) from user_capabilities) as capability_rows;"
)

POST_CHECK = (
    "select (select prosecdef from pg_proc where proname='provision_user') as security_definer,"
    "       (select proconfig from pg_proc where proname='provision_user') as search_path,"
    "       has_function_privilege('anon','provision_user(uuid, text, text, text[], text)','execute') as anon_can_execute,"
    "       has_function_privilege('authenticated','provision_user(uuid, text, text, text[], text)','execute') as authenticated_can_execute,"
    "       has_function_privilege('service_role','provision_user(uuid, text, text, text[], text)','execute') as service_role_can_execute,"
    "       (select count(*) from app_users where phone in ('15550100142','15550100143')) as control_accounts_left,"
    "       (select count(*) from auth.users where phone in ('15550100142','15550100143')) as control_identities_left,"
    "       (select count(*) from admin_audit where action='provision_user') as provision_audit_rows,"
    "       (select count(*) from user_settings) as settings_rows,"
    "       (select count(*) from user_capabilities) as capability_rows;"
)


def main():
    if not MIGRATION.exists():
        sys.exit(f"migration file not found: {MIGRATION}")
    token = get_token()

    print("\n== 0/4  token check ==")
    show(query(token, CEDRUS, "select current_database() as db, current_user as who;"))

    print("\n== 1/4  pre-check ==")
    print("   expect: foundation_tables 3, active_admins >= 1, provision_user_exists 0")
    pre = query(token, CEDRUS, PRE_CHECK)
    show(pre)
    row = pre[0] if pre else {}
    if int(row.get("foundation_tables", 0)) != 3:
        sys.exit("STOP: the multi-user foundation is not fully present. Apply 20260830120000 first.")
    if int(row.get("active_admins", 0)) < 1:
        sys.exit("STOP: no active admin exists. The migration's controls need one to act (BUILD_PLAN F0.1).")
    if int(row.get("provision_user_exists", 0)) != 0:
        print("   NOTE: provision_user already exists; the migration is CREATE OR REPLACE and will redefine it.")

    if input("\nApply the migration? Type yes to continue: ").strip() != "yes":
        sys.exit("Stopped. Nothing applied.")

    print("\n== 2/4  applying (self-proving; all-or-nothing) ==")
    query(token, CEDRUS, MIGRATION.read_text())
    print("   committed — the function exists, every assertion passed, all three controls ran and were unwound")

    print("\n== 3/4  recording it in the migration history ==")
    try:
        query(token, CEDRUS,
              "insert into supabase_migrations.schema_migrations (version) "
              f"values ('{VERSION}') on conflict do nothing;")
        print("   history row recorded")
    except SystemExit as e:
        print(f"   could not record history (bookkeeping only, schema is applied): {e}")

    print("\n== 4/4  post-check ==")
    print("   expect: security_definer t, search_path {search_path=public, pg_temp}, anon f, authenticated f,")
    print("           service_role t, control_accounts_left 0, control_identities_left 0, provision_audit_rows 0,")
    print("           settings_rows and capability_rows UNCHANGED from the pre-check")
    show(query(token, CEDRUS, POST_CHECK))

    print("\nDone. No account was created — the first real provisioning is P1.3.")
    print("Keep both check outputs with the session report.")


if __name__ == "__main__":
    main()
