# Chat-import hardening — found / fixed / deferred (feat/import-hardening)

Adversarial + messy-input hardening of the ChatGPT/Claude memory-import path.
Governed by `cedrus-planning/.../session8-security-abuse/CHAT_IMPORT_SECURITY.md`
(threats I-01..I-19, requirements CIS-01..CIS-18) and `night-fleet-2/NF2-IMPORT.md`
(propose-then-confirm is law; imported content is UNTRUSTED DATA, never
instructions; historical never clobbers present).

Scope of this worktree: `src/parsers/chatExport.js`, `src/services/chatImport.js`,
their tests, and this doc. `memory.js` (the canonical fact registry), safety,
auth, send paths, insights, and brief files were **not** touched — registry
needs are flagged in §5 instead. No push / deploy / migration was performed.

Method: build the corpus first, let it drive the fixes. Two new suites:

| Suite | Runtime | Cases | What it pins |
|-------|---------|-------|--------------|
| `test/import-hardening.test.mjs` | node **or** bun (dependency-free) | 34 | parser crash-safety, size caps / bombs, injection-as-data, secrets/PII, unicode/timestamps |
| `test/import-dedup.test.mjs` | bun (injected deps, no network) | 11 | D5 dedup edge, idempotent re-import, duplicate-conversation dedup |

Both are wired into `test/run-import-tests.sh` and run inside the full battery.

---

## 1. Found and fixed

### H1 — BOM-prefixed JSON export wrongly rejected (parser correctness)
`sniffFormat()` deliberately skips a leading UTF-8 BOM to detect a bare JSON
export (`chatExport.js` line ~66), but `parseChatExport()` then fed the
BOM-prefixed bytes straight to `JSON.parse`, which rejects `U+FEFF` → the file
failed as `invalid_json` / `invalid_file`. A legitimately BOM'd bare-JSON
upload (common when a file is re-saved by a Windows editor) was therefore
turned away even though the sniffer accepted it — the sniffer and the parser
disagreed.
**Fix:** strip a single leading BOM from the decoded text before `JSON.parse`
(`parseChatExport`). Covers both bare and zip-extracted JSON. Fail-closed
posture unchanged; only a genuinely-valid-but-BOM'd file now parses.
**Proof:** `import-hardening` → "sniffFormat tolerates a UTF-8 BOM".

### H2 — D5: dedup / single-valued guard blind to legacy non-canonical keys
(`docs/EXTRACTION_AUDIT.md` D5.) `confirmImport()` built its `currentByKey`
map, and `runExtraction()` built its `already_known` set, from the **raw**
stored `fact_key`, while proposed facts are already canonical
(`harvestBatch` → `canonicalFactKey`). A legacy row stored under a
non-canonical alias — e.g. `employer`, which folds to the single-valued
`job` — was invisible to the guard. Consequences:
- **Idempotency miss:** re-importing `job = Stripe` for a person who already
  has `employer = Stripe` wrote a *second* row (`job = Stripe`) → duplicate.
- **Single-valued fork:** importing `job = Google` for that same person wrote
  a second current `job` row alongside the legacy `employer = Stripe` →
  exactly the fork the registry work set out to prevent.

**Fix:** canonicalize the stored key at **both read sites** —
`canonicalFactKey(r.fact_key)` when building `currentByKey` (the durable commit
guard) and the `already_known` `have` set (the review-UI pre-mark). Proposed
keys are already canonical, so both sides now agree and legacy rows are seen.
`memory.js` is untouched — the fix reads *through* its `canonicalFactKey()` at
the call sites, which is precisely what EXTRACTION_AUDIT D5 recommended
("not patched … to avoid re-implementing canonicalization at the read site").
**Proof:** `import-dedup` → the three "D5:" checks fail on the pre-fix code and
pass after; the "guard does NOT over-skip" and "idempotent re-import" checks
guard against regressions in the other direction.

### H3 — Duplicate / near-duplicate conversations wasted budget and double-proposed
`buildBatches()` scored and packed every message, so a re-pasted conversation
or a duplicated export (N identical copies of a message) spent N× the token
budget and pushed the model to propose the same fact repeatedly. There was no
message-level dedup before batching.
**Fix:** before scoring, dedup on a whitespace-collapsed, lowercased identity
key, keeping the first original spelling (so evidence quotes stay faithful).
Identical and whitespace-only-different messages collapse to one; genuinely
distinct messages are untouched.
**Proof:** `import-dedup` → "duplicate / near-duplicate conversations are
collapsed" and "genuinely distinct messages are all kept".

---

## 2. Verified safe — corpus asserts it, no code change needed

The bulk of the corpus **characterizes** existing robustness so it can never
silently regress. The parser is genuinely crash-safe: every hostile input below
fails closed with a typed `ImportParseError` (mapped to a 4xx + public copy) —
**never** a raw `TypeError`/`RangeError` that would 500-leak a stack trace.

- **Malformed archives:** truncated zips at every cut length, corrupt central
  directory, PK-magic-only, absurd entry counts, zip64 sentinels, corrupt
  deflate streams, encrypted entries → `invalid_zip` / `encrypted_zip`, no crash.
