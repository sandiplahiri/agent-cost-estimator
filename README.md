# Agent Ledger

A local web app for AI architects estimating the LLM spending of proposed agent suites. Define complexity groups or import agent rows, compare explicit scenarios, and export an Excel budget with its assumptions and pricing snapshot.

The [agentic system feature definition](docs/features/agentic-system-cost-modeler.md) is maintained under `docs/features/`. [Implementation status](docs/AGENTIC_IMPLEMENTATION.md) distinguishes delivered behavior from later milestones and open decisions.

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
   Quick setup gives every counted agent a distinct ID and name plus an explicitly pending business use case description. Open a group to edit each member's properties; the member list is shown 25 at a time. IDs and names must be unique across the suite. These categories describe token consumption, not business use cases.
   In **Complexity profiles**, choose **Add custom category** to name a category and set its starter calls, token sizes, retries, and cache assumptions. The name must be unique across predefined and custom categories. The category is available to new estimates throughout this local app. To use it in an older estimate, choose **Use [category]** in Complexity profiles, then select it for an agent's starting profile or an individual step. New custom profiles do not copy a model choice; older saved model selections remain in their snapshots for reproducibility. To delete a custom category, use **Delete** on its profile or beside its globally available name. Reassign every agent default and step using it first, including saved estimates. Deleting the global starter removes it from new estimates and the current draft; saved unused snapshots remain until removed and saved individually. Simple, medium, and high cannot be deleted.
2. Select models on agent steps in **Agent inventory**, or in a group or agent execution editor. Numeric profile defaults are illustrative; model selections start empty to avoid silently choosing a provider for your customer.
3. Enter the required **Users per agent per day** and **Invocations per user per agent per day** for each group. **Total monthly invocations per agent** is read-only and equals their product × 30 planning days. **Total monthly invocations · all agents** multiplies that result by the group count. The Dashboard shows group budgets. Open **Agent inventory** from the left navigation to see every named agent, its use case, step count, callers, callees, and daily workload. Choose **Edit** to change one agent's name, business use case name and description, daily inputs, and ordered steps. Each step lists its model name and complexity profile; expand **Step execution details** to edit calls, tokens, retries, and probabilities. The agent ID is not editable in this panel, and there is no agent-level complexity control. A counted member separates from its group only when you apply changes; closing the editor leaves the group intact. Caller and callee counts come from links and cannot be edited there.

The inventory's **Use Case Name** column shows the agent's named use case. **Total Cost** shows that agent's Expected monthly model and tool spending plus allocated harness. Members of a counted group share its cost equally until customized. Called agents have their own rows, so their costs are not added to callers. Suite-level additional costs and any fixed harness that cannot be allocated at zero volume stay in the suite total. Missing pricing shows a partial amount or **Incomplete**.
4. Open **Agent suite graph** from the left navigation to select an agent, edit its use case and model steps, or link it to a child. The graph has its own workspace, separate from the Dashboard inventory and budget breakdowns. Preview the child-volume and suite-cost change, then apply it. The child becomes derived-volume; its old daily or legacy inputs remain available if the last link is removed.
5. Use **Cost drivers & impact** in Dashboard to rank the priced agent groups and preview how changing one workload or execution input affects the Expected monthly LLM bill. The comparison uses the current estimate and does not edit it.
6. Use **Scenarios** to vary invocation volume, calls, token sizes, retries, or model choice explicitly. Links can also override probability and fanout for Low and High.
7. Add separate monthly or one-time costs, save the estimate, and export Excel.

The main scenario amount is monthly LLM spending; each card also shows the full suite total. Monetary calculations use Python Decimal.

## Agentic use cases

Open an agent row and enter the business use case completed by one invocation. **Use detailed workflow** creates ordered steps. Select each step's simple, medium, high, or custom complexity profile and set its execution probability; add model rows with their own model, token profile, expected calls per occurrence, and invocation probability. A single agent may use several step profiles. Changing a step's profile changes its profile breakdown; its already entered calls, tokens, and model remain explicit until edited. Independent model probabilities add in expectation; rows sharing an exclusive group must total at most 1. New model rows start at probability zero. A step can be copied or moved up. Add tool costs at agent or step scope.

The graph shows each agent or group as a node with its use case, steps, monthly volume, and model cost. Select an individual node to edit its use case, complexity, direct workload, model, and basic execution values in the inspector; apply those changes to that agent alone. Unapplied inspector edits survive switching between the graph and Dashboard. Changing an individual's complexity preserves its model and execution values. A group node clearly offers **Customize one agent** to separate a member or **Edit all agents** for a group-wide change. Splitting also works for linked groups: incoming child work is divided across the original members, and outgoing calls are copied for the new individual. More complex step and model tables remain in the detailed workflow editor. Optionally attach a link to a caller step; the step probability scales the child's expected invocations. A derived child gets volume from its parents only; cycles are rejected with the path shown. **Copy** creates an independent agent with copied steps, tools, and outgoing links, zero direct use cases, and no incoming links. The Dashboard no longer shows a cost-per-completed-use-case panel; the Excel **Use cases** sheet retains direct, allocated harness, and fully loaded expected child costs.

