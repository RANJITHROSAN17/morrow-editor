# Morrow: competitive research and release plan

Research date: **30 October 2026**. Morrow is a working name, not a cleared trademark. This document separates observed facts from product hypotheses and proposed targets.

## The opportunity

**Positioning hypothesis:** “A calm Windows text editor that starts with a blank page and grows with you: useful syntax coloring and optional local AI without an account.” This is a testable promise, not a claim that this prototype is faster, safer, or more capable than established products.

The audience has two overlapping jobs:

1. **Everyday users:** open a `.txt`, jot down a thought, find a phrase, save and reopen it, and trust that nothing was lost.
2. **Developers and support engineers:** inspect a script, config or log immediately, recognize the language, find/replace accurately, and occasionally get a code completion without starting a full IDE.

The key is progressive disclosure: a normal note should not require understanding models, workspaces, git, or a plugin ecosystem. AI should never be the price of using the editor.

## Competitive landscape

| Product | What users already get | Implication for Morrow |
|---|---|---|
| Windows Notepad | Recent Windows 11 Notepad has tabs and can restore open tabs and unsaved edits; those are table stakes, not differentiators. [1](https://blogs.windows.com/windows-insider/2023/08/31/new-updates-for-snipping-tool-and-notepad-for-windows-insiders/) Microsoft also announced subscription-free local writing tools on supported Copilot+ PCs. [3](https://blogs.windows.com/windowsexperience/2025/10/16/new-experiences-currently-rolling-out-for-windows-11/) | Match ease and session trust. Differentiate on source-code highlighting, open governance, and optional code-oriented completion—not “Notepad has no tabs or AI.” |
| Notepad++ | A mature, open-source Windows editor built on Scintilla. Its manual describes around 80 languages, syntax folding and tabs, and a much broader feature set including plugins and macros. [2](https://npp-user-manual.org/docs/getting-started/) Its session snapshot/backup behavior is established. [2](https://community.notepad-plus-plus.org/topic/21782/faq-desk-periodic-backup-vs-autosave-plugin/) | It is the serious incumbent, not a weak baseline. Earn trust through file fidelity and performance; prioritize large-file support, find-in-files and operational maturity before calling Morrow a replacement. |
| Visual Studio Code | Supports hundreds of languages and richer code understanding, debugging and extensions. [3](https://code.visualstudio.com/docs/editor/whyvscode) Its Copilot Free plan has a monthly allowance for inline suggestions; some capabilities require the Copilot service. [1](https://code.visualstudio.com/docs/setup/copilot) | Don't pretend Morrow is a complete IDE. Aim for the short single-file task with a smaller conceptual footprint and an optional local-model path; measure actual startup and memory instead of assuming an advantage. |

There are also many capable smaller editors. This is directional research, not an exhaustive competitor survey, and no head-to-head benchmarks have been run. Before naming, launch or public claims, review current product versions, licenses, pricing, trademarks and relevant platform policies again.

## Why this architecture

The prototype uses Tauri 2 with the system WebView2 and CodeMirror 6. This avoids bundling a separate Chromium runtime, but WebView2 process-tree RAM and startup behavior must be measured; using Tauri alone does **not** prove lower memory or faster startup. Tauri documents its WebView2 requirement and Windows development prerequisites. [1](https://v2.tauri.app/start/prerequisites/) CodeMirror's language catalog is loaded on demand; it provides syntax highlighting, not LSP-style understanding. [1](https://codemirror.net/docs/ref/)

For optional suggestions, Ollama's API supports a fill-in-the-middle `suffix` for suitable models. [1](https://docs.ollama.com/api/generate) The selected `qwen2.5-coder:1.5b` package is listed at about 986 MB separately from the app. [1](https://ollama.com/library/qwen2.5-coder:1.5b) This makes the editor usable without a model download while being honest that AI has substantial hardware and storage costs.

## Prototype versus a competitive release

| Area | Present in this prototype | Before a public 1.0 |
|---|---|---|
| Text and code | Tabs; syntax catalog; undo/redo; find/replace; themes; optional local-address AI | Robust international text and input methods; customizable shortcuts; command palette and accessible UI; usability tests with non-developers. |
| File fidelity | UTF-8 and BOM-marked UTF-16; newline detection; mixed-ending warning; 20 MiB limit | Legacy Windows code pages and explicit conversion; exact mixed-ending handling; very large logs; file locks, symlinks, UNC paths and permissions; disk-full and power-loss tests. |
| Safety | Unsaved-close prompts; best-effort local session; external-change check; temporary-file replacement | Crash-injection tests; atomicity and ACL audit on NTFS/network shares; stale-file monitoring; recoverability tests and retention controls. Treat a single confirmed data-loss bug as a release blocker. |
| Developer workflow | Language coloring, folding, brackets, basic word/language completion, single-line FIM | Find in files; go to line; optional formatting; configurable indentation; optionally isolated LSP integrations for priority languages after performance/privacy evaluation. |
| Windows product | Windows-targeted Tauri config, file associations and build workflow | Verify Windows 10/11 x64 and ARM64, multi-instance/Open With behavior, high DPI, screen readers, signed NSIS/MSI, reliable uninstall, update/rollback and an optional portable build. |
| Distribution | MIT source and an unsigned build workflow | Code signing and checksums; dependency/SBOM/license audit; Windows Store / winget / Scoop evaluation; public security reporting and sustainable maintainer ownership. |

## Release gates and measurable targets

These are **proposed acceptance targets**, not measurements or promises. Measure cold and warm starts separately, on both a low-spec Windows machine and a modern baseline, and record hardware, OS, WebView2 version, file fixture, sample size and process-tree methodology. Compare against Notepad and Notepad++ on the same machines.

- **Trust gate:** zero known reproducible data-loss or silent encoding-corruption issues. Test kill/power interruption, full disk, access denial, changed/deleted files, concurrent edits, invalid bytes, read-only paths and session recovery.
- **Suggested UX budget:** p95 first editable window under 1.5 s on the agreed baseline; p95 open of a 10 MiB UTF-8 file under 2 s; p95 typing latency under 16 ms on the same fixture. Revise budgets after measurement rather than presenting them as current facts.
- **Resource budget:** record both app and WebView2 child processes. Set an idle working-set target only after collecting baselines; also measure installed size, battery and idle CPU.
- **Compatibility:** round-trip fixture corpus across UTF-8/BOM/UTF-16, CR/LF/CRLF, mixed endings, supplementary Unicode, right-to-left text, IMEs, paths with spaces/non-ASCII, long paths, network shares and locked/read-only files.
- **AI:** opt-in is explicit and reversible; no request on startup; no stale suggestion insertion; complete works with a local model and offline networking disabled except loopback; document context bounds and model provenance; test slow/offline models and user cancellation.
- **Accessibility:** keyboard-only workflows, screen-reader labels, visible focus, high contrast, scaling at 100–200%, and color contrast review before release.
- **Security:** threat-model dynamic file scopes, WebView CSP, raw IPC, file association launch arguments, model/provider selection and supply chain; resolve findings and sign release binaries.

## Practical roadmap

1. **Stabilize the core:** real Windows x64 build and smoke tests; save/recovery fault injection; legacy encodings and file change handling; remove or justify the 20 MiB cap. Validate the editor with everyday note-takers.
2. **Win quick developer tasks:** find-in-files, go-to-line, sensible indentation, formatting for a small set of formats, better model onboarding, and compare-file workflow. Verify language coloring against fixture files rather than counting labels.
3. **Earn adoption:** signed and reproducible releases, release notes and checksums, winget/Scoop proposals, localization, accessibility audit, portable option and contributor/security policies. Add opt-in integrations only after the core stays reliable.
4. **Grow carefully:** community-voted features, optional LSP/plugins with clear resource budgets and permissions, and ARM64 builds. Avoid bundling a model or introducing mandatory accounts.

## Attracting and retaining users without surveillance

- **Launch message:** “Notes are simple. Code is readable. AI is optional.” Demonstrate a note, a Python file and a local completion in a short video; don't claim that it beats every editor.
- **Initial users:** interview 5–10 note-takers, 5–10 developers and several IT/support users. Observe whether each can open, edit, find and save a file, and whether the AI consent is understood. Fix failures before promotion.
- **Distribution:** GitHub releases and documentation first, then a signed installer and package-manager submissions. Publish known limitations, hashes, model requirements and an honest comparison table.
- **Metrics:** use aggregate download counts from distribution channels and voluntary surveys; do not add silent telemetry. Define activation as a user-reported successful open/edit/save and retention as a voluntary follow-up at 7/30 days. Track issue themes and crash reports only when users choose to share them. Download counts are not active users.
- **Open-source sustainability:** MIT license, public roadmap, clear issue templates and review standards; accept sponsorships/donations without making basic editing or local AI paid-only. Verify third-party licenses and the project's name before launch.
