# WS-A → WS-B flags (fix/stability-security)

Cross-file needs WS-A found but must not implement, because they live in files
WS-B owns (`src/pipeline/05_understand.js`, `06_resolveEntities.js`,
`07_persist.js`, and the safety-detection layer). WS-A only prepared the
logging lane; it implemented no crisis/safety detection.

---

## B-1 (ACTION REQUIRED — small, one line each): thread `user.id` into the two people-service calls in `07_persist.js`

WS-A hardened `src/services/people.js` so **every write is scoped by `user_id`**
(item 3, the cross-tenant-write backstop). The write functions now require the
owning `userId` as their **first argument**:

- `people.rename(userId, personId, name)`  *(was `rename(personId, name)`)*
- `people.setRelationship(userId, personId, relationship)`  *(was `setRelationship(personId, relationship)`)*
- `people.markNudged(userId, personId)`  *(was `markNudged(personId)` — WS-A already updated the one caller it owns, `jobs/dailySweeps.js`)*

`07_persist.js` calls the first two with the **old** signature (it has `user.id`
in scope already):

```js
// src/pipeline/07_persist.js
await people.rename(personId, p.corrected_name);              // ~line 34  → rename(user.id, personId, p.corrected_name)
await people.setRelationship(personId, factValue.slice(0,100)); // ~line 70 → setRelationship(user.id, personId, factValue.slice(0,100))
```

**Interim behavior (safe, not silent-corrupting):** with the old signature the
functions treat the wrong argument as `userId`, so the `(user_id, person_id)`
predicate matches zero rows and the write is a **caught no-op**. Nothing is
corrupted and the underlying facts still persist (they’re written by
`memory.addFact` earlier in the same block). Only two *denormalized*
enhancements degrade until this is fixed: **name-correction persistence** and
the **`people.relationship` column sync**. Please make the two one-line edits.

## B-2 (RECOMMENDED — the marquee cross-tenant finding): assert ownership in `06_resolveEntities.js`

`06_resolveEntities.js` trusts a **model-supplied `person_id`** for
existing/self/ambiguous resolution with no ownership check
(CURRENT_SECURITY_POSTURE_AUDIT §A5, weakness #1). The service-role client
bypasses RLS, so a hallucinated or injected foreign UUID can reach another
tenant’s rows. WS-A’s people-service scoping is the **backstop**, but the
authoritative fix is to verify, in resolve, that any `person_id` you accept
`.eq('user_id', user.id)` before it flows into `resolved.personByMention`.
Recommended: fetch/confirm the person under `user.id`; drop the mention if it
isn’t owned.

## B-3 (READY FOR YOU): the logging lane for safety/crisis events (safety spec §7)

WS-A built the `sensitivity` lane into `src/utils/logger.js` as requested. Use it
to log that a Category A/B/C/D signal fired **without logging its content**:

```js
logger.event('safety.category_fired', {
  sensitivity: 'restricted',   // ← elevated-restriction tier
  category: 'A',               // low-cardinality, safe
  user_ref: 'u_' + user.id,    // pseudonymous, never a phone
});
```

When `sensitivity: 'restricted'`, the logger emits the event name + structural
fields (category, user_ref, correlation_id, …) and **drops `message` and
`meta` entirely** — the disclosure never reaches a log line. This is verified by
`test/logger.test.js` (“sensitivity lane keeps the event, drops the content”).
Notes:
- Don’t put disclosure text in `message`/`meta` and rely on the drop as the only
  guard; keep it out at the call site too.
- This is only the *logging* lane. WS-A implemented **no** detection, no
  response templates, no suppression window — all Priority-0 WS-B work.
- Retention/access policy for these events is still open for Emil + legal
  (safety spec §8); the lane just makes the distinction expressible today.
