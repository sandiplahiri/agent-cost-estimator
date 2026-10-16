# Agent Ledger

A local web app and Excel workflow for AI architects estimating monthly LLM spending for an entire agent suite, with explainable assumptions and scenarios.

- Python dependencies use **uv**: `uv sync --locked --cache-dir .uv-cache`.
- `npm run check` runs TypeScript checking, Prettier validation, and backend Ruff checks; it requires the uv-managed `.venv`.
- Keep changes scoped to the task and preserve unrelated user changes.

Read the relevant guides **before** starting the corresponding work; a task may need several guides:

- [Product scope and decisions](docs/agents/product.md) — features, requirements, and design decisions.
- [Architecture and dependencies](docs/agents/architecture.md) — calculation boundaries, adapters, modules, and dependency changes.
- [Cost calculations](docs/agents/calculations.md) — units, validation, billing, workloads, and accounting.
- [Pricing, scenarios, and persistence](docs/agents/persistence.md) — snapshots, overrides, migrations, saves, and reset.
- [Spreadsheets](docs/agents/spreadsheets.md) — import, export, and workbook verification.
- [Interface](docs/agents/interface.md) — budget presentation, editing, accessibility, and recoverable errors.
- [Local operation and data handling](docs/agents/local-operation.md) — services, external operations, credentials, and logging.
- [Testing and handoff](docs/agents/testing.md) — read before implementation that needs verification, before changing tests, and before handoff; includes the test-before-code rules.
