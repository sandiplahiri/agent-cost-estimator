"""Atomic domain transformations for turning one group member into an independent agent."""

from decimal import Decimal
from uuid import uuid4

from .models import AgentRow, Estimate


def split_agent(
    estimate: Estimate, row_id: str, individual: AgentRow | None = None, member_id: str | None = None
) -> tuple[Estimate, str]:
    source = next((row for row in estimate.agents if row.id == row_id), None)
    if source is None:
        raise ValueError("Choose an existing agent group to customize.")
    if source.count < 2:
        raise ValueError(f"{source.name}: at least two agents are required to customize one member.")
    if individual is not None and individual.id != source.id:
        raise ValueError("The customized agent must come from the selected group.")
    if member_id is not None and not any(member.id == member_id for member in source.members):
        raise ValueError("Choose an agent that belongs to this group.")

    next_estimate = estimate.model_copy(deep=True)
    group = next(row for row in next_estimate.agents if row.id == row_id)
    original_count = group.count
    group.count -= 1
    member_index = next(
        (index for index, member in enumerate(group.members) if member.id == member_id),
        len(group.members) - 1,
    )
    member = group.members.pop(member_index)
    if individual is not None:
        member = next((item for item in individual.members if item.id == member.id), member)
    copy = group.model_copy(deep=True)
    copy.id = str(uuid4())
    copy.name = member.name
    copy.use_case_description = member.business_use_case_description
    copy.members = [member]
    copy.count = 1
    if individual is not None:
        for field in (
            "description",
            "use_case_name",
            "use_case_description",
            "complexity",
            "overrides",
            "steps",
            "tool_costs",
            "users_per_day",
            "invocations_per_user_per_agent_per_day",
            "invocations",
            "volume_source",
            "prior_volume_source",
        ):
            setattr(copy, field, getattr(individual, field))

    step_ids = {}
    for step in copy.steps:
        old_id = step.id
        step.id = str(uuid4())
        step_ids[old_id] = step.id
        for call in step.model_calls:
            call.id = str(uuid4())
    for tool in copy.tool_costs:
        tool.id = str(uuid4())
        if tool.step_id:
            if tool.step_id not in step_ids:
                raise ValueError(f"{tool.name}: choose an existing step before customizing this agent.")
            tool.step_id = step_ids[tool.step_id]
    next_estimate.agents.append(copy)

    # Partition incoming child work. The old group retains n-1 shares and the new row takes one.
    old_share = Decimal(original_count - 1) / Decimal(original_count)
    new_share = Decimal(1) / Decimal(original_count)
    new_links = []
    for link in next_estimate.links:
        if link.child_id == row_id:
            copied = link.model_copy(deep=True)
            copied.id = str(uuid4())
            copied.child_id = copy.id
            event_id = link.branch_event_id or link.id
            link.branch_event_id = event_id
            copied.branch_event_id = event_id
            original_fanout = link.invocations_per_trigger
            link.invocations_per_trigger = original_fanout * old_share
            copied.invocations_per_trigger = original_fanout * new_share
            for scenario in ("low", "high"):
                original_override = getattr(link, scenario).invocations_per_trigger
                if original_override is not None:
                    getattr(link, scenario).invocations_per_trigger = original_override * old_share
                    getattr(copied, scenario).invocations_per_trigger = original_override * new_share
            new_links.append(copied)
        if link.parent_id == row_id:
            copied = link.model_copy(deep=True)
            copied.id = str(uuid4())
            copied.parent_id = copy.id
            copied.branch_event_id = None
            if copied.step_id:
                if copied.step_id not in step_ids:
                    raise ValueError("Keep the caller step used by an outgoing link or edit that link first.")
                copied.step_id = step_ids[copied.step_id]
            new_links.append(copied)
    next_estimate.links.extend(new_links)
    validated = Estimate.model_validate(next_estimate.model_dump())
    return validated, copy.id
