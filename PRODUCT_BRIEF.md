# Agent suite token cost estimator

## Purpose

Help AI architects budget proposed collections of one to hundreds of agents and explain expected LLM spending to customers before the agents exist. The primary result is the monthly cost of the entire agent suite, with traceable assumptions and explicit scenarios.

This brief records the discovery interview. Confirmed requirements are distinguished from proposed implementation defaults. It does not claim that the application has been implemented.

**Later product decision (2026-10-01):** New inventory rows require users per agent per day and average invocations per user per agent per day. Total monthly invocations per agent is calculated and read-only. This supersedes the manual monthly entry described in the original discovery requirements below. Existing saved manual rows remain available as labeled legacy data until converted.

**Earlier follow-up decision, superseded for category agent counts on 2026-10-04:** Derive total monthly invocations for all agents in each inventory group and roll them up by simple, medium, and high (complex) category. Group totals remain read-only; profile reporting now allocates step usage rather than treating categories as disjoint agent groups.

**Follow-up decision:** Show total input-plus-output token consumption for each step complexity profile per month and as an average per day over the 30-day planning month. Use Expected-scenario execution assumptions and count cached input and billable reasoning within their existing input/output categories.

**Follow-up decision:** Show the Expected-scenario monthly LLM cost for each step complexity profile as a token-type calculation. Separate uncached input, cached reads, cache writes, and output (including billable reasoning), and show the selected per-million rate for each model/tier. Profile cost totals must reconcile to the suite's Expected LLM total; missing pricing remains visibly incomplete.

**Follow-up decision:** For each step complexity profile, show each token type's average tokens and LLM cost per day alongside monthly tokens and cost. Daily amounts divide unrounded Expected-scenario monthly values by 30 planning days; mixed-model rates remain inspectable separately.

**Follow-up decision:** Add a visible Expected-scenario monthly summary for simple, medium, high, and custom step profiles and the entire suite. Each row shows input and output token counts, input and output LLM costs, and their totals. Input cost includes uncached input, cached reads, and cache writes; incomplete costs remain labeled.

**Follow-up decision:** Model agent-to-agent work as explicit invocation links. A link records trigger probability and child invocations per trigger. A linked child uses derived volume in place of its entered direct volume; existing direct inputs are retained for recovery. Reject unbounded cycles. Keep normal model-call cycles and retries separate from child-agent invocations.

**Follow-up confirmed decision (2026-10-03), amended 2026-10-04:** Put graph creation and agent-to-agent work in a dedicated **Agent suite graph** view in the left navigation. Do not embed the graph panel in Dashboard. Dashboard remains the budget review view; both views use the same estimate, preserve unsaved edits when switching, and share save/export actions. The graph view provides an action to add an agent when the graph is empty.

**Follow-up confirmed decision (2026-10-04):** Rename the Suite planner navigation item to **Dashboard**. Remove the **Cost per completed use case** panel from Dashboard. Keep its calculation available to saved results and the Excel **Use cases** sheet; removing the panel does not change suite totals or agent inventory costs.

**Follow-up confirmed decision (2026-10-03), amended 2026-10-04:** Simple, medium, and high remain the predefined complexity profiles. Users may define additional profiles globally and assign them to steps. Each custom profile needs a unique name, including against predefined names. Custom profiles participate in the same step usage and cost summaries as the predefined profiles.

**Follow-up confirmed decision, amended 2026-10-04:** A complexity profile has no business use case. Business use cases are defined for individual agents, including each member of a counted group. Assigning or changing a step's profile does not set or change its agent's business use case.

**Follow-up confirmed decision (2026-10-04):** One agent invocation can complete a business use case through multiple steps. Each step can have its own model invocation and simple, medium, high, or custom complexity profile. A single agent invocation can therefore use several complexity profiles. The step's effective profile, model, and execution assumptions determine its cost; an agent-level profile is only an optional starting default for steps. Grouping agents by one complexity category is not a valid general accounting model. This supersedes the earlier requirements below to distribute all agents into complexity groups, sum agent counts by category, or assign a single category to each agent. Keep agent identity, use case, and workload separate from step complexity.

**Follow-up confirmed decision (2026-10-04):** Add **Agent inventory** to the left navigation. List each individual agent with its name, business use case summary, step count, distinct calling-agent count, distinct called-agent count, users per agent per day, and invocations per user per agent per day. Caller and callee counts are derived from links and read-only. Open one agent at a time to edit its name, use case, ordered steps and their model/profile assumptions, and direct daily workload inputs. Editing a member of a counted group must affect only that member; closing without applying must leave the group unchanged. Derived-volume agents may edit retained direct inputs for recovery, with a clear indication that incoming links still determine current volume.

