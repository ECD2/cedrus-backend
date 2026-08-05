/**
 * Cedrus Contracts — validator core.
 *
 * A small, dependency-free schema combinator library. Every combinator carries
 * two things at once:
 *
 *   1. a runtime `check` that returns a list of issues, and
 *   2. a JSON Schema fragment (draft 2020-12).
 *
 * Both come from the same declaration, so the TypeScript validator and the
 * published JSON Schema cannot drift apart by construction. `test/json-schema-
 * agreement.test.ts` then proves agreement against an independent JSON Schema
 * implementation (Ajv) rather than trusting the construction.
 *
 * No `any` anywhere. `unknown` plus narrowing only.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
/** A JSON Schema fragment. Kept as an open record of JsonValue, never `any`. */
export type JsonSchema = {
    [key: string]: JsonValue;
};
/** One validation failure. `code` is stable and is what callers assert on. */
export interface Issue {
    readonly path: string;
    readonly code: string;
    readonly message: string;
}
export type CheckResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly issues: readonly Issue[];
};
/**
 * Raised by `parse`. Carries the full issue list; never a single string, because
 * a caller fixing a payload needs every problem at once.
 */
export declare class ContractViolation extends Error {
    readonly contract: string;
    readonly issues: readonly Issue[];
    constructor(contract: string, issues: readonly Issue[]);
}
/** A validator with a matching JSON Schema fragment and an inferred output type. */
export interface Validator<T> {
    /**
     * Phantom, never populated at runtime. It exists so `T` is covariantly
     * referenced by the interface, which keeps `Infer<>` reliable and makes
     * `Validator<KnownStatement>` assignable to `Validator<Statement>`.
     */
    readonly __output?: T;
    readonly kind: string;
    /** JSON Schema fragment for this node. */
    readonly schema: JsonSchema;
    /**
     * True when the JSON Schema fragment expresses *every* rule this validator
     * enforces. False marks a rule that JSON Schema cannot express (cross-field
     * logic, mostly). The agreement test reads this flag; it is never guessed.
     */
    readonly fullyExpressedInJsonSchema: boolean;
    check(input: unknown, path: string): readonly Issue[];
}
export type Infer<V> = V extends Validator<infer T> ? T : never;
export declare const issue: (path: string, code: string, message: string) => Issue;
export interface StringOptions {
    readonly minLength?: number;
    readonly maxLength?: number;
    /** ECMA-262 source, used verbatim by both the runtime check and JSON Schema. */
    readonly pattern?: string;
    readonly format?: string;
    readonly description?: string;
}
export declare const string: (options?: StringOptions) => Validator<string>;
export interface NumberOptions {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly integer?: boolean;
    readonly description?: string;
}
export declare const number: (options?: NumberOptions) => Validator<number>;
export declare const integer: (options?: Omit<NumberOptions, "integer">) => Validator<number>;
export declare const boolean: () => Validator<boolean>;
export declare const nullValue: () => Validator<null>;
/**
 * A constant. Used heavily for locked promises: `token_storage: 'server_only'`,
 * `bundled: false`. A const in the contract is a promise the caller cannot
 * quietly weaken.
 */
export declare const literal: <const T extends string | number | boolean | null>(value: T) => Validator<T>;
export interface EnumOptions {
    /**
     * Issue code emitted when the value is outside the set. Defaults to
     * `enum/not_allowed`. Guards override it so the rejection names the doctrine
     * it is enforcing (`provenance/inference_as_known`, not "bad enum").
     */
    readonly code?: string;
    readonly message?: string;
    readonly description?: string;
}
/** A closed set of string values. Closed sets are the main anti-drift device here. */
export declare const enumOf: <const T extends readonly string[]>(values: T, options?: EnumOptions) => Validator<T[number]>;
export interface ArrayOptions {
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly description?: string;
}
export declare const arrayOf: <T>(item: Validator<T>, options?: ArrayOptions) => Validator<readonly T[]>;
/**
 * An arbitrary JSON object, unvalidated at this level. Used only where a shape
 * is deliberately opaque (an envelope payload, validated on read against its own
 * contract). The deep guards still walk it, so opaque is not unchecked.
 */
