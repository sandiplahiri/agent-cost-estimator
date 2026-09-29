# Implementation decisions and failure cases

Recorded before implementing calculation behavior.

## Design

FastAPI serves a built React/TypeScript app on loopback. SQLite stores versioned estimate JSON and pricing snapshots. A pure Decimal calculation module consumes validated domain records. LiteLLM supplies its bundled catalog offline; explicit refresh retrieves its published catalog. There are no paid model calls. The first detailed workflow is an ordered list of model-call steps with bounded expected repetitions; child agents remain separate rows with inclusive manual volumes.

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
- An inventory row's 1,000 monthly invocations must become 25 when the user clicks and types `25`; this must update the actual budget inputs, not just the displayed text.
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
