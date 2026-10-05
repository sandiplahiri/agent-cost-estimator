# Exclusive step actions: failure modes and independent outcomes

Recorded before implementation, 2026-10-05. Verification uses the actual local app and fixed synthetic USD prices, not provider benchmarks.

- Mixed or empty actions: reject applying, saving, and importing a step with no targets or both target types. A disabled step still needs a valid distribution.
- Invalid probability: missing, nonfinite, negative, above-one, or totals different from exactly 1 are invalid. Explicit zero is valid and produces no usage/cost. Do not normalize silently.
- Scenario pricing: a scenario-wide model override must price and identify every effective model option consistently; forcing model B gives $4.50/month in the 300-invocation acceptance fixture. Malformed action-list or target-ID types return validation errors rather than internal errors.
- Model pricing: a positive-weight model with missing prices produces an incomplete estimate; zero-weight missing pricing does not invalidate cost.
- Agent references: reject self, missing, external-suite, and cyclic targets. Child profiles remain independent of caller profiles.
- Selection versus execution: option probabilities sum to 1 even for an optional step; execution probability multiplies its expected action cost once.
- Workload: derive children from caller workload and option probabilities, replacing retained direct workload. Multiple callers sum; child execution is not charged again at its parent.
- Example fixture: 100 root invocations/month; model A costs $0.002/call and B $0.010/call (1,000 input tokens, no output or retries). Root model options A 0.8/B 0.2 cost $0.0036/invocation, $0.36/month. Root delegation step executes 0.5, choosing child A 0.7/child B 0.3: child volumes 35/15, costs $0.07/$0.15. Expected suite $0.58/month; root loaded cost $0.0058. Another 100-invocation root delegating to A at 1 adds $0.20/month; shared A volume 135 and suite $0.78/month.
- Persistence/import: invalid edits/imports retain the prior draft. Saved versioned distributions and frozen prices reproduce costs offline. Only the current exclusive-action schema is supported; unsupported schemas and actions are rejected without modifying the draft. No conversion or independent-link editor is needed.
- Copy/split: regenerate option IDs, remap step references, and preserve stable individual target identities, their probabilities, and workload when customizing a counted member. Targeted members receive all their assigned work; unselected members retain direct volume. Graph links project option lists, never a second execution definition.
- Excel: export effective options, execution probabilities, and loaded/direct costs. Existing supported formulas recalculate to $0.58, and graph/loaded values remain clearly labeled precomputed.

Acceptance artifacts: artifacts/step-actions/input.json, budget.xlsx, verification.json, and screenshots. The report records the command, fixture, independent totals, actual values, workbook recalculation, and failures.

Simplification acceptance: each explicit model step has a nonempty model distribution; each agent step has a nonempty same-suite target distribution. Optional execution scales these choices without weakening normalization. Model execution inputs belong only to model options. Graph links are projections, and splitting/copying edits the options directly. Preserve single-model bulk assumptions, child-volume recovery, scenarios, prices, and workbook reconciliation.
