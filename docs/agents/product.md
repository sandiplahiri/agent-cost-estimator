# Product scope and decisions

Read this guide before implementing features or changing product behavior.

- Read [PRODUCT_BRIEF.md](../../PRODUCT_BRIEF.md) before implementing features. Preserve the distinction between confirmed requirements and proposed defaults; do not present illustrative profiles or scenarios as measured benchmarks.
- Optimize for an AI architect estimating the monthly LLM spending of an entire agent suite. Keep individual costs, assumptions, and scenario differences explainable.
- Build the local web app and Excel workflow first. Do not introduce cloud services, authentication, live agent execution, or a LiteLLM proxy unless the task requires them.
- Keep implementation and setup instructions current. Record material design decisions and limitations in the repository rather than relying on conversation history.
