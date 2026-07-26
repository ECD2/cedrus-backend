# FLAGS — Station 3 (onboarding self-name) → shared test battery

Branch: `fix/onboarding-self-name`

## Test-bundle registration (shared file — NOT edited by this station)

A new dependency-free suite was added: `test/self-name.test.mjs`. It imports only
`src/pipeline/selfName.js` (pure logic, no Supabase/OpenAI/Twilio), so it runs
under plain `node` or `bun`.

**Register it in `test/run-all.sh`** by adding these three lines. Suggested
placement: right after the `=== Priority 3 — web search ===` block (i.e. after
the `$RUNNER test/search.test.mjs` line), so it sits with the other
deterministic, dependency-free `$RUNNER` suites:

```sh

echo "=== Onboarding — self-name capture (Station 3) ==="
$RUNNER test/self-name.test.mjs
```

`$RUNNER` resolves to bun on this machine (falls back to node/jsc), matching the
safety/voice/search suites above it.

## Standalone validation (already run on this branch)

```
node test/self-name.test.mjs        # ALL SELF-NAME TESTS PASSED (46 assertions)
node --check src/pipeline/selfName.js
node --check src/pipeline/index.js
```

## No other shared-file changes

- No route mounts. `src/pipeline/selfName.js` is imported only by
  `src/pipeline/index.js` (both owned by this station); nothing to mount in
  `src/index.js`.
- `test/run-tests.sh`, `package.json`, and every safety module are untouched.
