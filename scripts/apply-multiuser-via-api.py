#!/usr/bin/env python3
"""
Apply the multi-user foundation migration using a Supabase Personal Access
Token, via the Management API's SQL endpoint.

    python3 scripts/apply-multiuser-via-api.py

WHY THIS EXISTS
`supabase migration up --linked` connects to the remote Postgres and needs the
DATABASE password — a different secret from the account password, and one that
is not recoverable (Supabase never shows it again after creation). The
Management API takes a Personal Access Token instead, which is one click to
generate at https://supabase.com/dashboard/account/tokens.

The token is read from $SUPABASE_ACCESS_TOKEN, else the macOS keychain where
the Supabase CLI stores it, else a hidden prompt. It is never printed, never
written to disk, and never included in any output.

WHAT IT DOES, in order, stopping at the first failure:
  0. proves the token works           (select 1 against the Cedrus project)
  1. THE DEPLOY GATE: email_ai_analyses.user_id exists in Chief of Staff
  2. pre-check                        (expects three zeros + your user count)
  3. applies the migration            (self-proving; rolls back entirely if any
                                       assertion or control fails)
  4. records it in the CLI's migration history
  5. offers to promote one account to admin
"""
import json, os, sys, subprocess, tempfile, urllib.request, urllib.error, getpass, pathlib

CEDRUS = "qjwbtlnwnjjuvrwblkzx"          # production, confusingly named cedrus-dev
COS     = "kpzyzjhfvjfvxowhusir"          # Chief of Staff
VERSION = "20260830120000"
MIGRATION = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations" / f"{VERSION}_multiuser_foundation.sql"


def get_token() -> str:
    tok = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if tok:
        print("token: from $SUPABASE_ACCESS_TOKEN")
        return tok
    for service in ("Supabase CLI", "supabase", "supabase-cli"):
        try:
            out = subprocess.run(["security", "find-generic-password", "-s", service, "-w"],
                                 capture_output=True, text=True, timeout=10)
            if out.returncode == 0 and out.stdout.strip().startswith("sbp_"):
                print(f"token: from the macOS keychain ({service})")
                return out.stdout.strip()
        except Exception:
            pass
    print("Generate one at https://supabase.com/dashboard/account/tokens "
          "(Generate new token), then paste it here.")
    tok = getpass.getpass("Supabase access token (sbp_...): ").strip()
    if not tok.startswith("sbp_"):
        sys.exit("That does not look like a personal access token (should start with sbp_).")
    return tok


