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
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON Schema fragment. Kept as an open record of JsonValue, never `any`. */
export type JsonSchema = { [key: string]: JsonValue };

/** One validation failure. `code` is stable and is what callers assert on. */
export interface Issue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type CheckResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly Issue[] };

/**
 * Raised by `parse`. Carries the full issue list; never a single string, because
 * a caller fixing a payload needs every problem at once.
 */
export class ContractViolation extends Error {
  readonly contract: string;
  readonly issues: readonly Issue[];

  constructor(contract: string, issues: readonly Issue[]) {
    const summary = issues.map((i) => `${i.path || '<root>'}: ${i.code}`).join('; ');
    super(`${contract} rejected the payload: ${summary}`);
    this.name = 'ContractViolation';
    this.contract = contract;
    this.issues = issues;
  }
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

export const issue = (path: string, code: string, message: string): Issue => ({ path, code, message });

const join = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);
const index = (path: string, i: number): string => `${path}[${i}]`;

const NO_ISSUES: readonly Issue[] = Object.freeze([]);

// ---------------------------------------------------------------------------
// Primitive combinators
// ---------------------------------------------------------------------------

export interface StringOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
  /** ECMA-262 source, used verbatim by both the runtime check and JSON Schema. */
  readonly pattern?: string;
  readonly format?: string;
  readonly description?: string;
}

export const string = (options: StringOptions = {}): Validator<string> => {
  const schema: JsonSchema = { type: 'string' };
  if (options.minLength !== undefined) schema['minLength'] = options.minLength;
  if (options.maxLength !== undefined) schema['maxLength'] = options.maxLength;
  if (options.pattern !== undefined) schema['pattern'] = options.pattern;
  if (options.format !== undefined) schema['format'] = options.format;
  if (options.description !== undefined) schema['description'] = options.description;

  const re = options.pattern === undefined ? null : new RegExp(options.pattern);

  return {
    kind: 'string',
    schema,
    fullyExpressedInJsonSchema: true,
    check(input, path) {
      if (typeof input !== 'string') return [issue(path, 'type/expected_string', 'expected a string')];
      const issues: Issue[] = [];
      if (options.minLength !== undefined && input.length < options.minLength) {
        issues.push(issue(path, 'string/too_short', `expected at least ${options.minLength} characters`));
      }
      if (options.maxLength !== undefined && input.length > options.maxLength) {
        issues.push(issue(path, 'string/too_long', `expected at most ${options.maxLength} characters`));
      }
      if (re !== null && !re.test(input)) {
        issues.push(issue(path, 'string/pattern', `expected to match ${options.pattern ?? ''}`));
      }
      return issues;
    },
  };
};

export interface NumberOptions {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer?: boolean;
  readonly description?: string;
}

export const number = (options: NumberOptions = {}): Validator<number> => {
  const schema: JsonSchema = { type: options.integer === true ? 'integer' : 'number' };
  if (options.minimum !== undefined) schema['minimum'] = options.minimum;
  if (options.maximum !== undefined) schema['maximum'] = options.maximum;
  if (options.description !== undefined) schema['description'] = options.description;

  return {
    kind: 'number',
    schema,
    fullyExpressedInJsonSchema: true,
    check(input, path) {
      if (typeof input !== 'number' || Number.isNaN(input)) {
        return [issue(path, 'type/expected_number', 'expected a number')];
      }
      const issues: Issue[] = [];
      if (options.integer === true && !Number.isInteger(input)) {
        issues.push(issue(path, 'number/expected_integer', 'expected an integer'));
      }
      if (options.minimum !== undefined && input < options.minimum) {
        issues.push(issue(path, 'number/too_small', `expected >= ${options.minimum}`));
      }
      if (options.maximum !== undefined && input > options.maximum) {
        issues.push(issue(path, 'number/too_large', `expected <= ${options.maximum}`));
      }
      return issues;
    },
  };
};

export const integer = (options: Omit<NumberOptions, 'integer'> = {}): Validator<number> =>
  number({ ...options, integer: true });

export const boolean = (): Validator<boolean> => ({
  kind: 'boolean',
  schema: { type: 'boolean' },
  fullyExpressedInJsonSchema: true,
  check(input, path) {
    return typeof input === 'boolean' ? NO_ISSUES : [issue(path, 'type/expected_boolean', 'expected a boolean')];
  },
});

