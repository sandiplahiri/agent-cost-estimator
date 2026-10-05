# Implementation decisions and failure cases

Recorded before implementing calculation behavior.

## Design

### Edit agent Cost preview: failure cases and independent outcomes

Recorded before implementation. The Cost section reports Expected monthly tokens and token costs for the current draft, before Steps. It uses the canonical calculation and frozen pricing; tools, harness, and suite extras are excluded.

- A selected member must not receive the entire counted entry's usage. In the inventory fixture, Planner A alone has 300,000 input tokens / USD 0.60, 30,000 output tokens / USD 0.24, and USD 0.84 total.
- Editing workload and adding a second model step must update the preview without applying or persisting the draft. Planner A at 600 monthly invocations with the fixture main and review steps has 1,200,000 input tokens / USD 1.80, 120,000 output tokens / USD 0.72, and USD 2.52 total. Closing without applying must preserve the original estimate.
- Derived workload must use the actual invocation links, including splitting incoming shares for an individual. Research after the Planner edit has 450 invocations, 450,000 input tokens / USD 0.90, 45,000 output tokens / USD 0.36, and USD 1.26 total.
- Token cost must exclude other costs: Agent A in the tool/harness fixture has 30,000 input tokens / USD 0.06, 3,000 output tokens / USD 0.024, and USD 0.084 token cost despite USD 21.084 total inventory cost.
- Missing pricing retains known token counts and labels costs incomplete; missing workload labels both usage and costs incomplete. Explicit zero workload produces complete zeros.
- Invalid drafts and calculation failures must show an actionable error, preserve unsaved fields, and hide stale numbers. Canceled/older requests must not replace newer previews.
- Cache reads and writes belong in input cost, billable output in output cost; reuse Decimal line components without new pricing arithmetic or rounding before aggregation. Existing cache/tier and workbook journeys remain applicable.

FastAPI serves a built React/TypeScript app on loopback. SQLite stores versioned estimate JSON and pricing snapshots. A pure Decimal calculation module consumes validated domain records. LiteLLM supplies its bundled catalog offline; explicit refresh retrieves its published catalog. There are no paid model calls. The first detailed workflow is an ordered list of model-call steps with bounded expected repetitions; child agents remain separate rows with inclusive volumes.

The pricing adapter uses LiteLLM's `cache_read_input_token_cost` where present and falls back to `input_cost_per_token_cache_hit` for catalog entries that only provide that field. LiteLLM [documents the latter as a legacy cache-hit field](https://github.com/BerriAI/litellm/issues/28854). The normalized catalog carries a version; older bundled catalogs are rebuilt from the installed LiteLLM package on load. Previously refreshed catalogs need another explicit refresh to pick up this normalization change. Saved estimate price snapshots are never changed by this migration. A save records the draft at the time Save is clicked; edits made during the request remain marked unsaved. Price refresh previews and import validation use the latest draft after their asynchronous work, and reject a preview if the draft changes again before it can be applied. Import preview validates imported rows against the current profile assumptions before enabling replacement.

Override precedence: bundled profile -> edited profile -> row overrides -> scenario multipliers, with scenario model override applied last. A detailed row replaces the aggregate calls with its steps; profile and aggregate execution overrides do not affect those explicit steps. Scenario multipliers affect both aggregate rows and explicit steps. Splitting one individual out of a group decrements the original group's count atomically in the client.

## Failure cases to verify through E2E

- Per-token prices mistaken for per-million prices; month versus year mixed up.
- Retry extra-attempt rates interpreted as failure probabilities; tool loops charged twice.
- Group-to-individual customization adds an agent without removing it from the group.
- Zero overridden by a default; NaN, infinity, negative numbers, fractional agent counts accepted.
- Unknown prices quietly converted to zero; partially priced suites look complete.
- Cache tokens charged at both normal and cache rates; unsupported cache prices silently discounted.
- Reasoning added to already inclusive output. This version accepts total billable output only.
- Context pricing thresholds evaluated using monthly tokens instead of per-call input.
- Unsupported rate modifiers interpreted as ordinary uniform pricing.
- Scenario edits mutate the baseline, and detailed workflows get charged in addition to aggregates.
- Stale calculation responses overwrite newer UI state.
- Price refresh changes a saved estimate without explicitly applying it.
- Save/reopen drops overrides, decimal precision, or selected price snapshot.
- Invalid spreadsheet rows partially modify the suite; uploaded formulas execute; exported names become formulas.
- Reset deletes agent counts, invocation volumes, custom pricing, or additional cost items.
- Workbook totals diverge from the UI; formulas exist but do not recalculate correctly.

