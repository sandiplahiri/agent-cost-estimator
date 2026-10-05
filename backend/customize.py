"""Atomic transformations for individual agent customization and deletion."""

from uuid import uuid4

from .models import AgentRow, Estimate


class AgentDeletionBlocked(ValueError):
    pass


def delete_agent(estimate: Estimate, member_id: str) -> Estimate:
    source = next(
        (row for row in estimate.agents if any(member.id == member_id for member in row.members)), None
    )
    if source is None:
        raise ValueError("Choose an individual agent still in this estimate.")
    references = [
        f"{name} / {step.name}"
        for row in estimate.agents
        for step in row.steps
        if any(option.child_agent_id == member_id for option in step.agent_calls)
        for name in ([member.name for member in row.members] or [row.name])
    ]
    if references:
        raise AgentDeletionBlocked(
            "Remove or retarget these calling steps before deleting the agent: " + "; ".join(references)
        )
    updated = estimate.model_copy(deep=True)
    row = next(row for row in updated.agents if row.id == source.id)
    row.members = [member for member in row.members if member.id != member_id]
    row.count = len(row.members)
    if not row.members:
        updated.agents = [item for item in updated.agents if item.id != row.id]
    elif row.count == 1:
        row.name = row.members[0].name
        row.use_case_description = row.members[0].business_use_case_description
    # Keep the previous link projection so canonical validation can restore the
    # retained direct workload of children that lose their final caller.
    return Estimate.model_validate(updated.model_dump())


def split_agent(
    estimate: Estimate, row_id: str, individual: AgentRow | None = None, member_id: str | None = None
) -> tuple[Estimate, str]:
    source = next((row for row in estimate.agents if row.id == row_id), None)
    if source is None:
        raise ValueError("Choose an existing agent to customize.")
    if source.count < 2:
        raise ValueError(f"{source.name}: at least two agents are required to customize one member.")
    if individual is not None and individual.id != source.id:
        raise ValueError("The customized agent must match the selected entry.")
    if member_id is not None and not any(member.id == member_id for member in source.members):
        raise ValueError("Choose an agent listed in this entry.")

    next_estimate = estimate.model_copy(deep=True)
    group = next(row for row in next_estimate.agents if row.id == row_id)
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
        for option in step.agent_calls:
            option.id = str(uuid4())
    for tool in copy.tool_costs:
        tool.id = str(uuid4())
        if tool.step_id:
            if tool.step_id not in step_ids:
                raise ValueError(f"{tool.name}: choose an existing step before customizing this agent.")
            tool.step_id = step_ids[tool.step_id]
    next_estimate.agents.append(copy)

    validated = Estimate.model_validate(next_estimate.model_dump())
    return validated, copy.id