export const nullValue = (): Validator<null> => ({
  kind: 'null',
  schema: { type: 'null' },
  fullyExpressedInJsonSchema: true,
  check(input, path) {
    return input === null ? NO_ISSUES : [issue(path, 'type/expected_null', 'expected null')];
  },
});

/**
 * A constant. Used heavily for locked promises: `token_storage: 'server_only'`,
 * `bundled: false`. A const in the contract is a promise the caller cannot
 * quietly weaken.
 */
export const literal = <const T extends string | number | boolean | null>(value: T): Validator<T> => ({
  kind: 'literal',
  schema: { const: value },
  fullyExpressedInJsonSchema: true,
  check(input, path) {
    return input === value
      ? NO_ISSUES
      : [issue(path, 'literal/mismatch', `expected the constant ${JSON.stringify(value)}`)];
  },
});

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
export const enumOf = <const T extends readonly string[]>(values: T, options: EnumOptions = {}): Validator<T[number]> => {
  const allowed: JsonValue[] = values.map((v) => v);
  const schema: JsonSchema = { type: 'string', enum: allowed };
  if (options.description !== undefined) schema['description'] = options.description;
  const code = options.code ?? 'enum/not_allowed';
  const message = options.message ?? `expected one of: ${values.join(', ')}`;
  return {
    kind: 'enum',
    schema,
    fullyExpressedInJsonSchema: true,
    check(input, path) {
      if (typeof input !== 'string') return [issue(path, 'type/expected_string', 'expected a string')];
      return (values as readonly string[]).includes(input) ? NO_ISSUES : [issue(path, code, message)];
    },
  };
};

// ---------------------------------------------------------------------------
// Composite combinators
// ---------------------------------------------------------------------------

export interface ArrayOptions {
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly description?: string;
}

export const arrayOf = <T>(item: Validator<T>, options: ArrayOptions = {}): Validator<readonly T[]> => {
  const schema: JsonSchema = { type: 'array', items: item.schema };
  if (options.minItems !== undefined) schema['minItems'] = options.minItems;
  if (options.maxItems !== undefined) schema['maxItems'] = options.maxItems;
  if (options.description !== undefined) schema['description'] = options.description;

  return {
    kind: 'array',
    schema,
    fullyExpressedInJsonSchema: item.fullyExpressedInJsonSchema,
    check(input, path) {
      if (!Array.isArray(input)) return [issue(path, 'type/expected_array', 'expected an array')];
      const issues: Issue[] = [];
      if (options.minItems !== undefined && input.length < options.minItems) {
        issues.push(issue(path, 'array/too_few', `expected at least ${options.minItems} items`));
      }
      if (options.maxItems !== undefined && input.length > options.maxItems) {
        issues.push(issue(path, 'array/too_many', `expected at most ${options.maxItems} items`));
      }
      for (let i = 0; i < input.length; i += 1) {
        issues.push(...item.check(input[i], index(path, i)));
      }
      return issues;
    },
  };
};

/**
 * An arbitrary JSON object, unvalidated at this level. Used only where a shape
 * is deliberately opaque (an envelope payload, validated on read against its own
 * contract). The deep guards still walk it, so opaque is not unchecked.
 */
export const jsonObject = (description?: string): Validator<{ [key: string]: JsonValue }> => {
  const schema: JsonSchema = { type: 'object' };
  if (description !== undefined) schema['description'] = description;
  return {
    kind: 'jsonObject',
    schema,
    fullyExpressedInJsonSchema: true,
    check(input, path) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return [issue(path, 'type/expected_object', 'expected an object')];
      }
      return NO_ISSUES;
    },
  };
};

type OptionalMarker = { readonly __cedrusOptional: true };
type OptionalValidator<T> = Validator<T> & OptionalMarker;

/** Marks a field optional. Absent is allowed; present must still validate. */
export const optional = <T>(inner: Validator<T>): OptionalValidator<T> => ({
  ...inner,
  __cedrusOptional: true,
});

const isOptional = (v: Validator<unknown>): boolean =>
  (v as Validator<unknown> & Partial<OptionalMarker>).__cedrusOptional === true;

export const nullable = <T>(inner: Validator<T>): Validator<T | null> => ({
  kind: 'nullable',
  schema: { anyOf: [inner.schema, { type: 'null' }] },
  fullyExpressedInJsonSchema: inner.fullyExpressedInJsonSchema,
  check(input, path) {
    if (input === null) return NO_ISSUES;
    return inner.check(input, path);
  },
});

