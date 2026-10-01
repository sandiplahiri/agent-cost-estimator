import logging
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import pricing, store, workbook
from .engine import calculate
from .models import Estimate, default_profiles, default_scenarios

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
    return Estimate(profiles=default_profiles(), scenarios=default_scenarios())


@app.post("/api/calculate")
def calculate_api(estimate: Estimate):
    # Decimal must stay strings through JSON, not become binary floats.
    return JSONResponse(jsonable_encoder(calculate(estimate), custom_encoder={Decimal: str}))


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
