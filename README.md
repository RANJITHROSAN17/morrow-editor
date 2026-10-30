# Morrow

**A little space for notes, code, and everything in between.**

Morrow is an early, free and open-source Windows text-editor prototype. It is intended to feel as approachable as Notepad while making quick source-code edits more comfortable. Its AI completion is optional, starts off on every launch, and uses an Ollama server on the user's computer.

> **Status: preview, not a production replacement.** Keep backups and do not rely on this prototype as your only copy of important files. It has not yet passed the Windows release, accessibility, performance, or security test matrix in `docs/RESEARCH-AND-ROADMAP.md`. “Morrow” is a working name; check trademark and app-store availability before release.

![Morrow's browser preview showing an example Python file](docs/images/morrow-browser-preview.png)

*The screenshot shows the browser preview; native Windows integration is not demonstrated here.*

## What works

- Multiple editable tabs, native open/save dialogs, drag-and-drop, undo/redo, close-with-unsaved-changes confirmation, and Windows-oriented keyboard shortcuts. When opening several files, readable files open even if others fail; the failed filenames and reasons are listed.
- Syntax coloring selected by filename or manually. The bundled CodeMirror catalog contains **143 language descriptions**, including programming, markup and SQL dialects; that number is not a count of independently verified programming languages. Highlighting is not semantic analysis or a language server.
- Line numbers, bracket matching/closing, folding where supported, multiple selections, word wrap, dark/light themes, and a configurable font and indentation width.
- Find/replace in the current file, with case sensitivity and regular expressions.
- UTF-8 (with or without BOM), BOM-marked UTF-16 LE/BE, and LF/CRLF/CR detection and output. Invalid UTF-8, UTF-32 BOMs, and text containing NUL are rejected. The app cannot detect every binary or legacy-encoded file. Mixed line endings are flagged; saving normalizes them after confirmation.
- Opt-out local session recovery, including unsaved content; local snapshots are **unencrypted** and are not a backup.
- Optional, opt-in, single-line inline AI suggestions from a locally addressed Ollama server. Tab accepts a suggestion; Esc dismisses it. The active document's nearby text is sent to Ollama only after opt-in; see **Privacy** below.
- Save-time external-change check and same-directory temporary-file replacement for native saves. This mitigates common accidental overwrites, but is not a transactional guarantee across all filesystems; see limitations below.

Example buffers are intentionally labeled **SAMPLE**. They are editable but are not files on disk until you save them.

## Run the Windows application from source

**Prerequisites:** Windows 10/11 x64, Node.js 20 or newer, Rust stable (1.90+), Microsoft C++ Build Tools with **Desktop development with C++**, and the Microsoft Edge WebView2 runtime. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

Open PowerShell in this project directory:

```powershell
npm ci
npm run tauri dev
```

Build an unsigned Windows x64 installer on Windows:

```powershell
npm ci
npm run tauri build -- --target x86_64-pc-windows-msvc
```

The NSIS setup executable is generated under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Unsigned builds can trigger Microsoft Defender SmartScreen; obtain and configure a code-signing certificate before public distribution. The installer uses the WebView2 download bootstrapper if the runtime is missing, so that step may require internet access. It is **not** an offline installer.

The included `.github/workflows/windows.yml` is configured to produce an unsigned Windows x64 installer as a GitHub Actions artifact. Check the repository's **Actions** tab for the latest build result; an artifact is not a tested public release. No signed Windows release is available yet.

### Browser preview (not the Windows application)

```sh
npm ci
npm run dev
```

Open the address Vite prints. This preview exercises the same editing UI. Depending on browser support and permissions, it may use the File System Access API or download a copy when saving; it cannot access native Windows dialogs, file associations, or your PC's Ollama service. It does **not** demonstrate Windows integration.

## Set up optional AI suggestions

1. Install and start [Ollama for Windows](https://ollama.com/download/windows).
2. In a terminal, download the recommended model:
   ```powershell
   ollama pull qwen2.5-coder:1.5b
   ```
   The model download is separate (approximately 1 GB as of October 2026); inference uses your own CPU/GPU and memory.
3. In the **Windows app**, open **AI suggestions**, read the consent notice, and turn the switch on. Consent lasts only until the app exits; enabling AI again requires another explicit choice. Use **Check connection** if needed. No account or API key is required for a local Ollama model.
4. Type code and pause for a suggestion; press **Tab** to accept or **Esc** to dismiss. `Ctrl+Shift+Space` requests one manually.

The implementation uses Ollama's [`/api/generate`](https://docs.ollama.com/api/generate) fill-in-the-middle `prompt` and `suffix` fields, which require a compatible model. Suggestions are currently **single-line**, may be wrong, and are not semantic/LSP-aware. The quality and latency depend on the model and your computer.

## Privacy and storage

- AI starts off on every launch, even if an older version stored an enabled setting. It runs only after explicit consent for the current session; that consent is not persisted. The app contains no analytics, accounts, or cloud endpoint. When enabled, at most 3,500 UTF-16 code units before and 1,200 after the cursor are sent to `http://127.0.0.1:11434`; no path is included in the request. Requests are cancelled/ignored when edits or cursor changes make them stale.
- A loopback address by itself does **not** guarantee that Ollama or a selected model will never forward data. Choose a genuinely local model, inspect its configuration, and follow your organization's policy. Model downloads and installing WebView2 can require network access.
- Session recovery is on by default and stores open document text, unsaved text, file paths, cursor positions and related metadata in the local WebView IndexedDB database. Settings are stored in local storage. They are not encrypted by Morrow; OS disk encryption and access controls are separate. Turning off **Remember my session** attempts to delete the current stored session; deletion is not a secure erase. If it fails, a persistent warning offers **Retry removal**. File-access scopes are separately persisted by Tauri to restore access after restart.
- If settings cannot be saved, Morrow warns that changes—including a recovery opt-out—may revert after restart. If settings cannot be read, recovery is paused and an existing snapshot is left untouched. If a snapshot cannot be read or is incompatible, Morrow also pauses recovery rather than replacing it with example files; save new work separately. An explicit confirmation is required before deleting an unreadable snapshot.
- Recovery snapshots are normally written after about 1.2 seconds of inactivity and on a normal native-window close. They can fail, be cleared, or miss the latest keystrokes during a crash. Failed snapshot writes trigger a persistent warning and, if recovery is still unavailable on exit, an unsaved-work prompt. **Save and back up important work.**

## Current limitations and safety notes

- There is a **20 MiB per-file limit**. Large-file streaming, ANSI/legacy code pages, UTF-32, exact preservation of mixed line endings, and binary/hex editing are not implemented.
- Native save writes a temporary file in the destination directory and replaces the destination after flushing. It needs write access to the directory; saving through a symbolic link is rejected. Metadata/ACL preservation, power-loss durability, network shares, file locks, and Windows-specific edge cases need testing. A small race remains between the external-change check and replacement. Do not assume it is as robust as a mature editor.
- Search is within the active file; there is no find-in-files, project browser, extension marketplace, macros, debugger, or language-server integration. The local AI feature is not a full Copilot replacement.
- Recovery is best-effort and is not an encrypted vault. If the app cannot refresh a clean restored file from disk, it displays the locally stored copy and warns; unsaved drafts retain their original disk hash for the next save check.
- An installed file association and command-line launch handler are configured but require verification on real Windows machines. The x64 installer, AI integration, and native dialogs need hands-on testing on Windows before release. An earlier 0.1.0 Linux Tauri smoke test opened and saved a file, detected an external edit, and exercised inline AI against a mock loopback service; that does not verify the current Windows build or a real model.
- With working session recovery enabled, a normal native-window close keeps unsaved tabs in the local recovery snapshot rather than prompting for each one. Closing an individual dirty tab prompts. If recovery is disabled, paused, or a close-time snapshot fails, the app prompts about unsaved tabs. Recovery is not a backup.
- The Rust lockfile contains `glib` 0.18.5 through Linux GTK/WebKit dependencies, with an outstanding upstream [advisory](https://github.com/advisories/GHSA-wrw7-89jp-8q8g). The Windows target dependency tree does not select `glib`; Linux builds need an upstream-compatible fix. This is not a complete security assessment.
- Accessibility, high-contrast themes, localization, security review, signed release infrastructure, benchmark numbers, and updates are still release blockers. No comparative speed or memory advantage is claimed without measurement.

## Shortcuts

| Action | Shortcut |
|---|---|
| New / open / save | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` |
| Save as / close tab | `Ctrl+Shift+S` / `Ctrl+W` |
| Find / replace | `Ctrl+F` / `Ctrl+H` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Toggle sidebar / wrap | `Ctrl+B` / `Alt+Z` |
| Settings | `Ctrl+,` |
| Request AI / accept / dismiss | `Ctrl+Shift+Space` / `Tab` / `Esc` |

## Development and tests

```sh
npm ci
npm run build
npm test
npx playwright install --only-shell chromium
npm run test:e2e        # starts the preview server automatically
```

Rust backend tests (with the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) installed):

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

The tests include settings/AI-consent failures, recovery preservation and removal, partial file-opening failures, and selected color-contrast checks. Browser tests inject storage and picker failures; the native picker unit test uses mocks. Neither substitutes for hands-on Windows/WebView2 testing or a complete accessibility audit. The Windows workflow is configured to run the browser tests as well as the frontend and Rust tests.

The frontend is TypeScript, CodeMirror 6 and Vite. The Windows shell and native file handling use Tauri 2 / Rust and the system WebView2 runtime; language modes are loaded on demand. See [`docs/RESEARCH-AND-ROADMAP.md`](docs/RESEARCH-AND-ROADMAP.md) for competitive research and release priorities.

## License

[MIT](LICENSE) for this project's code. Dependencies and any separately downloaded AI models have their own licenses; review them before redistribution. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for an initial direct-dependency inventory and the remaining distribution audit. The suggested `qwen2.5-coder:1.5b` model is distributed separately under its own terms.