type FieldsOf<S extends Record<string, Validator<unknown>>> = {
  -readonly [K in keyof S as S[K] extends OptionalMarker ? never : K]: Infer<S[K]>;
} & {
  -readonly [K in keyof S as S[K] extends OptionalMarker ? K : never]?: Infer<S[K]>;
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export interface ObjectOptions {
  readonly description?: string;
  /**
   * Closed by default. Unknown keys are a rejection, not a warning: an unknown
   * key on a calendar payload is exactly how a title gets into the logs.
   */
  readonly additionalProperties?: false;
}

export const object = <S extends Record<string, Validator<unknown>>>(
  shape: S,
  options: ObjectOptions = {},
): Validator<Simplify<FieldsOf<S>>> => {
  const properties: JsonSchema = {};
  const required: JsonValue[] = [];
  let fullyExpressed = true;

  for (const key of Object.keys(shape)) {
    const field = shape[key];
    if (field === undefined) continue;
    properties[key] = field.schema;
    if (!isOptional(field)) required.push(key);
    if (!field.fullyExpressedInJsonSchema) fullyExpressed = false;
  }

  const schema: JsonSchema = {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
  if (options.description !== undefined) schema['description'] = options.description;

  return {
    kind: 'object',
    schema,
    fullyExpressedInJsonSchema: fullyExpressed,
    check(input, path) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return [issue(path, 'type/expected_object', 'expected an object')];
      }
      const record = input as Record<string, unknown>;
      const issues: Issue[] = [];

      for (const key of Object.keys(shape)) {
        const field = shape[key];
        if (field === undefined) continue;
        const present = Object.prototype.hasOwnProperty.call(record, key);
        if (!present) {
          if (!isOptional(field)) {
            issues.push(issue(join(path, key), 'object/missing_required', `required field "${key}" is missing`));
          }
          continue;
        }
        issues.push(...field.check(record[key], join(path, key)));
      }

      for (const key of Object.keys(record)) {
        if (!Object.prototype.hasOwnProperty.call(shape, key)) {
          issues.push(issue(join(path, key), 'object/unknown_key', `unknown field "${key}" is not permitted`));
        }
      }

      return issues;
    },
  };
};

/**
 * Discriminated union. The discriminant is a required literal-valued field on
 * every member. Provenance (`kind`) is modelled this way so the tag is
 * structurally inseparable from the value.
 */
export const discriminatedUnion = <D extends string, T>(
  discriminant: D,
  members: readonly { readonly tag: string; readonly validator: Validator<T> }[],
): Validator<T> => {
  const byTag = new Map<string, Validator<T>>();
  let fullyExpressed = true;
  for (const member of members) {
    byTag.set(member.tag, member.validator);
    if (!member.validator.fullyExpressedInJsonSchema) fullyExpressed = false;
  }

  const schema: JsonSchema = {
    oneOf: members.map((m) => m.validator.schema),
  };

  return {
    kind: 'discriminatedUnion',
    schema,
    fullyExpressedInJsonSchema: fullyExpressed,
    check(input, path) {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return [issue(path, 'type/expected_object', 'expected an object')];
      }
      const record = input as Record<string, unknown>;
      const tag = record[discriminant];
      if (typeof tag !== 'string') {
        return [issue(join(path, discriminant), 'union/missing_discriminant', `"${discriminant}" is required and must be a string`)];
      }
      const member = byTag.get(tag);
      if (member === undefined) {
        return [
          issue(
            join(path, discriminant),
            'union/unknown_variant',
            `"${tag}" is not one of: ${[...byTag.keys()].join(', ')}`,
          ),
        ];
      }
      return member.check(input, path);
    },
  };
};

/**
 * Adds a rule the type system alone cannot express. `expressedInJsonSchema`
 * must be stated honestly: it is what the agreement test trusts.
 */
export const refine = <T>(
  inner: Validator<T>,
  rule: {
    readonly code: string;
    readonly message: string;
    readonly expressedInJsonSchema: boolean;
    readonly schema?: JsonSchema;
    predicate(value: T): boolean;
  },
): Validator<T> => {
  const schema: JsonSchema = rule.schema === undefined ? inner.schema : { ...inner.schema, ...rule.schema };
  return {
    kind: `${inner.kind}+refine(${rule.code})`,
    schema,
    fullyExpressedInJsonSchema: inner.fullyExpressedInJsonSchema && rule.expressedInJsonSchema,
    check(input, path) {
      const issues = inner.check(input, path);
      if (issues.length > 0) return issues;
      // Safe: inner.check passed, so `input` conforms to T.
      return rule.predicate(input as T) ? NO_ISSUES : [issue(path, rule.code, rule.message)];
    },
  };
};

