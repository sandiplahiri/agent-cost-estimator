# PRD: Agentic System Cost Modeler

**Status:** Draft v1.8 (exclusive model-or-agent step actions) | **Date:** 2026-10-05 | **Owner:** AI Architecture

---

## 1. Summary

Add a feature to the cost estimation app that lets a user model an **agentic system** as a directed acyclic graph (DAG) of agents and models, then get a daily/monthly/annual cost estimate with full breakdowns, sensitivity analysis, and what-if scenarios.

The atomic unit is the **agent**. Each agent is associated with a **business use case**, and **one invocation of the agent completes that use case**. A use case consists of multiple ordered **steps**. Each step has exactly one action type: **invoke a model** selected from potential models, or **invoke another agent in the same suite** selected from potential agents. These action types are mutually exclusive. Within the selected type, option probabilities total **1.0**, and exactly one target is selected whenever the step executes. The step's expected action cost is the probability-weighted cost of its options. Model steps can mix simple, medium, high, and custom complexity profiles across an agent's invocation. Agents also have a usage profile (invocations per day) and an optional default complexity for new model steps. Because agents can call other agents, the structure is a call tree/DAG. **Cycles are not allowed**; the app must prevent and explain them.

**Confirmed requirements update (2026-10-05):** This step contract supersedes independent model probabilities, optional exclusive groups with a residual no-call probability, mixed model/agent actions within one step, and agent calls outside steps. An optional step execution probability controls whether a step runs; it does not relax the requirement that its target distribution totals 1.0.

Because an invocation equals a completed use case, the primary unit-economics metric is **cost per completed use case**, which can be broken down by step, model, and vendor.

The suite also has exactly one dedicated **agent harness** cost entry covering the shared runtime and platform around all agents (orchestration, sandboxes, state, observability, hosting, operations). Total suite cost = models + tools + harness.

## 2. Goals and Non-Goals

**Goals**
- Model any realistic agentic suite (single agent, router + specialists, planner/executor/critic, deep-research fan-out) with one general abstraction.
- Produce explainable cost numbers: every dollar traces to an agent, use case step, model, and token type.
- Tie cost to business outcomes: each agent invocation is a completed business use case, so cost per completed use case (and optionally value or margin per completion) is a first-class metric.
- Make the model easy to build (templates, visual canvas, sensible defaults) and easy to interrogate (charts, sensitivity, scenarios).
- Capture uncertainty with ranges, not just point estimates.
- Account for the full cost of running the suite, including the shared agent harness, not only model calls.

**Non-Goals (v1)**
- Live telemetry ingestion or billing reconciliation (see Future Work).
- Latency/throughput SLA modeling beyond simple peak-concurrency estimates.
- Modeling loops or unbounded recursion. Model retries use model-option retry assumptions; additional agent invocations require separate steps in an acyclic dependency graph.

## 3. Users and Use Cases

| Persona | Need |
|---|---|
| Solution architect / pre-sales | Quote an agentic deployment before building it |
| Product manager | Understand unit economics (cost per task, per user, per seat) and set pricing |
| Finance / FinOps | Forecast monthly spend, compare model choices, set budgets |
| Engineer | Find the expensive node and test cheaper model/caching options |

## 4. Core Concepts and Data Model

### 4.1 Entities

**Model Catalog (global, editable, vendor-neutral)**

The catalog is the single source of truth for every model any agent can call. An agent's model calls may mix models from different vendors and different sourcing types (see 4.1.1). Each catalog entry has:

- Identity: `model_id`, `name`, `vendor` (e.g. Anthropic, OpenAI, Google, Mistral, Meta, Cohere, in-house), `family`, `version`
- **Source type** (`source_type`): `vendor_api` | `cloud_marketplace` | `self_hosted` | `fine_tuned` | `custom` (see 4.1.1)
- **Hosting/channel** (`channel`): the actual place it is bought or run, e.g. "Vendor direct API", "AWS Bedrock", "Azure OpenAI", "Google Vertex", "Together/Groq/Fireworks", "On-prem GPU cluster"
- `region` (pricing and data-residency can differ by region)
- Capabilities (for filtering and swap suggestions): `modalities` (text, image, audio, video, embeddings), `context_window`, `max_output_tokens`, `supports_tools`, `supports_caching`, `supports_batch`, `supports_reasoning`
- `tokenizer_id` and `tokens_per_word_ratio` (used for normalization across vendors, see 5.2)
- **Pricing** (one or more pricing components, see 4.1.2)
- `quality_tier` / optional benchmark scores (user-supplied, used only for display and swap comparisons, never for cost math)
- `currency`, `effective_date` (price versioning, so old estimates stay reproducible), `price_source_note` (link or text on where the price came from)

#### 4.1.1 Source Types

| Source type | How it is priced | Typical inputs |
|---|---|---|
| Vendor API | Per token (input / output / cached / reasoning), per request, per image, per audio second | Published list price, negotiated discount |
| Cloud marketplace (Bedrock, Azure, Vertex) | Per token, or provisioned throughput (hourly commitment per model unit) | Marketplace price, committed-use discounts |
| Self-hosted / open weights | Infrastructure-based: GPU hourly cost / throughput | GPU type, $/GPU-hour, tokens/sec per GPU, utilization %, replicas, ops overhead |
| Fine-tuned | Base inference price (often with a premium) plus one-time training cost and hosting fee | Training cost (amortized), hosting $/hour |
| Custom / other | User-defined unit and price | Free-form |

#### 4.1.2 Pricing Components

A model can carry multiple pricing components so that vendors with different billing structures are all representable:

- `price_input_per_mtok`, `price_output_per_mtok`
- `price_cached_read_per_mtok`, `price_cache_write_per_mtok` (optional)
- `price_reasoning_per_mtok` (defaults to output price)
- `price_per_request` (flat fee per call, optional)
- `price_per_image`, `price_per_audio_second`, `price_per_video_second` (optional, for multimodal)
- **Tiered / volume pricing**: price breakpoints by monthly volume (e.g. first 100M tokens at X, next at Y)
- **Long-context surcharge**: different price when input exceeds a token threshold
- `batch_discount_pct` (optional)
- `committed_discount_pct` (negotiated or committed-use discount applied to list price)
- **Provisioned / fixed capacity** (optional): `$ per hour per unit`, `units`, `throughput_tokens_per_sec_per_unit`. Cost is then capacity-based, not usage-based (see 5.2).
- **Self-hosted cost model** (when `source_type = self_hosted`): `gpu_type`, `gpu_hourly_cost`, `gpus_per_replica`, `replicas`, `throughput_tokens_per_sec`, `target_utilization_pct`, `ops_overhead_pct`. The engine converts this to an effective per-million-token price (see 5.2).

The app ships with a starter catalog of common models and prices (clearly dated), and users can add, clone, and edit entries. Workspace admins can lock the catalog so team members cannot alter negotiated prices.

**Agent**
- `agent_id`, `name`, `description`, `color`
- `use_case`: the business use case this agent completes (see 4.3): `name`, `description`, optional `value_per_completion` (business value or avoided cost of one completed use case)
- `complexity`: optional agent default for initializing steps (see 4.2); the effective profile is resolved per step
- `steps[]`: the ordered steps of the use case; each step declares `action_type` (`model` or `agent`) and owns exactly one nonempty option list: `model_calls[]` (4.3) or `agent_calls[]` (4.4). Optional `tool_calls[]` remain separately accounted ancillary charges (4.5).
- `tool_calls[]`: non-LLM costs not tied to a specific step (see 4.5)
- `fixed_overhead_per_invocation` (optional flat $)

**Root Usage (entry points)**
A root agent is one invoked directly by users. Properties:
- `agent_id`
- `users` (count of active users)
- `invocations_per_user_per_day` (each invocation is one completed business use case)
- `active_days_per_month` (default 22 for business, 30 for consumer)
- `growth_pct_per_month` (optional)

