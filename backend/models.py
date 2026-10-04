from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID, uuid4, uuid5

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Amount = Annotated[Decimal, Field(ge=0, le=Decimal("1e15"), allow_inf_nan=False)]
Ratio = Annotated[Decimal, Field(ge=0, le=1, allow_inf_nan=False)]
Fanout = Annotated[Decimal, Field(ge=0, le=1000000, allow_inf_nan=False)]
PREDEFINED_COMPLEXITIES = ("simple", "medium", "high")
Complexity = str


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


class Execution(Record):
    calls: Amount = Decimal(1)
    input_tokens: Amount = Decimal(2000)
    output_tokens: Amount = Decimal(500)
    retry_rate: Amount = Decimal("0.02")
    cache_fraction: Ratio = Decimal(0)
    cache_write_fraction: Ratio = Decimal(0)
    model_id: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def cache_partition(self):
        if self.cache_fraction + self.cache_write_fraction > 1:
            raise ValueError("Cached read and cache write fractions cannot exceed 100% of input combined.")
        return self


class Overrides(Record):
    calls: Amount | None = None
    input_tokens: Amount | None = None
    output_tokens: Amount | None = None
    retry_rate: Amount | None = None
    cache_fraction: Ratio | None = None
    cache_write_fraction: Ratio | None = None
    model_id: str | None = Field(default=None, max_length=300)


class Step(Execution):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    name: str = Field(default="Model call", min_length=1, max_length=120)
    execution_probability: Ratio = Decimal(1)
    model_calls: list["ModelCall"] = Field(default_factory=list, max_length=100)


class ModelCall(Execution):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    role: str = Field(default="", max_length=120)
    probability: Ratio = Decimal(1)
    exclusive_group: str = Field(default="", max_length=80)


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
    def migrate_members(cls, value):
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
    invocations_per_trigger: Fanout | None = None