export declare const jsonObject: (description?: string) => Validator<{
    [key: string]: JsonValue;
}>;
type OptionalMarker = {
    readonly __cedrusOptional: true;
};
type OptionalValidator<T> = Validator<T> & OptionalMarker;
/** Marks a field optional. Absent is allowed; present must still validate. */
export declare const optional: <T>(inner: Validator<T>) => OptionalValidator<T>;
export declare const nullable: <T>(inner: Validator<T>) => Validator<T | null>;
type FieldsOf<S extends Record<string, Validator<unknown>>> = {
    -readonly [K in keyof S as S[K] extends OptionalMarker ? never : K]: Infer<S[K]>;
} & {
    -readonly [K in keyof S as S[K] extends OptionalMarker ? K : never]?: Infer<S[K]>;
};
type Simplify<T> = {
    [K in keyof T]: T[K];
} & {};
export interface ObjectOptions {
    readonly description?: string;
    /**
     * Closed by default. Unknown keys are a rejection, not a warning: an unknown
     * key on a calendar payload is exactly how a title gets into the logs.
     */
    readonly additionalProperties?: false;
}
export declare const object: <S extends Record<string, Validator<unknown>>>(shape: S, options?: ObjectOptions) => Validator<Simplify<FieldsOf<S>>>;
/**
 * Discriminated union. The discriminant is a required literal-valued field on
 * every member. Provenance (`kind`) is modelled this way so the tag is
 * structurally inseparable from the value.
 */
export declare const discriminatedUnion: <D extends string, T>(discriminant: D, members: readonly {
    readonly tag: string;
    readonly validator: Validator<T>;
}[]) => Validator<T>;
/**
 * Adds a rule the type system alone cannot express. `expressedInJsonSchema`
 * must be stated honestly: it is what the agreement test trusts.
 */
export declare const refine: <T>(inner: Validator<T>, rule: {
    readonly code: string;
    readonly message: string;
    readonly expressedInJsonSchema: boolean;
    readonly schema?: JsonSchema;
    predicate(value: T): boolean;
}) => Validator<T>;
/** Like `refine`, but the rule may report several issues with their own paths. */
export declare const inspect: <T>(inner: Validator<T>, rule: {
    readonly expressedInJsonSchema: boolean;
    readonly schema?: JsonSchema;
    run(value: T, path: string): readonly Issue[];
}) => Validator<T>;
export interface ContractMeta {
    /** Stable dotted name, e.g. `cedrus.pace_card`. Used as the JSON Schema $id stem. */
    readonly name: string;
    /** Integer schema version. Bumped whenever the shape changes. */
    readonly version: number;
    readonly title: string;
    readonly description: string;
    /** Where in the canon this contract comes from. Kept in the JSON Schema. */
    readonly sources: readonly string[];
}
export interface Contract<T> extends ContractMeta {
    readonly validator: Validator<T>;
    readonly jsonSchema: JsonSchema;
    safeParse(input: unknown): CheckResult<T>;
    parse(input: unknown): T;
    is(input: unknown): input is T;
}
export declare const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
export declare const SCHEMA_ID_BASE = "https://contracts.cedrus.life/v0";
export declare const schemaFileName: (meta: ContractMeta) => string;
export declare const defineContract: <T>(meta: ContractMeta, validator: Validator<T>) => Contract<T>;
export interface VisitedNode {
    readonly path: string;
    readonly key: string | null;
    readonly value: unknown;
}
/** Depth-first walk over an arbitrary payload. Used by the forbidden-key guards. */
export declare const walk: (input: unknown, path: string, visit: (node: VisitedNode) => void) => void;
/**
 * Builds a case-insensitive ECMA-262 pattern for a literal word with word-ish
 * boundaries. JSON Schema has no `i` flag, so case insensitivity has to be
 * written into the character classes for the schema and the runtime to agree.
 */
export declare const caseInsensitiveWordPattern: (word: string) => string;
/** `not: { pattern }` for every word in the list, as one JSON Schema fragment. */
export declare const notAnyOfPatterns: (words: readonly string[]) => JsonSchema;
export declare const matchesAnyWord: (text: string, words: readonly string[]) => string | null;
export {};