## Missing cache-rate display: failure cases and expected outcomes

Recorded before changing the display behavior. The bundled `gemini/gemini-3.8-flash` snapshot has USD 0.75/M input, USD 3.75/M output, USD 0.075/M cached read, and no cache-write rate. With one simple agent, 1,000 monthly invocations, 2,000 input and 500 output tokens per call, and 2% extra attempts:

- At zero cache fractions, the independent result is 1,020 calls and USD 3.4425/month. The estimate must be complete.
- At a 0.5 cached-read fraction and zero cache writes, the independent result is USD 2.754/month. The estimate must remain complete.
- At a positive cache-write fraction, the missing rate must make the estimate incomplete. The main result must name the missing cache-write price and must not present USD 0.00 as a complete monthly bill.
- Restoring the cache-write fraction to zero must restore the previously calculated complete result. The pricing table must distinguish the available cached-read rate from the unavailable cache-write rate.

## Numeric entry replacement: failure cases and expected outcomes

Recorded before changing numeric input behavior. A user clicking a prefilled numeric control and typing a new value should replace the old value on that first focus.

- A profile's 2,000 input tokens per call must become 3,000 when the user clicks and types `3000`, rather than appending digits to 2,000.
- An inventory row's prefilled daily user count must be replaced when the user types a new count; the read-only monthly volume and budget must update from it.
- The quick setup's default total count of 10 must become 3 when the user clicks and types `3`.
- Explicit zero and fractional values must remain enterable where valid, and keyboard focus must still support replacement.

## Independent arithmetic fixture

Use custom model Fixture A, USD 2 / million input and USD 8 / million output (synthetic, not provider prices). Two simple agents each invoked 1,000/month, 1 call/invocation, 2,000 input and 500 output tokens/call, 2% additional attempts:

- 2,040 calls, 4,080,000 input tokens, 1,020,000 output tokens.
- Expected LLM cost: $8.16 input + $8.16 output = $16.32/month.
- Low (75% token sizes): $12.24. High (150% token sizes): $24.48.
- $25 recurring and $100 one-time additional items: expected monthly recurring $41.32; first month $141.32; first year $595.84.
- Split one agent and override its output to zero: total expected LLM cost $12.24, with two agents still present.
- Detailed replacement of both agents: 2 calls with 1,000 input/250 output, no retries, yields $16/month, not $32.32.

Verification uses browser interactions against the real local backend, a temporary database, downloaded workbooks, and an independent spreadsheet calculation engine. No unit tests will be added after implementation.
## Daily-user volume (schema 2)

Each agent row stores `volume_source` (`manual` for historical rows or `daily_users`), its historical manual monthly invocations, and the two daily inputs. New rows derive monthly invocations **per agent** as `users_per_day × invocations_per_user_per_agent_per_day × 30`. The engine then applies the scenario volume factor and group count. A 30-day month is an explicit planning assumption, not a calendar-month forecast. Version 1 estimates and browser drafts migrate to schema 2 with manual volume and unchanged costs; the inventory labels them as legacy. Entering both daily inputs converts such a row to derived volume. Existing pricing snapshots remain frozen.

Schema 6 adds a `members` identity list to each counted row. Each member has an editable ID, suite-unique name, and short business use case description; the list length must equal the row count. Row IDs remain stable internal keys for links when a member ID is edited. Quick setup generates one identity per agent. Earlier saved estimates gain deterministic member IDs from the row ID and index; browser drafts and imported JSON gain generated IDs when migrated and retain them when saved. Count-one agents retain their row names, and missing use cases receive an explicit pending-description value. The split operation moves one existing member identity to the independent row. Changing a count adds or removes identities at the end of the list. The Excel **Agent identities** sheet exports every member; the **Agents** sheet remains the aggregate import format. A count-one import can supply an ID and description, while counted imports generate identities for later editing. The per-row count and suite total are limited to 5,000 agents to bound saved and exported identity data.

Counted groups still share execution and workload assumptions. Their member descriptions may differ, but the group's cost-per-completed-use-case result remains an aggregate approximation until members are customized into individual rows.

## Global custom complexity categories (schema 7)

Schema 8 separates profile execution assumptions from model identity. Current estimate and global category profiles contain no model field. Aggregate agents select a model through their own override; detailed steps and model-call rows retain explicit model choices. When older saved estimates or browser drafts inherit a model from a profile, migration copies that model to each affected aggregate agent and preserves the pricing snapshot. An explicit agent model override, including an empty selection, remains authoritative. Old global category records have their former model field removed transactionally on read; new global category requests with a model field are rejected.