class AgentLink(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    parent_id: str = Field(min_length=1, max_length=100)
    child_id: str = Field(min_length=1, max_length=100)
    trigger_probability: Ratio = Decimal(1)
    invocations_per_trigger: Fanout = Decimal(1)
    branch_group: str = Field(default="", max_length=80)
    branch_event_id: str | None = Field(default=None, max_length=100)
    step_id: str | None = Field(default=None, max_length=100)
    low: LinkOverride = Field(default_factory=LinkOverride)
    high: LinkOverride = Field(default_factory=LinkOverride)


class AdditionalCost(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(min_length=1, max_length=120)
    amount: Amount
    quantity: Amount = Decimal(1)
    frequency: Literal["monthly", "one-time"] = "monthly"


class Estimate(Record):
    schema_version: Literal[7] = 7
    defaults_version: Literal[1] = 1
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(default="Untitled agent suite", min_length=1, max_length=120)
    notes: str = Field(default="", max_length=10000)
    profiles: dict[Complexity, Execution] = Field(max_length=53)
    agents: list[AgentRow] = Field(default_factory=list, max_length=1000)
    links: list[AgentLink] = Field(default_factory=list, max_length=10000)
    scenarios: list[Scenario] = Field(max_length=3, min_length=3)
    prices: dict[str, Price] = Field(default_factory=dict, max_length=5000)
    additional_costs: list[AdditionalCost] = Field(default_factory=list, max_length=200)
    harness: Harness = Field(default_factory=Harness)

    @model_validator(mode="before")
    @classmethod
    def migrate_previous(cls, value):
        if isinstance(value, dict) and value.get("schema_version", 1) in (1, 2, 3, 4, 5, 6):
            used_names = set()
            agents = []
            for row in value.get("agents", []):
                migrated = AgentRow.migrate_members(row) if isinstance(row, dict) else row
                if isinstance(migrated, dict):
                    for member in migrated.get("members", []):
                        base_name = member.get("name", "Agent")
                        candidate = base_name
                        suffix = 2
                        while candidate.strip().casefold() in used_names:
                            ending = f" ({suffix})"
                            candidate = f"{base_name[: 120 - len(ending)]}{ending}"
                            suffix += 1
                        member["name"] = candidate
                        used_names.add(candidate.strip().casefold())
                agents.append(migrated)
            return {**value, "schema_version": 7, "links": value.get("links", []), "agents": agents}
        return value

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
                groups = {}
                if len({call.id for call in step.model_calls}) != len(step.model_calls):
                    raise ValueError(f"{row.name} / {step.name}: model-call IDs must be unique.")
                for call in step.model_calls:
                    if call.exclusive_group:
                        groups[call.exclusive_group] = (
                            groups.get(call.exclusive_group, Decimal(0)) + call.probability
                        )
                if any(total > 1 for total in groups.values()):
                    raise ValueError(f"{row.name} / {step.name}: exclusive model probabilities exceed 1.")
            for tool in row.tool_costs:
                if tool.step_id and tool.step_id not in step_ids:
                    raise ValueError(f"{row.name}: tool {tool.name} references a missing step.")
        incoming = {row.id: 0 for row in self.agents}
        outgoing = {row.id: [] for row in self.agents}
        branch_events = {}
        for link in self.links:
            parent, child = rows.get(link.parent_id), rows.get(link.child_id)
            if parent is None or child is None:
                raise ValueError("Agent links must reference existing parent and child rows.")
            if link.parent_id == link.child_id:
                raise ValueError(f"Agent link for {parent.name} cannot call itself.")
            if link.step_id and link.step_id not in {step.id for step in parent.steps}:
                raise ValueError(f"{parent.name}: agent link references a missing step.")
            if child.volume_source != "derived":
                raise ValueError(f"{child.name}: convert to derived volume before adding an incoming link.")
            incoming[child.id] += 1
            outgoing[parent.id].append(child.id)
            if link.branch_group:
                for scenario_name, probability in (
                    ("Expected", link.trigger_probability),
                    (
                        "Low",
                        link.low.trigger_probability
                        if link.low.trigger_probability is not None
                        else link.trigger_probability,
                    ),
                    (
                        "High",
                        link.high.trigger_probability
                        if link.high.trigger_probability is not None
                        else link.trigger_probability,
                    ),
                ):
                    key = (
                        parent.id,
                        link.step_id,
                        link.branch_group,
                        scenario_name,
                        link.branch_event_id or link.id,
                    )
                    if key in branch_events and branch_events[key] != probability:
                        raise ValueError(
                            "Links sharing a branch event must use the same probability in each scenario."
                        )
                    branch_events[key] = probability
        branch_probabilities = {}
        for (parent_id, step_id, group, scenario_name, _), probability in branch_events.items():
            key = (parent_id, step_id, group, scenario_name)
            branch_probabilities[key] = branch_probabilities.get(key, Decimal(0)) + probability
        if any(total > 1 for total in branch_probabilities.values()):
            raise ValueError("Mutually exclusive branch probabilities cannot exceed 1 for any scenario.")
        for row in self.agents:
            if row.volume_source == "derived" and incoming[row.id] == 0:
                raise ValueError(f"{row.name}: derived volume needs at least one incoming agent link.")
            if row.volume_source == "derived" and row.count == 0:
                raise ValueError(f"{row.name}: a derived group needs at least one agent to receive work.")
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
                f"Adding this link creates a cycle: {names}. Model bounded work with multiplicity."
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


def default_profiles() -> dict[str, Execution]:
    return {
        "simple": Execution(),
        "medium": Execution(calls=4, input_tokens=6000, output_tokens=1000, retry_rate="0.05"),
        "high": Execution(calls=10, input_tokens=15000, output_tokens=2000, retry_rate="0.10"),
    }


def default_scenarios() -> list[Scenario]:
    return [
        Scenario(name="Low", input_factor="0.75", output_factor="0.75"),
        Scenario(name="Expected"),
        Scenario(name="High", input_factor="1.5", output_factor="1.5"),
    ]
