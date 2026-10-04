"""Deterministic accounting. No IO, provider calls, or floating-point currency."""

from decimal import Decimal

from .models import Estimate, Execution, Price, Scenario

ZERO = Decimal(0)
MILLION = Decimal(1000000)
PLANNING_DAYS_PER_MONTH = Decimal(30)
TOKEN_TYPES = (
    ("input", "input", "input"),
    ("cache_read", "cache_read", "cache"),
    ("cache_write", "cache_write", "cache_write"),
    ("output", "output", "output"),
)


def direct_monthly_invocations(row):
    if row.volume_source == "daily_users":
        if row.users_per_day is None or row.invocations_per_user_per_agent_per_day is None:
            return ZERO
        return row.users_per_day * row.invocations_per_user_per_agent_per_day * PLANNING_DAYS_PER_MONTH
    return row.invocations


def resolve_volumes(estimate: Estimate, scenario: Scenario | None = None):
    """Resolve direct and delegated row volumes in topological order."""
    rows = {row.id: row for row in estimate.agents}
    incoming = {row.id: [] for row in estimate.agents}
    outgoing = {row.id: [] for row in estimate.agents}
    degree = {row.id: 0 for row in estimate.agents}
    for link in estimate.links:
        incoming[link.child_id].append(link)
        outgoing[link.parent_id].append(link)
        degree[link.child_id] += 1
    ready = [row.id for row in estimate.agents if degree[row.id] == 0]
    volumes = {}
    contributions = {}
    while ready:
        row_id = ready.pop()
        row = rows[row_id]
        if row.volume_source == "derived":
            total = ZERO
            issues = []
            for link in incoming[row_id]:
                parent = volumes[link.parent_id]
                override = (
                    link.low
                    if scenario and scenario.name == "Low"
                    else link.high
                    if scenario and scenario.name == "High"
                    else None
                )
                probability = (
                    override.trigger_probability
                    if override and override.trigger_probability is not None
                    else link.trigger_probability
                )
                fanout = (
                    override.invocations_per_trigger
                    if override and override.invocations_per_trigger is not None
                    else link.invocations_per_trigger
                )
                step_probability = (
                    next(
                        step.execution_probability
                        for step in rows[link.parent_id].steps
                        if step.id == link.step_id
                    )
                    if link.step_id
                    else Decimal(1)
                )
                child_invocations = parent["total"] * step_probability * probability * fanout
                contributions[link.id] = {
                    "link_id": link.id,
                    "parent_id": link.parent_id,
                    "child_id": link.child_id,
                    "parent_total": parent["total"],
                    "trigger_probability": probability,
                    "step_probability": step_probability,
                    "invocations_per_trigger": fanout,
                    "child_total": child_invocations,
                    "complete": parent["complete"],
                }
                total += child_invocations
                if not parent["complete"]:
                    issues.append(f"Caller {rows[link.parent_id].name} volume is incomplete.")
            per_agent = total / Decimal(row.count)
        else:
            factor = scenario.volume_factor if scenario else Decimal(1)
            per_agent = direct_monthly_invocations(row) * factor
            total = Decimal(row.count) * per_agent
            issues = []
            if row.volume_source == "daily_users" and (
                row.users_per_day is None or row.invocations_per_user_per_agent_per_day is None
            ):
                issues.append("Enter users per day and invocations per user per agent per day.")
        volumes[row_id] = {
            "per_agent": per_agent,
            "total": total,
            "complete": not issues,
            "issues": list(dict.fromkeys(issues)),
        }
        for link in outgoing[row_id]:
            degree[link.child_id] -= 1
            if degree[link.child_id] == 0:
                ready.append(link.child_id)
    return volumes, contributions


def selected_rates(price: Price, input_tokens: Decimal):
    rates = {
        "input": price.input,
        "output": price.output,
        "cache_read": price.cache_read,
        "cache_write": price.cache_write,
    }
    for tier in sorted(price.tiers, key=lambda t: t.above):
        if input_tokens > tier.above:
            for key in rates:
                value = getattr(tier, key)
                if value is not None:
                    rates[key] = value
            # A base cached-read price is not evidence for a long-context cached price.
            if tier.cache_read is None:
                rates["cache_read"] = None
            if tier.cache_write is None:
                rates["cache_write"] = None
    return {key: value * price.fx_to_usd if value is not None else None for key, value in rates.items()}


