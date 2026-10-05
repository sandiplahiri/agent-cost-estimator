# Top five individual agents: failure modes and independent outcomes

Recorded before implementation. Use browser journeys and fixed-price Excel reconciliation; no isolated tests.

- Ranking counted groups instead of individual members: a three-member group costs USD 18 overall but USD 6 per member. Individual agents costing USD 12 / 10 / 8 must precede all three USD 6 members. Show exactly five: 12, 10, 8, 6, 6; deterministic name/ID ordering breaks ties.
- Including tools or harness in token cost: an agent with USD 4 token cost and USD 100 tool cost must remain outside this top five. Token costs come from canonical Expected priced lines only, divided by counted members without display rounding.
- Wrong names or use cases: display each member's actual agent name and its group's actual use_case_name, including shared use cases for counted members.
- Incorrect precision or missing prices: preserve small per-agent token costs with up to eight decimal places. Missing prices/workload remain incomplete or partial, and ranking uses known subtotals with a visible caveat.
- Missing limits or empty states: fewer than five agents produces fewer rows; no padding or invented agents. Exclude zero-count groups. No Show all control remains.
- Fixture reconciliation: with the agents above, Expected model total is USD 52 (12 + 10 + 8 + 18 + 4); spreadsheet formulas must recalculate USD 52, independently of the USD 100 tools. Scenario volume changes and individual overrides must update per-member costs once.