**Agent Harness (one per suite)**
A single suite-level cost entry for the shared runtime and platform around all agents (orchestration, sandboxes, state, observability, hosting, operations). Defined in 4.8. It appears in totals as its own line and is optionally allocated to agents when computing cost per use case.

### 4.2 Complexity Measure

Complexity describes a **step's** model invocation assumptions. An agent may use several profiles in one completed use case; its default profile is only a convenience for creating steps.

- Discrete tiers with editable multipliers (defaults):

| Tier | Input multiplier | Output multiplier | Model calls multiplier |
|---|---|---|---|
| Simple | 0.5x | 0.5x | 1.0x |
| Standard | 1.0x | 1.0x | 1.0x |
| Complex | 2.0x | 2.0x | 1.5x |
| Very Complex | 4.0x | 3.0x | 2.5x |
| Custom | user-set | user-set | user-set |

- Each model step selects an effective profile: its explicit selection if present, otherwise the agent's default. A lightweight "Classify" step and a complex "Investigate" step may belong to the same agent invocation. Changing the default must not silently rewrite explicitly selected step profiles.
- Effective tokens for a model call = `base_tokens x tier_multiplier`.
- Profile definitions live at the workspace level; custom profiles can be selected per model step. Model choice and workload volume remain independent of complexity.
- The multiplier on calls represents extra reasoning steps/tool-use turns a harder task needs.

Agent inventory and workload are counted by unique agent identity. A counted group may reuse a complete agent step definition, but complexity alone cannot define a group. Profile breakdowns allocate each step's expected tokens and model cost to its effective profile. Called-agent model usage is attributed to the called agents' own model-step profiles once. An agent may contribute to several profile breakdowns, so profile agent counts, if displayed, are overlapping distinct-agent counts and must never be summed to obtain suite agent count.

### 4.3 Use Case, Steps, and Exclusive Actions (per agent)

**An agent invocation completes one business use case.** Each agent is associated with a business use case (e.g. "Resolve a customer billing inquiry", "Produce a due-diligence summary", "Triage an incoming support ticket"). One invocation of the agent runs the use case from start to finish, so:
- **Cost per invocation = cost per completed use case.** This is the headline unit-economics metric throughout the app.
- The number of invocations per day (4.1 root usage, 5.1) is the number of use cases completed per day.

**A use case consists of multiple ordered steps.** Example: *Understand request -> Delegate retrieval -> Draft response -> Verify -> Finalize*.
- A step has: `step_id`, `name`, `description`, `order`, `action_type`, and an optional `execution_probability` (default 1.0: the chance this step runs at all in a given invocation, e.g. a "Verify" step that only runs for 20% of cases).
- A **model step** selects one target from its model options. It has a selectable complexity profile (inheriting the agent default only when no step selection exists), an optional `context_carryover_pct` (share of earlier steps' output tokens added to this step's input), and its own model-option table (below).
- An **agent step** selects one other agent from the same suite using its agent-option table (4.4). It has no model options or direct model token assumptions. Each called agent retains its own steps and complexity profiles; the caller's profile does not modify the child's execution assumptions.
- A step cannot contain both model and agent options. Work that requires both is represented by separate steps. Tool costs (4.5) are ancillary charges, not a third action type.
- Steps are sequential for cost purposes. Order matters for context carryover and for display; parallel or branching flows are a latency concern (see open questions), and conditional steps are expressed with `execution_probability`.
- A single-step agent is valid and is the simple case. New agents start with one step.

**Semantics: exactly one target from one probability distribution per executed step.**
- Each step has a fixed, user-defined, nonempty set of potential targets of its selected action type. Different model steps may offer models from different vendors; agent-step targets must be other agents in the current suite.
- Every option has an explicit, finite probability in [0,1], and probabilities across the step's options must sum to **1.0**. A single-option step therefore has probability 1.0. Explicit zero-probability options are valid; missing probabilities are invalid.
- Options are mutually exclusive alternatives. There is no independent invocation mode, residual "no call" outcome, or separate exclusive-group control. Optional execution is represented only by `execution_probability`.
- Expected action cost given the step executes is `sum(option_probability x option_cost)`. For a model option, use that option's effective model pricing and execution assumptions. For an agent option, use the selected child's full cost per invocation, including its downstream steps. Apply the step execution probability once, then scale by the caller's workload. A positive-probability option with missing pricing or unresolved child cost makes the step estimate incomplete; do not omit it and present a complete weighted total.
- Model-call counts and retries apply only to model options. An executed agent step invokes its selected individual exactly once. Additional invocations require separate steps; no agent repetition count or scenario repetition override is supported. An individual appears at most once in one step’s option list and may be selected again in other steps.

Each model step has one or more model-option rows:

| Field | Description |
|---|---|
| `model_id` | Any model from the catalog, from any vendor or source type. An agent may use any mix (e.g. a vendor API model for reasoning, a self-hosted open model for classification, a marketplace-hosted embedding model) |
| `role` | Optional label for the purpose of the call (e.g. "reasoning", "classifier", "embedding", "reranker", "guardrail", "fallback") |
| `probability` | **User-provided.** Chance this model is selected given the step runs, in [0,1]. All model-option probabilities in this step total 1.0 |
| `calls_per_occurrence` | Average number of calls when it occurs (e.g. 3.2 turns in a tool-use loop). Must be >= 0, can be fractional |
| `base_input_tokens` | Average fresh input tokens per call |
| `base_output_tokens` | Average output tokens per call |
| `base_reasoning_tokens` | Optional thinking tokens per call |
| `cache_hit_rate` | Fraction of input served from cache (0-1) |
| `context_growth_per_call` | Optional tokens added to input on each successive call within one invocation (models multi-turn context accumulation) |
| `mode` | Standard / Batch (applies batch discount) |

Example: Small model 80% / Large model 20% is one valid model step. Its expected action cost is `0.8 x cost(Small) + 0.2 x cost(Large)`. Alternatives may span vendors or hosting channels.

**Multi-vendor patterns supported explicitly** (available as one-click presets in the model-call editor):
- **Cascade / escalation:** cheap model in one step, stronger model in a separate conditional step (can be a different vendor).
- **Fallback / failover:** primary model in one step and secondary vendor in a separate conditional step with execution probability equal to the explicitly modeled failure/timeout rate.
- **Traffic split / routing:** a fixed percentage of calls routed to each vendor or channel (cost optimization, A/B testing, or resiliency).
- **Ensemble / voting:** separate steps for each model, each with a single option of probability 1.0; costs sum across steps.
- **Pipeline of specialists:** e.g. embedding model -> reranker -> generator, each from a different vendor, modeled as consecutive steps of the use case.

**Per-call token profile is model-specific.** Because tokenizers differ across vendors, the same text produces a different token count in each model. Each model-call row therefore stores its own token counts, with an optional **"derive from reference"** helper (see 5.2) that converts a reference token count into this model's token count using the catalog's tokenizer ratio.

### 4.4 Agent Options (sub-agent edges)

Each agent step has one or more distinct individual agent-option rows. When the step executes, one option is selected and invoked exactly once. To invoke the same agent again, add another step. The rows form one mutually exclusive distribution totaling 1.0. Graph edges are projections of these rows, not additional calls to be charged separately.

| Field | Description |
|---|---|
| `child_agent_id` | Stable ID of a named individual agent in the same suite; cannot be the calling agent, a category, or a shared row |
| `probability` | Chance this child is selected given the agent step executes; all option probabilities for this step total 1.0 |
| `step_id` | Required on the graph edge; references the parent's agent step owning this option. Effective selection probability is `step.execution_probability x probability` |

