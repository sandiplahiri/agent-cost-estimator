from decimal import Decimal, localcontext
from typing import Annotated, Literal
from uuid import UUID, uuid4, uuid5

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Amount = Annotated[Decimal, Field(ge=0, le=Decimal("1e15"), allow_inf_nan=False)]
Ratio = Annotated[Decimal, Field(ge=0, le=1, allow_inf_nan=False)]
PREDEFINED_COMPLEXITIES = ("simple", "medium", "high")
Complexity = str


def valid_distribution(probabilities):
    # Bound pathological exponents and add without the default 28-digit rounding.
    values = list(probabilities)
    if any(value.as_tuple().exponent < -1000 for value in values):
        raise ValueError("Selection probabilities support at most 1,000 decimal places.")
    with localcontext() as context:
        context.prec = 1105
        return sum(values, Decimal(0)) == 1


def category_name(value: str) -> str:
    name = value.strip()
    if not name or len(name) > 80:
        raise ValueError("Category name must contain 1–80 nonblank characters.")
    return name


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Tier(Record):
    above: Amount
    input: Amount | None = None
    output: Amount | None = None
    cache_read: Amount | None = None
    cache_write: Amount | None = None


class Price(Record):
    id: str = Field(min_length=1, max_length=300)
    provider: str = Field(min_length=1, max_length=100)
    source_type: Literal["vendor_api", "cloud_marketplace", "self_hosted", "fine_tuned", "custom"] = (
        "vendor_api"
    )
    channel: str = Field(default="", max_length=120)
    region: str = Field(default="", max_length=100)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    fx_to_usd: Amount = Decimal(1)
    fx_source: str = Field(default="", max_length=500)
    fx_retrieved_at: str = Field(default="", max_length=100)
    input: Amount | None = None
    output: Amount | None = None
    cache_read: Amount | None = None
    cache_write: Amount | None = None
    tiers: list[Tier] = Field(default_factory=list, max_length=20)
    max_input: Amount | None = None
    max_output: Amount | None = None
    source: str = Field(max_length=500)
    retrieved_at: str = Field(max_length=100)
    custom: bool = False
    unsupported: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def currency_conversion(self):
        if self.currency != "USD" and "fx_to_usd" not in self.model_fields_set:
            raise ValueError("Non-USD prices require an explicit USD conversion rate.")
        return self


class ComplexityProfile(Record):
    calls: Amount = Decimal(1)
    input_tokens: Amount = Decimal(2000)
    output_tokens: Amount = Decimal(500)
    retry_rate: Amount = Decimal("0.02")
    cache_fraction: Ratio = Decimal(0)
    cache_write_fraction: Ratio = Decimal(0)

    @model_validator(mode="after")
    def cache_partition(self):
        if self.cache_fraction + self.cache_write_fraction > 1:
            raise ValueError("Cached read and cache write fractions cannot exceed 100% of input combined.")
        return self


class Execution(ComplexityProfile):
    model_id: str = Field(default="", max_length=300)


class Overrides(Record):
    calls: Amount | None = None
    input_tokens: Amount | None = None
    output_tokens: Amount | None = None
    retry_rate: Amount | None = None
    cache_fraction: Ratio | None = None
    cache_write_fraction: Ratio | None = None
    model_id: str | None = Field(default=None, max_length=300)


