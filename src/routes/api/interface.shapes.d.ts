// ─────────────────────────────────────────────────────────────────────────────
// /api/interface response shapes (A3.2) — the Engine's own shapes, declared.
//
// Every field here is a column, a token claim, or the output of a function
// the Engine already has. Nothing is invented for the interface. Where a value
// is a slot the Engine cannot fill yet, it is typed `null` and says so.
// A parallel session builds the interface adapter against these; ledger item
// A3.3 freezes them as JSON Schema + fixtures generated from the real
// handlers. Until then this file is the contract and Bundle 47 checks that
// every top-level key each handler returns is declared here.
//
// Authentication (every route): `Authorization: Bearer <supabase access_token>`.
// The token is verified in code (signature, expiry, issuer, audience, role,
// subject), the session must be aal2 (a second factor presented), and the
// account must be active. See src/routes/api/auth.js.
// ─────────────────────────────────────────────────────────────────────────────

/** ISO-8601 timestamp with offset, e.g. "2026-09-09T11:00:12.345Z". */
export type IsoTimestamp = string;
/** Calendar date, YYYY-MM-DD, in the timezone the response names. */
export type IsoDate = string;
export type Uuid = string;

// ── errors ───────────────────────────────────────────────────────────────────

/**
 * Every non-2xx body. `reason` is present on the choke point's 401s and is a
 * short category — it never contains the token.
 *
 *   401 auth_required   no/invalid bearer: reason ∈ no_bearer | malformed |
 *                       unsupported_alg | no_key_for_alg | unknown_key |
 *                       bad_signature | no_expiry | expired | not_yet_valid |
 *                       bad_issuer | bad_audience | bad_role | no_subject |
 *                       rejected_by_auth
 *   401 mfa_required    token verified but first-factor only:
 *                       reason ∈ aal2_required | aal_missing | aal_unknown
 *   403 no_linked_account   verified identity, no app_users row linked to it
 *   403 account_suspended   account_status is not 'active'
 *   503 settings_unreadable | capabilities_unreadable | brief_unreadable |
 *       workspace_unreadable   a read the response depends on failed — never
 *       reported as empty data
 *   500 internal        verifier/keys unreachable, or an unexpected throw
 */
export interface ErrorResponse {
  error:
    | 'auth_required' | 'mfa_required' | 'no_linked_account' | 'account_suspended'
    | 'settings_unreadable' | 'capabilities_unreadable' | 'brief_unreadable' | 'workspace_unreadable'
    | 'internal';
  reason?: string;
  message: string;
}

// ── GET /api/interface/session ──────────────────────────────────────────────

/** The closed vocabulary (user_capabilities CHECK constraint). Absent row ⇒ false. */
export interface Capabilities {
  run_agents: boolean;
  write_workspace: boolean;
  receive_brief: boolean;
  receive_sms: boolean;
}

export type AssuranceLevel = 'aal1' | 'aal2';
/** Supabase `amr[].method` values seen on this session, in order. */
export type AuthMethod = 'password' | 'totp' | 'otp' | 'magiclink' | 'oauth' | 'sso/saml' | 'anonymous' | string;

export interface SessionResponse {
  /** app_users, curated: never the raw row. */
  user: {
    id: Uuid;
    name: string | null;
    display_name: string | null;
    timezone: string | null;
    role: 'admin' | 'member' | null;
  };
  /** What the verified token said about THIS session. */
  session: {
    /** Always 'aal2' on a 200 — aal1 is refused upstream. */
    aal: AssuranceLevel;
    methods: AuthMethod[];
    issued_at: IsoTimestamp | null;
    expires_at: IsoTimestamp | null;
    session_id: string | null;
  };
  capabilities: Capabilities;
  preferences: {
    /** SLOT. user_settings has no skin column yet; always null until it does. Do not persist. */
    skin: null;
  };
}

// ── GET /api/interface/status ───────────────────────────────────────────────

