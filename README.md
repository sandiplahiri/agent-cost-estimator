# Agent Ledger

A local web app for AI architects estimating the LLM spending of proposed agent suites. Define complexity groups or import agent rows, compare explicit scenarios, and export an Excel budget with its assumptions and pricing snapshot.

## Bug reports and feature requests

Search [existing issues](https://github.com/sandiplahiri/llm-token-cost-estimator/issues) before submitting a report or request. Issues are public: use synthetic examples and remove customer workbooks, estimates, prompts, API keys, and sensitive details from logs or screenshots. See [CONTRIBUTING.md](CONTRIBUTING.md) for more guidance.

### Submit a bug report

1. Open [New issue](https://github.com/sandiplahiri/llm-token-cost-estimator/issues/new/choose) and choose **Bug report**.
2. Enter the version or commit and your environment (operating system, browser, and relevant Python or Node.js versions).
3. Provide steps to reproduce with synthetic inputs, the expected result, and the actual result. For a calculation error, include the expected amount, its units, and how you calculated it independently.
4. Add sanitized context if useful, then submit the issue. A maintainer may ask for more detail.

### Submit a feature request

1. Open [New issue](https://github.com/sandiplahiri/llm-token-cost-estimator/issues/new/choose) and choose **Feature request**.
2. Describe the problem or workflow, the behavior you want, and a synthetic example of the expected outcome.
3. Include any current workaround or alternatives, then submit the issue.

For a possible security vulnerability, use [GitHub's private vulnerability reporting](https://github.com/sandiplahiri/llm-token-cost-estimator/security/advisories) and follow [SECURITY.md](SECURITY.md). Do not publish exploit details in an issue.

## Run locally

Requires Python 3.12+, Node.js 22+, npm, and [uv](https://docs.astral.sh/uv/). Dependency installation requires internet access.

```sh
uv sync --locked --cache-dir .uv-cache
npm ci --cache .npm-cache
npm run build
npm start
```

Open **http://127.0.0.1:8000**. The backend serves the built frontend. Leave the terminal running; Ctrl+C stops it. No provider API keys or paid model calls are required.

For frontend development, run `npm start` and `npm run dev` in separate terminals, then open http://127.0.0.1:5173. Rebuild the frontend to update what the backend serves at port 8000.

## Plan a suite

1. Set a name and use **Quick setup** to distribute the agent count across simple, medium, and high complexity.
2. Select models in **Complexity profiles**. Numeric defaults are illustrative; model selections start empty to avoid silently choosing a provider for your customer.
3. Enter the required **Users per agent per day** and **Invocations per user per agent per day** for each group. **Total monthly invocations per agent** is read-only and equals their product × 30 planning days. **Total monthly invocations · all agents** multiplies that result by the group count. The inventory sums all groups in each simple, medium, and high (complex) category and shows total token usage per month and average tokens per day. Configure exceptions by opening a row and choosing **Customize one agent**, which keeps the total agent count unchanged.
4. Use **Scenarios** to vary invocation volume, calls, token sizes, retries, or model choice explicitly.
5. Add separate monthly or one-time costs, save the estimate, and export Excel.

All rates are USD per million tokens. Monetary calculations use Python Decimal. The total shown on scenario cards is LLM spending only; additional costs appear separately in the app and workbook.

## Execution assumptions

The starter simple/medium/high profiles use 1/4/10 model calls per invocation, 2,000/6,000/15,000 input tokens per call, 500/1,000/2,000 output tokens per call, and 2%/5%/10% additional attempts. These are editable planning assumptions, not industry benchmarks.

- Input tokens include instructions, history, retrieval, and tool results included in the call.
- Output tokens include all billable reasoning. Do not add reasoning again if it is already included.
- Category token totals use Expected-scenario input plus output usage, including additional model-call attempts. Cached input remains part of input usage and is counted once. Daily token usage is the monthly total divided by the 30-day planning month. Category invocation totals are baseline volumes and do not include scenario multipliers. The visible monthly summary shows input/output tokens and costs for each category and the suite. Input cost includes uncached input, cached reads, and cache writes. Expand a category's token cost to see each token type's tokens and LLM cost per day and month. Model-rate detail below retains each selected model and per-call rate. Each monthly component is tokens × USD per million tokens / 1,000,000; daily cost divides the unrounded monthly cost by 30. Incomplete categories show only costs from fully priced agent lines.
- Retry rate is extra attempts divided by normal calls, not a failure probability. A value of 0.05 means 5 extra attempts per 100 calls. Normal tool and revision cycles belong in the call count.
- Cached reads and writes partition total input; their fractions cannot sum above 1. Cache writes use the supplied base/short-duration rate. Storage and other cache overhead can be separate items.
- A model can have input/output prices without a cache-write price. For example, the bundled `gemini/gemini-3.8-flash` snapshot has a cached-read rate but no cache-write rate. If cache writes are part of the workload, the estimate is incomplete until you supply an applicable custom rate. Set the cache-write fraction to zero only when the workload has no cache writes. The Model pricing tab shows each selected model's cache-rate availability.
- Detailed workflows are explicit model-call steps with expected repetitions and their own models/token sizes. They replace the aggregate execution for that row. Conditional paths can be represented using expected fractional repetitions; there is no executable workflow graph.
- New agent volumes use required daily-user inputs and include all sources, including delegation. The entered user count is per agent, so group count scales the resulting monthly total only once. Older saved manual rows remain labeled as legacy and retain their original costs until both daily inputs are entered. A parent's steps cover its own calls only. Business-event mapping and automatic call-graph propagation are not implemented.

Override precedence is profile defaults → edited profile → row overrides → scenario multipliers/model override. Detailed steps replace profile/row execution fields but still receive scenario multipliers. Zero is a valid override. Scenario changes do not mutate the underlying profile.

## Pricing and reproducibility

The pricing adapter reads LiteLLM's installed catalog without importing its model execution stack or making startup network requests. It includes text models from major providers, including OpenAI, Anthropic, Google, Azure, Bedrock, Mistral, Cohere, DeepSeek, and others. Catalog presence does not establish model availability or completeness of provider pricing.

Supported calculations cover text input/output, catalog context-length tiers, cache reads/base-duration cache writes, and batch rates where explicitly available. Prices are selected per request before scaling to monthly usage. Where a batch/context combination or separate reasoning price is unsupported, the result is marked incomplete and requires custom rates.

Ordinary estimates use local prices. **Refresh catalog** downloads the published LiteLLM price file; it sends no estimate data. Review the before/after scenario costs before applying refreshed rates to the current draft. Previously saved estimates retain their snapshots until explicitly saved over. Failed refreshes preserve available prices.

Custom models allow uniform negotiated input/output/cache rates. Give each contract, region, or service tier a unique ID. Unknown prices remain unknown, never silently zero. The app labels incomplete totals as known subtotals.

Limits: multimodal billing, hosted tool fees, cache storage, long-duration cache writes, priority/flex tiers, and provider-specific contract rules may need custom rates or additional cost items. Context tiers operate on average tokens per call; split detailed steps when a workload spans a threshold. Scenario ranges are not confidence intervals. Additional cost items are fixed across scenarios.

## Import and Excel

Download **Template**, populate its `Agents` sheet, and upload `.xlsx`. The preview replaces the agent inventory only after successful validation and an explicit Apply action. Each imported row must represent a disjoint group. For new rows, supply `name`, `complexity`, `count`, `volume_source` (`daily_users`), `users_per_day`, and `invocations_per_user_per_agent_per_day`. Both daily values are required; zero is valid. The `invocations` column accepts older manual workbooks for compatibility and is ignored for daily rows. Such imported rows remain labeled as legacy until converted. Optional execution overrides use the same names and units as the template. Blank overrides inherit; zero does not.

Files are limited to 5 MB, 30 MB expanded, and 1,000 agent rows. Formula cells in the agent sheet, macros, and external workbook links are rejected. Exported user text remains text, including names beginning with `=`.

The exported workbook includes Summary, Calculations, Agents, Volume, Category totals, Category usage, Category costs, Monthly category summary, Profiles, Scenarios, Additional costs, Pricing, and Read me sheets. **Volume** derives baseline per-agent and all-agent monthly invocations with formulas; **Category totals** sums them by complexity. **Category usage** sums Expected-scenario input and output tokens by complexity and divides by 30 for average daily usage. **Category costs** splits those tokens into four billed types, sums the matching cost formulas, and divides monthly tokens and cost by 30 for average daily figures; its USD per million figure is a blended rate when several models or tiers contribute. **Monthly category summary** rolls those results into input, output, and suite totals with formulas. **Calculations** contains editable scenario-effective inputs and cost formulas linked to Summary. Other sheets document the snapshot; editing them does not propagate into Calculations. Changing token sizes across a pricing threshold requires updating rates or re-exporting. The workbook documents these limits. The Agents sheet can be imported as aggregate rows; it is not a lossless backup of detailed workflows.

First-year cost assumes 12 identical recurring months plus one-time items. Partial estimates remain clearly marked in the workbook. Excel/compatible spreadsheet software recalculates formulas on opening.

## Storage and recovery

Saved estimates and the local catalog are in `data/estimates.sqlite3` (override with `ESTIMATOR_DB`). Browser drafts also use localStorage. Back up the SQLite file while the server is stopped to preserve complete estimates and detailed steps. No telemetry or cloud database is used.

Reset previews its scope and offers undo; agent counts, volumes, model choices, custom prices, and additional cost items are preserved. Quick setup, import, opening an estimate, and resetting also support a single undo. Saving writes atomically to SQLite.

## Verification

```sh
npm run build
npm run check
npm run test:e2e
```

The E2E runner uses installed Google Chrome on macOS, or Playwright Chromium elsewhere. If needed, install the latter with `npx playwright install chromium`. It starts the actual app on loopback port 8011 with a separate SQLite file, drives browser journeys, and checks spreadsheet formulas using HyperFormula. No paid model calls or live-price assumptions are used in arithmetic verification.

`npm run format` formats the frontend and backend. The ExcelJS test-only dependency uses an override to UUID 11.1.1+ to avoid its older transitive UUID advisory; ExcelJS uses the compatible `v4` API. HyperFormula is used only in the development verification workflow.

Outputs include `artifacts/verification.json`, `artifacts/e2e-results.json`, sample import workbooks, exported budgets, and desktop/mobile screenshots. `playwright-report/index.html` contains the browser test report. Failure traces are under `test-results/`. SQLite test files are disposable and are not the user's application database.

See [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) for discovery requirements, [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for design decisions and preimplementation failure cases, and [AGENTS.md](AGENTS.md) for development/testing rules.
