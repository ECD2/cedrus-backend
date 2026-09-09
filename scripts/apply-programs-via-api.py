#!/usr/bin/env python3
"""
Apply the programs data foundation migration (R6.2a) using a Supabase Personal
Access Token, via the Management API's SQL endpoint — the same path that
applied the multi-user foundation (2026-08-31) and provision_user (P1.2).

    python3 scripts/apply-programs-via-api.py

Law 8's sanctioned path is `supabase migration up --linked`; this script is the
equivalent for a machine without the CLI or the database password. It reuses
the token lookup and the SQL endpoint helper from apply-multiuser-via-api.py
and does nothing that file does not already do.

WHAT IT DOES, in order, stopping at the first failure:
  0. proves the token works           (select 1 against the Cedrus project)
  1. pre-check                        (no program tables yet, at least one
                                       app_users row, provision_user present)
  2. applies the migration            (self-proving; all-or-nothing — the
                                       positive, negative and isolation
                                       controls run inside and are unwound)
  3. records it in the CLI's migration history
  4. post-check                       (RLS forced ×3, no anon policy, the
                                       idempotency constraint, function grants,
                                       zero rows in all three tables)

It creates NO program. Loading one is `scripts/load-program.mjs --commit`.
"""
import importlib.util, pathlib, sys

_HELPERS = pathlib.Path(__file__).resolve().parent / "apply-multiuser-via-api.py"
_spec = importlib.util.spec_from_file_location("apply_multiuser_via_api", _HELPERS)
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
CEDRUS, get_token, query, show = _helpers.CEDRUS, _helpers.get_token, _helpers.query, _helpers.show

VERSION = "20260909180000"
MIGRATION = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations" / f"{VERSION}_programs_foundation.sql"

PRE_CHECK = (
    "select (select count(*) from information_schema.tables where table_schema='public'"
    "          and table_name in ('programs','program_revisions','program_items')) as program_tables,"
    "       (select count(*) from app_users) as app_users_rows,"
    "       (select count(*) from pg_proc where proname='provision_user') as provision_user_exists,"
    "       (select count(*) from supabase_migrations.schema_migrations where version='" + VERSION + "') as already_in_history;"
)

POST_CHECK = (
    "select (select count(*) from pg_class where relname in ('programs','program_revisions','program_items')"
    "          and relrowsecurity and relforcerowsecurity) as tables_rls_forced,"
    "       (select count(*) from pg_policies where tablename in ('programs','program_revisions','program_items')"
    "          and ('anon' = any(roles) or 'public' = any(roles))) as policies_exposing_anon,"
    "       (select count(*) from pg_policies where tablename in ('programs','program_revisions','program_items')) as policies,"
    "       (select count(*) from pg_constraint where conname='program_revisions_program_id_source_sha256_key') as idempotency_constraint,"
    "       (select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where proname='publish_program_revision') as anon_can_publish,"
    "       (select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where proname='publish_program_revision') as authenticated_can_publish,"
    "       (select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where proname='publish_program_revision') as service_role_can_publish,"
    "       (select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where proname='todays_program_items') as anon_can_read_today,"
    "       (select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p where proname='todays_program_items') as service_role_can_read_today,"
    "       (select count(*) from programs) as programs,"
    "       (select count(*) from program_revisions) as revisions,"
    "       (select count(*) from program_items) as items;"
)


def main():
    if not MIGRATION.exists():
        sys.exit(f"migration file not found: {MIGRATION}")
    sql = MIGRATION.read_text()
    tok = get_token()

    print("\n0. token check")
    show(query(tok, CEDRUS, "select 1 as ok;"))

    print("\n1. pre-check (expect program_tables 0, app_users_rows >= 1, provision_user_exists 1, already_in_history 0)")
    pre = query(tok, CEDRUS, PRE_CHECK)
    show(pre)
    row = pre[0] if isinstance(pre, list) and pre else {}
    if int(row.get("program_tables", 0)) != 0:
        sys.exit("STOP: program tables already exist. Nothing applied.")
    if int(row.get("app_users_rows", 0)) < 1:
        sys.exit("STOP: no app_users row exists to own the migration's control program. Nothing applied.")
    if int(row.get("provision_user_exists", 0)) != 1:
        sys.exit("STOP: provision_user is absent — apply 20260909120000 first (one migration at a time). Nothing applied.")
    if int(row.get("already_in_history", 0)) != 0:
        sys.exit("STOP: this version is already in the migration history. Nothing applied.")

    print(f"\n2. applying {MIGRATION.name} ({len(sql)} bytes) — one transaction; the controls run inside it")
    query(tok, CEDRUS, sql)
    print("   applied (the file committed, so every assertion and control inside it passed)")

    print("\n3. recording in supabase_migrations.schema_migrations")
    query(tok, CEDRUS,
          f"insert into supabase_migrations.schema_migrations (version, name) values ('{VERSION}', 'programs_foundation') "
          "on conflict (version) do nothing;")

    print("\n4. post-check (expect tables_rls_forced 3, policies_exposing_anon 0, policies 3, idempotency_constraint 1,")
    print("   anon f / authenticated f / service_role t, and programs/revisions/items 0, 0, 0)")
    show(query(tok, CEDRUS, POST_CHECK))
    print("\nDone. No program was created. Load one with: bun scripts/load-program.mjs <source> --user-id <id> --commit")


if __name__ == "__main__":
    main()