A child can have many parents (shared specialist agents). Its expected invocations are the sum across all incoming edges. Example: Answerer 70% / Escalation 30% is one agent step with expected action cost `0.7 x loaded_cost(Answerer) + 0.3 x loaded_cost(Escalation)` for one invocation of the selected child. Child costs are attributed to this step for explanation, but counted once in suite totals through the children's derived workload.

### 4.5 Tool / Non-LLM Costs
Per-agent rows for web search, vector DB queries, code sandbox seconds, API calls, etc.: `name`, `unit_cost`, `expected_units_per_invocation`, `probability`. Rows can be attached to a specific step (`step_id`, so they only occur when that step runs) or to the agent as a whole.

### 4.6 Constraint: No Cycles
- The graph must be a DAG. On every edge add/edit, run cycle detection (DFS).
- If a cycle would be created, block it and highlight the offending path in the UI: "Adding Critic -> Planner would create a cycle: Planner -> Executor -> Critic -> Planner."
- Guidance: model repeated downstream invocations with separate steps; those steps cannot create a dependency cycle.

### 4.7 Copy Agent (create a new agent from an existing one)

Users frequently need agents that are variations of one another (same structure, different models, probabilities, or complexity). Creating an agent must therefore support **starting from a copy**.

**Entry points**
- On the canvas: right-click or node menu -> **Duplicate agent**.
- In the agent list / inspector: **Copy** button.
- In the **New agent** dialog: choose **Blank**, **From template**, or **Copy existing agent...** (searchable picker showing each agent's name, complexity tier, models, and daily cost).
- Keyboard shortcut (Ctrl/Cmd+D) and multi-select duplicate.
- Cross-project copy: copy an agent from another project or from a saved template/library into the current project.

**What is copied** (user can untick any item in a short "Copy options" panel; all ticked by default):
- Description, color, complexity tier / custom multipliers
- The **use case definition and all steps** (names, order, execution probabilities, explicit complexity selections or inherited defaults, context carryover), and each model step's full option table: every model, its probability, calls per occurrence, token profile, cache hit rate, context growth, mode, role, action type, and the complete agent-option distribution where applicable
- Tool / non-LLM cost rows and fixed overhead
- **Outgoing sub-agent calls** (edges to child agents, with selection probabilities and one invocation per executed step). Children are shared, not duplicated, unless the user chooses **Duplicate with subtree**, which also copies all descendants and rewires the edges among the copies.

**What is NOT copied**
- Incoming edges (the copy is not automatically called by any parent) and root usage settings (users, invocations/day). The new agent starts as an unattached node so it never silently changes the existing system's cost; the user then wires it in or sets it as a root. After duplicating, the UI offers "Attach to a parent" and "Make this a root" actions.
- The copy is **independent**: later edits to the original do not change the copy, and vice versa. (An optional "link to source" mode is out of scope for v1.)

**After copying**
- The copy is named `<Original name> (copy)` and opens immediately in the inspector with the name field focused.
- All fields are editable, including renaming the use case, adding/removing/reordering steps, changing action types and model or agent options per step, changing option probabilities and model-step complexity profiles, changing the optional default for new steps, and changing edges.
- A **"Changes from source"** indicator shows which fields differ from the original (chips or a compact diff), with the cost delta versus the source agent, so users see the impact of their modifications. It can be dismissed.
- Cycle validation (4.6) runs on the copied outgoing edges and on any edges the user adds next.
- Undo restores the state before the copy in a single action.

**Copy step.** Within an agent, a single step can be duplicated (including its models, probabilities, tool rows, and step-level sub-agent calls) and then edited, and steps can be copied from one agent to another. This makes it quick to build use cases with similar steps (e.g. two "Verify" steps with different models).

### 4.8 Agent Harness (suite-level cost entry)

The **agent harness** is the shared runtime and platform around the agents: the orchestration / workflow engine, agent runtime and execution sandboxes, tool gateway, memory / state / session stores, queues, guardrails and policy layer, API gateway and auth, observability (tracing, logging, evals), and the hosting infrastructure that runs them. It belongs to the whole suite rather than to any single agent, so it has its **own dedicated cost entry, one per suite**, separate from agents, models, and per-agent tool costs. It is never created by "copy agent", is not a node in the DAG, and appears in totals as its own line.

**Fields**
- `name`, and `harness_type`: `managed_platform` | `self_built` | `hybrid` | `none`. (`none` is an explicit "no harness cost" choice; leaving the harness undefined triggers a warning instead, see 8.2.)
- `components[]`: the cost lines. Each has `name`, `category`, `basis` (with its parameters), optional `scope`, and an optional source note. Categories: orchestration, compute / sandbox, state & memory, vector / retrieval store, queue / messaging, gateway & auth, guardrails & policy, observability, evaluation, security & compliance, storage, networking, license / support, labor, other.
- `scaffold_tokens` (optional): `injected_input_tokens_per_call`, `injected_output_tokens_per_call`, `cache_hit_rate`. Tokens the harness adds to every model call on behalf of agents (system scaffolding, tool schemas, memory injection, guardrail prompts). They are priced at each call's own model price and reported under the harness, not the agent, so agent model cost stays clean. Individual agents can opt out.
- `contingency_pct`: buffer applied to the harness total (default 0).
- `allocation`: how harness cost is attributed to agents when computing cost per use case: `by_invocations` (default), `by_step_executions`, `by_model_calls`, `by_tokens`, `by_direct_cost`, or `custom_weights`. Allocation only changes per-agent and per-use-case views; the suite total never changes.
- `include_in_cost_per_use_case`: toggle, default on.

**Component bases**

| Basis | Meaning | Parameters |
|---|---|---|
| `fixed_monthly` | Flat monthly charge (platform license, baseline cluster, minimum fee) | `amount` |
| `per_unit` | Price per usage-driver unit, optionally with volume tiers | `driver`, `unit_price`, `units_per_driver` (default 1, e.g. 6 sandbox seconds per tool call), optional `tiers[]` |
| `capacity` | Replicas / nodes sized from peak load | `driver`, `capacity_per_unit_per_min`, `unit_price_per_hour`, `target_utilization_pct`, `min_units`, `max_units`, `hours_per_month` |
| `storage` | Retained data (traces, logs, memory) | `driver`, `gb_per_driver_unit`, `retention_days`, `price_per_gb_month` |
| `percent_of_model_spend` | Overhead tied to LLM spend (gateway markup, guardrail surcharge) | `pct` |
| `amortized_one_time` | Setup, implementation, integration | `one_time_cost`, `amortization_months` |
| `labor` | Engineering and operations effort | `fte`, `loaded_cost_per_fte_month`, `suite_allocation_pct` |

**Usage drivers** (computed by the engine, see 5.6): `root_invocations`, `invocations`, `step_executions`, `model_calls`, `tool_calls`, `mtokens`, `users`.

**Scope.** A component applies to the whole suite by default, or to a list of agents only (e.g. sandbox compute that only the coding agent uses). Scoped components sum their driver over those agents only and are allocated directly to them.

**Presets** (one click, fully editable, dated like the model catalog): *Managed agent platform* (license plus per-invocation / per-step fees), *Self-built on Kubernetes* (cluster capacity, state database, queue, observability, 0.5 FTE), *Serverless* (per-invocation functions, queue, database, per-GB logging), and *Minimal* (single service plus logging).

### 4.9 Delete an Individual Agent

The requested feature is deletion of a named individual from the current estimate. The implemented behavior defaults are:

- Provide Delete beside Edit in Agent inventory and Delete agent in individual editors, including members sharing settings. Confirm the selected name and scope; Cancel leaves the draft unchanged.
- Block deletion when any step references the individual, even at zero probability or zero workload. Identify calling agents and steps so the architect can explicitly remove or retarget options while preserving normalized distributions.
- Deleting an unreferenced caller removes its steps, tools, and outgoing contributions. Recalculate child work with the canonical model; restore retained direct volume when the last caller disappears. Deleting a shared member reduces only its own share; deleting the final member removes that definition.
- Preserve sibling identities and assumptions, pricing snapshots, profiles, scenarios, and suite costs. Apply atomically to the browser draft after backend validation; reject stale responses. Undo restores the prior estimate and Save persists the deletion.
- Permit an empty inventory and retain applicable fixed harness/additional costs. Save/reopen and Excel must reproduce the reduced agent count and scenario costs.

## 5. Calculation Engine

All values are **expected values** computed deterministically; optional Monte Carlo layer provides ranges (5.4).

### 5.1 Expected invocations (topological order)

```
E[inv(root)]  = users x invocations_per_user_per_day
E[inv(child)] = sum over incoming edges e (parent p -> child c):
                  E[inv(p)] x e.probability
```
Computed once per agent in topological order. Cost is O(V + E).

Because one invocation completes one use case, `E[inv(a)]` is also the expected number of completed use cases per day for agent a. Every edge belongs to an agent step. Its effective probability is `step.execution_probability x e.probability`, which replaces `e.probability` in the formula above. Model steps create no child-agent volume. Multiple callers contribute to a shared child's volume without charging its execution twice.

### 5.2 Cost per agent invocation (self cost, excluding children)

**Stage 0: Cross-vendor normalization and effective pricing (per model-call row)**

1. **Token normalization (optional):** if the user enters tokens against a reference tokenizer, convert: `model_tokens = reference_tokens x (model.tokens_per_word_ratio / reference.tokens_per_word_ratio)`. Users may instead enter tokens directly per row; direct entry always wins. This keeps "same workload, different model" comparisons fair.
2. **Effective per-token price by source type:**
   - *Vendor API / marketplace per-token:* use the price components directly, after `committed_discount_pct`, tiered/volume breakpoints (evaluated against the model's total monthly volume across all agents, so shared usage of a model across agents correctly moves it through price tiers), and long-context surcharge (applied when a call's input tokens exceed the threshold).
   - *Provisioned throughput:* cost is fixed capacity: `monthly_cost = $/hour x units x hours_running`. If the modeled demand exceeds capacity (`peak tokens/sec > units x throughput`), raise a warning and suggest additional units. The model's effective $/Mtok for display = `monthly_cost / modeled monthly tokens`.
   - *Self-hosted:* `effective_$/Mtok = (gpu_hourly_cost x gpus_per_replica) / (throughput_tokens_per_sec x 3600 x target_utilization) x 1,000,000 x (1 + ops_overhead_pct)`. Replicas needed are derived from peak load (5.5) and billed for all hours they run, so low utilization shows up as higher effective $/Mtok.
   - *Fine-tuned:* inference price plus `(training_cost / amortization_months)` plus any hosting fee, allocated as a fixed monthly line item on the model.
   - *Per-request / multimodal components:* `calls x price_per_request`, images x `price_per_image`, audio seconds x `price_per_audio_second`.
3. **Currency:** convert every price to the workspace currency using the workspace FX rates before any math, and show the original currency in tooltips.
4. **Usage-based vs fixed costs:** the engine separates **variable** cost (scales with calls) from **fixed** cost (provisioned capacity, self-hosted replicas, fine-tune amortization). Fixed model costs are attributed to agents proportionally to their share of that model's tokens, so per-agent and per-task numbers stay meaningful while the system total remains exact.

**Stage 1: Per model-call cost (within a step)**

For each model-call row of a step (`complexity` below is the step's effective tier: the step override if present, otherwise the agent's tier):
```
calls         = probability x calls_per_occurrence x complexity.calls_mult
in_tokens     = (base_input x complexity.in_mult) + avg context growth
                + context_carryover_pct x (expected output tokens of earlier steps)
out_tokens    = base_output x complexity.out_mult
reason_tokens = base_reasoning x complexity.out_mult
call_cost     = calls x [ in_tokens x (1 - cache_hit) x p_in
                        + in_tokens x cache_hit x p_cached_read
                        + out_tokens x p_out
                        + reason_tokens x p_reason ] x (1 - batch_discount if batch)
```
**Stage 2: Per step and per agent (use case) cost**

```
direct_step_cost(s) = model step: sum(call_cost over model options) + step tool_costs
                      agent step: step tool_costs only
action_cost(s)      = model step: sum(call_cost over model options)
                      agent step: sum over options e [ e.probability
                                                       x loaded_cost(e.child) ]
step_cost(s)        = action_cost(s) + step tool_costs
self_cost(a)        = sum over steps s [ s.execution_probability x direct_step_cost(s) ]
                      + agent-level tool_costs + fixed overhead
```
`self_cost(a)` excludes child-agent costs. `step_cost(s)` includes the probability-weighted downstream cost for an agent step; `direct_step_cost(s)` excludes it. Model option probability is already included in `call_cost`; do not apply it a second time. Step execution probability is applied once in each rollup. Use decimal arithmetic and round only for presentation.

### 5.3 Rollups
- **Daily direct cost of agent a** = `E[inv(a)] x self_cost(a)`.
- **Daily direct cost of step s of agent a** = `E[inv(a)] x s.execution_probability x direct_step_cost(s)`; these amounts reconcile to the agent's direct cost, excluding separately shown agent-level charges. **Daily loaded step cost** uses `step_cost(s)` instead and includes called-agent costs for explanation; label these views explicitly.
- **Daily total** = sum over all agents (model, tool, and fixed model cost) + daily harness cost (5.6). Totals always show the split Models / Tools / Harness.
- **Fully loaded cost per invocation** of agent a (recursive, memoized) = `self_cost(a) + sum over agent steps s [s.execution_probability x sum over options e (e.probability x loaded_cost(e.child))]`. This is the "cost of one task" metric, i.e. the fully loaded **cost of one completed business use case**, shown for each root (and each agent). When the harness is included (default), `self_cost(a)` in this recursion is replaced by `self_cost(a) + harness_per_inv(a)` (5.6); the UI always offers a toggle to show cost with and without the harness.
- **No double counting:** suite totals sum agents' direct costs at their derived workload. Do not also sum loaded parent or loaded step costs, which already include those child costs.
- Derived metrics: cost per user per day/month, cost per completed use case, cost per step, monthly/annual (using active days and growth), tokens per day by type, cost share by agent / step / model / token type.
- **Value metrics (optional):** when `value_per_completion` is entered, net value per completion (`value - loaded cost`), ROI, and break-even volume per use case.

### 5.4 Uncertainty (Monte Carlo, v1.1 but designed-in now)
- Any numeric input may be entered as a **range** (min / likely / max, triangular distribution) instead of a point.
- Run N=5,000 samples client-side or in a worker; output P10/P50/P90 for daily and monthly cost.
- **Execution-level simulation mode:** instead of using expected values, simulate individual executions. For each agent execution (one use case completion), each step runs or not by a Bernoulli draw on its execution probability; within each executed step, make one categorical draw from its target distribution, selecting exactly one model or exactly one other suite agent according to its action type. Each agent selection invokes the selected child once and executes its steps; repeated agent invocations are represented by additional steps. This shows the real distribution of cost per execution (e.g. most runs are cheap, a few escalate to an expensive model) and is the basis for cost-per-task percentiles (P50/P95). The expected-value engine and the simulation must agree on the mean (tested, see 8.5).
- Display as a band on charts and a "confidence range" in the summary.

### 5.5 Peak load (simple)
`peak_model_calls_per_min = daily_calls x peak_factor / active_minutes`, shown per model to inform rate-limit and capacity planning. Inputs: `peak_factor` (default 3x), `active_hours_per_day`.

### 5.6 Harness cost (suite level)

**Usage drivers (daily expected values from the engine)**

| Driver | Definition |
|---|---|
| `root_invocations` | Sum of E[inv] over root agents |
| `invocations` | Sum of E[inv(a)] over all agents, including sub-agents |
| `step_executions` | Sum over agents and steps of E[inv(a)] x s.execution_probability |
| `model_calls` | Expected model calls per day (after complexity multipliers), also available per model |
| `tool_calls` | Expected tool units per day |
| `mtokens` | Expected input + output + reasoning tokens per day, in millions |
| `users` | Sum of root users |

A component with a `scope` sums its driver over the scoped agents only.

**Monthly cost per component**
```
fixed_monthly:           amount
per_unit:                unit_price x units_per_driver x driver_daily x active_days x growth_factor
storage:                 price_per_gb_month x (gb_per_driver_unit x driver_daily x retention_days)   # steady-state stock
capacity:                units = clamp(ceil(peak_driver_per_min / (capacity_per_unit_per_min x target_utilization)),
                                       min_units, max_units)
                         cost  = units x unit_price_per_hour x hours_per_month
percent_of_model_spend:  pct x monthly variable model cost
amortized_one_time:      one_time_cost / amortization_months
labor:                   fte x loaded_cost_per_fte_month x suite_allocation_pct
scaffold tokens:         sum over model-call rows of
                           expected_calls_per_day x [ injected_in x ((1 - cache_hit) x p_in + cache_hit x p_cached_read)
                                                    + injected_out x p_out ] x active_days
```
`peak_driver_per_min` uses the peak-load method in 5.5. If the required units exceed `max_units`, the engine caps at `max_units` and raises a capacity warning.

```
harness_monthly = (sum of component costs + scaffold token cost) x (1 + contingency_pct)
harness_daily   = usage-based costs per day + fixed costs / active_days_per_month
```

**Allocation to agents**
```
weight(a)          = by_invocations: E[inv(a)] | by_step_executions | by_model_calls | by_tokens
                     | by_direct_cost: E[inv(a)] x self_cost(a) | custom weights
harness_alloc(a)   = scoped component costs for a + (unscoped harness cost) x weight(a) / sum(weights)
harness_per_inv(a) = harness_alloc(a) / E[inv(a)]
```
The sum of `harness_alloc(a)` over all agents equals the harness total exactly.

**Fixed vs variable.** Each component is tagged fixed (`fixed_monthly`, `capacity`, `amortized_one_time`, `labor`) or variable (`per_unit`, `storage`, `percent_of_model_spend`, scaffold tokens). Because fixed costs are spread over volume, harness cost per completed use case depends on volume; the engine can evaluate it at volume multipliers (0.25x to 4x) to draw the scale curve (7.2).

## 6. Additional Parameters Considered

Beyond the required ones, the model supports (all optional, with defaults):
- **Prompt caching** hit rate and cache-write amortization (system prompts, tool definitions).
- **Context accumulation** across turns in an agent loop (input grows each call).
- **Reasoning/thinking tokens** priced separately.
- **Retry / error rate**: `retry_rate` multiplies model calls and tool calls (e.g. 4% retries -> x1.04).
- **Conditional / optional steps**: modeled with each step's `execution_probability` (e.g. a verification step that runs for 30% of cases). Since an invocation implies the use case is completed, there is no separate abandonment parameter by default.
- **Human-in-the-loop** share: fraction of runs needing a person (adds labor cost per run, optional).
- **Batch vs real-time** discounts.
- **Input size drivers**: average documents/pages attached, tokens per page, to derive input tokens from a more intuitive unit.
- **Seasonality / growth**: monthly growth rate and ramp-up curve for year-one forecasts.
- **Volume discounts / committed-use** pricing tiers on the model catalog.
- **Currency and region** with an exchange-rate setting.
- **Markup / margin** to convert cost into a suggested price per seat or per task.
- **Harness / infrastructure** costs (hosting, orchestration, sandboxes, observability, vector DB, operations) are modeled in the dedicated suite-level harness entry (4.8).

## 7. User Experience

### 7.1 Principles
1. **Start fast:** a working estimate in under 2 minutes from a template.
2. **Visual first:** the graph is the primary editing surface; forms are secondary.
3. **Always explainable:** click any number to see how it was calculated.
4. **Progressive disclosure:** simple fields up front, advanced parameters collapsed.

### 7.2 Main Screens

**Confirmed navigation decision (2026-10-03):** The left navigation must include **Agent suite graph** as its own workspace beside **Dashboard**. The graph canvas, agent inspector, and agent-to-agent link creation and editing belong in that workspace, including an **Add agent** action for an empty graph. Dashboard keeps the inventory, scenario totals, and budget breakdowns; it must not embed the graph or its link editor. Both screens edit the same estimate, so switching between them must preserve unsaved changes and show the resulting costs and volumes consistently. Shared save and export actions remain available from either screen. This screen boundary applies to future canvas features as the graph UI grows.

**A. Templates / Start screen**
Prebuilt starters: *Single chatbot*, *Router + specialists*, *Planner-Executor-Critic*, *Research fan-out*, *Coding agent with tools*, *RAG assistant*. Or "Blank canvas". Import/export JSON.

**A2. Model Catalog manager**
- Searchable, filterable table of all models (filter by vendor, source type, channel, region, modality, context window, price range).
- Add/clone/edit models; guided forms per source type (e.g. the self-hosted form asks for GPU type, $/hour, throughput, utilization, and shows the resulting effective $/Mtok live).
- Bulk import/export (CSV/JSON), price history per model, and "price changed" indicators.
- Side-by-side model comparison (price, context window, capabilities, effective cost for a sample workload).

**A3. Harness editor**
- One screen for the suite's single harness entry. Start from a preset (Managed platform, Self-built on Kubernetes, Serverless, Minimal) or add components one by one.
- Components table: name, category, basis, price and parameters, a live driver preview (e.g. "about 9,780 step executions/day"), monthly cost, and a fixed/variable tag. Inline validation and a "what does this driver mean?" tooltip.
- Live summary: monthly harness cost, % of total suite cost, donut by category, and a fixed vs variable bar.
- Allocation selector with a preview of how harness cost lands on each agent, plus the include-in-cost-per-use-case toggle.
- Scaffolding tokens section with the resulting cost shown live.
- Scenarios can carry different harness configurations, so users can compare, for example, a managed platform against a self-built one.

**B. Canvas (graph editor)**
- Selecting an individual agent must expose its own editable use case, step profiles, workload source and direct usage where applicable, model choices, and execution assumptions. Saving those values changes only that agent, not the shared profile or other agents. A grouped node must show its member count and offer distinct actions to edit the whole group or separate one member for individual customization; separating a linked member must preserve graph workload until its own assumptions are changed.
- Node-and-edge canvas. Agents are nodes; each node shows its **use case name** and a mini step strip (one segment per step, colored by its effective complexity profile and sized by cost share). Model calls appear as small chips under each step showing model name, a **vendor icon/color**, and probability. Mixed-profile agents must not be represented by a single complexity color.
- Edges show selection probability (e.g. "70%"), and edge thickness scales with expected invocations.
- Drag from an agent-step handle to create an option edge, or select/create an owning agent step when dragging from a node. Editing an edge updates that step's target distribution and validates its total. Cycle attempts are blocked with a red path highlight and explanation.
- Node badge shows daily invocations and daily cost; a heat overlay (green to red) shows cost share.
- Auto-layout (top-down tree), minimap, zoom, collapse/expand subtrees for large systems.
- Right-hand **inspector panel** edits the selected agent/edge: use case name and description, an ordered **step list** (add, rename, reorder by drag, duplicate, delete), each step's action type and target probability table, model-step complexity and token assumptions, tool costs, with inline validation and live cost delta. An optional agent default initializes new steps and remains visibly distinct from effective step selections.
- **Step action editor** (in the inspector, per step): select **Invoke model** or **Invoke agent**, then show only that type's target table. Model options use the catalog; agent options use a picker of named individual agents in the same suite, including Bulk add members. Categories, profiles, and shared rows are not targets. Persist the individual agent ID; applying a call to a shared member separates only that member, preserves all other workload, and routes the full weighted contribution to the selected individual. Each option has a probability input (slider + numeric field, 0-100%) and its weighted cost contribution. Show **Probability total: 100%** and the probability-weighted step cost. Block applying or importing invalid distributions; never silently normalize them. Adding an option may start at explicit zero; a new single-option step starts at 100%. A separate "Step runs in X% of executions" field sets execution probability (default 100%). Switching action type must replace the prior target list through an explicit, undoable edit, without retaining active options of both types.
- **Duplicate** button on the node and inspector header (see 4.7), plus drag-copy (hold Alt/Option while dragging a node).
- **Use case flow view** (double-click an agent): a left-to-right timeline of the use case's steps. Each step is a card showing its name, an execution-probability badge, its action type and model or agent targets with probabilities, and its expected tokens and cost per execution. Users add steps with "+" or from the step library, drag to reorder, duplicate a step, and click a step to edit its action and options. A cost bar under the timeline shows each step's share of the cost of one completed use case.
- **Harness panel (one per suite):** a pinned card at the edge of the canvas (not a node in the DAG) shows "Agent harness: $X/month, Y% of total, fixed vs variable", with a warning badge if the harness is undefined or capacity is exceeded. Clicking it opens the harness editor (A3). It cannot be duplicated or wired into the graph.

**B2. Agent inventory (dedicated left-navigation view)**
- Show one row per uniquely identified agent, including members of counted groups. Columns: name, business use case summary, number of steps, number of distinct agents calling it, number of distinct agents it calls, users per agent per day, and invocations per user per agent per day. Count each distinct calling/called identity once, even when several step options connect the same agents.
- The calling and called counts are derived from links and read-only. Edit one agent at a time. The editor exposes its name, **Business use case name** and description, daily workload inputs, and an ordered **Steps** list. Each step shows its action type, targets, probability total, and weighted cost; model steps also show their complexity profile and detailed execution inputs. The panel has no agent ID input, agent-level Complexity field, separate Agent identities section, or separate Execution assumptions section. Opening and closing an editor without applying changes must not alter a counted group; applying a member edit separates only that member and preserves link accounting.
- For a derived-volume agent, daily inputs are retained and editable for recovery but incoming links determine current execution volume. Show that distinction beside the controls.

**C. Live Summary bar (always visible)**
Daily / Monthly / Annual cost, cost per completed use case (cost per task), cost per user, and P10-P90 range when enabled; plus value or margin per completion when a value per completion is entered. The bar shows the split Models / Tools / Harness and a toggle to include or exclude the harness from cost per use case. Updates instantly on any edit, with a delta indicator versus the last saved baseline.

**D. Results / Insights tab**
- **Cost breakdown:** stacked bar by agent; donut by model; split by input / cached / output / reasoning / tools.
- **Cost per use case completion:** per agent and per root, with a **step waterfall** chart showing how the cost of one completed use case builds up step by step (including steps that run only part of the time, and sub-agent cost).
- **Step x model heatmap:** steps as rows, models as columns, cells showing expected calls and cost, so it is clear which step and model combination drives spend.
- **Harness breakdown:** by category, fixed vs variable, and per component, with the harness share of total and cost per use case with vs without the harness. A **scale curve** shows how harness cost per completed use case falls as volume grows (fixed costs are diluted), with the current volume marked.
- **Vendor and source view:** breakdown by vendor, by source type (vendor API vs marketplace vs self-hosted), and by channel, with a vendor concentration indicator (% of spend per vendor) to highlight lock-in or single-vendor risk.
- **Model mix matrix:** agents as rows, models/vendors as columns, cells showing share of that agent's cost, so mixed-vendor agents are easy to read.
- **Model swap / comparison:** pick any model-call (or all calls using a model) and compare the cost if swapped to another catalog model from any vendor, with a capability check (context window, tools, modalities) flagging incompatible swaps. Includes a break-even view for self-hosted vs API (the monthly token volume at which self-hosting becomes cheaper).
- **Sankey / flow diagram:** users -> root agents -> sub-agents -> models, plus a separate harness flow, with flow width = dollars. Immediately shows where the money goes.
- **Top cost drivers table:** ranked agents/models with $ and %, with one-click "what if I downgrade this model?".
- **Call-tree explorer:** expandable tree for one root invocation showing expected calls and cost at each node (fully loaded cost per task).
- **Sensitivity (tornado chart):** vary each input +/-20% (or its range) and show impact on total cost, so users see which assumptions matter.
- **Growth projection:** 12-month line chart with growth rate and uncertainty band.

**E. Scenarios**
- Save named scenarios (e.g. "Baseline", "Cheaper models", "2x users").
- Side-by-side comparison table and delta chart.
- Quick toggles: swap a model across the whole system, apply a caching rate, scale users.

**F. Pricing / unit economics panel**
Enter target margin or seat price; see break-even usage, margin per user, and cost-to-serve per tier.

### 7.3 Ease-of-Use Features
- Sensible defaults for every field; tier multipliers prefilled.
- **Token helper:** estimate tokens from words/pages/characters; paste a sample prompt to count.
- Tooltips with plain-language explanations ("probability = how often this happens per run").
- Undo/redo, autosave, **copy agent / copy with subtree** (4.7), bulk edit of models.
- **Template library:** any agent can be saved as a reusable template and used later as the starting point for a new agent (same flow as copying an existing one).
- **Step library / palette:** common steps (Classify intent, Retrieve context, Generate draft, Verify / critique, Summarize, Format output) with sensible default model probabilities and token profiles can be added in one click and then edited; any step can be saved to the library.
- Inline validation: missing probabilities, target probability totals other than 1.0, empty or mixed action lists, invalid suite-agent targets, missing model prices, orphan agents (not reachable from any root), duplicate individual targets within a step, and unsupported agent repetition inputs. Invalid steps cannot be applied.
- Keyboard shortcuts and accessible color palettes (never rely on color alone).
- Export: PDF/PNG report, CSV of per-agent costs, JSON model definition, shareable read-only link.

## 8. Technical Requirements

### 8.1 Data Schema (JSON, illustrative)

```json
{
  "workspace": {
    "currency": "USD",
    "tiers": { "simple": {"in":0.5,"out":0.5,"calls":1.0}, "standard": {"in":1,"out":1,"calls":1} }
  },
  "fx_rates": { "EUR": 1.08 },
  "models": [
    { "id": "m_large", "name": "Large", "vendor": "VendorA", "source_type": "vendor_api",
      "channel": "direct", "region": "us", "currency": "USD", "tokenizer_id": "tok_a",
      "context_window": 200000,
      "pricing": { "price_in": 3.0, "price_out": 15.0, "price_cached_read": 0.3,
                   "committed_discount_pct": 0 } },
    { "id": "m_open_small", "name": "Open Small 8B", "vendor": "Meta (open weights)",
      "source_type": "self_hosted", "channel": "on-prem", "currency": "USD", "tokenizer_id": "tok_b",
      "self_hosted": { "gpu_type": "H100", "gpu_hourly_cost": 2.5, "gpus_per_replica": 1,
                       "throughput_tokens_per_sec": 2500, "target_utilization_pct": 0.6,
                       "ops_overhead_pct": 0.15, "replicas": 2 } },
    { "id": "m_mkt_embed", "name": "Embedding X", "vendor": "VendorC", "source_type": "cloud_marketplace",
      "channel": "bedrock", "region": "us-east", "currency": "USD", "modalities": ["embeddings"],
      "pricing": { "price_in": 0.1, "price_out": 0 } }
  ],
  "agents": [
    {
      "id": "planner", "name": "Planner", "complexity": "complex",
      "use_case": { "name": "Produce a research plan for a request",
                    "description": "Turn a user request into a vetted research plan",
                    "value_per_completion": 4.0 },
      "steps": [
        { "id": "s1", "name": "Classify request", "order": 1, "action_type": "model", "execution_probability": 1.0,
          "model_calls": [
            { "model_id": "m_open_small", "role": "classifier", "probability": 1.0, "calls_per_occurrence": 1,
              "base_input_tokens": 1200, "base_output_tokens": 50 }
          ] },
        { "id": "s2", "name": "Retrieve context", "order": 2, "action_type": "model", "execution_probability": 1.0,
          "model_calls": [
            { "model_id": "m_mkt_embed", "role": "embedding", "probability": 1.0, "calls_per_occurrence": 1,
              "base_input_tokens": 800, "base_output_tokens": 0 }
          ] },
        { "id": "s3", "name": "Draft plan", "order": 3, "action_type": "model", "execution_probability": 1.0,
          "complexity_override": "complex", "context_carryover_pct": 0.5,
          "model_calls": [
            { "model_id": "m_open_small", "probability": 0.65, "calls_per_occurrence": 1,
              "base_input_tokens": 3000, "base_output_tokens": 600 },
            { "model_id": "m_large", "role": "reasoning", "probability": 0.35, "calls_per_occurrence": 2,
              "base_input_tokens": 4000, "base_output_tokens": 800, "cache_hit_rate": 0.6 }
          ] },
        { "id": "s4", "name": "Delegate research", "order": 4, "action_type": "agent", "execution_probability": 0.8,
          "agent_calls": [
            { "child_agent_id": "researcher", "probability": 1.0 }
          ] }
      ],
      "tool_calls": []
    },
    {
      "id": "researcher", "name": "Researcher", "complexity": "standard",
      "use_case": { "name": "Research supporting evidence" },
      "steps": [
        { "id": "r1", "name": "Research", "order": 1, "action_type": "model", "execution_probability": 1.0,
          "model_calls": [
            { "model_id": "m_large", "probability": 1.0, "calls_per_occurrence": 1,
              "base_input_tokens": 2000, "base_output_tokens": 500 }
          ] }
      ]
    }
  ],
  "roots": [
    { "agent_id": "planner", "users": 500, "invocations_per_user_per_day": 3, "active_days_per_month": 22 }
  ]
}
```

### 8.2 Validation Rules
- Graph is a DAG; at least one root; all agents reachable (warn if not).
- Validate in both the UI and backend: each step declares exactly one `action_type`, with a nonempty matching option list and no options of the other type. All option probabilities are explicit, finite decimals in [0,1] and total exactly 1.0; reject totals below or above 1.0 and missing values without silently normalizing. Explicit zero is allowed. Multiplicity and call counts are finite and nonnegative.
- Each model option references a catalog model. Each agent option references another existing agent in the same suite; reject self-calls, external or missing agents, and cycles. Every agent edge references its owning agent step; agent-level calls outside steps are invalid.
- Use case and steps: every agent has a use case name and at least one step; step order values are unique; `execution_probability` and `context_carryover_pct` are in [0,1], and carryover is not allowed on the first step; a `step_id` on a sub-agent call or tool row must reference a step of the same agent; reject empty action lists even when a step has tool charges or execution probability zero.
- Each model step resolves to an existing simple, medium, high, or custom complexity profile. Agent steps use the called agents' own profiles. A custom profile cannot be deleted while any current or saved step or agent default references it. A mixed-profile agent remains one agent and its workload is counted once; profile model-cost and token rollups sum its step contributions without duplicating them.
- Complexity profile definitions contain execution assumptions only. Model identity is chosen independently by the aggregate agent or by each detailed step/model-call row using the profile. Multiple executions using one profile may use different models and pricing snapshots.
- Copy-agent validation: names stay unique (auto-suffix "(copy)", "(copy 2)"); copied edges are re-checked for cycles.
- Token counts and prices >= 0; cache hit rate in [0,1].
- Every model-call references an existing catalog model.
- Every catalog model has a complete pricing definition for its source type (e.g. self-hosted requires GPU cost, throughput, and utilization > 0); incomplete models are flagged and excluded from totals with a visible warning rather than silently priced at $0.
- Currency: every model's currency must have an FX rate to the workspace currency.
- Capability checks: warn when a model-call's modeled input exceeds the model's context window, or an agent needing tool use is assigned a model without tool support.
- Capacity checks: warn when provisioned or self-hosted capacity is below modeled peak demand.
- Harness: at most one harness entry per suite. If no harness is defined, show a visible banner ("totals exclude harness cost") with one-click presets, rather than silently treating it as $0; `harness_type = none` is the explicit opt-out. Every component needs a valid basis with non-negative prices; referenced drivers and scoped agents must exist; `min_units <= max_units`; percentages in [0,1]; custom allocation weights must sum to more than 0; warn when a capacity component hits `max_units` at modeled peak.

### 8.3 Performance
- Recompute for graphs up to 200 agents / 1,000 edges in < 100 ms (single topological pass with memoization).
- Monte Carlo 5,000 samples in < 2 s in a web worker.
- Canvas stays interactive at 200 nodes (virtualized rendering, collapsible subtrees).

### 8.4 Persistence and Sharing
- Projects stored per user/workspace with version history; scenarios are branches of a project.
- Model price catalog versioned by effective date; estimates pin to a catalog version, with a "price changed since estimate" banner.
- Export/import JSON; read-only share links.
- Version the step action schema. Persist action types, option probabilities, effective assumptions, and frozen pricing in saved estimates, scenarios, JSON, and Excel. Validate complete imports before applying them. Support only the exclusive model-or-agent action workflow. No legacy action modes or migration/conversion flows are required. Invalid or unsupported action definitions are rejected without changing the current draft.

### 8.5 Testing
- Golden test suite: hand-computed examples (below) must match to the cent, including a mixed-vendor case (vendor API + marketplace + self-hosted in one agent) with FX conversion and tiered pricing.
- Tiered pricing is evaluated on a model's aggregate volume across all agents; a test must confirm that moving usage between agents does not change total cost.
- Fixed-cost allocation: per-agent allocated fixed costs must sum exactly to the model's fixed cost.
- Step actions: verify model and agent distributions through E2E editing, save/reopen, import, and export. Reject mixed types, empty options, missing/nonfinite/out-of-range probabilities, totals below or above 1.0, and invalid suite targets. A single option has probability 1.0; zero-weight options contribute no usage or cost. Compare weighted costs against independent hand calculations, including a shared child reached by multiple parents and an optional agent step, with no duplicate suite charges. When simulation is implemented, each executed step selects exactly one target and its mean converges to the expected-value result.
- Copy agent: a copy produces an identical use case, steps (order, execution probabilities), per-step action types, target tables and probabilities, tool rows, and outgoing option edges, but no incoming edges or root usage; editing the copy never changes the original; total system cost is unchanged until the copy is wired in; "duplicate with subtree" preserves the internal structure of the copied subgraph.
- Steps: an agent's self cost equals the sum of its direct step costs weighted by each step's execution probability (plus separately shown agent-level charges); loaded step costs include child work; a step with execution probability 0 contributes nothing (including its attached tool costs and sub-agent calls); reordering steps without context carryover does not change cost, and with carryover only input tokens change; an agent with one step reproduces the cost of the equivalent single model table.
- Harness: harness total equals the sum of its components exactly; allocated harness cost across agents sums exactly to the harness total for every allocation method; with a fixed-only harness, scaling users leaves harness cost unchanged and lowers harness cost per use case; per-unit components scale linearly with their driver; a scoped component is allocated only to its scoped agents; removing the harness reproduces the agent-only total; scaffold token cost matches a hand calculation with the model prices.
- Property tests: scaling users scales agent and model cost linearly (harness cost scales only through its variable components); zeroing a probability removes the subtree's cost; the loaded cost of a root x its invocations equals the sum of agent direct costs from that root alone.

## 9. Worked Example (for test fixtures)

System: **Support Assistant** (root), 1,000 users x 2 invocations/day = 2,000 invocations/day.

| Agent (use case) | Tier | Steps and model calls | Calls to children |
|---|---|---|---|
| Router ("Route a support request") | Simple (0.5x) | Step 1 "Classify" (model, runs p=1): Small model, p=1, 1 call, 2,000 in / 100 out. Step 2 "Route" (agent, runs p=1): select Answerer p=0.7 or Escalation p=0.3 | From step 2: -> Answerer p=0.7 x1; -> Escalation p=0.3 x1 |
| Answerer ("Answer a customer question") | Standard (1x) | Step 1 "Understand" (model, runs p=1): Small model, p=1, 1 call, 1,000 in / 50 out. Step 2 "Delegate search" (agent, runs p=0.5): Search agent, p=1, one invocation. Step 3 "Delegate search again" (agent, runs p=0.5): Search agent, p=1, one invocation. Step 4 "Draft answer" (model, runs p=1): Large model, p=1, 2 calls, 3,000 in / 500 out. Step 5 "Verify" (model, runs p=0.2): select Large model p=0.5 or Small model p=0.5, 1 call each, 1,500 in / 100 out | From steps 2 and 3: -> Search agent p=1 once per executed step, each weighted by execution p=0.5 |
| Escalation ("Handle a complex case") | Complex (2x) | 1 step "Resolve": Large model, p=1, 1.5x calls mult x 2 calls, 3,000 in / 500 out | none |
| Search agent ("Retrieve supporting documents") | Simple (0.5x) | 1 step "Search": Small model, p=1, 1 call, 1,500 in / 200 out | none |

Expected invocations (= completed use cases per day): Router 2,000; Answerer 1,400; Escalation 600; Search 1,400 x (step 2 runs 0.5 x option 1.0) x 2 = 1,400.
Expected Answerer calls per day by step: Understand 1,400 Small calls; Draft answer 2,800 Large calls; Verify 1,400 x 0.2 x 0.5 = 140 Large calls and 140 Small calls.

Illustrative weighted-cost acceptance examples (USD per selected option, after its execution assumptions): a model step offering costs $0.01 at p=0.8 and $0.05 at p=0.2 costs $0.018 per executed step. An agent step offering loaded child costs $0.04 at p=0.7 and $0.20 at p=0.3, invoked once, costs $0.088 per executed step. If that agent step runs with probability 0.5, it contributes $0.044 per caller invocation; at 2,000 caller invocations/day its attributed child cost is $88/day. Count that $88 once through the children's derived direct costs in the suite total.

Suite harness (one entry), illustrative: fixed platform fee $3,000/month plus $0.0005 per step execution, allocation by invocations, 22 active days/month. Expected drivers per day: invocations 5,400 (2,000 + 1,400 + 600 + 1,400); step executions 9,780 (Router 4,000; Answerer 1,400 + 700 + 1,400 + 280; Escalation 600; Search 1,400). Harness cost per day = 3,000 / 22 fixed + 9,780 x $0.0005 variable = about $141.25 ($3,107.58/month). Harness per agent invocation is about $0.0262. One Support request triggers 2.7 expected agent invocations (Router 1, Answerer 0.7, Escalation 0.3, Search 0.7), so its allocated harness cost is about $0.0706, which equals the unrounded daily harness cost / 2,000 root invocations.
Fixtures should assert these counts and the resulting per-agent and total costs using the catalog prices in the test file.

## 10. Success Metrics
- Time to first estimate < 3 minutes (median) from template.
- >= 80% of estimates built without needing support.
- Estimate accuracy within +/-25% of actual spend for pilot customers after calibration.
- Weekly active use of scenarios and sensitivity views by >= 40% of users.

## 11. Milestones

| Phase | Scope |
|---|---|
| **M1 (MVP)** | Agent / use case / step / model / edge data model (with exclusive model-or-agent actions, target distributions totaling 1.0, per-model-step complexity profiles, and step execution probability), use case flow view, cost per completed use case, **suite-level agent harness cost entry (fixed and per-unit components, allocation by invocations, shown as its own line in totals)**, DAG validation, expected-value engine, canvas editor, summary bar, breakdown charts, templates, JSON export, **copy agent (with copy options and "changes from source")**, **per-step model-or-agent probability editor**, **multi-vendor model catalog with per-token pricing, vendor/channel tags, and FX conversion** |
| **M2** | **Harness: capacity, storage, labor, amortized and percent-of-model-spend components, scaffolding tokens, presets, other allocation methods, scale curve**, context carryover, step library, step waterfall and step x model views, value/ROI per use case completion, complexity tier editor, caching/reasoning/tool costs, call-tree explorer, Sankey, scenarios and comparison, **self-hosted and provisioned-throughput cost models, tiered/volume pricing, cascade/fallback/split presets, model swap and vendor breakdown views, catalog manager UI** |
| **M3** | Ranges + Monte Carlo, tornado sensitivity, growth projection, unit economics/pricing panel, PDF report, share links |
| **Future** | Import real traces/logs to calibrate parameters, billing reconciliation, latency modeling, team collaboration/comments |

## 12. Open Questions
1. Should complexity be one global tier set or fully per-agent custom curves by default? Global tier by default that can be overidden to create agent specific complexity.
2. Do we support parallel vs sequential edge semantics (affects latency, not cost)? Proposed: store a flag now, use it later.
3. How are user-specific token distributions (heavy tails) handled? Proposed: mean by default, optional P50/P95 inputs feeding Monte Carlo.
4. Source of truth for model prices: manual catalog only, or provider-synced feed (per vendor/marketplace)? How do we flag stale prices?
4a. Tokenizer normalization: ship a ratio table per model, or require users to enter tokens per model? Proposed: ship defaults, always allow override.
4b. How to treat negotiated/enterprise discounts that differ per vendor and expire (workspace-level vs per-model, with end dates)?
4c. Self-hosted GPU cost: include only inference GPUs, or also storage, networking, and engineering time? Proposed: `ops_overhead_pct` plus optional fixed monthly lines.
4d. Should vendor-level spend commitments (e.g. a minimum monthly commitment with one vendor) be modeled as a floor on that vendor's cost?
4e. **Resolved 2026-10-05:** Each step chooses one action type and exactly one model or suite-agent target from a distribution totaling 1.0. Multiple targets that must all run require separate steps; skipping is expressed through step execution probability.
4f. Should copied agents optionally stay linked to a source ("template inheritance", where unchanged fields follow the source)? Proposed: v1 copies are independent; revisit based on usage.
4g. Steps are sequential for cost purposes, with conditional steps expressed via `execution_probability`. Do we need parallel or branching step flows (which affect latency and dependencies more than cost)? Proposed: not in v1; add an optional `parallel_group` later.
4h. Should steps be reusable across agents as shared definitions (edit once, update everywhere), or always copied? Proposed: copied in v1, with a step library for quick reuse.
5. Multi-tenant labor/infra cost inclusion: now covered by the suite-level harness entry (4.8), shown as its own line. Open: should infrastructure shared by several suites be split across suites by a configurable share?
6. Harness allocation default: `by_invocations` is simple and exact; should `by_direct_cost` be the default so expensive agents carry more overhead? Proposed: keep `by_invocations`, make the choice visible in the harness editor.
7. Should we ship benchmark default prices for managed agent platforms in the presets, or leave all harness prices blank for the user to fill in? Proposed: ship clearly dated placeholders with a "verify" badge.