The local SQLite store keeps up to 50 global custom category starters, each with a case-insensitively unique name and a validated execution profile. Simple, medium, and high remain predefined and reserved names. Creating a category copies the chosen profile, including any edits made in the creation dialog, into the global store and the current estimate. New estimates receive current global starters. Existing saved estimates keep their own profile snapshots; adding a newly available global category to one is explicit. Profile edits made in an estimate stay local. Global starter definitions cannot currently be renamed or edited after creation; create a new category when a different global starter is needed.

Deleting a global custom category runs in a SQLite write transaction. It checks the current draft sent by the UI and every saved estimate for agent rows assigned to that category, and rejects deletion with their names if any are found. The UI also blocks deletion when the current draft has assignments. Successful deletion removes the global starter and its unused profile from the current draft, so new estimates omit it. Saved estimates are not rewritten: unused historical profile snapshots remain reproducible and may be removed locally, then saved. Predefined categories have no delete action and are rejected at the API boundary. The server cannot inspect unsaved drafts in other browser sessions; those retain local snapshots until opened or edited.

The canonical estimate model now accepts profiles keyed by every defined category and validates each agent's category reference. The calculation engine iterates those keys for invocation, token, and cost summaries. Excel Category totals, Category usage, Category costs, Monthly category summary, and Profiles sheets use the same keys; formulas reference literal category cells so custom names cannot become formula code. A missing category profile rejects the estimate at the backend boundary. Spreadsheet imports can use a custom category already attached to the current estimate. Reset restores starter execution assumptions for active global categories while preserving category names, agent assignments, model choices, and undo. A custom profile imported from JSON without a global starter remains unchanged by reset.

Global starters store execution assumptions and a model ID, not a custom model's price. If a starter selects a custom model, add that model's rate snapshot to each new estimate before relying on its cost; missing pricing remains visible as incomplete.

The spreadsheet import template accepts the daily source and inputs, and exported calculation rows include their source, inputs, planning days, manual fallback, and scenario factor. Monthly invocation cells in Calculations contain formulas based on those fields. The Agents sheet remains a reimportable aggregate inventory snapshot.

New rows and Quick setup now require both daily inputs; monthly volume is read-only in the inventory. Save and export reject incomplete daily rows at the backend boundary. Existing manual rows remain labeled legacy and retain their original monthly costs; entering daily inputs converts them to the derived source. Legacy spreadsheet rows remain importable so previous templates do not silently lose data.

Each inventory row also shows baseline monthly invocations for all agents in that row (`agent count × derived monthly invocations per agent`). Category totals sum these row contributions by complexity exactly once, including individual rows and rows with detailed workflows. An incomplete daily row makes its category total visibly incomplete. The workbook's Volume sheet recalculates row totals, and Category totals uses formulas to sum every active category. Scenario-effective volumes remain separate in Calculations.

Category token consumption sums Expected-scenario line-item input and output tokens by complexity. The sum includes normal calls, additional attempts, detailed steps, and each group's agent count; cached input is already part of input tokens, and billable reasoning is already part of output tokens. Average daily tokens = monthly total / 30 planning days. A missing daily workload input marks the category token number incomplete. The workbook's Category usage sheet uses formulas over Expected-scenario Calculations rows, so changing execution inputs there can recalculate the category figures.

Independent E2E fixture: two simple agents, one medium agent, and one high agent with daily inputs of 2 × 3, 1 × 2, and 4 × 0.5 produce 180, 60, and 60 monthly invocations per agent. With synthetic USD 2/M input and USD 8/M output prices, starter execution profiles yield USD 2.9376 + USD 5.04 + USD 30.36 = USD 38.3376/month. A missing daily input must mark the estimate incomplete and block save/export; explicit zero is valid. Historical manual rows retain their original volume until converted.

## Category token-cost detail: failure cases and independent outcomes

- With that daily-volume fixture, simple has 734,400 uncached input tokens × USD 2/M = USD 1.4688 and 183,600 output tokens × USD 8/M = USD 1.4688. Medium costs USD 5.04 and high costs USD 30.36. The three category totals must sum to the Expected LLM suite cost, USD 38.3376.
- With 10 calls of 200,000 input and 1,000 output tokens, 25% cached reads and 25% cache writes, the base rates USD 2/M input, USD 0.5/M cached read, USD 3/M cache write, USD 8/M output yield USD 2 + USD 0.25 + USD 1.5 + USD 0.08 = USD 3.83. A long-context rate tier must be selected per call when the input size crosses its threshold, rather than from monthly volume.
- Cached input must appear in exactly one input token type; output already includes billable reasoning. Multiple models or rates must retain separate detail rows so a single catalog rate is never falsely applied to an entire category.
- If any contributing line lacks a required rate or has invalid pricing limits, its category cost must be marked incomplete; the displayed cost and workbook subtotal may include only fully priced lines. Tokens from supplied workload remain visible. Zero workload is a valid complete zero when inputs are present.
- Workbook Category costs formulas must recalculate the same token partitions and costs from Calculations. Category totals must reconcile to the Summary Expected LLM amount, within spreadsheet numeric precision.

