# AGENTS.md refactor audit

This document records the refactor review, not additional agent instructions. Topic guides live in `docs/agents/` and are loaded through the root AGENTS.md only when relevant.

## Contradictions

No direct contradictions were found within the original AGENTS.md. No choice between conflicting instructions was needed.

Two apparent tensions are already qualified by the original text:

- “Highly prefer E2E tests as the sole testing mechanism” is a preference. “If you must test a system in isolation” explicitly permits an exception, with tests written before implementation. Both remain in the testing guide.
- “NEVER write unit tests after you write code” does not conflict with allowing regression tests only for genuine behavior gaps. Regression coverage can be E2E; necessary isolated tests must still precede implementation. Both restrictions remain.

## Root essentials

- One-sentence project description: local agent-suite monthly LLM budgeting with Excel and explicit assumptions/scenarios.
- Non-default package manager: uv for Python, using the locked setup command from README. Frontend uses npm and needs no special package-manager instruction.
- Non-standard check command: `npm run check` combines TypeScript, Prettier, and Ruff and requires `.venv`. The conventional build and E2E commands live in the testing guide.
- Universal editing rule: scope changes to the task and preserve unrelated user changes.
- Task-based links: read relevant guides before the work, especially testing guidance before implementation requiring verification.

## Consolidated repetition

These duplicate statements were consolidated without removing their constraints:

| Original overlap | Canonical location |
| --- | --- |
| Opening E2E preference and “Prefer E2E journeys through the actual app…” | `agents/testing.md`, test selection and E2E verification |
| Opening isolated-test rule and “Before implementing calculation behavior that needs isolated verification…” | `agents/testing.md`, one ordered failure modes → independent outcomes → tests → implementation rule |
| “At the end of E2E tests, produce a verifiable and repeatable artifact” and the detailed fixtures/workbook/run-report rule | `agents/testing.md`, detailed artifact requirements |
| “Tautological tests considered harmful” and the prohibition on deriving expectations from the implementation/UI-API agreement | `agents/testing.md`, actionable prohibition and examples |
| “Change-detector tests considered harmful” and “Do not introduce tests that only detect text/layout changes…” | `agents/testing.md`, actionable prohibition |
| “The testing rules at the top of this file take precedence” | `agents/testing.md`, precedence stated beside the relocated policy |

## Flagged deletion or clarification candidates

These are recommendations for a later policy edit. They remain in the guides unless identified above as consolidated repetition.

| Original wording | Concern | Recommendation |
| --- | --- | --- |
| “Prefer small, typed modules with explicit inputs and outputs.” | “Small” has no actionable boundary; this is largely generic coding advice. | Consider deleting this sentence. Preserve the separate prohibition on speculative abstractions. |
| “Use a dependency manifest and lockfile…” | Already established by package.json/package-lock.json and pyproject.toml/uv.lock. | Consider dropping the generic clause; retain dependency constraints and repeatable setup documentation. |
| “Do not add dependencies where existing capabilities are sufficient.” | General agent hygiene rather than project-specific guidance. | Optional deletion; retained because it expresses an explicit maintenance preference. |
| “Handle migrations deliberately…” | “Deliberately” does not define required behavior. | Remove this phrase in a later edit; retain schema/default versioning and preservation of existing estimates. |
| “Keep bulk editing practical for hundreds of agents.” | Product intent without a measurable acceptance criterion. | Clarify with an agreed workload and acceptable interaction time rather than inventing a threshold. |
| “Log enough context to diagnose failures…” | “Enough” is undefined. | Clarify the required diagnostic fields; retain the prohibition on logging customer spreadsheets/prompts. |
| “Never imply a check passed when it was not run.” | Obvious reporting integrity rule. | Optional deletion; retained because verification claims matter in handoff. |

Domain-specific rules about decimal money, incomplete pricing, frozen snapshots, spreadsheet safety, local-only operation, and test timing remain explicit. They carry project decisions or concrete failure constraints and are not deletion candidates merely because they resemble general good practice.

## Suggested docs structure (implemented)

```text
AGENTS.md
PRODUCT_BRIEF.md
docs/
├── agents/
│   ├── product.md
│   ├── architecture.md
│   ├── calculations.md
│   ├── persistence.md
│   ├── spreadsheets.md
│   ├── interface.md
│   ├── local-operation.md
│   └── testing.md
├── agents-refactor-notes.md
├── features/                       # Existing feature specifications
├── IMPLEMENTATION.md               # Existing design decisions/failure cases
├── AGENTIC_IMPLEMENTATION.md        # Existing implementation status
├── VERIFICATION.md                 # Existing verification records
├── COST_MODEL_GUIDE.md              # Existing user guide
└── *_FAILURE_MODES.md               # Existing feature-specific failure cases
```

Existing documentation stays in place; this refactor only replaces AGENTS.md and adds the guides and this audit. Application behavior, package manifests, and project commands are unchanged.

## Verification results

- All 53 original instruction bullets were reviewed: 43 retain their wording (allowing Markdown link formatting); 10 were split, consolidated, or rewritten without removing their constraints.
- Root AGENTS.md is 18 lines and routes to eight topic guides.
- All 16 local Markdown links across the root, guides, and this audit resolve to existing files. The README setup anchor was checked against its heading.
- A Python documentation check verified whitespace, final newlines, and the presence of documented check/build/E2E scripts in package.json. Commands were also reviewed against README, package.json, and playwright.config.ts.
- `git diff --check` passed.
- Application type, lint, build, and E2E checks were not run for this documentation-only refactor. No runtime behavior was verified or changed.
