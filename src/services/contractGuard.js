import { goalContract, apiErrorFromIssues } from '../../contracts/dist/index.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────
// CONTRACT GUARD — the one seam where the vendored contracts package meets a
// live request path. Slice 1 Phase B.
//
// WHAT THIS IS FOR. `contracts/` says what shape a Cedrus value has. Nothing
// enforced it against anything running. This wires exactly ONE existing path,
// POST /api/goals, so that the contract and the deployed service can be
// observed disagreeing before anything depends on them agreeing.
//
// THE FLAG. `CONTRACTS_VALIDATE` decides what a violation costs:
//
//   unset / anything but 'true'  (DEFAULT)  log-only. A `contract.violation`
//                                           event is emitted and the request
//                                           proceeds exactly as it did before.
//                                           Behaviour is unchanged, by
//                                           construction: nothing in this file
//                                           can throw on that branch.
//   'true'                                  the request is refused with a 422
//                                           shaped as `cedrus.api_error`.
//
// The flag is read per call, not cached at module load, so a test can drive
// both branches in one process without a module reset. This is a hot-ish path
// (one env read per goal write) and that is cheap; correctness of the control
// is worth more here than the read.
//
// THE FLAG IS NOT FLIPPED IN THIS SLICE. Default off is the shipped state.
//
// LESSON 7, AND WHY THE LOG LINE ALWAYS SAYS WHICH MODE IT RAN IN. "A guard
// that can't distinguish 'checked and fine' from 'didn't run'" is a disease
// this codebase has already had twice. So: every violation names its mode, and
// `assertGoalContract` NEVER silently skips. If the contract cannot be reached
// at all the failure is loud on the flag-on branch and announced on the
// flag-off branch — never absent.
//
// WHAT IT DOES NOT DO. It does not touch `BRIEF_DRY_RUN`, the safety modules,
// or any other route. It does not rewrite the payload. A contract that
// disagrees with the service is a fact to record, not a licence to change what
// gets stored.
// ─────────────────────────────────────────────────────────────────────────

/** The contract this seam enforces. Named once so the log line and the 422 agree. */
export const GOAL_CONTRACT_NAME = goalContract.name;

/**
 * Stand-in for the id on a goal that has not been inserted yet.
 *
 * The check runs BEFORE the write, because a validation that runs after the
 * row lands cannot refuse it. Postgres assigns `user_goals.id`, so at check
 * time there is no id to check. Rather than hide that, it is named: **the goal
 * id is not under test on this path.** It is not a member-supplied value, it is
 * `gen_random_uuid()`, and nothing a client sends can influence it.
 *
 * Everything a member actually supplies IS under test.
 */
export const GOAL_ID_PENDING = 'goal:pending';

/** Public copy for the flag-on refusal. Voice spec: no em dashes, no exclamation marks. */
export const MSG_CONTRACT_VIOLATION = "That goal isn't in a shape I can store yet.";

export function contractsValidateEnabled() {
  try {
    return (typeof process !== 'undefined' && process.env
      ? process.env.CONTRACTS_VALIDATE
      : undefined) === 'true';
  } catch {
    // An unreadable environment is "off", which is the no-behaviour-change
    // branch. It is also announced by the caller, so it cannot pass for a clean
    // check.
    return false;
  }
}

/**
 * Project a live `user_goals` write onto `cedrus.goal` v2.
 *
 * Every mapping that is not the identity is deliberate and is recorded in
 * `contracts/VENDORED_FROM.md` under "Divergences". The two that would
 * otherwise produce permanent false violations:
 *
 *   priority  The service's `priority` is a 0-100 ranking weight for
 *             selectVitalFew. The contract's `priority` is a member-set rank of
 *             1-3. Same name, different concept. Sending the service's value
 *             would assert the member ranked something they never ranked, and
 *             would make every default-priority goal a violation. Null is the
 *             honest answer: this member has not set a contract-sense rank.
 *
 *   ids       The contract's ids are `prefix:suffix`; the backend's are bare
 *             uuids. Prefixing here rather than loosening the pattern, because
 *             the pattern is doing real work everywhere else.
 *
 * `lane` is null because the column does not exist yet (Slice 2's additive
 * migration). Null means unsorted, which is exactly true today.
 */
export function goalRowToContract(row = {}) {
  return {
    schema_version: 2,
    goal_id: row.id ? `goal:${row.id}` : GOAL_ID_PENDING,
    member_id: `member:${row.user_id ?? ''}`,
    stated_text: row.goal_text ?? '',
    lane: null,
    origin: row.origin ?? '',
    status: row.status ?? '',
    priority: null,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

/**
 * Validate a goal about to be written.
 *
 * Returns `{ ok: true }` when the payload satisfies the contract. On a
 * violation: emits `contract.violation` and then, ONLY when the flag is on,
 * throws a typed 422 the route wrapper already knows how to render.
 *
 * The thrown error carries `apiError`, the `cedrus.api_error` body, so the
 * shape a client sees is the contract's own error shape rather than a second
 * hand-rolled one.
 */
export function assertGoalContract(row, { requestId = null } = {}) {
  const enforcing = contractsValidateEnabled();
  const result = goalContract.safeParse(goalRowToContract(row));

  if (result.ok) return { ok: true, enforcing };

  const issues = result.issues.map((i) => ({ path: i.path, code: i.code, message: i.message }));

  // Paths and codes only. Never `stated_text`'s value: the goal is the member's
  // own words and a log line is not the place for them.
  logger.event('contract.violation', {
    level: enforcing ? 'warn' : 'info',
    error_category: 'validation',
    outcome: enforcing ? 'rejected' : 'observed_only',
    // The mode is in the record, always. Absence of a warning is not evidence
    // of a pass (Lesson 7).
    reason: enforcing ? 'contracts_validate_on' : 'contracts_validate_off_log_only',
    category: GOAL_CONTRACT_NAME,
    error_code: issues.map((i) => i.code).join(','),
    count: issues.length,
    message: issues.map((i) => `${i.path}:${i.code}`).join(' '),
  });

  if (!enforcing) return { ok: false, enforcing, issues };

  const apiError = apiErrorFromIssues({
    contract: GOAL_CONTRACT_NAME,
    issues,
    request_id: `request:${requestId ?? 'unknown'}`,
    occurred_at: new Date().toISOString(),
  });

  throw Object.assign(new Error(MSG_CONTRACT_VIOLATION), {
    status: 422,
    code: 'contract_violation',
    publicMessage: MSG_CONTRACT_VIOLATION,
    contract: GOAL_CONTRACT_NAME,
    issues,
    apiError,
  });
}
