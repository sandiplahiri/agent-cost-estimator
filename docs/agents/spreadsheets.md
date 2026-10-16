# Spreadsheet import and export

Read this guide when changing spreadsheet templates, imports, exports, or workbook verification. For import application and recovery, also read [Pricing, scenarios, and persistence](persistence.md).

- Provide an import template with documented units and accepted fields. Validate complete imports before applying them, with actionable row/column errors and a preview.
- Treat imported spreadsheets as untrusted data: constrain file sizes and row counts, validate structure, and never execute macros, external links, or user-supplied formulas. Write user-provided strings as literal Excel text.
- Export the same effective assumptions and price snapshot used on screen. Include traceable formulas for supported calculations and clearly identify any precomputed results or unsupported recalculation paths.
- Verify exported formula results using a spreadsheet calculation engine when formulas are part of acceptance. Merely checking that cells contain formulas does not verify workbook correctness; disclose when recalculation could not be checked.

For E2E fixtures, numerical expectations, and required artifacts, use [Testing and handoff](testing.md).