## Daily and monthly token-type cost: failure cases and independent outcomes

- With the synthetic two-simple-agent fixture, uncached input is 734,400 tokens and USD 1.4688/month; output is 183,600 tokens and USD 1.4688/month. Their daily averages must be 24,480 and 6,120 tokens, USD 0.04896 each. Category daily cost is USD 0.09792. Division must happen before display rounding.
- With the tier/cache fixture, monthly token-type costs USD 2, USD 0.25, USD 1.5, and USD 0.08 yield daily averages USD 0.066666666..., USD 0.008333333..., USD 0.05, and USD 0.002666666...; daily category cost is USD 3.83 / 30. Cached reads and writes remain distinct token types.
- Two models in one category must be combined into category token-type totals without discarding their distinct rates. Missing pricing or workload volume must mark affected category cost totals incomplete, rather than presenting a zero daily cost as complete.
- The exported Category costs sheet must calculate daily token and cost columns from monthly formula results using the 30-day planning month, and its category subtotals must reconcile with the Expected suite total.

## Monthly input/output summary: failure cases and independent outcomes

- Input cost must sum uncached input, cached reads, and cache writes exactly once; output cost must use billable output. The input and output costs must sum to each category's Expected monthly LLM cost, including mixed models and request-level tiers.
- With the synthetic daily-volume fixture, simple input/output are 734,400/183,600 tokens and USD 1.4688/USD 1.4688; medium are 1,512,000/252,000 tokens and USD 3.024/USD 2.016; high are 9,900,000/1,320,000 tokens and USD 19.8/USD 10.56. The suite row is 12,146,400 input tokens, 1,755,600 output tokens, USD 24.2928 input, USD 14.0448 output, and USD 38.3376 total.
- With the tier/cache fixture, 2,000,000 input tokens cost USD 3.75 (uncached USD 2 + read USD 0.25 + write USD 1.5); 10,000 output tokens cost USD 0.08. The summary must not apply one blended catalog rate to all input tokens.
- Missing required prices or workload inputs must mark affected input/output costs and overall totals incomplete. Known subtotals may remain visible, while token counts with supplied workload remain visible. Zero workload is a valid complete zero.
- The exported monthly summary must use formulas linked to Category usage and Category costs and reconcile its suite LLM cost to Summary's Expected LLM cost when recalculated.

## Cost-driver and sensitivity preview: failure cases and independent outcomes

Recorded before implementation. A preview changes one row input in a temporary copy of the estimate, recalculates both copies with the canonical engine, and never saves or changes the draft. The ranked list and preview use Expected-scenario LLM cost only; additional costs stay separate.

- For Fixture A (two simple agents in one group), the group and suite each cost USD 16.32/month. Changing that group's input tokens per call from 2,000 to 3,000 yields USD 20.40/month, an increase of USD 4.08. Changing its calls per invocation from 1 to 2 yields USD 32.64/month, an increase of USD 16.32. These expected values are computed independently from 2,040 baseline calls, USD 2/M input, and USD 8/M output.
- With one agent split into an individual row, rank each row once. A change to the individual must not alter the remaining group; the suite delta equals that individual's cost delta. A row with several detailed steps must have its costs summed once, and aggregate execution fields must not be offered for that row.
- The preview must preserve the current Expected scenario factor, model, snapshot rates, row overrides, and explicit zero. A changed input size crossing a context tier must reselect the rate per call; a simple percentage scaling of the displayed total would be wrong.
- A missing volume or required price makes the affected row or suite comparison incomplete. Known subtotals must not be labeled as a full projected bill or full dollar impact.
- Invalid, negative, infinite, out-of-range, or incompatible fields (for example a cache-read fraction that makes read plus write exceed one) must be rejected at the backend boundary. A preview must not change the saved estimate, browser draft, or exported workbook.

## Agent invocation links: failure cases and independent outcomes