**Agent harness** holds one shared runtime cost entry per suite. Choose an explicit type and enter a fixed monthly fee, per-agent-invocation charge, and per-step-execution charge. Its cost is shown separately from models, tools, and additional items. Allocation by agent invocations affects cost per completed use case without changing the suite total. The planning month remains 30 days for direct-volume rows.

Custom model rates can identify source type, channel, region, and currency. Non-USD rates require a sourced USD conversion rate; the saved snapshot retains both original rates and the conversion. The engine uses converted USD rates for calculation. **Export JSON** and **Import JSON** preserve the full versioned estimate and pricing snapshot, including agent identities, detailed steps, and links. Spreadsheet import remains an aggregate inventory workflow: count-one rows may supply an agent ID and business use case description; counted rows generate editable member identities. Excel export lists every identity on the **Agent identities** sheet.

## Execution assumptions

The starter simple/medium/high profiles use 1/4/10 model calls per invocation, 2,000/6,000/15,000 input tokens per call, 500/1,000/2,000 output tokens per call, and 2%/5%/10% additional attempts. These are editable planning assumptions, not industry benchmarks.

- Input tokens include instructions, history, retrieval, and tool results included in the call.
- Output tokens include all billable reasoning. Do not add reasoning again if it is already included.
- Category token totals use Expected-scenario input plus output usage, including additional model-call attempts. Cached input remains part of input usage and is counted once. Daily token usage is the monthly total divided by the 30-day planning month. Category invocation totals are baseline volumes and do not include scenario multipliers. The visible monthly summary shows input/output tokens and costs for each category and the suite. Input cost includes uncached input, cached reads, and cache writes. Expand a category's token cost to see each token type's tokens and LLM cost per day and month. Model-rate detail below retains each selected model and per-call rate. Each monthly component is tokens × USD per million tokens / 1,000,000; daily cost divides the unrounded monthly cost by 30. Incomplete categories show only costs from fully priced agent lines.
- Retry rate is extra attempts divided by normal calls, not a failure probability. A value of 0.05 means 5 extra attempts per 100 calls. Normal tool and revision cycles belong in the call count.
- Cached reads and writes partition total input; their fractions cannot sum above 1. Cache writes use the supplied base/short-duration rate. Storage and other cache overhead can be separate items.
- A model can have input/output prices without a cache-write price. For example, the bundled `gemini/gemini-3.8-flash` snapshot has a cached-read rate but no cache-write rate. If cache writes are part of the workload, the estimate is incomplete until you supply an applicable custom rate. Set the cache-write fraction to zero only when the workload has no cache writes. The Model pricing tab shows each selected model's cache-rate availability.
- Detailed workflows replace aggregate execution for that row. Conditional step and model probabilities are expected values; they do not execute agent code. Calls per occurrence can be fractional planning averages.
- Direct-volume rows use required daily-user inputs. A derived-volume row receives invocations from incoming agent links instead of its entered direct volume; the original inputs remain stored for recovery. A parent's steps cover its own calls only. Older saved manual rows remain labeled as legacy and retain their original costs until both daily inputs are entered or a link converts them. Business-event mapping is not implemented.

Override precedence for aggregate execution is profile defaults → edited profile → row overrides → scenario multipliers/model override. Profiles contain execution behavior only. Select a model for each aggregate agent or detailed step/model call; different executions can use the same profile with different models. An aggregate agent without a model has incomplete pricing. Detailed steps replace profile/row execution fields but still receive scenario multipliers. Zero is a valid override. Scenario changes do not mutate the underlying profile.

The cost-driver list ranks nonempty inventory rows by their Expected monthly LLM costs. An unpriced row shows its known subtotal and an incomplete label; its position may change when missing rates are supplied. The impact preview changes one row input in a temporary copy, then calculates baseline and proposed costs with the same engine used for the suite and export. It reports a full suite dollar change only when both estimates are complete. A direct-volume row with detailed steps offers workload-volume previews; edit its steps to examine an execution change. For a derived detailed row, edit incoming links or workflow steps. Previewed values are not saved or exported until entered in the estimate itself.

## Agent invocation links

Each directed link has a trigger probability from 0 to 1 and expected child invocations per trigger from 0 to 1,000,000. A caller's total monthly invocations × step probability (when scoped) × link probability × child invocations per trigger gives that link's child invocations. Contributions from several callers add. For a child group with several agents, the total is pooled evenly across the group, so group count is not applied a second time. These are planning averages, not executed traces.

The link editor previews conversion from direct to derived volume before changing the draft. Links marked with the same exclusive branch group on one caller must have probabilities totaling at most 1 in each scenario; blank branch groups are independent and can both trigger. Low/High probability and fanout overrides are optional. The global scenario volume factor scales direct roots and consequently their descendants once. Structural cycles, missing row references, and derived groups without incoming links are rejected. Normal tool/revision calls and retries remain separate from child-agent invocations. Removing the last incoming link restores the child's previous direct volume source. Linked groups can be split for individual customization; remove links before deleting a linked row. Save the estimate to persist links; Undo restores the prior graph after a link change.

