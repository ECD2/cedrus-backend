/**
 * Statement kinds: known / user_reported / inferred / proposed_action.
 *
 * This is the load-bearing contract of the whole package. Reboot plan §19:
 * "Why `pace_card_parts` is a table and not a JSON blob. The provenance tag is
 * load-bearing ... this is the field whose loss is unrecoverable."
 *
 * The tag is modelled as the discriminant of a union, so it is structurally
 * impossible to hold a statement without holding its kind. The rules that make
 * the tag mean something live in `guards/provenance.ts`.
 */
import { type Contract, type Infer, type Validator } from '../schema/core.ts';
export declare const HEDGE_VOCABULARY: readonly ["usually", "often", "probably", "looks like", "might"];
export declare const CONFIDENCE_LEVELS: readonly ["low", "medium", "high"];
export declare const knownStatementValidator: Validator<{
    statement_id: string;
    kind: "known";
    text: string;
    source: {
        type: "calendar_freebusy" | "member_stated" | "operator_entered" | "system_record";
        ref: string;
    };
    observed_at: string;
    derived_from?: readonly string[];
}>;
export type KnownStatement = Infer<typeof knownStatementValidator>;
export declare const userReportedStatementValidator: Validator<{
    statement_id: string;
    kind: "user_reported";
    text: string;
    source: {
        type: "operator_entered" | "member_sms" | "member_tap";
        ref: string;
    };
    reported_at: string;
    verified: false;
}>;
export type UserReportedStatement = Infer<typeof userReportedStatementValidator>;
export declare const inferredStatementValidator: Validator<{
    statement_id: string;
    kind: "inferred";
    text: string;
    source: {
        type: "model_inference" | "heuristic" | "statistical_prior";
        ref: string;
    };
    hedge: "usually" | "probably" | "might" | "looks like" | "often";
    confidence: "low" | "medium" | "high";
    basis: readonly string[];
    inferred_at: string;
    derived_from?: readonly string[];
}>;
export type InferredStatement = Infer<typeof inferredStatementValidator>;
export declare const proposedActionStatementValidator: Validator<{
    statement_id: string;
    kind: "proposed_action";
    text: string;
    window: {
        starts_at: string;
        ends_at: string;
    };
    goal_ref: string;
    urgency: "none";
    place_ref?: string;
    person_ref?: string;
}>;
export type ProposedActionStatement = Infer<typeof proposedActionStatementValidator>;
export declare const statementValidator: Validator<Statement>;
export type Statement = KnownStatement | UserReportedStatement | InferredStatement | ProposedActionStatement;
export declare const statementContract: Contract<Statement>;