export interface StatusResponse {
  generated_at: IsoTimestamp;
  services: {
    /** user_settings + the per-user send ledger (system_flags, keyed by CoS owner id per UTC day). */
    brief: {
      /** Whether this person has a user_settings row at all (P1.3 backfills it). */
      settings_row: boolean;
      enabled: boolean;
      email: string | null;
      hour_utc: number | null;
      timezone: string;
      /** receive_brief */
      capability: boolean;
      /** 'unknown' when not linked to CoS or the ledger could not be read. */
      today: 'sent' | 'claimed' | 'not_sent' | 'unknown';
      sent_at: IsoTimestamp | null;
    };
    cos: {
      /** user_settings.cos_user_id is set for this person. */
      linked: boolean;
      /** COS_SUPABASE_URL + COS_SERVICE_ROLE_KEY both set on this deploy. */
      reader: 'armed' | 'disarmed';
    };
    /** todays_program_items(p_user_id, p_at) for this person. */
    programs:
      | { state: 'ok'; today_items: number; error: null }
      | { state: 'unreadable'; today_items: null; error: string };
    sms: {
      phone_linked: boolean;
      consent_recorded_at: IsoTimestamp | null;
      opted_out: boolean;
      /** receive_sms */
      capability: boolean;
    };
    agents: {
      /** run_agents */
      capability: boolean;
      state: 'ok' | 'unlinked' | 'disarmed' | 'unreadable';
      /** Newest agent_runs.created_at for this person in CoS. */
      last_run_at: IsoTimestamp | null;
    };
  };
}

// ── GET /api/interface/brief/today ──────────────────────────────────────────

export type SourceRefType =
  | 'workstream' | 'open_loop' | 'decision' | 'capture' | 'agent_run'
  | 'email_message' | 'email_analysis';

export interface SourceRef { type: SourceRefType; id: string }

export type Urgency = 'low' | 'medium' | 'high' | 'critical';

/**
 * CoS's `today_brief_v1` exactly as the daily job validated and stored it in
 * today_briefs.structured_output (src/services/cos/compose.js validateBrief +
 * the job's todays_program). `workspace_state` and `todays_program` are
 * computed lines, not model output; `workspace_state` is also mirrored into
 * `not_enough_evidence` for CoS's own panel — render it once.
 */
export interface TodayBriefV1 {
  schema_version: 'today_brief_v1';
  generated_at: IsoTimestamp;
  summary: string;
  top_priorities: Array<{
    rank: number;
    title: string;
    reason: string;
    recommended_action: string;
    urgency: Urgency;
    /** 0–1 */
    confidence: number;
    source_refs: SourceRef[];
  }>;
  decisions_to_make: Array<{ question: string; source_refs: SourceRef[] }>;
  people_or_dependencies_waiting: Array<{ who: string; what: string; source_refs: SourceRef[] }>;
  risks: Array<{ risk: string; source_refs: SourceRef[] }>;
  not_enough_evidence: string[];
  model_disclaimer: string;
  workspace_state: string[];
  todays_program: string[];
  composed_by: string;
  source_system: 'cedrus';
}

export type BriefTodayResponse =
  | {
      available: true;
      date: IsoDate;
      timezone: string;
      id: Uuid;
      generated_at: IsoTimestamp;
      expires_at: IsoTimestamp | null;
      model: string | null;
      schema_version: string | null;
      brief: TodayBriefV1;
    }
  | {
      available: false;
      date: IsoDate;
      timezone: string;
      /**
       * cos_not_linked        no user_settings.cos_user_id for this person
       * cos_disarmed          the CoS reader has no credentials on this deploy
       * not_generated_today   no ok/ai brief row dated today in this timezone
       */
      reason: 'cos_not_linked' | 'cos_disarmed' | 'not_generated_today';
      /** The newest brief's generated_at when one exists on another day. */
      latest_generated_at: IsoTimestamp | null;
    };

// ── GET /api/interface/workspace ────────────────────────────────────────────

/** READER_COLUMNS.workstreams, verbatim (src/services/cos/reader.js). */
export interface Workstream {
  id: string; name: string | null; status: string | null; priority: string | null;
  health: string | null; objective: string | null; current_stage: string | null;
  next_action: string | null; target_date: string | null; archived_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

/** READER_COLUMNS.open_loops, verbatim. */
export interface OpenLoop {
  id: string; title: string | null; status: string | null; priority: string | null;
  waiting_on: string | null; next_action: string | null; due_at: IsoTimestamp | null;
  workstream_id: string | null; created_at: IsoTimestamp;
}

/** READER_COLUMNS.decisions, verbatim. */
export interface Decision {
  id: string; question: string | null; status: string | null; recommendation: string | null;
  recommendation_source: string | null; decided_at: IsoTimestamp | null;
  workstream_id: string | null; created_at: IsoTimestamp;
}

export type WorkspaceResponse =
  | {
      available: true;
      /** Newest first, capped at `limits` (COS_LIMITS). */
      workstreams: Workstream[];
      open_loops: OpenLoop[];
      decisions: Decision[];
      limits: { workstreams: number; open_loops: number; decisions: number };
    }
  | { available: false; reason: 'cos_not_linked' | 'cos_disarmed' };
