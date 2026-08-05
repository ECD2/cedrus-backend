/**
 * Every contract in the package, in one list.
 *
 * This is what the JSON Schema generator walks, what the agreement test walks,
 * and what a consumer enumerates to discover what exists. A contract that is not
 * in this list has no published JSON Schema and no agreement test, which is why
 * `test/registry.test.ts` asserts that every exported contract is here.
 */
import type { Contract } from './schema/core.ts';
/**
 * Typed as `Contract<never>` deliberately: the registry is for enumeration and
 * validation, not for producing typed values. A caller who wants a typed parse
 * imports the specific contract.
 */
export declare const CONTRACTS: readonly Contract<never>[];
export type ContractName = (typeof CONTRACTS)[number]['name'];
export declare const contractByName: (name: string) => Contract<never> | undefined;
