"""Read LiteLLM's catalog without importing its execution stack or making startup requests."""

import importlib.metadata
import json
import re
from datetime import datetime, timezone
from decimal import Decimal
from urllib.request import urlopen

from .models import Price, Tier

CATALOG_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
NORMALIZER_VERSION = 3
PRICE_KEYS = {
    "input": "input_cost_per_token",
    "output": "output_cost_per_token",
    "cache_read": "cache_read_input_token_cost",
    "cache_write": "cache_creation_input_token_cost",
}


def normalize(raw: dict, source: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    prices = {}
    skipped = 0
    for model_id, info in raw.items():
        if not isinstance(info, dict) or info.get("mode") not in ("chat", "completion", "responses"):
            continue
        try:

            def rate(key):
                value = info.get(key)
                return Decimal(str(value)) * 1000000 if value is not None else None

            base_rates = {field: rate(key) for field, key in PRICE_KEYS.items()}
            if base_rates["cache_read"] is None:
                base_rates["cache_read"] = rate("input_cost_per_token_cache_hit")

            thresholds = sorted(
                {
                    int(m.group(1)) * 1000
                    for key in info
                    if (m := re.fullmatch(r"input_cost_per_token_above_(\d+)k_tokens", key))
                }
            )
            tiers = [
                Tier(
                    above=t,
                    **{field: rate(f"{key}_above_{t // 1000}k_tokens") for field, key in PRICE_KEYS.items()},
                )
                for t in thresholds
            ]
            unsupported = []
            if info.get("input_cost_per_request") or info.get("input_cost_per_query"):
                unsupported.append("per-request/query charges")
            if info.get("output_cost_per_reasoning_token") not in (None, info.get("output_cost_per_token")):
                unsupported.append("separately priced reasoning")
            price = Price(
                id=model_id,
                provider=info.get("litellm_provider") or model_id.split("/")[0],
                source_type=(
                    "cloud_marketplace"
                    if info.get("litellm_provider") in ("bedrock", "azure", "vertex_ai")
                    else "vendor_api"
                ),
                channel=info.get("litellm_provider") or "",
                **base_rates,
                tiers=tiers,
                max_input=info.get("max_input_tokens"),
                max_output=info.get("max_output_tokens"),
                source=source,
                retrieved_at=now,
                unsupported=unsupported,
            )
            prices[model_id] = price.model_dump(mode="json")
            if (
                info.get("input_cost_per_token_batches") is not None
                and info.get("output_cost_per_token_batches") is not None
            ):
                batch = price.model_copy(deep=True)
                batch.id = model_id + " [batch]"
                batch.input, batch.output = (
                    rate("input_cost_per_token_batches"),
                    rate("output_cost_per_token_batches"),
                )
                batch.cache_read = batch.cache_write = None
                if batch.tiers:
                    batch.unsupported = [*batch.unsupported, "batch context tiers require custom rates"]
                prices[batch.id] = batch.model_dump(mode="json")
        except (ValueError, TypeError, ArithmeticError):
            skipped += 1
    if not prices:
        raise ValueError("The catalog did not contain any valid text-model pricing entries.")
    return {
        "prices": prices,
        "normalizer_version": NORMALIZER_VERSION,
        "retrieved_at": now,
        "source": source,
        "skipped": skipped,
        "scope": "Text token pricing. Standard service unless marked batch. Cache writes use the base/short TTL rate. Paid tools, cache storage, multimodal and other service tiers require separate items or custom rates.",
    }


def bundled_catalog():
    distribution = importlib.metadata.distribution("litellm")
    path = distribution.locate_file("litellm/model_prices_and_context_window_backup.json")
    with path.open() as stream:
        raw = json.load(stream)
    return normalize(raw, f"LiteLLM {distribution.version} bundled catalog")


def refresh_catalog():
    with urlopen(CATALOG_URL, timeout=20) as response:
        data = response.read(12_000_001)
    if len(data) > 12_000_000:
        raise ValueError("Pricing catalog exceeded the download size limit.")
    return normalize(json.loads(data), CATALOG_URL)
