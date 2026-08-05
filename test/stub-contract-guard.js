// Stub for src/services/contractGuard.js, for the concat rig only.
//
// WHY THIS FILE EXISTS. run-tests.sh builds each bundle by stripping `import`
// lines and concatenating the real sources. src/services/goals.js imports
// assertGoalContract, so without something declaring it here Bundle 19 dies with
// "assertGoalContract is not defined". The real guard cannot be concatenated:
// it imports the compiled contracts package (26 modules) and the logger, and
// Bundle 19's prelude (reliability-core.js) declares no logger at all — the trap
// CEDRUS.md II.5 records.
//
// The REAL guard is exercised for real, with real ESM imports and no stripping,
// by test/contracts-goals.test.mjs (registered in run-all.sh). That is where the
// flag-off and flag-on branches are proven. This file is scaffolding.
//
// IT IS A RECORDING STUB, NOT A NO-OP, ON PURPOSE. A silent no-op would let
// someone delete the guard call from addGoal and watch every suite stay green,
// which is precisely the "checked and fine vs never ran" disease of Lesson 7.
// goals.test.js asserts against the recorded calls, so Bundle 19 goes red if the
// call site disappears.
const contractGuardCalls = [];

function assertGoalContract(row, options) {
  contractGuardCalls.push({ row: row, options: options || {} });
  return { ok: true, enforcing: false };
}
