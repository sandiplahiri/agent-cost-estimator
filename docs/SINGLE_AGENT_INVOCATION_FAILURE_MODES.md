# One agent invocation per step

Recorded before implementation, 2026-10-05. An executed agent step selects one named individual and invokes it once. Additional invocations require additional steps. Model-call counts and retries remain independent.

- Reject per-option multiplicity and scenario invocation-count overrides at the backend and spreadsheet boundary; never silently drop or accept a repetition input.
- Reject duplicate individual targets within one step. The same individual can be targeted in several steps or by several callers; all contributions sum once.
- Optional execution and target selection remain separate. Every base and scenario target distribution totals exactly 1.0, even when execution probability is zero.
- Removing repetition controls must not remove model-call counts/retries, lose drafts after invalid imports, or change stable agent identities.
- Independent fixture: 300 caller invocations, own model A at USD 2/M input, 1,000 input tokens/call, no output/retries. A delegation step runs with probability 0.5 and chooses Alice (A) with probability 0.8 or Bob (B at USD 10/M) with probability 0.2. Alice receives 120 invocations and Bob 30; total cost is USD 1.14, with USD 0.0036 per executed delegation and USD 0.0038 loaded caller cost. Copying the delegation into another separate step doubles child contributions to 240/60 and yields USD 1.68, with USD 0.0056 loaded caller cost.
- Save/reopen and spreadsheet reimport must reproduce both steps and the USD 1.68 total. Recalculate exported Summary and each Agent links contribution with HyperFormula. An import with an unsupported repetition column must be rejected without changing the USD 1.68 draft.

Repeatable artifacts: `artifacts/single-agent-invocation/input.json`, `saved.json`, `budget.xlsx`, `invalid-import.xlsx`, and `verification.json`, plus the full E2E run report.