## Pricing and reproducibility

The pricing adapter reads LiteLLM's installed catalog without importing its model execution stack or making startup network requests. It includes text models from major providers, including OpenAI, Anthropic, Google, Azure, Bedrock, Mistral, Cohere, DeepSeek, and others. Catalog presence does not establish model availability or completeness of provider pricing.

Supported calculations cover text input/output, catalog context-length tiers, cache reads/base-duration cache writes, and batch rates where explicitly available. Prices are selected per request before scaling to monthly usage. Where a batch/context combination or separate reasoning price is unsupported, the result is marked incomplete and requires custom rates.

Ordinary estimates use local prices. **Refresh catalog** downloads the published LiteLLM price file; it sends no estimate data. Review the before/after scenario costs before applying refreshed rates to the current draft. Previously saved estimates retain their snapshots until explicitly saved over. Failed refreshes preserve available prices.

Custom models allow uniform negotiated input/output/cache rates, source/channel/region identity, and user-supplied FX conversion. Give each contract, region, or service tier a unique ID. Unknown prices remain unknown, never silently zero. The app labels incomplete totals as known subtotals.

Limits: multimodal billing, hosted tool fees, cache storage, long-duration cache writes, priority/flex tiers, and provider-specific contract rules may need custom rates or additional cost items. Context tiers operate on average tokens per call; split detailed steps when a workload spans a threshold. Scenario ranges are not confidence intervals. Additional cost items are fixed across scenarios.

## Import and Excel

Download **Template**, populate its `Agents` sheet, and upload `.xlsx`. The preview replaces the agent inventory only after successful validation and an explicit Apply action. Each imported row must represent a disjoint group. For new rows, supply `name`, `complexity`, `count`, `volume_source` (`daily_users`), `users_per_day`, and `invocations_per_user_per_agent_per_day`. Both daily values are required; zero is valid. The `invocations` column accepts older manual workbooks for compatibility and is ignored for daily rows. Such imported rows remain labeled as legacy until converted. Optional numeric execution overrides use the same names and units as the template; blank numeric overrides inherit and zero does not. Supply `model_id` for each priced aggregate row; a blank model leaves its estimate incomplete.

Files are limited to 5 MB, 30 MB expanded, and 1,000 agent rows. Formula cells in the agent sheet, macros, and external workbook links are rejected. Exported user text remains text, including names beginning with `=`.

The exported workbook includes Summary, Calculations, Agents, Volume, Agent links, Category totals, Category usage, Category costs, Monthly category summary, Profiles, Scenarios, Additional costs, Pricing, and Read me sheets. **Volume** derives direct baseline invocations with formulas and records derived graph volumes computed by the app; **Category totals** sums them by complexity. **Agent links** shows effective Low/Expected/High probabilities, fanout, and each child contribution. **Category usage** sums Expected-scenario input and output tokens by complexity and divides by 30 for average daily usage. **Category costs** splits those tokens into four billed types, sums the matching cost formulas, and divides monthly tokens and cost by 30 for average daily figures; its USD per million figure is a blended rate when several models or tiers contribute. **Monthly category summary** rolls those results into input, output, and suite totals with formulas. **Calculations** contains editable scenario-effective execution inputs and cost formulas linked to Summary. Derived invocation volumes are precomputed: changing graph links or upstream volumes in Excel requires re-export from the app. Other sheets document the snapshot; editing them does not propagate into Calculations. Changing token sizes across a pricing threshold requires updating rates or re-exporting. The workbook documents these limits. The Agents sheet can reimport direct aggregate rows; derived rows require rebuilding links in the app, and detailed workflows are not a lossless backup.

First-year cost assumes 12 identical recurring months plus one-time items. Partial estimates remain clearly marked in the workbook. Excel/compatible spreadsheet software recalculates formulas on opening.

The workbook also has **Tool costs**, **Harness**, and **Use cases** sheets. Tool and harness charges have formulas that feed Summary. The Use cases sheet records the precomputed DAG rollup for each scenario; changing its source graph requires re-export. The Pricing sheet retains original-currency rates and the entered FX snapshot, while Calculations uses effective USD rates.

## Storage and recovery

Saved estimates and the local catalog are in `data/estimates.sqlite3` (override with `ESTIMATOR_DB`). Browser drafts also use localStorage. Back up the SQLite file while the server is stopped to preserve complete estimates and detailed steps, or export JSON for a portable copy. No telemetry or cloud database is used.

Reset previews its scope and offers undo; agent counts, volumes, links, model choices, custom prices, category definitions, and additional cost items are preserved. Clearing scenario overrides also clears Low/High link overrides. Quick setup and inventory import replace the inventory and its links together; the import preview states this. Opening an estimate and resetting support a single undo. Saving writes atomically to SQLite. Existing schema-1–7 estimates migrate to schema 8 without changing direct volumes or saved prices. Models formerly inherited from profiles become explicit aggregate agent overrides; profiles no longer store models.

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