def effective_execution(estimate: Estimate, row) -> Execution:
    return Execution(
        **(estimate.profiles[row.complexity].model_dump() | row.overrides.model_dump(exclude_none=True))
    )


def line_item(
    estimate: Estimate,
    row,
    execution: Execution,
    scenario: Scenario,
    step_name: str,
    base_volume,
    current_volume,
    probability=Decimal(1),
    step_id=None,
    role="",
    complexity=None,
):
    model_id = scenario.model_id if scenario.model_id is not None else execution.model_id
    volume = current_volume["per_agent"]
    calls = execution.calls * scenario.calls_factor * probability
    retry = execution.retry_rate * scenario.retry_factor
    input_tokens = execution.input_tokens * scenario.input_factor
    output_tokens = execution.output_tokens * scenario.output_factor
    monthly_calls = current_volume["total"] * calls * (1 + retry)
    cached_input = input_tokens * execution.cache_fraction
    cache_writes = input_tokens * execution.cache_write_fraction
    uncached_input = input_tokens - cached_input - cache_writes
    price = estimate.prices.get(model_id)
    issues = list(current_volume["issues"])
    rates = (
        selected_rates(price, input_tokens)
        if price
        else {"input": None, "output": None, "cache_read": None, "cache_write": None}
    )
    if monthly_calls > 0:
        if price is None:
            issues.append("Select a model with a price snapshot.")
        elif price.unsupported:
            issues.append(
                "Unsupported pricing: " + ", ".join(price.unsupported) + ". Use explicit custom rates."
            )
        else:
            if price.max_input and input_tokens > price.max_input:
                issues.append("Average input exceeds the model input limit.")
            if price.max_output and output_tokens > price.max_output:
                issues.append("Average output exceeds the model output limit.")
        for field, tokens in [
            ("input", uncached_input),
            ("output", output_tokens),
            ("cache_read", cached_input),
            ("cache_write", cache_writes),
        ]:
            if tokens > 0 and rates[field] is None:
                issues.append(f"Missing {field.replace('_', ' ')} price.")
    unit_issues = []
    if calls * (1 + retry) > 0:
        if price is None:
            unit_issues.append("Select a model with a price snapshot.")
        elif price.unsupported:
            unit_issues.append("Unsupported pricing: " + ", ".join(price.unsupported) + ".")
        else:
            if price.max_input and input_tokens > price.max_input:
                unit_issues.append("Average input exceeds the model input limit.")
            if price.max_output and output_tokens > price.max_output:
                unit_issues.append("Average output exceeds the model output limit.")
        for field, tokens in [
            ("input", uncached_input),
            ("output", output_tokens),
            ("cache_read", cached_input),
            ("cache_write", cache_writes),
        ]:
            if tokens > 0 and rates[field] is None:
                unit_issues.append(f"Missing {field.replace('_', ' ')} price.")
    unit_cost = (
        None
        if unit_issues
        else calls
        * (1 + retry)
        * (
            uncached_input * (rates["input"] or ZERO)
            + cached_input * (rates["cache_read"] or ZERO)
            + cache_writes * (rates["cache_write"] or ZERO)
            + output_tokens * (rates["output"] or ZERO)
        )
        / MILLION
    )
    costs = (
        None
        if issues
        else {
            "input": monthly_calls * uncached_input * (rates["input"] or ZERO) / MILLION,
            "cache": monthly_calls * cached_input * (rates["cache_read"] or ZERO) / MILLION,
            "cache_write": monthly_calls * cache_writes * (rates["cache_write"] or ZERO) / MILLION,
            "output": monthly_calls * output_tokens * (rates["output"] or ZERO) / MILLION,
        }
    )
    return {
        "row_id": row.id,
        "name": row.name,
        "step": step_name,
        "step_id": step_id,
        "role": role,
        "execution_probability": probability,
        "complexity": complexity or row.complexity,
        "count": row.count,
        "invocations": volume,
        "base_invocations": base_volume["per_agent"],
        "base_total_invocations": base_volume["total"],
        "volume_source": row.volume_source,
        "manual_invocations": row.invocations,
        "users_per_day": row.users_per_day,
        "invocations_per_user_per_agent_per_day": row.invocations_per_user_per_agent_per_day,
        "days_per_month": PLANNING_DAYS_PER_MONTH,
        "volume_factor": scenario.volume_factor,
        "calls_per_invocation": calls,
        "raw_calls_per_invocation": execution.calls * scenario.calls_factor,
        "retry_rate": retry,
        "input_per_call": input_tokens,
        "output_per_call": output_tokens,
        "cache_fraction": execution.cache_fraction,
        "monthly_calls": monthly_calls,
        "cache_write_fraction": execution.cache_write_fraction,
        "input_tokens": monthly_calls * input_tokens,
        "output_tokens": monthly_calls * output_tokens,
        "model_id": model_id,
        "provider": price.provider if price else "Unselected",
        "source_type": price.source_type if price else "",
        "channel": price.channel if price else "",
        "region": price.region if price else "",
        "rates": rates,
        "costs": costs,
        "cost": sum(costs.values(), ZERO) if costs else None,
        "issues": issues,
        "unit_cost": unit_cost,
        "unit_issues": unit_issues,
    }


