#!/usr/bin/env python3
"""
Read back the ACTUAL state of the multi-user foundation and print it.

    python3 scripts/verify-multiuser-state.py

Read-only. Written because the pre-check on 2026-08-31 reported that
user_capabilities, user_settings and admin_audit already existed before the
migration ran. `create table if not exists` silently accepts a pre-existing
table with a DIFFERENT shape, and the migration's own assertions cover RLS,
policies and row counts but not columns. This closes that gap.
"""
import json, os, subprocess, sys, tempfile, getpass

REF = "qjwbtlnwnjjuvrwblkzx"

SQL = r"""
select jsonb_pretty(jsonb_build_object(
  'columns', (select jsonb_agg(jsonb_build_object('t',table_name,'n',ordinal_position,'col',column_name,
                'type',data_type,'null',is_nullable,'default',column_default) order by table_name, ordinal_position)
              from information_schema.columns
             where table_schema='public'
               and table_name in ('user_capabilities','user_settings','admin_audit')),
  'app_users_new_cols', (select jsonb_agg(jsonb_build_object('col',column_name,'type',data_type,
                'null',is_nullable,'default',column_default) order by column_name)
              from information_schema.columns
             where table_schema='public' and table_name='app_users'
               and column_name in ('role','account_status','display_name','invited_by','invited_at','activated_at')),
  'constraints', (select jsonb_agg(jsonb_build_object('name',conname,'def',pg_get_constraintdef(oid)) order by conname)
              from pg_constraint
             where conrelid::regclass::text in ('app_users','user_capabilities','user_settings','admin_audit')
               and contype in ('c','p','f','u')),
  'rls', (select jsonb_agg(jsonb_build_object('t',relname,'enabled',relrowsecurity,'forced',relforcerowsecurity) order by relname)
              from pg_class where relname in ('user_capabilities','user_settings','admin_audit')),
  'policies', (select jsonb_agg(jsonb_build_object('t',tablename,'name',policyname,'cmd',cmd,'roles',roles) order by tablename, policyname)
              from pg_policies where tablename in ('user_capabilities','user_settings','admin_audit')),
  'policies_exposing_anon', (select count(*) from pg_policies
             where tablename in ('user_capabilities','user_settings','admin_audit')
               and ('anon' = any(roles) or 'public' = any(roles))),
  'triggers', (select jsonb_agg(jsonb_build_object('t',c.relname,'name',t.tgname,'enabled',t.tgenabled))
              from pg_trigger t join pg_class c on c.oid=t.tgrelid
             where c.relname='admin_audit' and not t.tgisinternal),
  'functions', (select jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,
                'config',p.proconfig) order by p.proname)
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname in ('current_app_user_id','is_app_admin','admin_audit_is_append_only')),
  'grants', (select jsonb_agg(jsonb_build_object('t',table_name,'grantee',grantee,'priv',privilege_type,'col',column_name) order by table_name, grantee, privilege_type)
              from information_schema.column_privileges
             where table_schema='public' and table_name in ('user_capabilities','user_settings','admin_audit')
               and grantee in ('anon','authenticated')),
  'migration_history', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'rows', jsonb_build_object(
       'app_users', (select count(*) from app_users),
       'admins', (select count(*) from app_users where role='admin'),
       'user_settings', (select count(*) from user_settings),
       'user_capabilities', (select count(*) from user_capabilities),
       'admin_audit', (select count(*) from admin_audit)),
  'app_users_rows', (select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,
       'status',account_status,'created',created_at) order by created_at) from app_users)
)) as report;
"""


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if t:
        return t
    for svc in ("Supabase CLI", "supabase", "supabase-cli"):
        r = subprocess.run(["security", "find-generic-password", "-s", svc, "-w"],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip().startswith("sbp_"):
            print(f"token: macOS keychain ({svc})")
            return r.stdout.strip()
    return getpass.getpass("Supabase access token (sbp_...): ").strip()


def main():
    tok = token()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(json.dumps({"query": SQL})); body = f.name
    try:
        cfg = (f'url = "https://api.supabase.com/v1/projects/{REF}/database/query"\n'
               'request = "POST"\n'
               f'header = "Authorization: Bearer {tok}"\n'
               'header = "Content-Type: application/json"\n'
               'user-agent = "cedrus-verify/1.0"\n'
               f'data-binary = "@{body}"\n'
               'silent\n show-error\n write-out = "\\n%{http_code}"\n')
        out = subprocess.run(["curl", "-K", "-"], input=cfg, capture_output=True, text=True, timeout=180)
    finally:
        os.unlink(body)
    text, _, code = out.stdout.rpartition("\n")
    if not (200 <= int(code.strip() or 0) < 300):
        sys.exit(f"FAILED (HTTP {code.strip()}): {text[:400]}")
    rows = json.loads(text)
    print(rows[0]["report"] if rows and "report" in rows[0] else json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