/** Like `refine`, but the rule may report several issues with their own paths. */
export const inspect = <T>(
  inner: Validator<T>,
  rule: {
    readonly expressedInJsonSchema: boolean;
    readonly schema?: JsonSchema;
    run(value: T, path: string): readonly Issue[];
  },
): Validator<T> => {
  const schema: JsonSchema = rule.schema === undefined ? inner.schema : { ...inner.schema, ...rule.schema };
  return {
    kind: `${inner.kind}+inspect`,
    schema,
    fullyExpressedInJsonSchema: inner.fullyExpressedInJsonSchema && rule.expressedInJsonSchema,
    check(input, path) {
      const issues = inner.check(input, path);
      if (issues.length > 0) return issues;
      return rule.run(input as T, path);
    },
  };
};

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

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

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const SCHEMA_ID_BASE = 'https://contracts.cedrus.life/v0';

export const schemaFileName = (meta: ContractMeta): string =>
  `${meta.name.replace(/\./g, '-')}.v${meta.version}.schema.json`;

export const defineContract = <T>(meta: ContractMeta, validator: Validator<T>): Contract<T> => {
  const jsonSchema: JsonSchema = {
    $schema: JSON_SCHEMA_DIALECT,
    $id: `${SCHEMA_ID_BASE}/${schemaFileName(meta)}`,
    title: meta.title,
    description: meta.description,
    'x-cedrus-contract': meta.name,
    'x-cedrus-version': meta.version,
    'x-cedrus-sources': meta.sources.map((s) => s),
    'x-cedrus-fully-expressed': validator.fullyExpressedInJsonSchema,
    ...validator.schema,
  };

  return {
    ...meta,
    validator,
    jsonSchema,
    safeParse(input: unknown): CheckResult<T> {
      const issues = validator.check(input, '');
      if (issues.length === 0) return { ok: true, value: input as T };
      return { ok: false, issues };
    },
    parse(input: unknown): T {
      const issues = validator.check(input, '');
      if (issues.length > 0) throw new ContractViolation(meta.name, issues);
      return input as T;
    },
    is(input: unknown): input is T {
      return validator.check(input, '').length === 0;
    },
  };
};

// ---------------------------------------------------------------------------
// Traversal helper, used by the deep guards
// ---------------------------------------------------------------------------

export interface VisitedNode {
  readonly path: string;
  readonly key: string | null;
  readonly value: unknown;
}

/** Depth-first walk over an arbitrary payload. Used by the forbidden-key guards. */
export const walk = (input: unknown, path: string, visit: (node: VisitedNode) => void): void => {
  visit({ path, key: null, value: input });
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i += 1) {
      walk(input[i], index(path, i), visit);
    }
    return;
  }
  if (typeof input === 'object' && input !== null) {
    const record = input as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const childPath = join(path, key);
      visit({ path: childPath, key, value: record[key] });
      walk(record[key], childPath, visit);
    }
  }
};

/**
 * Builds a case-insensitive ECMA-262 pattern for a literal word with word-ish
 * boundaries. JSON Schema has no `i` flag, so case insensitivity has to be
 * written into the character classes for the schema and the runtime to agree.
 */
export const caseInsensitiveWordPattern = (word: string): string => {
  const body = [...word]
    .map((ch) => {
      if (ch === ' ') return '\\s+';
      const lower = ch.toLowerCase();
      const upper = ch.toUpperCase();
      if (lower === upper) return lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `[${lower}${upper}]`;
    })
    .join('');
  return `(^|[^A-Za-z])${body}([^A-Za-z]|$)`;
};

/** `not: { pattern }` for every word in the list, as one JSON Schema fragment. */
export const notAnyOfPatterns = (words: readonly string[]): JsonSchema => ({
  not: {
    anyOf: words.map((w) => ({ pattern: caseInsensitiveWordPattern(w) })),
  },
});

export const matchesAnyWord = (text: string, words: readonly string[]): string | null => {
  for (const word of words) {
    if (new RegExp(caseInsensitiveWordPattern(word)).test(text)) return word;
  }
  return null;
};
