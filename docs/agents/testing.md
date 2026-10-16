# Testing and handoff

Read this guide before implementation that needs verification, before writing or changing tests, and before handoff. The testing policy below takes precedence over other verification guidance.

## Test timing and selection

- NEVER write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. Isolated verification remains an exception under the next rule.
- If you must test a system in isolation, FIRST enumerate all its failure modes and independent expected outcomes, THEN write any necessary isolated tests, THEN write the implementation.
- Do not create regression tests for bug fixes without a genuine gap in behavior testing.
- Do not write tautological tests: do not compute expectations by calling the implementation under test or merely assert that the UI mirrors the API.
- Do not write change-detector tests; verify behavior rather than merely detecting text/layout changes. Do not repeat successful checks without a reason.

## E2E verification

- Prefer journeys through the actual app, persistence, import, and export. Use fixed, versioned pricing fixtures for repeatability; distinguish those checks from live provider/catalog compatibility checks.
- Use independently calculated expected totals for representative scenarios.
- Cover meaningful risks: incomplete pricing, unit mistakes, duplicate agent counts, override precedence, scenario changes, reset behavior, save/reopen reproducibility, import failure recovery, and workbook reconciliation. Add coverage proportionate to the implemented feature.
- Finish E2E verification with reusable input fixtures, an exported Excel workbook, and a run report recording the command, assumptions/pricing fixture, expected versus actual results, and failures. Screenshots may supplement these artifacts but cannot replace numerical verification.
- For workbook formula acceptance, follow [Spreadsheets](spreadsheets.md), including recalculation in a spreadsheet calculation engine.

## Commands and artifacts

Run relevant type, lint, build, and E2E checks provided by the project:

```sh
npm run check
npm run build
npm run test:e2e
```

`npm run check` runs TypeScript, Prettier, and backend Ruff checks. `npm run build` typechecks and builds the frontend; build before E2E so the backend serves the current frontend. Dependency setup is documented in [README.md](../../README.md#run-locally).

The Playwright configuration starts the actual backend on loopback port 8011 with a separate SQLite file. Reports are written to `artifacts/e2e-results.json` and `playwright-report/index.html`; other numerical reports, fixtures, and exported workbooks belong under `artifacts/`. These locations do not replace the required numerical verification and run report.

## Handoff

State what changed, what was verified, artifact locations, and any unverified behavior or material limitations. Never imply a check passed when it was not run.
