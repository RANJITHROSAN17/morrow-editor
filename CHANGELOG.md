# Changelog

## 0.1.1 — 2026-10-30

### Trust and usability

- AI consent is session-only; AI starts off every time, including after upgrades from older saved settings.
- Settings and recovery failures show persistent, actionable warnings. Unreadable settings or recovery snapshots no longer cause existing recovery data to be silently overwritten.
- Recovery deletion failures can be retried, and closing with dirty work while recovery is unavailable prompts for confirmation. Recovery remains unencrypted, best-effort local storage—not a backup or secure erase.
- Opening or dropping multiple files now preserves successful opens and reports each failure by filename. Files remain subject to the 20 MiB limit and supported text encodings.
- Improved text contrast, keyboard focus indicators and suggestion readability in the dark and light themes.
- Added regression tests for settings/AI consent, recovery, mixed file-opening failures and selected contrast pairs. The Windows build workflow is configured to run browser UI tests as well as unit and Rust tests.
- Updated the development test runner to Vitest 4.1.12, removing the affected `tinypool` dependency and addressing reported Vitest/mocker advisories.

### Important limitations

- If saving settings fails, the current recovery preference may revert after restart; the app warns about this. Save and back up work separately.
- Browser UI tests simulate storage and picker failures. Native multi-file picker unit tests use mocks. The changes still require hands-on Windows/WebView2, real-AI, and full accessibility/security testing.
- Windows installers built by the workflow are unsigned and can trigger SmartScreen. An Actions artifact is not a signed release.

## 0.1.0

Initial open-source Windows preview: Tauri editor shell, CodeMirror editing and syntax coloring, local recovery, and optional Ollama inline suggestions.
