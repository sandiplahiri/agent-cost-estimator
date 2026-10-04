# Verification — current implementation

Verified on October 3, 2026.

## Results

- `npm run build`: passed (TypeScript and production frontend build).
- `npm run check`: passed (strict TypeScript, formatting, Python lint).
- `npm run test:e2e`: all 16 browser journeys passed against the real local FastAPI/SQLite app.
- Linked customization fixture: two Planner agents generate 600 monthly invocations, a two-agent Research group receives 600, and Reviewer receives 240. Splitting a Research member preserves Low/Expected/High model totals of $1.9656/$4.032/$9.576, including scenario-specific fanout and an exclusive branch. Splitting a Planner caller and copying a step-scoped outgoing call also preserve child volumes. The new Research individual first raises Expected spending to $4.272 by changing its output tokens. Its unapplied graph-inspector edit survives switching to Suite planner and back. A negative token value is rejected without losing the draft; valid edits to that individual's use case, output tokens, and model then produce $3.792 Expected spending. Changing only its complexity leaves that spending and model unchanged. The original group and complexity profile retain their assumptions, and the exported Summary formula recalculates to $3.792. The browser also verified that the graph appears only after selecting **Agent suite graph** in the left navigation. [Input](../artifacts/agent-customization/input.json), [customized estimate](../artifacts/agent-customization/customized.json), [workbook](../artifacts/agent-customization/customized-budget.xlsx), [inspector screenshot](../artifacts/agent-customization/graph-inspector-after.png), and [run report](../artifacts/agent-customization/verification.json) reproduce the journey.
- The added agentic fixture independently expects 100 root completions, 50 step-scoped child completions, $0.38 model spend, $1.25 tool spend, $11.675 harness spend, $13.305 suite spend, and $0.13305 loaded cost per root completion. The saved UI and a HyperFormula recalculation of the exported workbook were checked. Exclusive probability overflow, missing prices, missing FX, and a cycle were rejected or marked incomplete as appropriate. [Input fixture](../artifacts/agentic-mvp/input.json), [exported workbook](../artifacts/agentic-mvp/agentic-budget.xlsx), and [run report](../artifacts/agentic-mvp/verification.json) reproduce the check.
- The dependency installation audit on September 23 reported zero npm vulnerabilities after overriding the test-only ExcelJS UUID dependency to a patched compatible version; this audit was not rerun for this change.
- LiteLLM 1.102.1 bundled catalog normalization: 3,278 text-model/service entries, zero skipped invalid entries. This checks catalog parsing, not correctness against every provider's bill.
- Desktop and mobile artifacts were visually inspected. The mobile check verifies that the page itself does not overflow horizontally; wide agent tables scroll within their container.

## Repeatable evidence

Run from the repository root:

```sh
npm run build
npm run check
npm run test:e2e
```

The tests start a separate local server at port 8011 with a separate SQLite database. They do not mutate the main application's saved estimates.

- [Verification results](../artifacts/verification.json): expected and observed arithmetic outcomes.
- [Browser test results](../artifacts/e2e-results.json): full run status, durations, and diagnostics.
- [Example customer workbook](../artifacts/mortgage-budget.xlsx): fixed synthetic model pricing, low/expected/high totals, recurring and one-time costs.
- [Sensitivity input fixture](../artifacts/sensitivity-fixture.json) and [exported workbook](../artifacts/sensitivity-budget.xlsx): independently calculated group and suite impact, individual split ownership, invalid input rejection, incomplete pricing, and proof that previews leave exported totals unchanged.
- [Agent graph fixture](../artifacts/agent-graph-fixture.json), [exported workbook](../artifacts/agent-graph-budget.xlsx), and [replacement import](../artifacts/agent-graph-replacement.xlsx): derived pooled volume, scenario link overrides, cycle and branch validation, schema migration, save/reopen, reset, import replacement, and spreadsheet reconciliation. [Mobile screenshot](../artifacts/agent-graph-mobile.png) shows the graph editor at 390 px width.
- [Agent identity fixture](../artifacts/agent-identities/input-fixture.json), [exported workbook](../artifacts/agent-identities/identity-suite.xlsx), [run report](../artifacts/agent-identities/run-report.json), and [full E2E results](../artifacts/agent-identities/full-e2e-results.json): two generated member identities, edits, duplicate ID/name rejection, schema-5 migration, save/reopen, exported identity reconciliation, and the final 14-test pass.
- [Custom category fixture](../artifacts/custom-categories/estimate-fixture.json), [exported workbook](../artifacts/custom-categories/custom-category-budget.xlsx), [run report](../artifacts/custom-categories/run-report.json), and [full E2E results](../artifacts/custom-categories/full-e2e-results.json): global creation, agent assignment, name validation, saved snapshot, older-estimate opt-in, reset and undo, import preview, category totals, and recalculated Excel formulas.
- [Category deletion fixture](../artifacts/category-deletion/used-category-fixture.json), [exported workbook](../artifacts/category-deletion/after-deletion-budget.xlsx), [run report](../artifacts/category-deletion/run-report.json), and [full E2E results](../artifacts/category-deletion/full-e2e-results.json): draft and saved-assignment guards, predefined-category rejection, global deletion, historical snapshot cleanup, and recalculated USD 0.24 suite cost.
- [Tier and cache workbook](../artifacts/tier-cache-budget.xlsx) and [input fixture](../artifacts/tier-cache-fixture.json): input/output/context-tier and cache partition accounting.
- [Import fixture](../artifacts/agent-import.xlsx), [300-agent fixture](../artifacts/300-agents-import.xlsx), and [invalid fixture](../artifacts/invalid-import.xlsx).
- [Invalid cache import fixture](../artifacts/invalid-cache-import.xlsx): a row whose override conflicts with its active profile is rejected during preview.
- [Cache-hit workbook](../artifacts/cache-hit-budget.xlsx): checks the bundled LiteLLM 1.102.1 cache-hit field fallback through the browser and spreadsheet engine.
- [Desktop screenshot](../artifacts/suite-desktop.png) and [mobile screenshot](../artifacts/suite-mobile.png).

