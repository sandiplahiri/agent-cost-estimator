# Profile and model separation: failure modes

Before changing the calculation and persistence model, verify these independent outcomes through the app and API:

- A new or custom complexity profile contains call, token, retry, and cache assumptions only. An API request that puts `model_id` in a new profile is rejected.
- A profile can be shared by agents or steps using different models. Each model's own saved price determines its cost, while changing the profile's execution assumptions changes usage without changing any model selection.
- An aggregate agent with no selected model reports incomplete pricing, even when its profile has valid token assumptions.
- A schema 7 estimate whose aggregate agent inherited a profile model migrates that model to the agent's explicit override. Its prior cost and price snapshot survive save, reopen, and Excel export.
- An explicit agent model override, including an empty selection, takes precedence over a legacy profile model during migration. A detailed step's explicit model is preserved.
- A browser draft and a stored global category created under the older schema also reopen without retaining a profile model field.
- Resetting profile execution assumptions preserves agent and step model selections.
