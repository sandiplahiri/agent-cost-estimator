# Agent suite token cost estimator

## Purpose

Help AI architects budget proposed collections of one to hundreds of agents and explain expected LLM spending to customers before the agents exist. The primary result is the monthly cost of the entire agent suite, with traceable assumptions and explicit scenarios.

This brief records the discovery interview. Confirmed requirements are distinguished from proposed implementation defaults. It does not claim that the application has been implemented.

**Later product decision (2026-10-01):** New inventory rows require users per agent per day and average invocations per user per agent per day. Total monthly invocations per agent is calculated and read-only. This supersedes the manual monthly entry described in the original discovery requirements below. Existing saved manual rows remain available as labeled legacy data until converted.

**Follow-up decision:** Also derive total monthly invocations for all agents in each inventory group and roll them up by simple, medium, and high (complex) category. Group and category totals are read-only.

**Follow-up decision:** Show total input-plus-output token consumption for each category per month and as an average per day over the 30-day planning month. Use Expected-scenario execution assumptions and count cached input and billable reasoning within their existing input/output categories.

**Follow-up decision:** Show the Expected-scenario monthly LLM cost for each category as a token-type calculation. Separate uncached input, cached reads, cache writes, and output (including billable reasoning), and show the selected per-million rate for each model/tier. Category cost totals must reconcile to the suite's Expected LLM total; missing pricing remains visibly incomplete.

**Follow-up decision:** For each category, show each token type's average tokens and LLM cost per day alongside monthly tokens and cost. Daily amounts divide unrounded Expected-scenario monthly values by 30 planning days; mixed-model rates remain inspectable separately.

**Follow-up decision:** Add a visible Expected-scenario monthly summary for simple, medium, and high categories and the entire suite. Each row shows input and output token counts, input and output LLM costs, and their totals. Input cost includes uncached input, cached reads, and cache writes; incomplete costs remain labeled.

**Follow-up decision:** Model agent-to-agent work as explicit invocation links. A link records trigger probability and child invocations per trigger. A linked child uses derived volume in place of its entered direct volume; existing direct inputs are retained for recovery. Reject unbounded cycles. Keep normal model-call cycles and retries separate from child-agent invocations.

## Confirmed requirements

- Run as a local web application initially.
- Focus on detailed LLM spending; allow separate additional cost items.
- Support major model providers.
- Produce an Excel deliverable. No markup or selling-price calculation.
- Support low, expected, and high scenarios with explicit parameter changes.
- Accept monthly invocation counts entered manually for each agent.
- Provide quick entry using total agent count, counts assigned to simple/medium/high complexity, and monthly invocations per agent within each group.
- Allow individual overrides and spreadsheet-based agent definitions.
- Define complexity using concrete execution behavior, with editable model choices and execution parameters.
- Start with aggregate execution assumptions; support optional detailed workflows for expensive or uncertain portions.
- Provide a reset-all-parameters feature.
- Measuring live agents is a future feature.
- Business-volume mapping is optional; it must not be required for an estimate.

## Proposed initial experience

1. Create a named estimate and enter the total number of agents, or import a spreadsheet.
2. Distribute agents across complexity groups. Group counts must sum to the total.
3. Select a provider/model and monthly invocations per agent for each group.
4. Review editable execution assumptions and optionally customize individual agents.
5. Compare low, expected, and high scenarios and inspect what changed.
6. Review suite totals and cost contributors, add separate cost items, and export Excel.

Proposed conveniences: local persistence, no account requirement, and reusable saved estimates. Pricing refresh needs internet access; saved pricing snapshots should permit reproducible offline calculations. Ordinary budgeting should not require provider credentials or paid model calls.

## Proposed starter profiles

These values are illustrative planning assumptions, not measured industry benchmarks. The user requested concrete profiles; the precise numerical defaults remain proposed.

| Parameter | Simple | Medium | High |
| --- | --- | --- | --- |
| Typical execution | Direct classification, extraction, short response | Retrieval/tool use and synthesis | Iterative investigation, planning, revision |
| Suggested model tier | Economy | Balanced | Most capable |
| Model calls per invocation, excluding retries | 1 | 4 | 10 |
| Average input tokens per model call | 2,000 | 6,000 | 15,000 |
| Average output tokens per model call | 500 | 1,000 | 2,000 |
| Additional model-call attempts from retries | 2% | 5% | 10% |
| Assumed prompt-cache savings | None | None | None |

Tiers are suggestions, not model identities. Every priced group must resolve to a specific provider/model and pricing record. Model changes preserve execution assumptions unless the architect explicitly edits them. Workload volume remains independent of complexity.

Input includes instructions, messages/history, retrieval content, tool definitions, and tool results actually included in each call. Aggregate averages represent context growth across the invocation. Tool/revision cycles belong in the normal call count, not the retry rate.

Output estimates must include billable reasoning where applicable. If reasoning is entered separately, normalize it using the provider's billing semantics and never add it twice to an output total that already includes it.

The additional-attempt rate means expected extra attempts divided by baseline model calls. It is not a failure probability or retry limit. Aggregate mode assumes extra attempts have the same average token usage as ordinary calls. Detailed mode can express different retry sizes, limits, and fallback models.

## Calculation and accounting

For a group with a single model and uniform token pricing:

