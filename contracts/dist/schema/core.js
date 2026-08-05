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
/**
 * Raised by `parse`. Carries the full issue list; never a single string, because
 * a caller fixing a payload needs every problem at once.
 */
export class ContractViolation extends Error {
    contract;
    issues;
    constructor(contract, issues) {
        const summary = issues.map((i) => `${i.path || '<root>'}: ${i.code}`).join('; ');
        super(`${contract} rejected the payload: ${summary}`);
        this.name = 'ContractViolation';
        this.contract = contract;
        this.issues = issues;
    }
}
export const issue = (path, code, message) => ({ path, code, message });
const join = (path, key) => (path === '' ? key : `${path}.${key}`);
const index = (path, i) => `${path}[${i}]`;
const NO_ISSUES = Object.freeze([]);
export const string = (options = {}) => {
    const schema = { type: 'string' };
    if (options.minLength !== undefined)
        schema['minLength'] = options.minLength;
    if (options.maxLength !== undefined)
        schema['maxLength'] = options.maxLength;
    if (options.pattern !== undefined)
        schema['pattern'] = options.pattern;
    if (options.format !== undefined)
        schema['format'] = options.format;
    if (options.description !== undefined)
        schema['description'] = options.description;
    const re = options.pattern === undefined ? null : new RegExp(options.pattern);
    return {
        kind: 'string',
        schema,
        fullyExpressedInJsonSchema: true,
        check(input, path) {
            if (typeof input !== 'string')
                return [issue(path, 'type/expected_string', 'expected a string')];
            const issues = [];
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
export const number = (options = {}) => {
    const schema = { type: options.integer === true ? 'integer' : 'number' };
    if (options.minimum !== undefined)
        schema['minimum'] = options.minimum;
    if (options.maximum !== undefined)
        schema['maximum'] = options.maximum;
    if (options.description !== undefined)
        schema['description'] = options.description;
    return {
        kind: 'number',
        schema,
        fullyExpressedInJsonSchema: true,
        check(input, path) {
            if (typeof input !== 'number' || Number.isNaN(input)) {
                return [issue(path, 'type/expected_number', 'expected a number')];
            }
            const issues = [];
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
export const integer = (options = {}) => number({ ...options, integer: true });
export const boolean = () => ({
    kind: 'boolean',
    schema: { type: 'boolean' },
    fullyExpressedInJsonSchema: true,
    check(input, path) {
        return typeof input === 'boolean' ? NO_ISSUES : [issue(path, 'type/expected_boolean', 'expected a boolean')];
    },
});
export const nullValue = () => ({
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
export const literal = (value) => ({
    kind: 'literal',
    schema: { const: value },
    fullyExpressedInJsonSchema: true,
    check(input, path) {
        return input === value
            ? NO_ISSUES
            : [issue(path, 'literal/mismatch', `expected the constant ${JSON.stringify(value)}`)];
    },
});
/** A closed set of string values. Closed sets are the main anti-drift device here. */
export const enumOf = (values, options = {}) => {
    const allowed = values.map((v) => v);
    const schema = { type: 'string', enum: allowed };
    if (options.description !== undefined)
        schema['description'] = options.description;
    const code = options.code ?? 'enum/not_allowed';
    const message = options.message ?? `expected one of: ${values.join(', ')}`;
    return {
        kind: 'enum',
        schema,
        fullyExpressedInJsonSchema: true,
        check(input, path) {
            if (typeof input !== 'string')
                return [issue(path, 'type/expected_string', 'expected a string')];
            return values.includes(input) ? NO_ISSUES : [issue(path, code, message)];
        },
    };
};
export const arrayOf = (item, options = {}) => {
    const schema = { type: 'array', items: item.schema };
    if (options.minItems !== undefined)
        schema['minItems'] = options.minItems;
    if (options.maxItems !== undefined)
        schema['maxItems'] = options.maxItems;
    if (options.description !== undefined)
        schema['description'] = options.description;
    return {
        kind: 'array',
        schema,
        fullyExpressedInJsonSchema: item.fullyExpressedInJsonSchema,
        check(input, path) {
            if (!Array.isArray(input))
                return [issue(path, 'type/expected_array', 'expected an array')];
            const issues = [];
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
export const jsonObject = (description) => {
    const schema = { type: 'object' };
    if (description !== undefined)
        schema['description'] = description;
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
/** Marks a field optional. Absent is allowed; present must still validate. */
export const optional = (inner) => ({
    ...inner,
    __cedrusOptional: true,
});
const isOptional = (v) => v.__cedrusOptional === true;
export const nullable = (inner) => ({
    kind: 'nullable',
    schema: { anyOf: [inner.schema, { type: 'null' }] },
    fullyExpressedInJsonSchema: inner.fullyExpressedInJsonSchema,
    check(input, path) {
        if (input === null)
            return NO_ISSUES;
        return inner.check(input, path);
    },
});
export const object = (shape, options = {}) => {
    const properties = {};
    const required = [];
    let fullyExpressed = true;
    for (const key of Object.keys(shape)) {
        const field = shape[key];
        if (field === undefined)
            continue;
        properties[key] = field.schema;
        if (!isOptional(field))
            required.push(key);
        if (!field.fullyExpressedInJsonSchema)
            fullyExpressed = false;
    }
    const schema = {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
    };
    if (options.description !== undefined)
        schema['description'] = options.description;
    return {
        kind: 'object',
        schema,
        fullyExpressedInJsonSchema: fullyExpressed,
        check(input, path) {
            if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                return [issue(path, 'type/expected_object', 'expected an object')];
            }
            const record = input;
            const issues = [];
            for (const key of Object.keys(shape)) {
                const field = shape[key];
                if (field === undefined)
                    continue;
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
export const discriminatedUnion = (discriminant, members) => {
    const byTag = new Map();
    let fullyExpressed = true;
    for (const member of members) {
        byTag.set(member.tag, member.validator);
        if (!member.validator.fullyExpressedInJsonSchema)
            fullyExpressed = false;
    }
    const schema = {
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
            const record = input;
            const tag = record[discriminant];
            if (typeof tag !== 'string') {
                return [issue(join(path, discriminant), 'union/missing_discriminant', `"${discriminant}" is required and must be a string`)];
            }
            const member = byTag.get(tag);
            if (member === undefined) {
                return [
                    issue(join(path, discriminant), 'union/unknown_variant', `"${tag}" is not one of: ${[...byTag.keys()].join(', ')}`),
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
export const refine = (inner, rule) => {
    const schema = rule.schema === undefined ? inner.schema : { ...inner.schema, ...rule.schema };
    return {
        kind: `${inner.kind}+refine(${rule.code})`,
        schema,
        fullyExpressedInJsonSchema: inner.fullyExpressedInJsonSchema && rule.expressedInJsonSchema,
        check(input, path) {
            const issues = inner.check(input, path);
            if (issues.length > 0)
                return issues;
            // Safe: inner.check passed, so `input` conforms to T.
            return rule.predicate(input) ? NO_ISSUES : [issue(path, rule.code, rule.message)];
        },
    };
};
/** Like `refine`, but the rule may report several issues with their own paths. */
export const inspect = (inner, rule) => {
    const schema = rule.schema === undefined ? inner.schema : { ...inner.schema, ...rule.schema };
    return {
        kind: `${inner.kind}+inspect`,
        schema,
        fullyExpressedInJsonSchema: inner.fullyExpressedInJsonSchema && rule.expressedInJsonSchema,
        check(input, path) {
            const issues = inner.check(input, path);
            if (issues.length > 0)
                return issues;
            return rule.run(input, path);
        },
    };
};
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const SCHEMA_ID_BASE = 'https://contracts.cedrus.life/v0';
export const schemaFileName = (meta) => `${meta.name.replace(/\./g, '-')}.v${meta.version}.schema.json`;
export const defineContract = (meta, validator) => {
    const jsonSchema = {
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
        safeParse(input) {
            const issues = validator.check(input, '');
            if (issues.length === 0)
                return { ok: true, value: input };
            return { ok: false, issues };
        },
        parse(input) {
            const issues = validator.check(input, '');
            if (issues.length > 0)
                throw new ContractViolation(meta.name, issues);
            return input;
        },
        is(input) {
            return validator.check(input, '').length === 0;
        },
    };
};
/** Depth-first walk over an arbitrary payload. Used by the forbidden-key guards. */
export const walk = (input, path, visit) => {
    visit({ path, key: null, value: input });
    if (Array.isArray(input)) {
        for (let i = 0; i < input.length; i += 1) {
            walk(input[i], index(path, i), visit);
        }
        return;
    }
    if (typeof input === 'object' && input !== null) {
        const record = input;
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
export const caseInsensitiveWordPattern = (word) => {
    const body = [...word]
        .map((ch) => {
        if (ch === ' ')
            return '\\s+';
        const lower = ch.toLowerCase();
        const upper = ch.toUpperCase();
        if (lower === upper)
            return lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return `[${lower}${upper}]`;
    })
        .join('');
    return `(^|[^A-Za-z])${body}([^A-Za-z]|$)`;
};
/** `not: { pattern }` for every word in the list, as one JSON Schema fragment. */
export const notAnyOfPatterns = (words) => ({
    not: {
        anyOf: words.map((w) => ({ pattern: caseInsensitiveWordPattern(w) })),
    },
});
export const matchesAnyWord = (text, words) => {
    for (const word of words) {
        if (new RegExp(caseInsensitiveWordPattern(word)).test(text))
            return word;
    }
    return null;
};
