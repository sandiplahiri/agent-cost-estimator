# Custom complexity category failure modes

Expected outcomes for the end-to-end journey, before changing the calculation model:

| Failure mode | Independent expected outcome |
| --- | --- |
| A custom name duplicates a predefined or global name, ignoring case or surrounding spaces | Creation is rejected; the existing definition and estimate remain unchanged. |
| An agent references a category without a profile snapshot in its estimate | Backend validation rejects the estimate with an actionable category error. |
| A global category is created while an older estimate is open | The category can be added to that estimate explicitly; its profile is copied into the estimate without repricing other rows. |
| A category profile is edited in another estimate after one is saved | The saved estimate keeps its own profile and pricing snapshot, and reopening reproduces the same cost. |
| Custom-category usage or cost is omitted from a three-category loop | The custom category appears in invocation, token, cost, and workbook summaries; the suite total reconciles to all categories exactly once. |
| A custom category name contains Excel formula syntax | The workbook writes the name as literal text and refers to category cells in formulas. |
| Reset removes a custom category or changes agent assignments | Reset preserves category definitions and assignments, previews execution assumptions affected, and supports undo. |
| An older estimate lacks custom-category data | Migration keeps the three predefined profiles, volumes, and costs unchanged. |

For the fixed verification fixture: one custom-category agent used once per day for 30 planning days, with two model calls per invocation, 1,000 input and 500 output tokens per call, no retries or caching, and fixed rates of USD 2/M input and USD 8/M output, costs **USD 0.36/month** (60,000 input tokens at USD 0.12 plus 30,000 output tokens at USD 0.24). An independently priced predefined-category agent can be added to verify the suite sum.
