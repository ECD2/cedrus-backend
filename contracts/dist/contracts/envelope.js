/**
 * Import and export envelopes.
 *
 * Canon: CEDRUS.md Part I §15 rule 8 — "Export the full contact and consent
 * state periodically, so a provider outage or account problem is never a data
 * loss event." And reboot plan §18: "Deletion is real ... The consent audit
 * trail is retained deliberately, because it is the legal record of a permission
 * that was granted; that retention is disclosed."
 *
 * Three rules made mechanical:
 *   1. `record_count` is a `Count` and must name what it counted, so an export
 *      cannot claim more rows than it carries. Same guard as Progression.
 *   2. Credentials never leave the system. `connection_tokens` is the one table
 *      where a mistake is a credential leak (reboot plan §20 migration 6), so a
 *      deep guard rejects any token-shaped field anywhere in the envelope.
 *   3. Every record carries its own `schema_version`, so an envelope written six
 *      months ago is readable by `migrate/` without a side channel.
 */
import { arrayOf, defineContract, enumOf, inspect, integer, issue, jsonObject, literal, nullable, object, optional, string, walk, } from "../schema/core.js";
import { countValidator, id, instant, memberId } from "../common/primitives.js";
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_KINDS = ['export', 'import'];
/** Contracts an envelope is allowed to carry. A closed list, not "anything". */
export const PORTABLE_CONTRACTS = [
    'cedrus.member_profile',
    'cedrus.goal',
    'cedrus.goal_set',
    'cedrus.consent_event',
    'cedrus.permission_state',
    'cedrus.pace_card',
    'cedrus.card_outcome',
    'cedrus.member_activity',
    'cedrus.person',
    'cedrus.place',
    'cedrus.plan',
    'cedrus.progression',
    'cedrus.connection_authorization',
    'cedrus.availability',
];
/**
 * Field names that must never appear in an envelope, at any depth. Tokens are
 * server-side only and are not member data (reboot plan §16 item 4, §19).
 */
export const FORBIDDEN_ENVELOPE_FIELDS = [
    'accesstoken',
    'refreshtoken',
    'token',
    'tokens',
    'clientsecret',
    'servicerolekey',
    'anonkey',
    'apikey',
    'password',
    'secret',
    'privatekey',
    'authorizationheader',
];
const normaliseKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORBIDDEN_SET = new Set(FORBIDDEN_ENVELOPE_FIELDS);
/**
 * One carried record. `payload` is deliberately unvalidated at this level: the
 * envelope's job is to say what a payload claims to be so the right contract can
 * be applied. `validateEnvelopeRecords` in `migrate/` does the second pass.
 */
const envelopeRecordValidator = object({
    contract: enumOf(PORTABLE_CONTRACTS),
    schema_version: integer({ minimum: 1, maximum: 999 }),
    record_id: id('Record id.'),
    payload: jsonObject('Opaque here; validated against its own contract on read. The deep guards still walk it.'),
});
const envelopeShape = object({
    envelope_version: literal(ENVELOPE_VERSION),
    kind: enumOf(ENVELOPE_KINDS),
    generated_at: instant('When the envelope was written.'),
    /** Null for a system-wide export, set for a member data export. */
    member_id: nullable(memberId()),
    source_system: enumOf(['cedrus_backend', 'cedrus_miami', 'operator_tool']),
    records: arrayOf(envelopeRecordValidator, { maxItems: 10000 }),
    integrity: object({
        record_count: countValidator,
        /** Content hash of the serialised records, hex. */
        checksum_sha256: string({ pattern: '^[0-9a-f]{64}$', description: 'sha256 of the canonical serialisation.' }),
    }),
    /**
     * What was deliberately left out, and why. Reboot plan §18: retention of the
     * consent trail is disclosed, so an export says what it withheld rather than
     * silently omitting it.
     */
    redactions: arrayOf(object({
        contract: enumOf(PORTABLE_CONTRACTS),
        reason: enumOf(['credentials_never_exported', 'retained_legal_record', 'not_member_data']),
        note: optional(string({ maxLength: 200 })),
    }), { maxItems: 20 }),
});
export const dataEnvelopeValidator = inspect(envelopeShape, {
    expressedInJsonSchema: false,
    run: (envelopeValue, path) => {
        const issues = [];
        /** 1. The count must name what it counted, and match what is carried. */
        const claimed = envelopeValue.integrity.record_count;
        if (claimed.value !== claimed.source_refs.length) {
            issues.push(issue(`${path}integrity.record_count`, 'fabrication/count_not_derived', `record_count says ${claimed.value} but cites ${claimed.source_refs.length} record(s)`));
        }
        if (claimed.value !== envelopeValue.records.length) {
            issues.push(issue(`${path}integrity.record_count`, 'envelope/count_mismatch', `record_count says ${claimed.value} but the envelope carries ${envelopeValue.records.length}`));
        }
        const carried = new Set(envelopeValue.records.map((r) => r.record_id));
        for (let i = 0; i < claimed.source_refs.length; i += 1) {
            const ref = claimed.source_refs[i];
            if (ref === undefined)
                continue;
            if (!carried.has(ref)) {
                issues.push(issue(`${path}integrity.record_count.source_refs[${i}]`, 'envelope/count_cites_missing_record', `record_count cites "${ref}", which the envelope does not carry`));
            }
        }
        /** 2. No credentials, at any depth. */
        walk(envelopeValue, path, (node) => {
            if (node.key === null)
                return;
            if (FORBIDDEN_SET.has(normaliseKey(node.key))) {
                issues.push(issue(node.path, 'envelope/credential_leak', `"${node.key}" is a credential; tokens are server-side only and never travel in an envelope`));
            }
        });
        return issues;
    },
});
export const dataEnvelopeContract = defineContract({
    name: 'cedrus.data_envelope',
    version: ENVELOPE_VERSION,
    title: 'Import/export envelope',
    description: 'A versioned batch of records for export or import. Counts name what they counted, redactions are disclosed, and credentials never travel.',
    sources: ['CEDRUS.md I.15 rule 8', 'reboot plan §16 item 4', 'reboot plan §18', 'reboot plan §19'],
}, dataEnvelopeValidator);