- **Pathological JSON:** truncated, `NaN`/`Infinity`, trailing commas,
  200k-deep nesting (V8's iterative `JSON.parse` does not stack-overflow),
  huge duplicate-key objects (last-wins, bounded), 200k-element scalar arrays
  (scanned in <30ms), non-conversation shapes → `invalid_json` /
  `unsupported_format`, no crash.
- **Prototype pollution:** `__proto__` keys planted in mapping/root do **not**
  pollute `Object.prototype` (own-property semantics; no proto walk).
- **Size caps / decompression bombs:** high-ratio zeros bomb, stored oversize
  entry, and a zip that **lies** about its uncompressed size all die at the
  real inflate ceiling (`zlib` `ERR_BUFFER_TOO_LARGE` → `file_too_large`);
  bare JSON over cap rejected before parse; per-message char cap and the
  `MAX_MESSAGES` flood cap (`truncated=true`) hold.
- **Injection is DATA (C-11, load-bearing):** prompt-injection, fake system
  prompts, and tool-invocation lures planted in assistant / system / tool turns
  are **absent** from extraction (ChatGPT `role` and Claude `sender`, incl.
  `content[]` assistant turns). User-turn instruction text survives only as
  inert content (the user's own words, neutralized downstream, never obeyed).
- **Secrets / PII (C-09):** every `containsSecret` family (password/passcode,
  OTP/verification, API/secret key, bearer, routing/account, SSN, PEM private
  key, Luhn cards) is caught and dropped by the six-theme gate; ordinary
  numbers (phone, address, score, order #) are **not** over-redacted.
- **Unicode / timestamps:** emoji, RTL scripts, combining marks, and ZWJ emoji
  sequences (U+200D preserved — family emoji must not shatter) survive as data;
  ASCII C0 controls + DEL are stripped (tab/newline kept); timezone-less or
  garbage timestamps are inert (the parser never reads timestamps).

---

## 3. Propose-then-confirm contract — preserved byte-compatibly

The existing `test/import-parsers.test.mjs` (23) and `test/import.test.mjs`
(the full upload → extract → review → confirm integration suite) pass
**unmodified**. No existing test encoded a bug that needed changing. The one
in-corpus expectation I corrected was in a *new* test (`[]` is a sub-4-byte
buffer, so it is caught by the minimum-size guard as `unsupported_type`, not
`unsupported_format` — correct defensive behavior; a real export is never 2
bytes).

---

## 4. Deferred — noted, not fixed (out of scope or needs bigger change)

- **D-parse-on-request-path (C-07):** `parseChatExport` (incl. `JSON.parse`)
  runs synchronously inside `startImport`, which the route awaits, so a large
  export briefly blocks the event loop. Bounded by the declared caps (≤50MB
  upload / ≤100MB inflated JSON, CIS-06), but the spec prefers parsing "off the
  request path" in a worker. Moving it there is an architectural change to the
  job/route flow beyond this worktree's parser+service ownership. **Deferred.**
- **D-bidi-render (C-08):** Unicode bidi controls (RTL override, etc.) are kept
  as inert data at the parser layer — they cannot smuggle JSON structure, and
  stripping bidi/zero-width chars would break legitimate ZWJ emoji. Their
  spoofing risk is a **render-layer** concern: the preview must escape content
  and render as text, not HTML (a frontend responsibility per CIS-12). Flagged
  for the review-UI stream. **Deferred (not this layer).**
- **D-proposal-cardinality:** the number of proposed people/facts is bounded in
  practice by the 25-model-call cap and per-call output size, but there is no
  explicit hard cap on `groups` size in code. Low risk (the model output is
  ours, not attacker-controlled; the attacker controls input text, which is
  already scored/budgeted). **Deferred pending evidence of real blowup.**

---

## 5. Registry needs flagged for `memory.js` (do-not-touch here)

- The D5 read-through fix (§H2) is only as complete as the canonical registry:
  a legacy stored key folds correctly **iff** it is in `FACT_KEY_ALIASES` (or
  is already canonical). No **new** missing alias was discovered by this corpus
  — `employer → job` is already registered — but any future single-valued
  alias added for the SMS/web paths must also be added to
  `memory.js:FACT_KEY_ALIASES` for import dedup to see legacy rows under it.
  This is the same lockstep `docs/EXTRACTION_AUDIT.md` (F1–F3, D6) already
  tracks; no action required now, recorded for the registry owner.
- No change to `SINGLE_VALUED_KEYS` is needed for these fixes; the import
  "skip when a current value exists" rule already reads the shared set.

---

## 6. How to run / results

```
sh test/run-import-tests.sh     # the four import suites
sh test/run-all.sh              # full WS-B battery (needs bun)
node --check src/parsers/chatExport.js src/services/chatImport.js
```

- `import-parsers` 23 passed · `import-hardening` 34 passed ·
  `import` integration passed · `import-dedup` 11 passed.
- Full battery: **ALL BATTERY SUITES PASSED** (exit 0) — every unrelated suite
  (safety, voice, search, CORS, admin, web-api, N2 email, admin-auth,
  web-onboard, interests) green in the same run; no load flakiness observed.