Recorded before implementing graph calculation. Links express invocations of a child agent row per invocation of a parent agent row. A link's expected multiplier is trigger probability × child invocations per trigger. A destination group pools the resulting total invocations evenly across its agents; its group count must be positive. Model calls, normal revision/tool cycles, and retry attempts remain within the executing agent's own cost. Low/High link overrides change only the named scenario.

- With one Planner invoked 1,000 times/month, a Researcher link at probability 0.6 and two child invocations per trigger yields 1,200 Researcher invocations/month. A Reviewer link at probability 0.25 and one child invocation per trigger yields 250 Reviewer invocations/month. Each row contributes its own priced LLM calls once; the Planner does not absorb child model calls.
- With two independent parents at 1,000 and 200 invocations/month, links of 0.5 × 1 and 1 × 2 to one derived child yield 900 child invocations/month. If the child row contains three pooled agents, its per-agent average is 300, and its group total remains 900. Do not multiply 900 by three again.
- A parent with missing daily workload makes descendant volumes incomplete. A positive priced descendant must never appear as a complete zero. Explicit zero probability or zero fanout is a complete zero when all required inputs are present.
- A child already using entered daily or legacy manual volume must be explicitly converted before accepting an incoming link. Conversion previews the before/after costs and preserves the entered values. Removing the last incoming link restores its previous volume source. A failed preview or save leaves the draft unchanged.
- Reject unknown row IDs, duplicate link IDs, self-links, structural cycles, derived rows with no incoming link, incoming links to direct-volume rows, and mutually exclusive branch probabilities summing above one. Independent links may each trigger in the same parent invocation and are not constrained to a combined probability of one.
- A global scenario volume multiplier scales roots and consequently their descendants once. Low/High link probability or fanout overrides change only that scenario's graph. Request-level model pricing thresholds still apply to each agent's own calls.
- Saving and reopening must preserve the graph and its pricing snapshot; earlier schema-2 estimates must retain their direct volumes and costs. Export must show the links, effective scenario multipliers, derived volume sources, and reconciled suite totals. Inventory replacement must clear dangling links atomically.

### Schema 3 and calculation choice

Schema 3 adds `links` and a `derived` row volume source. Each converted row retains its former source and input values. Schema 1/2 estimates migrate to schema 3 with no links; their direct-volume arithmetic and pricing snapshots remain unchanged. Validation checks references, ownership, exclusive-branch sums for all scenarios, and structural cycles before graph calculation. A topological pass computes every row's total and per-agent volume once. Incoming link contributions use their caller's total volume; derived groups pool the sum across their `count`. Global scenario volume factors scale direct roots; downstream volumes inherit that scaling once. Missing root inputs propagate an incomplete status through descendants.

The link editor previews a candidate estimate through `/api/calculate` and applies it only while the base draft remains current. Removing the last link restores the stored previous direct source. Inventory import and Quick setup clear links together with the old inventory. The Excel `Agent links` sheet displays effective Low/Expected/High link contributions with formulas from precomputed parent volumes; derived `Volume` and `Calculations` cells contain the app's graph result. Editing graph inputs in Excel requires re-export, as documented in the workbook. Reimport of derived rows is rejected with an actionable error because the aggregate Agents sheet does not contain a lossless graph definition.

## Schema 4: agentic use cases

Schema 4 adds use-case labels, step IDs and execution probabilities, per-step model rows, tool charges, a single harness, and optional step-scoped invocation links. Existing schema-1/2/3 estimates migrate with their old costs and frozen prices. Detailed rows still replace aggregate profile calls. Model probabilities and exclusive groups are scoped to a step. The engine preserves Decimal precision and calculates model, tool, harness, and loaded use-case costs from the same validated estimate used by the UI and export. Price records also carry source/channel/region and original-currency FX snapshot fields. See [agentic implementation status](AGENTIC_IMPLEMENTATION.md) for supported formulas and remaining PRD scope.

## Linked individual customization

The `/api/agents/split` domain transformation creates one independent agent from a group with at least two members. For a direct group, one member keeps its original per-agent workload while the group count decreases. For a derived group, each incoming link's fanout is partitioned into `(n-1)/n` for the remaining group and `1/n` for the individual, including Low/High overrides. The individual's outgoing links are copied, and step references are remapped to its own steps. The backend validates the complete estimate before returning it; the browser applies it as one undoable change. The source group's configuration is preserved when the individual is edited.

Schema 5 adds `branch_event_id` to links. When a derived group is split, the two incoming links represent one original branch event, so exclusive-group validation counts their shared probability once. Scenario-specific probabilities and fanout remain explicit on both links. Schema 1–4 data migrates to version 5 without changing its price snapshot or calculated result.
