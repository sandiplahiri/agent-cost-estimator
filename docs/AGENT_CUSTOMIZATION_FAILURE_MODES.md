# Agent customization and graph failure modes

Recorded before changing split behavior and the graph editor. E2E verification uses independent expected volumes and costs.

| Failure | Expected result |
| --- | --- |
| Splitting one member of a direct group adds an agent | The original count falls by one, one individual is added, and total monthly invocations and costs stay unchanged until the individual is edited. |
| Splitting a derived child group drops incoming work | Every incoming edge is partitioned by the original group count, including Low/High fanout overrides; old and new child volumes sum to the former total in every scenario. |
| Splitting a child on an exclusive branch makes the branch probability count twice | The two destination edges share one branch event; the validator counts its probability once and requires matching scenario probabilities. |
| Splitting a caller group drops or doubles delegated work | Outgoing edges are copied to the individual with independent IDs and remapped step references; combined child work stays unchanged before customization. |
| A step-scoped outgoing edge points to the original agent's step after a copy | The new edge points to the matching step of the new individual. |
| Customization edits the whole source group | Only the new individual gets the draft changes; the remaining group keeps its assumptions. |
| A graph edit creates a cycle, invalid probability, or missing endpoint | The proposed link is rejected before application, the draft remains usable, and the error identifies the path or field. |
| An agent or link cannot be found on the canvas by keyboard | Every node and link has a labeled focusable control and the inspector exposes equivalent actions. |
| A group is mistaken for one agent | Canvas nodes display the group count; one-agent customization has a clear action on group nodes. |
| Editing a selected individual silently changes its complexity profile or the remaining group | The graph inspector saves changes to that individual's row or step only; category defaults and sibling agents retain their values. |
| Changing an individual's complexity silently changes its model or call assumptions | The inspector preserves that individual's currently effective execution values as row overrides before changing its complexity tier. |
| Editing the graph inspector changes a detailed workflow through unused aggregate overrides | The inspector directs detailed model and step editing to the workflow editor; inline execution fields edit only the effective aggregate call or sole simple step. |
| Choosing a new model in the graph loses its price snapshot | The selected catalog price is copied into the estimate before validation and saved with that agent change. |
| A failed or stale inspector save discards entered work | Validation occurs before applying the candidate estimate; errors stay in the inspector with its draft intact. |
| Switching to Suite planner discards an unapplied agent edit | The graph's selected agent and inspector draft live above the tab views and reappear when returning to the graph for the same estimate. |
