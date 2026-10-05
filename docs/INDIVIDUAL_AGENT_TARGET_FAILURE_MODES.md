# Individual agent targets: failure modes and independent outcomes

Recorded before implementation, 2026-10-05. Verify through the local application with fixed synthetic prices.

- A category or shared inventory row is offered as a target: offer each named member and persist its stable agent identity, never the category/row identifier.
- A selected member receives only a share of the caller's work: route the entire probability-weighted contribution to that individual; do not divide by the former shared count.
- Untargeted members lose their direct workload: retain their definitions, inputs, and volume. Materialize targeted members separately without increasing the suite's agent count.
- Preview or Cancel splits the live inventory: normalize a copied candidate only; applying the validated edit updates the draft atomically.
- Editing a targeted member changes siblings: model, tokens, and use case changes affect only that individual. Stable target identities survive edits, copy, save/reopen, and export/import.
- A member/row identity collision selects a category: resolve targets exclusively through member IDs. Missing, self, and cyclic individual references must be rejected.
- Removing the last caller erases direct inputs: restore that individual's retained direct volume, leaving other members untouched.
- An import regenerates called identities or loses names: export/import named individual target IDs with the Agents and Step options sheets; validate the entire candidate before applying.

Independent fixture: Root has 300 monthly model calls at USD 0.002/call. Alice, Bob, and Cara start with 30 calls/month each at the same rate, so initial suite cost is USD 0.78. Root adds an agent step selecting Alice 0.8 / Bob 0.2: Alice receives 240 invocations, Bob 60, Cara keeps 30. Suite cost is USD 1.26 (0.60 + 0.48 + 0.12 + 0.06), with Root's loaded cost USD 0.004/invocation. Changing only Bob to USD 0.010/call produces USD 1.74. Removing Alice's last caller restores her 30 direct invocations. No additional agents or duplicated costs may appear.

Artifacts: artifacts/individual-agent-targets/input.json, budget.xlsx, graph.png, verification.json, and the full E2E report.