The synthetic model's rates are $2/M input and $8/M output. Two simple agents at 1,000 invocations/month each produce $12.24 / $16.32 / $24.48 in the starter scenarios. With $25 monthly and $100 one-time costs, expected first-year spending is $595.84. The 300-agent group fixture produces $244.80/month at 100 invocations per agent.

A delayed-save and delayed-refresh browser journey verifies that edits made during either operation remain in the draft and that only the earlier save is marked persisted. The sensitivity journey expects $16.32 baseline, $20.40 after increasing input tokens per call, $32.64 after doubling calls, and $40.80 for the input change under doubled Expected-scenario volume. It also verifies that an individual-only change leaves the other agent untouched and that an incomplete price prevents a complete comparison. The tier fixture previews a one-token increase across the 200,000-token request threshold and expects $7.6200375/month, confirming that the new rate is selected per call. The cache-hit journey uses the pinned bundled catalog entry for `deepseek/deepseek-coder` and independently expects $0.59976/month in the exported workbook. These checks do not validate the provider's live price.

The fixed graph fixture prices each agent invocation at $0.00816: Planner 300/month, Researcher 360/month pooled over two agents, and Reviewer 75/month yield $5.9976 Expected LLM spending. Low/High link overrides yield $3.0294/$11.934. The workbook's Summary formulas were recalculated with HyperFormula and match those values. Separate checks show that two callers contribute 397.5 Researcher invocations, an explicit zero Low probability remains zero, a doubled Expected root volume produces 720 Researcher invocations, and missing root volume marks descendants incomplete. Cycles and exclusive-branch sums above one are rejected.

Workbook formulas were independently evaluated with HyperFormula, including changing a calculation input and checking propagation to the summary. Microsoft Excel's desktop UI was not automated. The workbook's Read me sheet identifies which inputs are recalculable and where selected pricing tiers require a fresh export or explicit rate update.

## Current limits

- Daily-user volume entry, conditional model-call steps, and DAG agent-call propagation are implemented; historical monthly volume remains available as labeled legacy data. Automatic business-volume mapping is not.
- Sensitivity previews change one row input at a time and use the current local price snapshot. They do not persist the proposed value or include additional costs in the reported LLM delta. Detailed workflow execution changes are made in the workflow editor; the preview supports workload-volume changes for those rows.
- Agent links are planning averages. The app rejects cycles; bounded loop execution and a full call-graph runtime are not implemented. The `Agent links` workbook sheet shows formula contributions from frozen parent volumes, while derived row volumes are precomputed. Change links or upstream volumes in the app and re-export; the exported `Agents` sheet cannot reimport derived rows without rebuilding links.
- Pricing refresh is implemented with snapshot preservation and a before/after preview; live network refresh and every provider's billing rules were not covered by the deterministic E2E run.
- Catalog pricing is community-maintained. Models with missing or recognized unsupported prices remain visibly incomplete. Multimodal, hosted tool, storage, priority/flex, and contract-specific charges may require explicit additional items or custom rates.
- The 300-agent test verifies aggregate budgeting; it is not a performance benchmark for 1,000 individually expanded rows.
- Member descriptions generated during quick setup or legacy migration are explicitly marked pending and require the architect to replace them with real use cases. Counted members share group cost assumptions until individually customized. Identity expansion is capped at 5,000 agents per estimate.
- No live agent execution/monitoring, accounts, or cloud deployment is included.
