# Pricing, scenarios, and persistence

Read this guide when changing prices, overrides, scenarios, saved estimates, imports, or reset behavior.

- Save the effective assumptions and pricing snapshot with each estimate, including provider/model identity, price-relevant region or service tier, units, source, retrieval date, and custom overrides.
- Do not silently reprice saved estimates on load. Make refresh explicit, show its impact, and preserve the ability to reproduce the previous estimate. Report refresh failures while retaining usable saved prices.
- Support custom prices without confusing them with catalog prices. Label tokenizer fallbacks and approximate counts; do not imply provider-exact tokenization without evidence.
- Define and document override precedence for profile, group, individual, and scenario values. Show effective values and their sources, and preserve explicit zero overrides rather than treating them as absent.
- Store scenario changes explicitly. Display the changed parameters alongside resulting costs; do not calculate a hidden percentage adjustment to the final bill or label planning ranges as statistical confidence intervals.
- Version persisted data schemas and bundled defaults. Handle migrations deliberately and preserve existing estimates when defaults change.
- Use transactions or atomic writes for saved data. A failed save or import must not leave a partially updated estimate.
- Make reset scope explicit, preview affected values, and provide undo. Preserve agent definitions and workload volumes unless the user explicitly selects them for reset.