class Step(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    name: str = Field(default="Model call", min_length=1, max_length=120)
    complexity: Complexity | None = None
    execution_probability: Ratio = Decimal(1)
    low_execution_probability: Ratio | None = None
    high_execution_probability: Ratio | None = None
    action_type: Literal["model", "agent"]
    model_calls: list["ModelCall"] = Field(default_factory=list, max_length=100)
    agent_calls: list["AgentCall"] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def distinct_agent_targets(self):
        if len({option.child_agent_id for option in self.agent_calls}) != len(self.agent_calls):
            raise ValueError(
                "Each individual agent can appear only once in a step. Add another step for an additional invocation."
            )
        return self


class ModelCall(Execution):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    role: str = Field(default="", max_length=120)
    probability: Ratio


class ToolCost(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    unit_cost: Amount
    expected_units_per_invocation: Amount = Decimal(1)
    probability: Ratio = Decimal(1)
    step_id: str | None = Field(default=None, max_length=100)


class Harness(Record):
    name: str = Field(default="Agent harness", min_length=1, max_length=120)
    harness_type: Literal["none", "managed_platform", "self_built", "hybrid"] = "none"
    fixed_monthly: Amount = Decimal(0)
    per_invocation: Amount = Decimal(0)
    per_step_execution: Amount = Decimal(0)
    allocation: Literal["by_invocations"] = "by_invocations"
    include_in_cost_per_use_case: bool = True


class AgentIdentity(Record):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    business_use_case_description: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def meaningful_fields(self):
        if not all((self.id.strip(), self.name.strip(), self.business_use_case_description.strip())):
            raise ValueError("Agent ID, name, and business use case description cannot be blank.")
        return self


class AgentRow(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    use_case_name: str = Field(default="", max_length=120)
    use_case_description: str = Field(default="", max_length=2000)
    members: list[AgentIdentity] = Field(default_factory=list, max_length=5000)
    complexity: Complexity = Field(default="simple", min_length=1, max_length=80)
    count: int = Field(default=1, ge=0, le=5000)
    invocations: Amount = Decimal(1000)
    volume_source: Literal["manual", "daily_users", "derived"] = "manual"
    prior_volume_source: Literal["manual", "daily_users"] | None = None
    users_per_day: Amount | None = None
    invocations_per_user_per_agent_per_day: Amount | None = None
    overrides: Overrides = Field(default_factory=Overrides)
    steps: list[Step] = Field(default_factory=list, max_length=100)
    tool_costs: list[ToolCost] = Field(default_factory=list, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def generate_members(cls, value):
        if not isinstance(value, dict) or "members" in value:
            return value
        count = value.get("count", 1)
        if not isinstance(count, int) or count < 0 or count > 5000:
            return value
        row_id = value.get("id") or str(uuid4())
        row_name = value.get("name", "Agent")
        description = value.get("use_case_description") or "Business use case pending description"
        members = [
            {
                "id": row_id
                if count == 1
                else str(uuid5(UUID("e83891b3-a81b-4231-a37f-63d61927bc3d"), f"{row_id}:{index}")),
                "name": row_name if count == 1 else f"{row_name} {index + 1}",
                "business_use_case_description": description,
            }
            for index in range(count)
        ]
        return {**value, "id": row_id, "members": members}

    @model_validator(mode="after")
    def member_count(self):
        if len(self.members) != self.count:
            raise ValueError(f"{self.name}: agent identities must match the agent count.")
        return self


class Scenario(Record):
    name: Literal["Low", "Expected", "High"]
    volume_factor: Amount = Decimal(1)
    calls_factor: Amount = Decimal(1)
    input_factor: Amount = Decimal(1)
    output_factor: Amount = Decimal(1)
    retry_factor: Amount = Decimal(1)
    model_id: str | None = Field(default=None, max_length=300)


class LinkOverride(Record):
    trigger_probability: Ratio | None = None


class AgentLink(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    parent_id: str = Field(min_length=1, max_length=100)
    child_id: str = Field(min_length=1, max_length=100)
    trigger_probability: Ratio = Decimal(1)
    step_id: str = Field(min_length=1, max_length=100)
    low: LinkOverride = Field(default_factory=LinkOverride)
    high: LinkOverride = Field(default_factory=LinkOverride)


class AgentCall(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    child_agent_id: str = Field(min_length=1, max_length=100)
    probability: Ratio
    low: LinkOverride = Field(default_factory=LinkOverride)
    high: LinkOverride = Field(default_factory=LinkOverride)


class AdditionalCost(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(min_length=1, max_length=120)
    amount: Amount
    quantity: Amount = Decimal(1)
    frequency: Literal["monthly", "one-time"] = "monthly"


class Estimate(Record):
    schema_version: Literal[10] = 10
    defaults_version: Literal[1] = 1
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(default="Untitled agent suite", min_length=1, max_length=120)
    notes: str = Field(default="", max_length=10000)
    profiles: dict[Complexity, ComplexityProfile] = Field(max_length=53)
    agents: list[AgentRow] = Field(default_factory=list, max_length=1000)
    links: list[AgentLink] = Field(default_factory=list, max_length=10000)
    scenarios: list[Scenario] = Field(max_length=3, min_length=3)
    prices: dict[str, Price] = Field(default_factory=dict, max_length=5000)
    additional_costs: list[AdditionalCost] = Field(default_factory=list, max_length=200)
    harness: Harness = Field(default_factory=Harness)

    @model_validator(mode="after")
    def project_actions(self):
        """Derive graph edges and child workload from step options."""
        # Targets identify named agents, never a shared row or complexity profile.
        targets = {
            option.child_agent_id for row in self.agents for step in row.steps for option in step.agent_calls
        }
        member_ids = [member.id for row in self.agents for member in row.members]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError("Agent IDs must be unique across the suite.")
        if not targets.issubset(member_ids):
            raise ValueError("Agent targets must reference individual agent IDs from the same suite.")
        expanded = []
        for row in self.agents:
            selected = [member for member in row.members if member.id in targets]
            if row.count <= 1 or not selected:
                expanded.append(row)
                continue
            remaining = [member for member in row.members if member.id not in targets]
            if remaining:
                retained = row.model_copy(deep=True)
                retained.members = remaining
                retained.count = len(remaining)
                if retained.count == 1:
                    retained.name = remaining[0].name
                expanded.append(retained)
            for member in selected:
                individual = row.model_copy(deep=True)
                individual.id = str(
                    uuid5(
                        UUID("e83891b3-a81b-4231-a37f-63d61927bc3d"), f"target:{self.id}:{row.id}:{member.id}"
                    )
                )
                individual.name = member.name
                individual.members = [member]
                individual.count = 1
                individual.use_case_description = member.business_use_case_description
                step_ids = {}
                for step in individual.steps:
                    previous_id = step.id
                    step.id = str(uuid5(UUID(individual.id), f"step:{previous_id}"))
                    step_ids[previous_id] = step.id
                    for option in [*step.model_calls, *step.agent_calls]:
                        option.id = str(uuid5(UUID(individual.id), f"option:{option.id}"))
                for tool in individual.tool_costs:
                    tool.id = str(uuid5(UUID(individual.id), f"tool:{tool.id}"))
                    if tool.step_id:
                        tool.step_id = step_ids.get(tool.step_id, tool.step_id)
                expanded.append(individual)
        self.agents = expanded
        member_rows = {member.id: row.id for row in self.agents for member in row.members}
        previous_children = {link.child_id for link in self.links}
        projected = [
            AgentLink(
                id=option.id,
                parent_id=row.id,
                child_id=member_rows[option.child_agent_id],
                step_id=step.id,
                trigger_probability=option.probability,
                low=option.low,
                high=option.high,
            )
            for row in self.agents
            for step in row.steps
            if step.action_type == "agent"
            for option in step.agent_calls
        ]
        self.links = projected
        child_ids = {link.child_id for link in self.links}
        for row in self.agents:
            if row.id in child_ids and row.volume_source != "derived":
                row.prior_volume_source = row.volume_source
                row.volume_source = "derived"
            elif row.id in previous_children - child_ids and row.volume_source == "derived":
                row.volume_source = row.prior_volume_source or "daily_users"
                row.prior_volume_source = None
        return self

    @model_validator(mode="after")
    def consistency(self):
        if not set(PREDEFINED_COMPLEXITIES).issubset(self.profiles):
            raise ValueError("Simple, medium, and high complexity profiles are required.")
        names = list(self.profiles)
        if any(category_name(name) != name for name in names):
            raise ValueError("Category names cannot have leading or trailing spaces.")
        if len({name.casefold() for name in names}) != len(names):
            raise ValueError("Category names must be unique, ignoring case.")
        if {s.name for s in self.scenarios} != {"Low", "Expected", "High"}:
            raise ValueError("Low, Expected, and High scenarios must each occur once.")
        if len({r.id for r in self.agents}) != len(self.agents):
            raise ValueError("Agent row IDs must be unique.")
        if len(self.agents) > 1000:
            raise ValueError("An estimate can contain at most 1,000 independent agent definitions.")
        if sum(row.count for row in self.agents) > 5000:
            raise ValueError("An estimate can contain at most 5,000 agents.")
        members = [member for row in self.agents for member in row.members]
        if len({member.id for member in members}) != len(members):
            raise ValueError("Agent IDs must be unique across the suite.")
        if len({member.name.strip().casefold() for member in members}) != len(members):
            raise ValueError("Agent names must be unique across the suite.")
        if len({link.id for link in self.links}) != len(self.links):
            raise ValueError("Agent link IDs must be unique.")
        if any(key != price.id for key, price in self.prices.items()):
            raise ValueError("Price snapshot keys must match their model IDs.")
        rows = {row.id: row for row in self.agents}
        for row in self.agents:
            if row.complexity not in self.profiles:
                raise ValueError(f"{row.name}: add the {row.complexity} category to this estimate first.")
            step_ids = {step.id for step in row.steps}
            if len(step_ids) != len(row.steps):
                raise ValueError(f"{row.name}: step IDs must be unique.")
            for step in row.steps:
                options = step.model_calls if step.action_type == "model" else step.agent_calls
                other = step.agent_calls if step.action_type == "model" else step.model_calls
                if not options or other:
                    raise ValueError(
                        f"{row.name} / {step.name}: choose exactly one nonempty model or agent option list."
                    )
                if len({option.id for option in options}) != len(options):
                    raise ValueError(f"{row.name} / {step.name}: option IDs must be unique.")
                if not valid_distribution(option.probability for option in options):
                    raise ValueError(f"{row.name} / {step.name}: option probabilities must total 1.0.")
                if step.action_type == "model" and any(not call.model_id.strip() for call in options):
                    raise ValueError(f"{row.name} / {step.name}: select a model for every option.")
                if step.action_type == "agent":
                    for scenario_name in ("low", "high"):
                        probabilities = (
                            getattr(option, scenario_name).trigger_probability
                            if getattr(option, scenario_name).trigger_probability is not None
                            else option.probability
                            for option in options
                        )
                        if not valid_distribution(probabilities):
                            raise ValueError(
                                f"{row.name} / {step.name}: {scenario_name} option probabilities must total 1.0."
                            )
                if step.complexity is not None and step.complexity not in self.profiles:
                    raise ValueError(
                        f"{row.name} / {step.name}: add the {step.complexity} profile to this estimate first."
                    )
            for tool in row.tool_costs:
                if tool.step_id and tool.step_id not in step_ids:
                    raise ValueError(f"{row.name}: tool {tool.name} references a missing step.")
        incoming = {row.id: 0 for row in self.agents}
        outgoing = {row.id: [] for row in self.agents}
        for link in self.links:
            parent, child = rows.get(link.parent_id), rows.get(link.child_id)
            if parent is None or child is None:
                raise ValueError("Agent links must reference existing parent and child rows.")
            if link.parent_id == link.child_id:
                raise ValueError(f"Agent link for {parent.name} cannot call itself.")
            incoming[child.id] += 1
            outgoing[parent.id].append(child.id)
        for row in self.agents:
            if row.volume_source == "derived" and incoming[row.id] == 0:
                raise ValueError(f"{row.name}: derived volume needs at least one incoming agent link.")
            if row.volume_source == "derived" and row.count == 0:
                raise ValueError(f"{row.name}: at least one agent is required to receive linked work.")
        degrees = incoming.copy()
        ready = [row.id for row in self.agents if degrees[row.id] == 0]
        seen = 0
        while ready:
            parent_id = ready.pop()
            seen += 1
            for child_id in outgoing[parent_id]:
                degrees[child_id] -= 1
                if degrees[child_id] == 0:
                    ready.append(child_id)
        if seen != len(self.agents):
            visiting, visited, path = set(), set(), []

            def find_cycle(node):
                visiting.add(node)
                path.append(node)
                for child in outgoing[node]:
                    if child in visiting:
                        return path[path.index(child) :] + [child]
                    if child not in visited:
                        cycle = find_cycle(child)
                        if cycle:
                            return cycle
                path.pop()
                visiting.remove(node)
                visited.add(node)
                return None

            cycle = next((found for node in rows if node not in visited if (found := find_cycle(node))), None)
            names = " → ".join(rows[node].name for node in cycle) if cycle else "agent links"
            raise ValueError(
                f"Adding this link creates a cycle: {names}. Represent additional invocations with separate steps without a dependency cycle."
            )
        for row_number, row in enumerate(self.agents, start=2):
            try:
                Execution(
                    **(
                        self.profiles[row.complexity].model_dump()
                        | row.overrides.model_dump(exclude_none=True)
                    )
                )
            except ValidationError as exc:
                problem = exc.errors()[0]
                field = ".".join(map(str, problem["loc"])) or "cache_fraction/cache_write_fraction"
                raise ValueError(f"Row {row_number}, {field}: {problem['msg']}") from exc
        return self


def default_profiles() -> dict[str, ComplexityProfile]:
    return {
        "simple": ComplexityProfile(),
        "medium": ComplexityProfile(calls=4, input_tokens=6000, output_tokens=1000, retry_rate="0.05"),
        "high": ComplexityProfile(calls=10, input_tokens=15000, output_tokens=2000, retry_rate="0.10"),
    }


def default_scenarios() -> list[Scenario]:
    return [
        Scenario(name="Low", input_factor="0.75", output_factor="0.75"),
        Scenario(name="Expected"),
        Scenario(name="High", input_factor="1.5", output_factor="1.5"),
    ]