**Follow-up confirmed decision (2026-10-04):** Remove the Agent inventory section from Dashboard. Keep the Monthly token and cost summary and the budget breakdowns there. Group editing, Quick setup, and spreadsheet/JSON import and template controls are available in the dedicated Agent inventory view.

**Follow-up confirmed decision (2026-10-04):** Remove the Simple, Medium, High (Complex), and custom profile overview cards and expandable token cost breakdowns from Dashboard. Keep the Monthly token and cost summary; its current suite-wide display is defined below. Detailed token types, daily quantities, model rates, and their calculations remain available in the exported Excel workbook.

**Follow-up confirmed decision (2026-10-04):** Display Dashboard's Monthly token and cost summary with Scenario as the first column and one consolidated suite row for Low, Expected, and High. Label the final column Total token cost. Use each scenario's actual unrounded tokens and priced components, including its workload, model, retry, cache, and context-tier assumptions; mark missing or incomplete totals. Include the matching Monthly scenario summary in Excel exports, alongside detailed Expected category breakdowns.

**Follow-up confirmed decision (2026-10-04):** Add Harness cost and Total cost to every Dashboard monthly scenario row and its Excel counterpart. Harness cost is the scenario's shared runtime charge. Total cost is the existing monthly suite amount, including token, tool, harness, and recurring additional costs. A known harness amount remains complete when model pricing is missing; workload-dependent harness fees are partial when their billed volume is missing. Fixed-only and disabled harness costs remain known.

**Follow-up confirmed decision (2026-10-04):** Remove the **A budget you can explain** section from Dashboard, including its duplicate token metrics and review-profiles link.

**Follow-up confirmed decision (2026-10-04):** Add **Other costs** between Harness cost and Total cost in the monthly scenario table and Excel summary. Include scenario tool charges and recurring additional costs, excluding one-time items. Token cost, harness cost, and Other costs reconcile to Total cost. Missing billed tool workload marks Other costs partial independently of model pricing.

**Follow-up confirmed decision (2026-10-04):** Remove the **Expected scenario · LLM costs only** footer and its duplicate Suite total beneath Dashboard's monthly summary.

**Follow-up confirmed decision (2026-10-04):** Rename Dashboard's **Cost drivers & impact** section to **Top agents by cost**.

**Follow-up confirmed decision (2026-10-04):** Remove the **Preview a change to [agent]** panel from Dashboard for every agent. The Top agents by cost section displays the ranked list with search and Show all controls.

**Follow-up confirmed decision (2026-10-04):** Remove the **Find an agent group** search field from Top agents by cost. Keep the ranked list and Show all control.

**Follow-up confirmed decision (2026-10-04):** Replace the ranked group list with the five individual agents with the highest Expected monthly token cost. Use the subtitle **Top 5 high cost agents** and columns Index, Agent name, Use case name, and Total token cost. Split a counted group's token cost evenly among its members before sorting; exclude tools, harness, and additional costs. Sort unrounded Decimal costs descending, then name and ID for ties. Show fewer rows when the suite has fewer than five agents and label incomplete pricing/workload. Remove Show all.

**Follow-up confirmed decision (2026-10-04):** Existing-agent dialogs are titled **Edit agent** on every entry path. Do not present an agent-group concept in UI labels, help, validation errors, generated names, or Excel labels. Use agent terminology and describe shared execution settings directly. Retain persisted field names and counted-agent accounting for saved-estimate compatibility; model exclusivity controls are labeled Exclusive choice or Exclusive branch.

**Follow-up confirmed decision (2026-10-04):** Label the second Agent inventory column **Use Case Name** and display the actual use-case name. Add **Total Cost** for each agent. This is the Expected-scenario monthly cost of that agent's own model calls and tools plus its share of the harness. Split a counted group's cost evenly among its members while they share assumptions. Called agents have their own rows so their cost is counted once. Suite-level additional costs and fixed harness that cannot be allocated at zero volume remain in the suite total. Mark missing-price or missing-volume values incomplete and label known subtotals partial.

**Follow-up confirmed decision:** In the inventory's **Edit agent** panel, label the use-case title **Business use case name**. Do not show an agent-level Complexity control or a separate Agent identities section; the agent's name and use-case description are already editable at the top, and its ID is not edited in this panel. Replace the Execution assumptions section with an ordered **Steps** list. Each step shows its name, model name, and complexity profile, with detailed execution inputs available within that step.

