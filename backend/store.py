import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .models import Estimate, Execution

DB_PATH = Path(os.environ.get("ESTIMATOR_DB", "data/estimates.sqlite3"))


class CategoryInUseError(ValueError):
    pass


class CategoryNotFoundError(ValueError):
    pass


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS estimates (id TEXT PRIMARY KEY, name TEXT, updated TEXT, body TEXT)"
        )
        db.execute("CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY, body TEXT)")
        db.execute(
            "CREATE TABLE IF NOT EXISTS complexity_categories (name_key TEXT PRIMARY KEY, name TEXT NOT NULL, profile TEXT NOT NULL)"
        )
        yield db


def save(estimate: Estimate):
    now = datetime.now(timezone.utc).isoformat()
    with connection() as db:
        db.execute(
            "INSERT OR REPLACE INTO estimates VALUES (?, ?, ?, ?)",
            (estimate.id, estimate.name, now, estimate.model_dump_json()),
        )
    return {"id": estimate.id, "updated": now}


def list_estimates():
    with connection() as db:
        return [
            dict(zip(("id", "name", "updated"), row))
            for row in db.execute("SELECT id, name, updated FROM estimates ORDER BY updated DESC")
        ]


def get(estimate_id: str):
    with connection() as db:
        row = db.execute("SELECT body FROM estimates WHERE id = ?", (estimate_id,)).fetchone()
    return Estimate.model_validate_json(row[0]) if row else None


def get_catalog():
    with connection() as db:
        row = db.execute("SELECT body FROM catalog WHERE id = 1").fetchone()
    return json.loads(row[0]) if row else None


def save_catalog(catalog):
    with connection() as db:
        db.execute("INSERT OR REPLACE INTO catalog VALUES (1, ?)", (json.dumps(catalog),))


def list_categories():
    with connection() as db:
        rows = db.execute("SELECT name, profile FROM complexity_categories ORDER BY rowid").fetchall()
    return [{"name": name, "profile": Execution.model_validate_json(profile)} for name, profile in rows]


def add_category(name: str, profile: Execution):
    with connection() as db:
        count = db.execute("SELECT COUNT(*) FROM complexity_categories").fetchone()[0]
        if count >= 50:
            raise ValueError("At most 50 custom categories can be defined globally.")
        try:
            db.execute(
                "INSERT INTO complexity_categories VALUES (?, ?, ?)",
                (name.casefold(), name, profile.model_dump_json()),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Category names must be unique, ignoring case.") from exc
    return {"name": name, "profile": profile}


def delete_category(name: str, draft: Estimate):
    key = name.casefold()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        category = db.execute(
            "SELECT name FROM complexity_categories WHERE name_key = ?", (key,)
        ).fetchone()
        if category is None:
            raise CategoryNotFoundError(f"Custom category {name} no longer exists globally.")
        canonical_name = category[0]
        references = [
            f"current draft: {row.name} ({row.count} agent{'s' if row.count != 1 else ''})"
            for row in draft.agents
            if row.complexity.casefold() == key
        ]
        for estimate_id, estimate_name, body in db.execute("SELECT id, name, body FROM estimates"):
            try:
                saved = Estimate.model_validate_json(body)
            except ValueError as exc:
                raise ValueError(
                    f"Cannot verify saved estimate {estimate_name} ({estimate_id}); deletion was cancelled."
                ) from exc
            references.extend(
                f"saved estimate {estimate_name}: {row.name} ({row.count} agent{'s' if row.count != 1 else ''})"
                for row in saved.agents
                if row.complexity.casefold() == key
            )
        if references:
            shown = "; ".join(references[:5])
            remainder = f"; and {len(references) - 5} more" if len(references) > 5 else ""
            raise CategoryInUseError(
                f"Reassign agents before deleting {canonical_name}: {shown}{remainder}."
            )
        db.execute("DELETE FROM complexity_categories WHERE name_key = ?", (key,))
    return {"name": canonical_name}
