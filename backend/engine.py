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


def monthly_invocations(row):
    if row.volume_source == "daily_users":
        if row.users_per_day is None or row.invocations_per_user_per_agent_per_day is None:
            return ZERO
        return row.users_per_day * row.invocations_per_user_per_agent_per_day * PLANNING_DAYS_PER_MONTH
    return row.invocations


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
    return rates


def effective_execution(estimate: Estimate, row) -> Execution:
    return Execution(
        **(estimate.profiles[row.complexity].model_dump() | row.overrides.model_dump(exclude_none=True))
    )


def line_item(estimate: Estimate, row, execution: Execution, scenario: Scenario, step_name: str):
    model_id = scenario.model_id if scenario.model_id is not None else execution.model_id
    base_volume = monthly_invocations(row)
    base_total_volume = Decimal(row.count) * base_volume
    volume = base_volume * scenario.volume_factor
    calls = execution.calls * scenario.calls_factor
    retry = execution.retry_rate * scenario.retry_factor
    input_tokens = execution.input_tokens * scenario.input_factor
    output_tokens = execution.output_tokens * scenario.output_factor
    monthly_calls = Decimal(row.count) * volume * calls * (1 + retry)
    cached_input = input_tokens * execution.cache_fraction
    cache_writes = input_tokens * execution.cache_write_fraction
    uncached_input = input_tokens - cached_input - cache_writes
    price = estimate.prices.get(model_id)
    issues = []
    if row.volume_source == "daily_users" and (
        row.users_per_day is None or row.invocations_per_user_per_agent_per_day is None
    ):
        issues.append("Enter users per day and invocations per user per agent per day.")
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
        "complexity": row.complexity,
        "count": row.count,
        "invocations": volume,
        "base_invocations": base_volume,
        "base_total_invocations": base_total_volume,
        "volume_source": row.volume_source,
        "manual_invocations": row.invocations,
        "users_per_day": row.users_per_day,
        "invocations_per_user_per_agent_per_day": row.invocations_per_user_per_agent_per_day,
        "days_per_month": PLANNING_DAYS_PER_MONTH,
        "volume_factor": scenario.volume_factor,
        "calls_per_invocation": calls,
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
        "rates": rates,
        "costs": costs,
        "cost": sum(costs.values(), ZERO) if costs else None,
        "issues": issues,
    }


def calculate(estimate: Estimate):
    category_invocations = {}
    for complexity in ("simple", "medium", "high"):
        rows = [row for row in estimate.agents if row.complexity == complexity]
        category_invocations[complexity] = {
            "total": sum((Decimal(row.count) * monthly_invocations(row) for row in rows), ZERO),
            "complete": all(
                row.volume_source != "daily_users"
                or (row.users_per_day is not None and row.invocations_per_user_per_agent_per_day is not None)
                for row in rows
            ),
        }
    recurring = sum(
        (c.amount * c.quantity for c in estimate.additional_costs if c.frequency == "monthly"), ZERO
    )
    one_time = sum(
        (c.amount * c.quantity for c in estimate.additional_costs if c.frequency == "one-time"), ZERO
    )
    scenarios = []
    for scenario in sorted(estimate.scenarios, key=lambda s: ["Low", "Expected", "High"].index(s.name)):
        lines = []
        for row in estimate.agents:
            if row.steps:
                lines.extend(line_item(estimate, row, step, scenario, step.name) for step in row.steps)
            else:
                lines.append(
                    line_item(estimate, row, effective_execution(estimate, row), scenario, "Aggregate")
                )
        known = sum((line["cost"] for line in lines if line["cost"] is not None), ZERO)
        complete = all(not line["issues"] for line in lines)
        scenarios.append(
            {
                "name": scenario.name,
                "complete": complete,
                "llm_cost": known,
                "monthly_total": known + recurring,
                "annual_total": (known + recurring) * 12 + one_time,
                "first_month": known + recurring + one_time,
                "input_tokens": sum((line["input_tokens"] for line in lines), ZERO),
                "output_tokens": sum((line["output_tokens"] for line in lines), ZERO),
                "monthly_calls": sum((line["monthly_calls"] for line in lines), ZERO),
                "lines": lines,
            }
        )
    expected_lines = next(s["lines"] for s in scenarios if s["name"] == "Expected")
    category_tokens = {}
    category_costs = {}
    for complexity in ("simple", "medium", "high"):
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
        category_costs[complexity] = {
            "monthly_cost": monthly_cost,
            "daily_cost": monthly_cost / PLANNING_DAYS_PER_MONTH,
            "complete": category_invocations[complexity]["complete"]
            and all(not line["issues"] for line in lines),
            "types": type_totals,
            "entries": list(entries.values()),
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
        "agent_count": sum(r.count for r in estimate.agents),
        "recurring": recurring,
        "one_time": one_time,
        "warnings": warnings,
    }
