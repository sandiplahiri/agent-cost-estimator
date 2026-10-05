# Scenario monthly token summary: failure modes and independent outcomes

Recorded before implementation. Verification uses existing E2E journeys, not isolated/unit tests.

- Repeating Expected values for Low/High: the linked four-agent fixture must display Low input/output/total tokens 1,597,500 / 159,750 / 1,757,250 and input/output/total USD 2.745 / 1.098 / 3.843; Expected 2,130,000 / 213,000 / 2,343,000 and 3.66 / 1.464 / 5.124; High 3,195,000 / 319,500 / 3,514,500 and 5.49 / 2.196 / 7.686. Each row is one suite, counted once.
- Applying a percentage to Expected cost instead of scenario pricing: the fixed ten-call context fixture has 200,000 input and 1,000 output tokens per Expected call. Input is 50% uncached, 25% cache reads, 25% cache writes. Base rates USD 2 / 0.5 / 3 per million input types and 8 output change above 200,000 input tokens/call to USD 4 / 1 / 6 and 12 output. Low input/output/total tokens = 1,500,000 / 7,500 / 1,507,500 and USD 2.8125 / 0.06 / 2.8725. Expected = 2,000,000 / 10,000 / 2,010,000 and USD 3.75 / 0.08 / 3.83. High = 3,000,000 / 15,000 / 3,015,000 and USD 11.25 / 0.18 / 11.43.
- Double counting cache tokens or ignoring cache charges: count input once; include uncached, cached read, and write costs in input cost. Output already includes reasoning. Input cost + output cost must equal token cost.
- Treating unsupported or missing prices as zero: preserve known priced-line subtotals, token counts, and incomplete flags independently in each scenario. Missing workload produces partial token and monetary totals; explicit zero volume remains zero.
- Including tools, harness, or additional costs: Total token cost contains model token spending only, matching each scenario's LLM amount.
- Ignoring explicit scenario edits: doubling High invocation volume in the mortgage fixture produces High USD 48.96 while Expected remains USD 16.32.
- Repricing or rounding during aggregation: summarize the existing Decimal line components, with presentation rounding only. Frozen saved prices and workbook formulas must reproduce each scenario.
- Inconsistent export: the new Monthly scenario summary sheet must recalculate all three token/cost rows using HyperFormula, including the context threshold fixture. Preserve the existing Expected category worksheets.

## Harness and total columns (recorded before implementation)

- Using only token + harness as Total cost would omit tools and recurring extras. Total cost is the existing canonical monthly suite total: tokens + tools + harness + recurring extras; one-time items stay outside the monthly amount.
- Repeating Expected harness for other workloads: two agents have 60 Expected invocations, USD 6 fixed harness plus USD 0.10/invocation, USD 0.50 tool/invocation, USD 5 recurring extra, and USD 0.168 Expected model cost. Set Low volume to 0.5 with 0.75 token sizes, High volume to 2 with 1.5 token sizes. Low harness/total = USD 9 / 29.063; Expected = USD 12 / 47.168; High = USD 18 / 83.504.
- Treating missing model pricing as missing harness: with the same workload, unpriced models still leave Expected harness USD 12 known and Total cost USD 47 partial.
- Treating unknown workload as complete variable harness: a billed invocation or step driver with missing volume must mark the harness subtotal partial. No harness and a fixed-only harness remain complete because workload does not affect their cost.
- Double adding harness in Excel: the matching scenario sheet must reference the existing Summary harness and monthly total formulas; HyperFormula must reproduce the independently expected harness/total values for all three scenarios.

## Other costs column (recorded before implementation)

- Omitting tools or including harness twice: Other costs is monthly tools plus recurring additional items, excluding tokens, harness, and one-time items. For the two-agent fixture above, Low / Expected / High Other costs must be USD 20 / 35 / 65. Token cost + harness + Other costs must reconcile to the existing total without changing it.
- Repeating Expected tools for every scenario: use each scenario's actual tool cost; recurring extras remain USD 5 in this fixture.
- Treating missing model pricing as missing Other costs: Expected Other costs remains USD 35 complete when only the model is unpriced.
- Treating unknown billed tool volume as complete: missing workload leaves USD 5 recurring extras as a partial subtotal. Disabled or zero-charge tools leave USD 5 complete even with missing workload.
- Export drift: the Excel column between Harness and Total must sum the existing Summary recurring-extra and tool formulas; HyperFormula must reproduce USD 20 / 35 / 65 and preserve all monthly totals.
