# Implementation decisions and failure cases

Recorded before implementing calculation behavior.

## Design

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

The spreadsheet import template accepts the daily source and inputs, and exported calculation rows include their source, inputs, planning days, manual fallback, and scenario factor. Monthly invocation cells in Calculations contain formulas based on those fields. The Agents sheet remains a reimportable aggregate inventory snapshot.

New rows and Quick setup now require both daily inputs; monthly volume is read-only in the inventory. Save and export reject incomplete daily rows at the backend boundary. Existing manual rows remain labeled legacy and retain their original monthly costs; entering daily inputs converts them to the derived source. Legacy spreadsheet rows remain importable so previous templates do not silently lose data.

Each inventory row also shows baseline monthly invocations for all agents in that row (`agent count × derived monthly invocations per agent`). Category totals sum these row contributions by complexity exactly once, including individual rows and rows with detailed workflows. An incomplete daily row makes its category total visibly incomplete. The workbook's Volume sheet recalculates row totals, and Category totals uses formulas to sum the three categories. Scenario-effective volumes remain separate in Calculations.

Category token consumption sums Expected-scenario line-item input and output tokens by complexity. The sum includes normal calls, additional attempts, detailed steps, and each group's agent count; cached input is already part of input tokens, and billable reasoning is already part of output tokens. Average daily tokens = monthly total / 30 planning days. A missing daily workload input marks the category token number incomplete. The workbook's Category usage sheet uses formulas over Expected-scenario Calculations rows, so changing execution inputs there can recalculate the category figures.

Independent E2E fixture: two simple agents, one medium agent, and one high agent with daily inputs of 2 × 3, 1 × 2, and 4 × 0.5 produce 180, 60, and 60 monthly invocations per agent. With synthetic USD 2/M input and USD 8/M output prices, starter execution profiles yield USD 2.9376 + USD 5.04 + USD 30.36 = USD 38.3376/month. A missing daily input must mark the estimate incomplete and block save/export; explicit zero is valid. Historical manual rows retain their original volume until converted.

## Category token-cost detail: failure cases and independent outcomes

- With that daily-volume fixture, simple has 734,400 uncached input tokens × USD 2/M = USD 1.4688 and 183,600 output tokens × USD 8/M = USD 1.4688. Medium costs USD 5.04 and high costs USD 30.36. The three category totals must sum to the Expected LLM suite cost, USD 38.3376.
- With 10 calls of 200,000 input and 1,000 output tokens, 25% cached reads and 25% cache writes, the base rates USD 2/M input, USD 0.5/M cached read, USD 3/M cache write, USD 8/M output yield USD 2 + USD 0.25 + USD 1.5 + USD 0.08 = USD 3.83. A long-context rate tier must be selected per call when the input size crosses its threshold, rather than from monthly volume.
- Cached input must appear in exactly one input token type; output already includes billable reasoning. Multiple models or rates must retain separate detail rows so a single catalog rate is never falsely applied to an entire category.
- If any contributing line lacks a required rate or has invalid pricing limits, its category cost must be marked incomplete; the displayed cost and workbook subtotal may include only fully priced lines. Tokens from supplied workload remain visible. Zero workload is a valid complete zero when inputs are present.
- Workbook Category costs formulas must recalculate the same token partitions and costs from Calculations. Category totals must reconcile to the Summary Expected LLM amount, within spreadsheet numeric precision.
