# Local operation and data handling

Read this guide when changing service startup, networking, pricing refresh, token counting, credentials, error handling, or logging.

- Bind the local service to loopback by default. Do not add telemetry or send customer estimate data to external services without an explicit requirement.
- Routine estimates must not make paid model calls. Keep pricing refresh and optional external token-counting operations explicit; disclose any data leaving the machine.
- Keep secrets out of source control, logs, exports, and browser code. Do not require provider credentials for manual estimates using available price data.
- Return actionable errors without exposing stack traces or sensitive data to the UI. Log enough context to diagnose failures without dumping customer spreadsheets or prompts.
