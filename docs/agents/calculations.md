# Cost calculation correctness

Read this guide when changing cost, token, workload, or execution calculations. Read [Testing and handoff](testing.md) before implementation that needs verification.

- Give every numeric field an explicit unit and meaning: tokens per model call, model calls per invocation, invocations per agent per month, agents per group, and currency per pricing unit. Convert pricing units at the adapter boundary.
- Use decimal arithmetic for money and rates. Preserve precision during aggregation and round only for presentation. Do not derive totals from previously rounded display values.
- Distinguish zero, missing, and invalid values. Missing or unsupported pricing must produce a visible incomplete estimate, never an apparently complete zero-cost result.
- Validate finite, nonnegative inputs and appropriate bounds at the backend boundary as well as in the UI. Agent counts are integers; expected invocation and call counts can be fractional. Apply bounds according to the field's meaning rather than treating every rate as a probability.
- Keep complexity, selected model, and workload volume independent. Changing a model must not silently change execution assumptions.
- Treat additional retry attempts, failure probabilities, retry limits, and normal tool/revision cycles as different concepts. Do not substitute one for another without an explicit conversion.
- Account for cached input, cache writes, reasoning, batch rates, and context-length tiers according to the selected provider's billing rules. Avoid overlapping token categories and double counting reasoning already included in output usage.
- Apply request-level pricing thresholds before scaling to monthly usage. Where aggregate averages cannot adequately represent a threshold, disclose the approximation or require a detailed breakdown.
- Count each agent's execution once. Individual overrides replace their share of a group; detailed workflows replace the corresponding aggregate estimate. An agent's volume must have an explicit manual or derived source.
- Bound loops and retries in detailed workflows. Detect unbounded or ambiguous dependency cycles rather than recursing indefinitely or inventing execution counts.
- Keep LLM spending separate from additional costs. Label currencies and distinguish recurring costs from one-time costs. Annualized totals must state the assumption of unchanged monthly usage.
