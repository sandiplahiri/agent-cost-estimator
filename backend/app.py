import logging
from decimal import Decimal
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import Field, ValidationError, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import pricing, store, workbook
from .customize import split_agent
from .engine import calculate, summarize_tokens
from .models import (
    PREDEFINED_COMPLEXITIES,
    AgentRow,
    Amount,
    Estimate,
    ComplexityProfile,
    Record,
    category_name,
    default_profiles,
    default_scenarios,
)

app = FastAPI(title="Agent Ledger", docs_url="/api/docs")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


@app.middleware("http")
async def local_requests(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in (
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:8011",
        ):
            return JSONResponse({"detail": "Requests must come from the local app."}, status_code=403)
        # Bound both fixed-length and chunked bodies before parsing.
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 6_000_000:
                return JSONResponse({"detail": "Request exceeds the 6 MB limit."}, status_code=413)
        request._body = bytes(body)
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(
        status_code=422, content={"detail": [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]}
    )


@app.exception_handler(Exception)
async def server_error(request, exc):
    logging.error("Request %s failed: %s", request.url.path, type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "The operation failed. Your current estimate has not been replaced. Check the local server and try again."
        },
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/catalog")
def catalog():
    current = store.get_catalog()
    if current is None or (
        current.get("normalizer_version") != pricing.NORMALIZER_VERSION
        and current.get("source", "").endswith(" bundled catalog")
    ):
        current = pricing.bundled_catalog()
        store.save_catalog(current)
    return current


@app.post("/api/catalog/refresh")
def refresh():
    try:
        updated = pricing.refresh_catalog()
        store.save_catalog(updated)
        return updated
    except Exception as exc:
        raise HTTPException(
            502, "Could not refresh prices. Saved catalog and estimate snapshots remain available."
        ) from exc


@app.get("/api/new")
def new():
    profiles = default_profiles()
    profiles.update({item["name"]: item["profile"] for item in store.list_categories()})
    return Estimate(profiles=profiles, scenarios=default_scenarios())


@app.get("/api/categories")
def categories():
    return store.list_categories()


class CategoryRequest(Record):
    name: str = Field(min_length=1, max_length=80)
    profile: ComplexityProfile


@app.post("/api/categories")
def create_category(request: CategoryRequest):
    try:
        name = category_name(request.name)
        if name.casefold() in PREDEFINED_COMPLEXITIES:
            raise ValueError("Choose a name different from simple, medium, and high.")
        return store.add_category(name, request.profile)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class DeleteCategoryRequest(Record):
    name: str = Field(min_length=1, max_length=80)
    estimate: Estimate


@app.post("/api/categories/delete")
def delete_category(request: DeleteCategoryRequest):
    try:
        name = category_name(request.name)
        if name.casefold() in PREDEFINED_COMPLEXITIES:
            raise HTTPException(422, "Predefined complexity categories cannot be deleted.")
        return store.delete_category(name, request.estimate)
    except store.CategoryNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except store.CategoryInUseError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/calculate")
def calculate_api(estimate: Estimate):
    # Decimal must stay strings through JSON, not become binary floats.
    return JSONResponse(jsonable_encoder(calculate(estimate), custom_encoder={Decimal: str}))


class SplitRequest(Record):
    estimate: Estimate
    row_id: str = Field(min_length=1, max_length=100)
    individual: AgentRow | None = None
    member_id: str | None = Field(default=None, min_length=1, max_length=100)


class AgentCostRequest(Record):
    estimate: Estimate
    draft: AgentRow
    member_id: str | None = Field(default=None, min_length=1, max_length=100)


@app.post("/api/agents/cost")
def agent_cost_preview(request: AgentCostRequest):
    """Calculate an unsaved edit with the same transformation used by Apply."""
    updated = request.estimate.model_copy(deep=True)
    row_id = request.draft.id
    try:
        if request.member_id is not None:
            updated, row_id = split_agent(updated, row_id, request.draft, request.member_id)
        else:
            index = next((i for i, row in enumerate(updated.agents) if row.id == row_id), None)
            if index is None:
                updated.agents.append(request.draft)
            else:
                updated.agents[index] = request.draft
            updated = Estimate.model_validate(updated.model_dump())
    except ValidationError as exc:
        raise HTTPException(422, exc.errors()[0]["msg"]) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    expected = next(item for item in calculate(updated)["scenarios"] if item["name"] == "Expected")
    summary = summarize_tokens(
        [line for line in expected["lines"] if line["row_id"] == row_id],
        {row_id: expected["volumes"][row_id]},
    )
    return JSONResponse(jsonable_encoder(summary, custom_encoder={Decimal: str}))


@app.post("/api/agents/split")
def split_agent_api(request: SplitRequest):
    try:
        updated, individual_id = split_agent(
            request.estimate, request.row_id, request.individual, request.member_id
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return JSONResponse(
        jsonable_encoder(
            {"estimate": updated.model_dump(), "individual_id": individual_id},
            custom_encoder={Decimal: str},
        )
    )


SensitivityField = Literal[
    "users_per_day",
    "invocations_per_user_per_agent_per_day",
    "invocations",
    "calls",
    "input_tokens",
    "output_tokens",
    "retry_rate",
    "cache_fraction",
    "cache_write_fraction",
]


class SensitivityRequest(Record):
    estimate: Estimate
    row_id: str = Field(min_length=1, max_length=100)
    field: SensitivityField
    value: Amount

    @model_validator(mode="after")
    def fraction_bounds(self):
        if self.field in ("cache_fraction", "cache_write_fraction") and self.value > 1:
            raise ValueError("Cache fractions must be between 0 and 1.")
        return self


@app.post("/api/sensitivity")
def sensitivity(request: SensitivityRequest):
    original = request.estimate
    changed = original.model_copy(deep=True)
    row = next((item for item in changed.agents if item.id == request.row_id), None)
    if row is None:
        raise HTTPException(422, "Choose an agent that is still in this estimate.")
    if row.count == 0:
        raise HTTPException(422, "Choose an entry with at least one agent.")
    if request.field in ("users_per_day", "invocations_per_user_per_agent_per_day"):
        if row.volume_source != "daily_users":
            raise HTTPException(422, "This agent uses legacy monthly volume.")
        setattr(row, request.field, request.value)
    elif request.field == "invocations":
        if row.volume_source != "manual":
            raise HTTPException(422, "This agent uses daily-user volume.")
        row.invocations = request.value
    else:
        if row.steps:
            raise HTTPException(422, "Detailed workflows require editing their individual steps.")
        setattr(row.overrides, request.field, request.value)
    try:
        changed = Estimate.model_validate(changed.model_dump())
    except ValidationError as exc:
        raise HTTPException(422, exc.errors()[0]["msg"]) from exc

    baseline_result = calculate(original)
    proposed_result = calculate(changed)
    baseline = next(s for s in baseline_result["scenarios"] if s["name"] == "Expected")
    proposed = next(s for s in proposed_result["scenarios"] if s["name"] == "Expected")
    baseline_row = next(d for d in baseline_result["cost_drivers"] if d["row_id"] == row.id)
    proposed_row = next(d for d in proposed_result["cost_drivers"] if d["row_id"] == row.id)
    row_complete = baseline_row["complete"] and proposed_row["complete"]
    suite_complete = baseline["complete"] and proposed["complete"]
    result = {
        "row_id": row.id,
        "field": request.field,
        "value": request.value,
        "baseline_row_cost": baseline_row["known_cost"] if row_complete else None,
        "proposed_row_cost": proposed_row["known_cost"] if row_complete else None,
        "row_delta": proposed_row["known_cost"] - baseline_row["known_cost"] if row_complete else None,
        "baseline_suite_cost": baseline["llm_cost"] if suite_complete else None,
        "proposed_suite_cost": proposed["llm_cost"] if suite_complete else None,
        "suite_delta": proposed["llm_cost"] - baseline["llm_cost"] if suite_complete else None,
        "issues": list(dict.fromkeys(baseline_row["issues"] + proposed_row["issues"])),
        "suite_complete": suite_complete,
    }
    return JSONResponse(jsonable_encoder(result, custom_encoder={Decimal: str}))


@app.get("/api/estimates")
def estimates():
    return store.list_estimates()


@app.get("/api/estimates/{estimate_id}")
def get_estimate(estimate_id: str):
    estimate = store.get(estimate_id)
    if estimate is None:
        raise HTTPException(404, "Estimate not found.")
    return estimate


@app.post("/api/estimates")
def save_estimate(estimate: Estimate):
    require_daily_volume(estimate)
    return store.save(estimate)


def require_daily_volume(estimate: Estimate):
    for row in estimate.agents:
        if row.volume_source == "daily_users" and (
            row.users_per_day is None or row.invocations_per_user_per_agent_per_day is None
        ):
            raise HTTPException(
                422,
                f"{row.name}: Users per day and invocations per user per agent per day are required.",
            )


def xlsx(data, filename):
    return Response(
        data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/import/template")
def template():
    return xlsx(workbook.import_template(), "agent-import-template.xlsx")


@app.post("/api/import/preview")
async def preview(request: Request):
    try:
        return workbook.read_import(await request.body())
    except (ValueError, ValidationError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, "Could not read this workbook. Use the provided .xlsx template.") from exc


@app.post("/api/export")
def export(estimate: Estimate):
    require_daily_volume(estimate)
    return xlsx(workbook.export_estimate(estimate), "agent-suite-budget.xlsx")


dist = Path(__file__).resolve().parent.parent / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