**Follow-up confirmed decision:** Remove the Model field from every category in the **Complexity profiles** pane, including the new custom category form. Select models on agent steps or agent-specific execution editors. New custom profiles must not silently copy a model from their starting category. Preserve model choices already saved in older estimates so their previous calculations remain reproducible.

**Follow-up confirmed decision (2026-10-04):** Complexity profile definitions contain only execution behavior: calls, tokens, retry attempts, and cache fractions. A model is selected independently for each aggregate agent execution or detailed step/model call that uses a profile. A profile has no implicit or default model, and several executions using the same profile may choose different models. Older estimates that inherited a profile model migrate that choice to the affected aggregate agents without changing their saved pricing snapshot or cost.

**Follow-up confirmed decision, amended 2026-10-04:** Users may delete a custom complexity profile only when no step or optional agent default references it. A global deletion must account for the current draft and saved estimates. Predefined profiles cannot be deleted. If a profile is in use, block deletion and identify the references that need to be changed.

**Edit agent Cost section (confirmed 2026-10-04):** Add **Cost** before **Steps**. Show Expected monthly total input tokens and input cost, total output tokens and output cost, and total token cost, in USD. Use the current draft and canonical calculation with frozen prices; opening or previewing an edit must not change the estimate. A selected individual receives its own workload share. Token costs exclude harness, tools, and other costs. Missing pricing or workload remains visibly incomplete.

## Confirmed requirements

**Agent inventory creation dialog (confirmed 2026-10-04):** Clicking **Add agent** in Agent inventory opens a dialog titled **Add agent**. Opening an existing agent continues to show **Edit agent**, including an individual sharing stored execution assumptions. Determine creation from whether the draft agent exists in the estimate, without adding persisted UI state.

**Per-step Cost section (confirmed 2026-10-04):** Add the same **Cost** section to every step in an agent: Expected monthly input/output token counts and costs, plus total token cost in USD. Use each step's contribution to the current draft's canonical calculation, including conditional model calls, step probabilities, and retry/cache assumptions. Step costs reconcile to the agent token total and remain visible without expanding execution details. Missing pricing/workload and calculation failures retain the same incomplete/error treatment as the agent summary.

- Support cost estimates for a single agent through a suite of agents.
- Let users begin with an initial set of estimation assumptions and progressively fine-tune those assumptions as they learn more about the agents and workload.
- Tie each agent to a business use case.
- Give every agent in a newly defined suite its own unique, editable name and ID plus a short, editable business use case description. Each member of a counted group retains these individual properties; generated descriptions must clearly indicate when the real use case still needs definition.
- Provide simple, medium, and high as predefined complexity profiles. Allow users to define additional, globally available profiles with unique names and assign them to individual use-case steps. Profiles characterize step execution assumptions and have no business use case of their own. An optional agent-level default may initialize steps but must not force all of an agent's steps into one profile or overwrite its business use case.
- Allow deletion of a custom complexity profile only when no current or saved estimate references it, including step assignments and optional agent defaults. Preserve predefined profiles and identify references that block deletion.
- Let each agent's business use case have multiple steps, each with its own effective complexity profile and model invocation assumptions. Different steps in one invocation may use different profiles and models.
- Run as a local web application initially.
- Focus on detailed LLM spending; allow separate additional cost items.
- Support major model providers.
- Produce an Excel deliverable. No markup or selling-price calculation.
- Support low, expected, and high scenarios with explicit parameter changes.
- Accept monthly invocation counts entered manually for each agent.
- Provide quick entry for agent counts and workload by agent or by reusable agent definition. Reusing a definition must preserve each member's identity and complete step mix; complexity alone is insufficient to define a group.
- Allow individual overrides and spreadsheet-based agent definitions.
- Define every complexity profile using concrete, editable step execution assumptions. Select a model independently for each step's invocation.
- Start with aggregate execution assumptions; support optional detailed workflows for expensive or uncertain portions.
- Provide a reset-all-parameters feature.
- Measuring live agents is a future feature.
- Business-volume mapping is optional; it must not be required for an estimate.

## Proposed initial experience

1. Create a named estimate and enter the total number of agents, or import a spreadsheet.
2. Define each agent's business use case and ordered steps, optionally using a reusable agent definition for counted members.
3. Set workload per agent or reusable group. Select each step's complexity profile and provider/model independently.
4. Review effective step assumptions and optionally customize individual agents.
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

