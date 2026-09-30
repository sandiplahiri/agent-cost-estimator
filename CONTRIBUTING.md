# Reporting bugs and suggesting features

Use [GitHub Issues](https://github.com/sandiplahiri/llm-token-cost-estimator/issues/new/choose) for ordinary bugs and feature requests. Search for an existing issue first, then choose the matching form. Public reports are visible to everyone and should contain only synthetic examples. Never upload customer workbooks or estimates, prompts, API keys, or unredacted logs and screenshots.

For a suspected vulnerability, follow [the private security reporting policy](SECURITY.md). Do not post exploit details in an issue, discussion, or pull request.

Maintainers triage public issues by reproducing bugs and checking requests against [the product brief](PRODUCT_BRIEF.md). Labels indicate the type and status when available; submitting a request does not guarantee it will be implemented. Maintainers may ask for a smaller example, link duplicates, or close reports that cannot be acted on. Do not run code or open files supplied in a report without reviewing them first.

The local app and Excel workflow are the current scope. Proposed defaults and examples in the product brief are planning assumptions, not measured benchmarks.

## Maintainer setup

These files take effect after they are pushed to the repository's default branch. Keep GitHub Issues enabled. The issue forms use the standard `bug` and `enhancement` labels; create those labels if they are absent.

In the repository's GitHub **Settings → Advanced Security**, keep **Private vulnerability reporting** enabled and verify that the **Report a vulnerability** button appears under **Security → Advisories**. Subscribe to repository security notifications so private reports are seen. GitHub's temporary interaction limits can help during a spam incident, but they also restrict legitimate new contributors.
