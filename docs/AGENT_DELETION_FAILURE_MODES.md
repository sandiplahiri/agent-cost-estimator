# Individual agent deletion

Recorded before implementation, 2026-10-05. Delete acts on one named agent in the current estimate. It is confirmed, undoable, validated at the backend, and persisted only by Save.

- A member sharing execution settings must be deleted by its stable individual ID; sibling identities, workloads, steps, tools, and prices must remain unchanged. Removing the last member removes its stored definition.
- Block deletion of any target still referenced by an agent step, including zero-probability options or scenario-only positive selections. Identify the callers and steps. Do not remove options or rebalance distributions implicitly.
- Allow deletion of a caller with outgoing steps. Canonical link projection must remove those contributions, recalculate downstream volumes, and restore a child's retained direct source when its final caller disappears.
- Cancel, backend validation failure, or a stale asynchronous response must not change the estimate or lose unsaved work. Undo restores exact identities, assumptions, links, prices, and volume sources.
- Delete through inventory and an individual editor must have the same scope. A shared-settings editor must not expose a whole-definition Remove action that deletes several individuals accidentally.
- Save/reopen and Excel must reproduce the reduced agent count and totals. Deleting the final agent leaves a usable empty inventory; fixed suite costs can remain.

Independent fixture: two root individuals each have 300 monthly invocations, 1,000 input tokens at USD 2/M, and a delegation step executing with probability 0.5 to a USD 10/M specialist. A USD 0.001 tool charge on delegation contributes USD 0.30 for both roots. Two independent shared members and one Solo each have 30 direct invocations at USD 2/M. Initial monthly total is USD 4.68 (models 4.38 + tools 0.30), six agents. Delete one independent shared member: USD 4.62, five agents; Undo restores USD 4.68. Delete root one: specialist 150 invocations, models USD 2.28 + tools USD 0.15 = USD 2.43. Delete the last root: specialist restores its retained 90 direct invocations, model spending USD 1.08, four agents. Delete the remaining agents: zero invocations and model cost, with USD 5 enabled fixed harness still charged in an explicit empty-suite variant.

Artifacts: `artifacts/agent-deletion/input.json`, `saved.json`, `budget.xlsx`, `verification.json`, and full E2E results. Numerical checks use the actual app, persistence, export, and HyperFormula.