Profiles are suggestions, not model identities. Every priced model invocation in a step must resolve to a specific provider/model and pricing record. Model changes preserve execution assumptions unless the architect explicitly edits them. Agent workload volume remains independent of step complexity.

Input includes instructions, messages/history, retrieval content, tool definitions, and tool results actually included in each call. Aggregate averages represent context growth across the invocation. Tool/revision cycles belong in the normal call count, not the retry rate.

Output estimates must include billable reasoning where applicable. If reasoning is entered separately, normalize it using the provider's billing semantics and never add it twice to an output total that already includes it.

The additional-attempt rate means expected extra attempts divided by baseline model calls. It is not a failure probability or retry limit. Aggregate mode assumes extra attempts have the same average token usage as ordinary calls. Detailed mode can express different retry sizes, limits, and fallback models.

## Calculation and accounting

For an aggregate agent definition with one step, one model, and uniform token pricing, the simplified formula is:

```text
monthly_invocations = agent_count * monthly_invocations_per_agent
monthly_calls = monthly_invocations * calls_per_invocation * (1 + additional_attempt_rate)
monthly_input_tokens = monthly_calls * average_input_tokens_per_call
monthly_output_tokens = monthly_calls * average_output_tokens_per_call
monthly_llm_cost = (monthly_input_tokens * input_price_per_million
                 + monthly_output_tokens * output_price_per_million) / 1_000_000
suite_llm_cost = sum(group_and_individual_llm_costs)
```

For a detailed use case, calculate each step's expected model usage and price using that step's effective profile and model. Weight conditional steps and model invocations exactly once, sum the step costs for one agent invocation, then multiply by that agent's monthly invocation volume. Roll up all agents once for the suite total. A reusable group may multiply an identical step mix by its member count; an individual exception replaces that member's share. Category token and cost summaries allocate each step's contribution to its effective profile and reconcile to the suite total. An agent that uses several profiles appears in several category usage/cost breakdowns, but remains one agent with one invocation volume; category agent counts must not be added as if they partitioned the suite.

Use more specific calculations when provider pricing requires cached reads/writes, context-length tiers, batch rates, or other billable categories. Evaluate per-request pricing thresholds before multiplying by monthly volume. Do not silently apply the simple formula to unsupported pricing schemes.

Manual invocation counts are proposed to include calls from all sources, including other agents. A parent's model-call count covers only the parent's own calls. In detailed mode, each agent's volume is either manually supplied or explicitly derived from callers, never both. Expanding a group into individual agents or replacing aggregate assumptions with a workflow must replace the corresponding contribution, not add a duplicate.

Model unknown prices as missing, never zero. Show incomplete totals as incomplete. Use full calculation precision internally and round for display/export presentation.

Optional business mapping:

```text
monthly_agent_invocations = business_events_per_month
                          * participation_rate
                          * invocations_per_participating_event
```

Architects supply these mappings explicitly. The app does not infer business logic from a domain label. This optional volume calculation is separate from the required association between each agent and its business use case.

## Proposed scenarios

Every estimate has an expected baseline and low/high scenario overrides. Show both the effective values and differences from the baseline. These are planning scenarios, not statistical confidence intervals.

To initialize illustrative scenarios, preserve agent counts, step structure, selected models, monthly invocation volumes, and retry rates. Set low-scenario input/output tokens per call to 75% of baseline and high-scenario input/output tokens per call to 150%. Label these as editable starter assumptions, not calibrated bounds.

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

Provide a downloadable import template. Proposed fields: agent/group name, agent ID for individual rows, business use case description, agent count, monthly invocations per agent, step ID/order/name, step complexity profile, provider/model per step, and optional step execution overrides. Named individual rows have count one. Counted group rows generate an editable identity and the same initial step definition for each member. Imported group rows and individual exceptions must have explicit ownership to avoid duplication. A single agent may occupy multiple step rows without increasing agent count or workload.

Validate imports with row/column-specific errors and a preview before applying changes. Exported user text must remain literal text rather than accidentally becoming Excel formulas.

Proposed workbook sheets:

- Summary: monthly scenario totals, annualized totals at unchanged monthly usage, and additional costs shown separately.
- Agents and steps: unique agent/group counts, invocation volumes, each step's effective profile/model/assumptions, token totals, and costs. Profile rollups allocate step usage and costs without duplicating agents.
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
