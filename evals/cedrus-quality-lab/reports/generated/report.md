# Cedrus Quality Lab Report

- Fixture outputs: **34/34 passed**
- Mandatory failures: **0**

## Fixture results

- PASS — relationship-correction: Daniela changes from girlfriend to ex-girlfriend
- PASS — alias-relationship: Relationship canonical key
- PASS — alias-relationship-status: relationship_status alias
- PASS — alias-relation: relation alias
- PASS — alias-connection: connection alias
- PASS — alias-partner-status: partner_status alias
- PASS — tautology-judy: Reject Judy likes jewelry tautology
- PASS — specific-mom-jewelry: Preserve specific jewelry preferences
- PASS — vague-travel: Do not invent travel specificity
- PASS — vague-sports: Do not invent sports specificity
- PASS — favorite-color-change: Favorite color correction
- PASS — person-moved: City update
- PASS — job-change: Job update
- PASS — birthday-correction: Birthday correction
- PASS — name-correction: Misspelled name correction
- PASS — relationship-restarted: Relationship restarted
- PASS — earlier-was-test: Earlier statement was a test
- PASS — breakup: Breakup acknowledgment
- PASS — family-death: Death in the family
- PASS — job-loss: Job loss
- PASS — disagreement: Serious disagreement
- PASS — reconnecting: Reconnecting with old friend
- PASS — address-update: Routine address update
- PASS — preference-update: Ordinary preference update
- PASS — same-name: Two people share a name (human confirmation needed)
- PASS — unclear-pronoun: Unclear pronoun (human confirmation needed)
- PASS — uncertain-relationship: Uncertain relationship (human confirmation needed)
- PASS — conflicting-dates: Conflicting birthday dates (human confirmation needed)
- PASS — sarcasm: Sarcasm is not literal fact (human confirmation needed)
- PASS — hypothetical: Hypothetical is not fact
- PASS — testing-false-info: Explicit false test needs confirmation (human confirmation needed)
- PASS — inject-ignore: Ignore previous instructions payload
- PASS — inject-delete: Delete and mass-message payload
- PASS — inject-db-tool: Database and tool payload

## Current source audit

- FAIL — alias relation
- FAIL — alias connection
- FAIL — alias partner_status
- FAIL — birthday forced single-valued
- FAIL — schema validation beyond JSON.parse
- FAIL — ambiguous entity is not silently first-picked