def query(token: str, ref: str, sql: str):
    """POST the SQL to the Management API.

    Transport is curl, not urllib: Cloudflare fronts api.supabase.com and
    rejects urllib's default `Python-urllib/3.x` signature with HTTP 403
    "error code: 1010" before Supabase ever sees the request. urllib with a
    real User-Agent is kept as a fallback in case curl is unavailable.

    The token goes to curl through a config file on STDIN, never in argv, so
    it cannot be read out of `ps` by another process on this machine.
    """
    # SUPABASE_MGMT_API_BASE exists for ONE reason: Bundle 44 points it at an
    # in-process fake so the real backfill script runs its real SQL against a
    # real (PGlite) database. Unset, it is the Management API.
    base = os.environ.get("SUPABASE_MGMT_API_BASE", "https://api.supabase.com").rstrip("/")
    url = f"{base}/v1/projects/{ref}/database/query"
    body = json.dumps({"query": sql})

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(body); body_path = f.name
    try:
        config = (f'url = "{url}"\n'
                  'request = "POST"\n'
                  f'header = "Authorization: Bearer {token}"\n'
                  'header = "Content-Type: application/json"\n'
                  'user-agent = "cedrus-migration/1.0"\n'
                  f'data-binary = "@{body_path}"\n'
                  'silent\n show-error\n write-out = "\\n%{http_code}"\n')
        try:
            out = subprocess.run(["curl", "-K", "-"], input=config,
                                 capture_output=True, text=True, timeout=300)
        except FileNotFoundError:
            out = None

        if out is not None and out.returncode == 0:
            text, _, code = out.stdout.rpartition("\n")
            status = int(code.strip() or 0)
        else:
            req = urllib.request.Request(url, data=body.encode(), method="POST", headers={
                "Authorization": f"Bearer {token}", "Content-Type": "application/json",
                "User-Agent": "cedrus-migration/1.0", "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    text, status = r.read().decode(), r.status
            except urllib.error.HTTPError as e:
                text, status = e.read().decode(), e.code
    finally:
        os.unlink(body_path)

    # The endpoint answers 201 Created on success, not 200. Accept any 2xx —
    # keying on a single code turned a working query into a reported failure.
    if not (200 <= status < 300):
        detail = text.strip()
        try:
            detail = json.loads(detail).get("message", detail)
        except Exception:
            pass
        hint = ""
        if "1010" in detail or status == 403:
            hint = ("\n\nHTTP 403 / Cloudflare 1010 is a client-fingerprint block, not an "
                    "auth failure. If curl is being blocked too, run the SQL in the dashboard "
                    "SQL editor instead — the migration file is a single paste.")
        elif status == 401:
            hint = ("\n\n401 means the token was rejected. Generate a fresh one at "
                    "https://supabase.com/dashboard/account/tokens and try again.")
        raise SystemExit(f"\nFAILED (HTTP {status}): {detail[:400]}{hint}\n\n"
                         "Nothing was applied — the migration is a single transaction "
                         "and any failure rolls all of it back.")
    return json.loads(text) if text.strip() else []

def show(rows):
    if not isinstance(rows, list) or not rows:
        print("   (no rows)"); return
    for r in rows:
        print("   " + json.dumps(r, default=str))


def main():
    if not MIGRATION.exists():
        sys.exit(f"Migration not found: {MIGRATION}")
    token = get_token()

    print("\n== 0/5  proving the token works ==")
    show(query(token, CEDRUS, "select current_database() as db, current_user as who;"))

    print("\n== 1/5  DEPLOY GATE: does Chief of Staff's email_ai_analyses have user_id? ==")
    rows = query(token, COS,
        "select column_name from information_schema.columns "
        "where table_schema='public' and table_name='email_ai_analyses' and column_name='user_id';")
    if not rows:
        sys.exit("STOP: email_ai_analyses has NO user_id column.\n"
                 "The scoped reader would fail closed and the daily brief would abort "
                 "every morning for everyone. Do not deploy the code until this is resolved.")
    print("   user_id present — the scoped reader is safe to deploy.")

    print("\n== 2/5  pre-check (expect three zeros, then your user count) ==")
    show(query(token, CEDRUS,
        "select (select count(*) from information_schema.tables where table_schema='public' and table_name='user_capabilities') as cap_tbl,"
        " (select count(*) from information_schema.tables where table_schema='public' and table_name='user_settings') as set_tbl,"
        " (select count(*) from information_schema.tables where table_schema='public' and table_name='admin_audit') as aud_tbl,"
        " (select count(*) from app_users) as existing_users;"))

    if input("\nApply the migration? Type yes to continue: ").strip() != "yes":
        sys.exit("Stopped. Nothing applied.")

    print("\n== 3/5  applying (self-proving; all-or-nothing) ==")
    query(token, CEDRUS, MIGRATION.read_text())
    print("   committed — every assertion and both controls passed")

    print("\n== 4/5  recording it in the migration history ==")
    try:
        query(token, CEDRUS,
              "insert into supabase_migrations.schema_migrations (version) "
              f"values ('{VERSION}') on conflict do nothing;")
        print("   history row recorded")
    except SystemExit as e:
        print(f"   could not record history (bookkeeping only, schema is applied): {e}")

    print("\n== 5/5  admin promotion ==")
    print("   The migration deliberately grants nobody admin. Your accounts:")
    show(query(token, CEDRUS,
        "select id, name, phone, role, account_status from app_users order by created_at;"))
    uid = input("   Paste the id to promote to admin (or press Enter to skip): ").strip()
    if uid:
        query(token, CEDRUS,
              f"update app_users set role='admin' where id='{uid}';")
        show(query(token, CEDRUS,
            "select id, name, role, account_status from app_users where role='admin';"))
    else:
        print("   skipped — promote later with: update app_users set role='admin' where id='...';")

    print("\nDone. Because the migration committed, all of this is now true:")
    for line in ("the six app_users columns exist; every row is (member, active)",
                 "RLS is enabled AND forced on all three new tables",
                 "no policy grants anon or public anything",
                 "the capability vocabulary rejects a typo and accepts a valid name",
                 "admin_audit refuses UPDATE and refuses DELETE, proven separately",
                 "no settings row, capability grant or user was created"):
        print("  · " + line)


if __name__ == "__main__":
    main()
