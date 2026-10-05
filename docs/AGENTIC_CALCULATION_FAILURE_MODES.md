# Agentic calculation failure modes and expected outcomes

Written before the calculation changes. The E2E fixture uses independent arithmetic.

| Failure mode | Expected outcome |
| --- | --- |
| A conditional step is priced as certain | Each model and tool cost, step execution count, and step-scoped child invocation is multiplied by its step probability exactly once. |
| A model step invokes all its alternatives | Exactly one alternative is selected; cost is the sum of option probability × its own priced execution. |
| A target distribution differs from probability one | Validation rejects the estimate before it is saved or exported. |
| A model has no price, but has expected calls | The estimate is visibly incomplete and only known costs are labeled partial. Zero expected calls requires no price. |
| A derived child is also charged at its old direct volume | Its volume comes only from incoming links; previous direct inputs remain recoverable. |
| A step-scoped link points to a missing step or creates a cycle | Validation rejects it with an actionable error. |
| A copied agent changes the current budget | A copy begins unattached with zero direct volume; copied outgoing links do not create invocations until it is attached. |
| Fixed harness fees disappear at zero volume | The fee stays in the suite total and allocation remains zero until there is volume. |
| Per-invocation harness fees count only roots | The fee applies to all agent invocations, including derived children. |
| Tool and harness costs are hidden inside LLM costs | Separate model, tool, harness, and additional totals reconcile to the suite total and export. |
| An export uses a different workload or price snapshot | The workbook uses the same calculation result and frozen price records as the screen. |

The PRD also specifies later milestone features that are not implied by these acceptance cases; implementation status is tracked in `docs/IMPLEMENTATION.md`.