```text
monthly_invocations = agent_count * monthly_invocations_per_agent
monthly_calls = monthly_invocations * calls_per_invocation * (1 + additional_attempt_rate)
monthly_input_tokens = monthly_calls * average_input_tokens_per_call
monthly_output_tokens = monthly_calls * average_output_tokens_per_call
monthly_llm_cost = (monthly_input_tokens * input_price_per_million
                 + monthly_output_tokens * output_price_per_million) / 1_000_000
suite_llm_cost = sum(group_and_individual_llm_costs)
```

Use more specific calculations when provider pricing requires cached reads/writes, context-length tiers, batch rates, or other billable categories. Evaluate per-request pricing thresholds before multiplying by monthly volume. Do not silently apply the simple formula to unsupported pricing schemes.

Manual invocation counts are proposed to include calls from all sources, including other agents. A parent's model-call count covers only the parent's own calls. In detailed mode, each agent's volume is either manually supplied or explicitly derived from callers, never both. Expanding a group into individual agents or replacing aggregate assumptions with a workflow must replace the corresponding contribution, not add a duplicate.

Model unknown prices as missing, never zero. Show incomplete totals as incomplete. Use full calculation precision internally and round for display/export presentation.

Optional business mapping:

```text
monthly_agent_invocations = business_events_per_month
                          * participation_rate
                          * invocations_per_participating_event
```

Architects supply these mappings explicitly. The app does not infer business logic from a domain label.

## Proposed scenarios

Every estimate has an expected baseline and low/high scenario overrides. Show both the effective values and differences from the baseline. These are planning scenarios, not statistical confidence intervals.

To initialize illustrative scenarios, preserve agent counts, selected models, monthly invocation volumes, and retry rates. Set low-scenario input/output tokens per call to 75% of baseline and high-scenario input/output tokens per call to 150%. Label these as editable starter assumptions, not calibrated bounds.

Architects may additionally change invocation volumes, call counts, models, retries, caching assumptions, and applicable additional costs. Expected call counts may be fractional averages. Token-size changes alone do not guarantee low/high cost ordering after model or pricing-tier changes; flag inconsistent scenario ordering for review.

## Providers and LiteLLM

Target OpenAI, Anthropic, Google Gemini/Vertex AI, Azure OpenAI, AWS Bedrock, Mistral, Cohere, DeepSeek, and other providers represented in the available catalog. Verify actual model/rate coverage during implementation; provider support does not imply complete pricing coverage for every offering.

Keep provider, model, and any price-relevant deployment/region/service tier distinct. Permit custom rate records for missing models and negotiated prices, and retain their provenance.

LiteLLM is a proposed integration and pricing source, not the workload prediction engine. Its Python library provides token counting, cost helpers, and a model pricing catalog. Its full proxy is unnecessary for the initial manual-budgeting application.

The app must own agent/group accounting, scenario calculations, execution assumptions, saved price snapshots, and Excel exports. Put LiteLLM behind a small adapter so provider-specific pricing or replacement data sources can be supported.

LiteLLM documents tokenizer fallbacks and a community-maintained pricing catalog. Label token counts appropriately, display pricing source and retrieval date, preserve the snapshot used by an estimate, and support explicit overrides. Refreshing prices should be an explicit action that reports its impact on saved estimates. A retrieval date is not necessarily a provider price effective date.

Sources reviewed during discovery:

- https://docs.litellm.ai/docs/
- https://docs.litellm.ai/docs/completion/token_usage

## Spreadsheet import and Excel export

Provide a downloadable import template. Proposed fields: agent/group name, optional domain/use case, agent count, complexity profile, monthly invocations per agent, provider/model, and optional execution overrides. Named individual rows have count one. Imported group rows and individual exceptions must have explicit ownership to avoid duplication.

Validate imports with row/column-specific errors and a preview before applying changes. Exported user text must remain literal text rather than accidentally becoming Excel formulas.

Proposed workbook sheets:

- Summary: monthly scenario totals, annualized totals at unchanged monthly usage, and additional costs shown separately.
- Agents: group/agent counts, invocation volumes, effective assumptions, token totals, and costs.
- Scenarios: explicit overrides and effective parameter values.
- Profiles: starter profiles and customized defaults.
- Pricing: provider/model rates, source, retrieval date, and overrides.
- Additional costs: named cost items with units, quantities, and frequencies.

Include editable inputs and Excel formulas for supported calculations so the estimate is inspectable and repeatable. Any pricing logic not reproduced in formulas must be clearly identified with its inputs and computed result. Export the same frozen assumptions and prices used in the displayed estimate.

## Reset behavior

Proposed behavior: reset restores bundled profile values and offers an explicit choice to clear individual/scenario parameter overrides. Preview the affected fields and offer undo. Preserve names, agent counts, monthly invocation volumes, custom pricing, and additional cost items by default. Label reset scope clearly rather than conflating parameter reset with deleting an estimate.

## Delivery and verification

Technology choices remain implementation decisions; a local Python backend is a natural fit for LiteLLM. No live execution gateway, authentication system, or cloud deployment is required initially.

Follow AGENTS.md: favor end-to-end verification and produce repeatable artifacts. Before implementation of isolated calculation logic, enumerate failure modes. Do not add unit tests after writing code or create tests that merely mirror the implementation.

Meaningful acceptance journeys include creating a suite estimate, changing a model/profile/scenario and observing corresponding totals, applying individual overrides without duplicate counts, importing a spreadsheet, handling missing pricing visibly, resetting parameters, reopening a saved estimate with frozen prices, and exporting a workbook that reconciles with the app.

Retain a sample input workbook, exported scenario workbook, and end-to-end run report as verifiable artifacts when the application is implemented.
