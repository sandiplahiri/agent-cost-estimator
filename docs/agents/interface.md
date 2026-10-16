# Interface quality

Read this guide when changing budget presentation, controls, or editing flows. Read [Cost calculations](calculations.md) when changing numeric input validation or cost presentation, and [Pricing, scenarios, and persistence](persistence.md) for resets and overrides.

- Make the suite total prominent, distinguish partial totals, and provide breakdowns that reconcile to it. Display sufficiently precise values for small per-agent costs without obscuring the overall budget.
- Support keyboard navigation, labeled controls, accessible error messages, and clear loading/empty/error states. Keep bulk editing practical for hundreds of agents.
- Preserve unsaved work across recoverable errors. Avoid network calls on every input edit; calculate from the selected local pricing snapshot.
