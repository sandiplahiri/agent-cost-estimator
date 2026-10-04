# Agent inventory monthly cost: failure modes and independent outcomes

- The second inventory column shows the agent's use case name. A pending name stays visibly pending rather than substituting a longer description as though it were the name.
- Total Cost is the Expected-scenario monthly cost of the agent's own model calls and tools plus its share of the harness. A called agent has its own row; including its cost in the caller would count it twice. Suite-level additional costs have no agent assignment.
- A counted group's total is divided equally among its members because they share execution and workload assumptions. If one member is edited and split out, its value changes without reallocating the other member's cost incorrectly.
- A derived-volume agent uses its derived monthly invocations. A change in an upstream caller or step changes that value and its displayed cost.
- Missing model pricing or workload marks that agent's cost incomplete. A known subtotal is labeled partial, while an unpriced zero subtotal says Incomplete. A valid zero workload or zero price remains a complete zero.
- Each complete row's value derives from the same Decimal calculation as the suite model, tool, and harness totals. When total invocations are positive, the sum across agent rows reconciles to those three suite components before display rounding; suite-level extras are excluded. At zero suite volume, a fixed harness fee remains unallocated at suite level.