def calculate(estimate: Estimate):
    base_volumes, base_links = resolve_volumes(estimate)
    category_invocations = {}
    for complexity in estimate.profiles:
        rows = [
            row
            for row in estimate.agents
            if (
                any((step.complexity or row.complexity) == complexity for step in row.steps)
                if row.steps
                else row.complexity == complexity
            )
        ]
        category_invocations[complexity] = {
            "total": sum((base_volumes[row.id]["total"] for row in rows), ZERO),
            "complete": all(base_volumes[row.id]["complete"] for row in rows),
        }
    recurring = sum(
        (c.amount * c.quantity for c in estimate.additional_costs if c.frequency == "monthly"), ZERO
    )
    one_time = sum(
        (c.amount * c.quantity for c in estimate.additional_costs if c.frequency == "one-time"), ZERO
    )
    scenarios = []
    for scenario in sorted(estimate.scenarios, key=lambda s: ["Low", "Expected", "High"].index(s.name)):
        scenario_volumes, scenario_links = resolve_volumes(estimate, scenario)
        lines = []
        for row in estimate.agents:
            if row.steps:
                for step in row.steps:
                    if step.model_calls:
                        for call in step.model_calls:
                            lines.append(
                                line_item(
                                    estimate,
                                    row,
                                    call,
                                    scenario,
                                    step.name,
                                    base_volumes[row.id],
                                    scenario_volumes[row.id],
                                    step.execution_probability * call.probability,
                                    step.id,
                                    call.role,
                                    step.complexity,
                                )
                            )
                    else:
                        lines.append(
                            line_item(
                                estimate,
                                row,
                                step,
                                scenario,
                                step.name,
                                base_volumes[row.id],
                                scenario_volumes[row.id],
                                step.execution_probability,
                                step.id,
                                complexity=step.complexity,
                            )
                        )
            else:
                lines.append(
                    line_item(
                        estimate,
                        row,
                        effective_execution(estimate, row),
                        scenario,
                        "Aggregate",
                        base_volumes[row.id],
                        scenario_volumes[row.id],
                    )
                )
        known = sum((line["cost"] for line in lines if line["cost"] is not None), ZERO)
        complete = all(not line["issues"] for line in lines)
        tool_lines = []
        for row in estimate.agents:
            for tool in row.tool_costs:
                step_probability = (
                    next(step.execution_probability for step in row.steps if step.id == tool.step_id)
                    if tool.step_id
                    else Decimal(1)
                )
                cost = (
                    scenario_volumes[row.id]["total"]
                    * step_probability
                    * tool.probability
                    * tool.expected_units_per_invocation
                    * tool.unit_cost
                )
                tool_lines.append(
                    {
                        "row_id": row.id,
                        "agent": row.name,
                        "name": tool.name,
                        "step_id": tool.step_id,
                        "step_probability": step_probability,
                        "probability": tool.probability,
                        "expected_units_per_invocation": tool.expected_units_per_invocation,
                        "unit_cost": tool.unit_cost,
                        "monthly_cost": cost,
                        "cost_per_invocation": step_probability
                        * tool.probability
                        * tool.expected_units_per_invocation
                        * tool.unit_cost,
                    }
                )
        tool_cost = sum((item["monthly_cost"] for item in tool_lines), ZERO)
        total_invocations = sum((item["total"] for item in scenario_volumes.values()), ZERO)
        step_executions = sum(
            (
                scenario_volumes[row.id]["total"] * step.execution_probability
                for row in estimate.agents
                for step in row.steps
            ),
            ZERO,
        )
        harness = estimate.harness
        harness_cost = (
            harness.fixed_monthly
            + total_invocations * harness.per_invocation
            + step_executions * harness.per_step_execution
            if harness.harness_type != "none"
            else ZERO
        )
        harness_allocations = {
            row.id: (
                harness_cost * scenario_volumes[row.id]["total"] / total_invocations
                if total_invocations
                else ZERO
            )
            for row in estimate.agents
        }
        model_cost_by_row = {row.id: ZERO for row in estimate.agents}
        tool_cost_by_row = {row.id: ZERO for row in estimate.agents}
        monthly_complete_by_row = {
            row.id: scenario_volumes[row.id]["complete"] for row in estimate.agents
        }
        for line in lines:
            model_cost_by_row[line["row_id"]] += line["cost"] or ZERO
            monthly_complete_by_row[line["row_id"]] &= not line["issues"]
        for item in tool_lines:
            tool_cost_by_row[item["row_id"]] += item["monthly_cost"]
        agent_costs = {}
        for row in estimate.agents:
            monthly_total = (
                model_cost_by_row[row.id] + tool_cost_by_row[row.id] + harness_allocations[row.id]
            )
            agent_costs[row.id] = {
                "monthly_total": monthly_total,
                "per_agent_monthly": monthly_total / Decimal(row.count) if row.count else ZERO,
                "complete": monthly_complete_by_row[row.id],
            }
        row_complete = {
            row.id: all(not line["unit_issues"] for line in lines if line["row_id"] == row.id)
            and scenario_volumes[row.id]["complete"]
            for row in estimate.agents
        }
        outgoing = {row.id: [] for row in estimate.agents}
        for link in estimate.links:
            outgoing[link.parent_id].append(link)
        loaded = {}

        def loaded_cost(row_id):
            if row_id in loaded:
                return loaded[row_id]
            volume = scenario_volumes[row_id]["total"]
            direct = sum(
                (
                    line["unit_cost"]
                    for line in lines
                    if line["row_id"] == row_id and line["unit_cost"] is not None
                ),
                ZERO,
            )
            direct += sum(
                (item["cost_per_invocation"] for item in tool_lines if item["row_id"] == row_id), ZERO
            )
            allocated = (
                harness_allocations[row_id] / volume
                if volume and harness.include_in_cost_per_use_case
                else ZERO
            )
            total = direct + allocated
            complete_row = row_complete[row_id]
            for link in outgoing[row_id]:
                contribution = scenario_links[link.id]
                child_cost, child_complete = loaded_cost(link.child_id)
                total += (
                    contribution["step_probability"]
                    * contribution["trigger_probability"]
                    * contribution["invocations_per_trigger"]
                    * child_cost
                )
                complete_row = complete_row and child_complete
            loaded[row_id] = (total, complete_row)
            return loaded[row_id]

        use_case_costs = {
            row.id: {
                "name": row.use_case_name or row.name,
                "monthly_invocations": scenario_volumes[row.id]["total"],
                "direct_cost_per_completion": (
                    sum(
                        (
                            line["unit_cost"]
                            for line in lines
                            if line["row_id"] == row.id and line["unit_cost"] is not None
                        ),
                        ZERO,
                    )
                    + sum(
                        (item["cost_per_invocation"] for item in tool_lines if item["row_id"] == row.id), ZERO
                    )
                ),
                "harness_per_completion": (
                    harness_allocations[row.id] / scenario_volumes[row.id]["total"]
                    if scenario_volumes[row.id]["total"]
                    else ZERO
                ),
                "loaded_cost_per_completion": loaded_cost(row.id)[0],
                "complete": loaded_cost(row.id)[1],
            }
            for row in estimate.agents
        }
        vendor_costs = {}
        for line in lines:
            key = (line["provider"], line["source_type"], line["channel"])
            entry = vendor_costs.setdefault(
                key,
                {
                    "provider": key[0],
                    "source_type": key[1],
                    "channel": key[2],
                    "monthly_cost": ZERO,
                    "complete": True,
                },
            )
            entry["monthly_cost"] += line["cost"] or ZERO
            entry["complete"] = entry["complete"] and not line["issues"]
        scenarios.append(
            {
                "name": scenario.name,
                "complete": complete,
                "llm_cost": known,
                "tool_cost": tool_cost,
                "harness_cost": harness_cost,
                "monthly_total": known + tool_cost + harness_cost + recurring,
                "annual_total": (known + tool_cost + harness_cost + recurring) * 12 + one_time,
                "first_month": known + tool_cost + harness_cost + recurring + one_time,
                "input_tokens": sum((line["input_tokens"] for line in lines), ZERO),
                "output_tokens": sum((line["output_tokens"] for line in lines), ZERO),
                "monthly_calls": sum((line["monthly_calls"] for line in lines), ZERO),
                "lines": lines,
                "tool_lines": tool_lines,
                "harness_allocations": harness_allocations,
                "agent_costs": agent_costs,
                "use_case_costs": use_case_costs,
                "vendor_costs": sorted(vendor_costs.values(), key=lambda item: -item["monthly_cost"]),
                "harness_drivers": {"invocations": total_invocations, "step_executions": step_executions},
                "volumes": scenario_volumes,
                "link_contributions": scenario_links,
            }
        )
    expected_lines = next(s["lines"] for s in scenarios if s["name"] == "Expected")
    lines_by_row = {}
    for line in expected_lines:
        lines_by_row.setdefault(line["row_id"], []).append(line)
    cost_drivers = []
    for row in estimate.agents:
        if row.count == 0:
            continue
        row_lines = lines_by_row.get(row.id, [])
        cost_drivers.append(
            {
                "row_id": row.id,
                "name": row.name,
                "complexity": row.complexity,
                "count": row.count,
                "known_cost": sum((line["cost"] for line in row_lines if line["cost"] is not None), ZERO),
                "complete": all(line["cost"] is not None for line in row_lines),
                "issues": list(dict.fromkeys(issue for line in row_lines for issue in line["issues"])),
            }
        )
    cost_drivers.sort(key=lambda item: (-item["known_cost"], item["name"].lower()))
    category_tokens = {}
    category_costs = {}
    for complexity in estimate.profiles:
        lines = [line for line in expected_lines if line["complexity"] == complexity]
        monthly_input = sum((line["input_tokens"] for line in lines), ZERO)
        monthly_output = sum((line["output_tokens"] for line in lines), ZERO)
        monthly_total = monthly_input + monthly_output
        category_tokens[complexity] = {
            "monthly_input": monthly_input,
            "monthly_output": monthly_output,
            "monthly_total": monthly_total,
            "daily_total": monthly_total / PLANNING_DAYS_PER_MONTH,
            "complete": category_invocations[complexity]["complete"],
        }
        entries = {}
        for line in lines:
            cached_read = line["input_tokens"] * line["cache_fraction"]
            cached_write = line["input_tokens"] * line["cache_write_fraction"]
            tokens_by_type = {
                "input": line["input_tokens"] - cached_read - cached_write,
                "cache_read": cached_read,
                "cache_write": cached_write,
                "output": line["output_tokens"],
            }
            for token_type, rate_key, cost_key in TOKEN_TYPES:
                tokens = tokens_by_type[token_type]
                if not tokens:
                    continue
                rate = line["rates"][rate_key]
                key = (token_type, line["model_id"], rate)
                entry = entries.setdefault(
                    key,
                    {
                        "token_type": token_type,
                        "model_id": line["model_id"],
                        "rate_per_million": rate,
                        "monthly_tokens": ZERO,
                        "monthly_cost": ZERO,
                        "complete": True,
                        "issues": [],
                    },
                )
                entry["monthly_tokens"] += tokens
                if line["costs"] is None:
                    entry["complete"] = False
                    entry["issues"] = list(dict.fromkeys(entry["issues"] + line["issues"]))
                else:
                    entry["monthly_cost"] += line["costs"][cost_key]
        type_totals = {}
        for token_type, _, _ in TOKEN_TYPES:
            matching = [entry for entry in entries.values() if entry["token_type"] == token_type]
            type_tokens = sum((entry["monthly_tokens"] for entry in matching), ZERO)
            type_cost = sum((entry["monthly_cost"] for entry in matching), ZERO)
            type_totals[token_type] = {
                "monthly_tokens": type_tokens,
                "daily_tokens": type_tokens / PLANNING_DAYS_PER_MONTH,
                "monthly_cost": type_cost,
                "daily_cost": type_cost / PLANNING_DAYS_PER_MONTH,
                "complete": category_invocations[complexity]["complete"]
                and all(entry["complete"] for entry in matching),
            }
        monthly_cost = sum((line["cost"] for line in lines if line["cost"] is not None), ZERO)
        input_types = ("input", "cache_read", "cache_write")
        category_costs[complexity] = {
            "monthly_cost": monthly_cost,
            "daily_cost": monthly_cost / PLANNING_DAYS_PER_MONTH,
            "monthly_input_cost": sum(
                (type_totals[token_type]["monthly_cost"] for token_type in input_types), ZERO
            ),
            "monthly_output_cost": type_totals["output"]["monthly_cost"],
            "input_complete": all(type_totals[token_type]["complete"] for token_type in input_types),
            "output_complete": type_totals["output"]["complete"],
            "complete": category_invocations[complexity]["complete"]
            and all(not line["issues"] for line in lines),
            "types": type_totals,
            "entries": list(entries.values()),
        }
    monthly_token_summary = {
        "input_tokens": sum((item["monthly_input"] for item in category_tokens.values()), ZERO),
        "output_tokens": sum((item["monthly_output"] for item in category_tokens.values()), ZERO),
        "total_tokens": sum((item["monthly_total"] for item in category_tokens.values()), ZERO),
        "input_cost": sum((item["monthly_input_cost"] for item in category_costs.values()), ZERO),
        "output_cost": sum((item["monthly_output_cost"] for item in category_costs.values()), ZERO),
        "total_cost": sum((item["monthly_cost"] for item in category_costs.values()), ZERO),
        "tokens_complete": all(item["complete"] for item in category_tokens.values()),
        "input_complete": all(item["input_complete"] for item in category_costs.values()),
        "output_complete": all(item["output_complete"] for item in category_costs.values()),
        "complete": all(item["complete"] for item in category_costs.values()),
    }
    warnings = []
    if all(s["complete"] for s in scenarios) and not (
        scenarios[0]["llm_cost"] <= scenarios[1]["llm_cost"] <= scenarios[2]["llm_cost"]
    ):
        warnings.append("Scenario costs are not ordered Low ≤ Expected ≤ High. Review the assumptions.")
    if any(price.tiers for price in estimate.prices.values()):
        warnings.append(
            "Context pricing tiers use average input per call. Split steps when calls cross a threshold."
        )
    return {
        "scenarios": scenarios,
        "category_invocations": category_invocations,
        "category_tokens": category_tokens,
        "category_costs": category_costs,
        "base_volumes": base_volumes,
        "base_links": base_links,
        "cost_drivers": cost_drivers,
        "monthly_token_summary": monthly_token_summary,
        "agent_count": sum(r.count for r in estimate.agents),
        "recurring": recurring,
        "one_time": one_time,
        "warnings": warnings,
    }
