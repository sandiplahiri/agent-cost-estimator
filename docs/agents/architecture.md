# Architecture and dependencies

Read this guide when changing application structure, calculation integration, adapters, or dependencies.

- Keep calculation logic independent of the UI, persistence, network access, and spreadsheet libraries. Given the same validated inputs and pricing snapshot, calculations must return the same results.
- Use one canonical calculation model for the UI, scenario comparisons, saved estimates, and exports. Avoid independently maintained pricing logic in different screens or endpoints.
- Isolate LiteLLM behind a small adapter for catalog lookup, token counting, and pricing integration. Provider payloads and library-specific objects must not become the application's persisted domain model.
- Prefer small, typed modules with explicit inputs and outputs. Introduce abstractions for actual requirements; avoid speculative frameworks and premature services.
- Use a dependency manifest and lockfile, pin compatible dependencies, and document repeatable install, run, and verification commands. Check official documentation when implementing unfamiliar or version-sensitive APIs.
- Do not add dependencies where existing capabilities are sufficient.
