from decimal import Decimal
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Amount = Annotated[Decimal, Field(ge=0, le=Decimal("1e15"), allow_inf_nan=False)]
Ratio = Annotated[Decimal, Field(ge=0, le=1, allow_inf_nan=False)]
Fanout = Annotated[Decimal, Field(ge=0, le=1000000, allow_inf_nan=False)]
Complexity = Literal["simple", "medium", "high"]


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
    name: str = Field(default="Model call", min_length=1, max_length=120)


class AgentRow(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(min_length=1, max_length=120)
    complexity: Complexity = "simple"
    count: int = Field(default=1, ge=0, le=100000)
    invocations: Amount = Decimal(1000)
    volume_source: Literal["manual", "daily_users", "derived"] = "manual"
    prior_volume_source: Literal["manual", "daily_users"] | None = None
    users_per_day: Amount | None = None
    invocations_per_user_per_agent_per_day: Amount | None = None
    overrides: Overrides = Field(default_factory=Overrides)
    steps: list[Step] = Field(default_factory=list, max_length=100)


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
    low: LinkOverride = Field(default_factory=LinkOverride)
    high: LinkOverride = Field(default_factory=LinkOverride)


class AdditionalCost(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(min_length=1, max_length=120)
    amount: Amount
    quantity: Amount = Decimal(1)
    frequency: Literal["monthly", "one-time"] = "monthly"


class Estimate(Record):
    schema_version: Literal[3] = 3
    defaults_version: Literal[1] = 1
    id: str = Field(default_factory=lambda: str(uuid4()), max_length=100)
    name: str = Field(default="Untitled agent suite", min_length=1, max_length=120)
    notes: str = Field(default="", max_length=10000)
    profiles: dict[Complexity, Execution]
    agents: list[AgentRow] = Field(default_factory=list, max_length=1000)
    links: list[AgentLink] = Field(default_factory=list, max_length=10000)
    scenarios: list[Scenario] = Field(max_length=3, min_length=3)
    prices: dict[str, Price] = Field(default_factory=dict, max_length=5000)
    additional_costs: list[AdditionalCost] = Field(default_factory=list, max_length=200)

    @model_validator(mode="before")
    @classmethod
    def migrate_previous(cls, value):
        if isinstance(value, dict) and value.get("schema_version", 1) in (1, 2):
            return {**value, "schema_version": 3, "links": value.get("links", [])}
        return value

    @model_validator(mode="after")
    def consistency(self):
        if set(self.profiles) != {"simple", "medium", "high"}:
            raise ValueError("All three complexity profiles are required.")
        if {s.name for s in self.scenarios} != {"Low", "Expected", "High"}:
            raise ValueError("Low, Expected, and High scenarios must each occur once.")
        if len({r.id for r in self.agents}) != len(self.agents):
            raise ValueError("Agent row IDs must be unique.")
        if len({link.id for link in self.links}) != len(self.links):
            raise ValueError("Agent link IDs must be unique.")
        if any(key != price.id for key, price in self.prices.items()):
            raise ValueError("Price snapshot keys must match their model IDs.")
        rows = {row.id: row for row in self.agents}
        incoming = {row.id: 0 for row in self.agents}
        outgoing = {row.id: [] for row in self.agents}
        branch_probabilities = {}
        for link in self.links:
            parent, child = rows.get(link.parent_id), rows.get(link.child_id)
            if parent is None or child is None:
                raise ValueError("Agent links must reference existing parent and child rows.")
            if link.parent_id == link.child_id:
                raise ValueError(f"Agent link for {parent.name} cannot call itself.")
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
                    key = (parent.id, link.branch_group, scenario_name)
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
            raise ValueError("Agent links contain a cycle. Remove it or model bounded work explicitly.")
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
