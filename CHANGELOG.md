# Changelog

## 0.4.0 — unreleased preview

- Refresh the dark and light palettes, app icon, connected tabs, editor chrome, dialogs and compact layout. Add a visible quick-open entry point and selected contrast/reduced-motion checks.
- Make the normal-browser Arena path the default: prepare a bounded, editable prompt from an explicit selection, copy only on request, sign in externally and review the pasted response. The website is not embedded and sessions are not transferred. The separate eligible-key API is still optional.
- Generate explicit permissions for the main bundled webview's Rust commands, deny remote editor navigation, narrow allowed external URLs, and test local versus remote IPC with Tauri's mock runtime.
- Enforce bounded no-follow native reads for individually opened files and bound Ollama JSON/error responses. Direct links/reparse points are rejected; parent-path races and existing-file save races remain.
- Preserve the unreleased 0.3.0 candidate's new-file save fix, multi-root workspaces, creation/search and API comparison. Consumer Windows, authenticated Arena and a complete security/accessibility audit remain unverified.


## 0.2.0 — 2026-10-30

### Folder, navigation and reviewed changes

- Open one explicitly selected folder, browse it lazily, and search its **saved files** with literal text and optional case/extension/name filters. Traversal, file sizes and results are bounded; generated folders, unsupported items and errors are disclosed. See the README for exact limits and exclusions.
- Add quick open (`Ctrl+P`), go to line (`Ctrl+G`), a command palette (`Ctrl+Shift+P`) and an optional, default-off recent native paths list with a clear control and storage-failure warnings.
- Compare a pasted replacement with one selected editor range before accepting it. Changes apply to the editor only, as one isolated undo step. Stale targets are rejected and Markdown is not silently stripped.
- Offer a normal-browser Arena workflow with manual copy/paste, plus an optional Arena API panel requiring an eligible key and explicit confirmation for every request. Keys are not persisted by Morrow. A Linux synthetic invalid-key request returned HTTP 401; authenticated success remains unverified. API access, model availability, billing and privacy depend on the user's account.
- Add an opt-in, locally rendered Markdown preview that follows unsaved edits. It uses an isolated worker and bounded inert DOM nodes; links and images are disabled and raw HTML is text. Limits and Windows verification caveats are in the README.
- Warn locally about a few potential credential patterns before an Arena API send. This is a limited, fallible heuristic, not a guarantee or a redaction tool. Clarify that Ollama's loopback API can route cloud models.
- Bound native folder enumeration and reads before IPC, skip detected links/reparse points, and restrict the HTTP plugin's redirect scope. Parent-directory and filesystem races remain; closing a folder view does not revoke persisted Tauri access.
- Add automated tests for search, navigation, review safety and undo, Arena request validation with a mock transport, and recent-path privacy. These do not replace hands-on Windows, live-provider, security or accessibility testing.

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
