# Individual agent graph verification

From the repository root with the documented dependencies installed:

```sh
npm run build
npm run check
npx playwright test e2e/agent-graph.spec.ts
```

Compact graph icons display only the individual name and Expected monthly total cost. Click to edit all settings; Copy agent is available in that editor. `compact-icons-run.json` records the three passing journeys after this simplification.

The E2E journey writes `input.json`, `saved.json`, `budget.xlsx`, desktop/mobile screenshots, and `verification.json`. `run-report.json` and the three `suite-*.json` reports record the broader verification for this change, including the resolved obsolete creation-button selector.

All prices are synthetic fixed fixtures: USD 2 per million input tokens, USD 0 per million output tokens. Each agent initially uses 1,000 input tokens per invocation, one model call, no retries, cache, tools, or harness. The month has 30 planning days. Low and High retain the bundled illustrative token multipliers.

Independent Expected totals:

| Stage | Monthly work and calculation | USD |
| --- | --- | ---: |
| Initial | Two roots × 300; Alice 480; Bob 120; Cara and Dana 30 each. 1,260 × 0.002. | 2.52 |
| Edit one root | Planner 600; other root 300; Alice 720; Bob 180; Cara and Dana 30 each. 1,860 × 0.002. | 3.72 |
| Retarget Planner | Roots 900; Alice 540; Bob 60; Cara 300; Dana 30. 1,830 × 0.002. | 3.66 |
| Edit Cara | Cara doubles to 2,000 input tokens/call: add 300 × 0.002. | 4.26 |

The graph must keep six individual nodes throughout. Applying a shared member's changes separates only that member's settings; opening, previewing, and Cancel preserve ownership. The test verifies each named caller's arrows, including removal of Planner → Bob and addition of Planner → Cara without altering the other root's distribution. Invalid probabilities preserve the draft and previous graph until corrected.

HyperFormula recalculates workbook formulas and verifies the Expected Summary total against USD 4.26. Excel desktop is not automated. The layout is automatic and scrollable; drag and zoom interactions are not implemented.
