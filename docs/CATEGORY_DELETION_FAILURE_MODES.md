# Custom category deletion: failure modes and expected outcomes

Record these outcomes before implementing deletion. Verification runs through the browser, local SQLite persistence, and an exported workbook.

| Failure mode | Expected outcome |
| --- | --- |
| An agent in the current draft uses the category, including a counted group | Deletion is blocked and identifies the agent/group; the category and estimate remain unchanged. |
| A saved estimate uses the category even though the current draft does not | The backend blocks deletion, identifies the saved estimate and agent/group, and retains the global category. |
| A category is deleted while the current draft changes during the request | The UI does not remove a profile from a newer draft or claim that draft is saved. |
| A predefined category is submitted for deletion | The backend rejects deletion and leaves all predefined profiles intact. |
| A category name is unknown or deleted twice | The backend reports that it no longer exists without changing any estimate. |
| An unused global category is deleted | The global starter disappears from new estimates, the current draft loses its unused profile, and active cost/category summaries and export no longer include it. |
| A saved estimate contains an unused snapshot of the deleted category | The snapshot remains available on reopen; it is not silently rewritten or repriced. |
| A category exists only as a historical local profile | It can be removed from the current draft when unused; the global catalog is unaffected. |

Fixed E2E fixture: one agent runs once per day for 30 planning days. Its simple profile makes one call of 2,000 input and 500 output tokens at USD 2/M input and USD 8/M output, yielding USD 0.24/month. A custom two-call profile with 1,000 input and 500 output tokens per call yields USD 0.36/month. After reassigning the agent to simple and deleting the unused custom category, the exported suite total must recalculate to USD 0.24/month.
