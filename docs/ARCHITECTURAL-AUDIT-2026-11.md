# Wrytrove Editor — architectural, competitive and product audit

> **Historical naming note:** product references in this snapshot now use Wrytrove. Original repository URLs, branch names, commit IDs and released artifact filenames are preserved as evidence.

**Audit date:** 13 November 2026 UTC  
**Repository:** `RANJITHROSAN17/morrow-editor`  
**Audited branch:** `arena/e840cdf9-morrow-editor`  
**Audited commit:** `211f60a45f83c4d4b7fa1824de112476a026ab74`  
**Scope:** current source tree, tests, native configuration, CI/release automation, product documentation, and a source-level comparison with five reference products.

This document is deliberately more conservative than a marketing review. It distinguishes what is in the tree, what a competitor's source or documentation says, what follows from architecture, and what is still a product hypothesis.

## How to read the evidence

- **Observed** — directly inspected in the audited repository or produced by a command against it.
- **Competitor evidence** — stated in a reference project's source tree, README or official documentation. It is not a claim that the competitor is objectively faster or safer.
- **Derived risk** — a reasonable engineering consequence of the observed design, but not a reproduced failure.
- **Hypothesis** — a proposed improvement that still needs user research or a benchmark.

GitHub stars, forks and issue counts are included only as ecosystem/demand signals. They are not quality, security or performance measurements. No competitor was run hands-on during this audit, and no comparative speed claim is made.

---

## 1. Executive verdict

Wrytrove is a thoughtful **Windows-first, local-first text/code/Markdown editor preview** with unusually explicit safety boundaries for a small project. Its strongest work is not the visual surface; it is the set of boundaries underneath it:

1. native reads and writes are bounded and scope-checked;
2. direct links/reparse points are rejected in the native paths that matter;
3. existing-file saves use an expected SHA-256 version and atomic temporary-file replacement;
4. supported text encodings and line endings are represented explicitly;
5. workspace traversal, search, model payloads, AI responses and Markdown rendering are bounded;
6. AI edits are reviewable changes, not direct model-controlled mutations;
7. recovery failures preserve the last complete snapshot rather than silently replacing it with metadata;
8. Markdown preview is an inert allowlisted tree rather than document-supplied HTML.

The central problem is not that Wrytrove lacks clever features. It is that the product is at the point where **preview-quality foundations must become daily-driver guarantees**. A user can already write, browse, search, recover, review and ask optional AI for help. They cannot yet rely on Wrytrove for the edge cases that make a mature editor trustworthy: very large files, search over live buffers, folder-wide replace, crash-safe draft history, a durable and signed distribution path, measured performance, real screen-reader validation, and a single coherent provider/data-flow model.

### The architectural judgment

- **Good foundation:** a small Tauri shell plus pure TypeScript modules is an appropriate local-first architecture for this scope. The native boundary is much more defensive than the average Electron/Tauri prototype.
- **Current scaling risk:** `src/main.ts` is the application controller, persistence coordinator, document model, editor host, settings controller, AI orchestrator, Markdown host, notes host, keyboard router and much of the DOM renderer in one class. `src/workbench.ts` is a useful extraction, but it is another large UI coordinator with a wide host interface.
- **Current product risk:** a 20 MiB hard limit and saved-file-only literal workspace search are safety limits, not a competitive editing strategy. Notepad++ and VS Code have set the expectation that “open anything reasonable” and “find it across the project” are baseline behaviors.
- **Current trust risk:** recovery is local but unencrypted; Tauri persisted scopes may outlive a visible folder; Ollama is addressed through loopback but can route cloud models; the installer is unsigned; and no complete security or accessibility audit has been performed. These are documented honestly, but documentation is not remediation.
- **Current AI risk:** local Ollama completion, local selection actions and Arena cloud/API/browser paths are each bounded, but they do not share one provider/capability/egress abstraction. That will make future model choice, cost disclosure, citations and privacy controls drift.

### Recommended product order

1. **P0 — trust gate:** signed/provenanced distribution, crash-safe recovery, durable save semantics, explicit data-flow/secret handling, Windows release validation.
2. **P1 — daily-driver gate:** unified live-buffer/disk search, regex and replace-in-files with preview, large-file mode, compare/split workflows, performance budgets, accessibility validation.
3. **P1/P2 — architecture:** extract document/file/search/recovery/AI services from the two UI orchestrators before adding autonomous behavior.
4. **P2 — differentiated value:** grounded local document Q&A, reviewable partial AI acceptance, portable note graph/indexing and capability-based rich Markdown preview.
5. **Do not build yet:** terminal execution, an extension marketplace, autonomous multi-file agents, collaboration sync or a proprietary note database.

The strategy is not “be a smaller VS Code.” It is: **be the editor where files remain ordinary files, every meaningful side effect is explainable, and useful local intelligence never outruns user consent.**

---

## 2. Audit evidence and verification state

### 2.1 Repository snapshot

| Area | Observed state |
|---|---|
| Branch and tree | Current branch is `arena/e840cdf9-morrow-editor`; at the supplied commit before this audit there was no branch diff and the working tree was clean. |
| Frontend | TypeScript 5.9, strict/no-emit type checking, Vite 8, CodeMirror 6, `markdown-it`, Vitest 5, Playwright 1.65. |
| Desktop shell | Tauri 2 / Rust 2021; Windows NSIS bundle; WebView2 bootstrapper; file associations for common text/code extensions. |
| Native surface | Five custom commands: `safe_write`, `take_launch_files`, `workspace_list_directory`, `workspace_read_file`, `workspace_create_entry`, plus Tauri plugins for dialog, filesystem, HTTP, opener, persisted scope and single instance. |
| Source scale | `src/main.ts` 2,097 lines; `src/workbench.ts` 951; `src-tauri/src/lib.rs` 547 source lines in the audited tree; 7,338 lines across the primary TypeScript/Rust source inventory reported during the audit. |
| Product version | `0.4.0` preview in `package.json`, Tauri config and UI. The project explicitly labels the installer unsigned and not production-ready. |
| License | Wrytrove code is MIT. Competitor implementation code is not assumed reusable; several comparisons below are GPL/AGPL. |

### 2.2 Commands run against the current tree

| Check | Result | Interpretation |
|---|---|---|
| `npm ci` | Passed; 112 packages installed, production audit clean at install time. | Frontend dependencies were available for the rest of the audit. |
| `npm test` | **25 test files / 281 tests passed**. | Strong pure-module and mocked-transport coverage; not proof of Windows behavior. The run took about 5.7 seconds wall-clock in this environment. |
| `npm run build` | **Passed** strict TypeScript and Vite production build. | 208 modules transformed; build reported a 302 kB main JS chunk, 108 kB Markdown worker and 46 kB CSS before gzip. These are bundle observations, not startup measurements. |
| `npm audit --omit=dev --audit-level=moderate` | **0 production vulnerabilities** in the npm dependency tree. | Does not cover Rust, WebView2, the installer, model provenance or application logic. |
| `node scripts/validate-roadmap.js .github/roadmap.json` | Passed: 15 manifest items, 3 filing candidates, caps 3/4. | Contributor-queue automation is currently internally consistent. |
| `npx playwright test --list` | Found **54 E2E tests**. | The test inventory exists and is discoverable. |
| `npx playwright test` | Could not launch any test because Playwright Chromium headless-shell is absent at `/home/user/.cache/ms-playwright/...`. | Environment limitation; not evidence of 54 product failures. Install the browser before using this result as a gate. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` | Could not run because Cargo/Rust is not installed in this environment. | Rust tests are present and CI/Windows automation runs them, but this audit did not execute them locally. |
| GitHub Actions snapshot | Recent `main` CI and Windows preview runs at the audited base commit were reported successful; the current local branch was not altered to reproduce those jobs. | Remote CI is useful evidence, but it is not a substitute for a consumer-Windows, WebView2, accessibility or signed-release test. |

### 2.3 What this audit does not establish

- No cold-start, first-keystroke, memory, edit-latency, 100 MiB-file or 5,000-file comparative benchmark was run.
- No live Ollama completion or authenticated Arena request was made.
- No independent penetration test, Windows reparse-point race test, power-loss test, ACL/metadata preservation test or WebView2 compatibility matrix was completed.
- No Narrator/NVDA task study, 200% scaling study or high-contrast manual pass was completed.
- No claim below that uses “faster”, “scales” or “more private” should be read as a measured product claim unless explicitly labelled as a benchmark proposal.

---

## 3. Wrytrove architecture deep dive

### 3.1 System shape

```text
                         ┌─────────────────────────────────────────────┐
                         │ Tauri 2 / Rust / WebView2                   │
                         │ CSP + capabilities + navigation guard       │
                         │ bounded read/list/create + atomic write    │
                         └──────────────┬──────────────────────────────┘
                                        │ Tauri IPC / plugin APIs
┌───────────────────────────────────────▼─────────────────────────────────────────┐
│ TypeScript/Vite application                                                     │
│                                                                                 │
│  WrytroveApp (`main.ts`)                                                        │
│   document model · CodeMirror view · settings · recovery · save/conflicts       │
│   keyboard/menu routing · AI completion/actions · Markdown host · notes UI      │
│                                                                                 │
│  Workbench (`workbench.ts`)                                                     │
│   selected roots · lazy tree · Quick Open · folder search · review/Arena UI     │
│                                                                                 │
│  Pure/mostly-pure modules                                                       │
│   encoding · workspace traversal/search · change-review · storage validation    │
│   AI request framing · Arena transport · bounded JSON · Markdown renderer       │
│   note parsing/index · outline · formatting · stats/focus/minimap               │
└─────────┬─────────────────────────┬──────────────────────────┬──────────────────┘
          │                         │                          │
          ▼                         ▼                          ▼
     IndexedDB/localStorage     selected files             explicit network calls
     session + settings         via Tauri/FS API            Ollama loopback or Arena
```

The architecture is intentionally **single-user and local-first**. It has no server, account database, background daemon, plugin runtime or implicit cloud synchronization. That is a strength for privacy and maintainability. It also means the main window currently carries responsibilities that a larger editor would distribute across services and workers.

### 3.2 Module and responsibility map

| Module | Responsibility | Strength | Structural concern |
|---|---|---|---|
| `src/main.ts` | Owns `WrytroveApp`, document records, active CodeMirror view, settings, recovery, save/reload, UI rendering, keyboard routing, AI and notes coordination. | One obvious application lifecycle; easy to follow for a small feature. | At 2,097 lines, every new cross-cutting feature increases coupling and regression surface. DOM selectors, persistence, network orchestration and document mutation are not strongly separated. |
| `src/workbench.ts` | Implements `WorkbenchHost`, folder roots, tree listings, Quick Open, folder search, review dialog, Arena panel and folder-note file operations. | A meaningful first extraction with a narrow-ish host contract; cancellation and generation tokens are present. | 951 lines and a broad host interface still make it a UI controller, not an independent service. Search and Arena are coupled to DOM dialogs. |
| `src/editor.ts` | CodeMirror 6 state creation and compartments for language, wrapping, indent, spellcheck, focus/typewriter, smart typing and ghost completion. | Correct use of CodeMirror state/compartments; inline completion is a decoration and one-step undoable insertion. | The application still reconstructs editor states in some lifecycle paths; large-document mode and incremental model policy are not defined. |
| `src/encoding.ts` | Strict UTF-8/BOM/UTF-16 LE/BE decode/encode, line-ending inspection, SHA-256. | Lossless write-back for supported encodings and explicit refusal of invalid/binary-looking data. | No ANSI/legacy code pages, UTF-32, byte-preserving mixed endings or binary/hex mode; hard 20 MiB limit. |
| `src/platform.ts` | Browser/native file opening, save target selection, native hash checks and raw IPC save. | Separates browser and desktop paths and avoids JSON serialization of large save bodies. | Native and browser semantics differ; browser File System Access cannot provide the same exclusive-create guarantee. |
| `src/workspace.ts` | Selected-root abstraction, bounded lazy directory listing, traversal, Quick Open ranking, saved-file literal search and creation. | Explicit caps, excluded generated directories, cancellation, progress and one global workspace cap. | Search reads files sequentially, has a 2 MiB per-file search cap, searches saved files only and has no replace plan or durable index. |
| `src/storage.ts` | Sanitized settings, IndexedDB session snapshots, quota fallback and metadata-only preservation. | Strong failure handling; session-only AI consent and opt-in recent paths are deliberate. | Content is unencrypted at rest; snapshot is a whole-session rewrite rather than a journal; recovery is not a separate durable draft/backup product. |
| `src/change-review.ts` | Captures document ID/revision/range/original text and validates a replacement before apply. | Correct review-first primitive; stale target and no-op replacement rejection are tested. | Primarily selection-level; it is not yet a file-to-file compare or multi-file transaction engine. |
| `src/ai.ts`, `src/ai-actions.ts` | Ollama model listing, bounded FIM suggestion, selection action request, output cleaning and timeouts. | Explicit context and output limits, model validation, cancellation and no automatic apply. | Ollama is a transport-specific module; provider capabilities, local/cloud state and cost/data disclosure are not centralized. |
| `src/arena.ts` | Explicit Arena browser prompt and API request construction, one/two-model comparison, bounded JSON. | Separate browser handoff from API, no persisted API key, exact endpoint and redirect refusal. | A second AI surface with different limits, UX and consent semantics increases policy drift. |
| `src/markdown-render.ts` / `markdown-preview.ts` | Worker Markdown parse, closed preview-node contract, inert DOM rendering, extension preprocessing. | Security posture is better than simply inserting Markdown HTML; worker timeout and node/character caps exist. | Deliberately less capable than MarkText/Joplin; links/images/math are placeholders/literals, and preview is not a document export pipeline. |
| `src/notes.ts`, `note-index.ts`, `outline.ts`, `daily.ts` | Plain-file front matter, tags, wikilinks, backlinks, orphan/tag index, daily notes, quick capture and headings. | Maintains portability and handles ambiguity rather than guessing a link. | Index refresh and write coordination are still evolving; no rename/reference transaction or full-text inverted index. |
| `.github/` and `scripts/` | TypeScript/Vitest CI, Windows preview build, issue queue/status bots, roadmap validation, Dependabot and stale nudging. | Good contributor hygiene for a young project; roadmap bot is explicit and bounded. | No committed performance budget, coverage gate, SBOM/provenance gate or release signing/update path. |

### 3.3 Startup and document lifecycle

1. `WrytroveApp` loads and sanitizes settings. Persisted `aiEnabled` is intentionally ignored, so a prior version cannot silently enable AI.
2. If recovery is enabled, IndexedDB is read and validated. A complete snapshot is restored; a metadata-only quota fallback blocks automatic restore so the older complete snapshot is not mistaken for the latest state.
3. Clean native restored files are refreshed from disk. Dirty tabs retain the recovery draft and original hash for save-time conflict checking.
4. If there is no restorable session, editable sample documents are created and marked as samples.
5. A CodeMirror `EditorView` is created for the active document. Language descriptions are loaded on demand; UI and desktop event handlers are then bound.
6. Recovery is scheduled after roughly 1.2 seconds of inactivity and on normal native close. This is a **session snapshot**, not a write-ahead journal and not a user-visible version history.

**Derived risk:** the startup path is sequential and all restored document text is materialized into JavaScript/CodeMirror/IndexedDB. The current valid-session test intentionally accepts more than 100 tabs, but there is no measured upper bound for total recovered characters or an incremental restore policy. A malformed/oversized valid-looking but resource-heavy snapshot is a performance and availability concern even when it is not a code-execution vulnerability.

### 3.4 Open, edit, save and conflict workflow

- Native open enters through the Tauri dialog, a launch-file queue, drag/drop or the workspace reader.
- Rust checks scope, regular-file status, links/reparse points and the maximum read size before bytes cross IPC.
- `decodeFile` rejects invalid sequences, NUL-containing content and unsupported UTF-32; it normalizes editor text to LF while retaining dominant line-ending metadata and a mixed-ending warning.
- A `Doc` holds current CodeMirror state, saved document text, encoding, line ending, file hash, revision and reference.
- Save encodes text, sends raw bytes plus percent-encoded path and non-empty expected-version/force headers, and invokes `safe_write`.
- Rust refuses an existing destination when the caller says `absent`, checks the expected SHA-256 for an existing file, writes beside the target, flushes the temporary file, preserves basic permissions and atomically persists it. A force action is explicit.
- Focus-time disk checks compare the bounded native read against the opened hash. Clean documents can reload; dirty documents keep the draft and receive a save-time conflict warning.

**What this does well:** it treats overwriting as a protocol, not a UI promise. The explicit `absent` sentinel avoids a transport quirk where empty headers could disappear. The app documents that a remaining parent-directory race means this is not a file lock.

**What is still missing:** a durable transaction/rollback story for power loss, network shares, ACLs, metadata, alternate data streams, external replacement between verification and replacement, and a user-visible “save copy / compare / merge” workflow. Mature editors have accumulated years of compatibility behavior in this layer.

### 3.5 Workspace traversal and search

The current limits are coherent and intentionally conservative:

- up to 12 selected workspace roots;
- up to 5,000 files and 1,000 directories per traversal;
- 2,000 entries per native directory listing;
- 2 MiB per file for search reads;
- 500 matching lines per search;
- excluded `.git`, `.hg`, `.svn`, `node_modules`, `target`, `dist`, `build`, `coverage`, `.cache`, `.next` and `.venv` directories;
- single-line, 256-character queries;
- literal case-sensitive/insensitive matching and safe extension/name filters;
- abort signal, progress text and skipped-item reporting.

Quick Open uses a deterministic in-memory ranker and has a test that ranks 5,000 entries under 25 ms in the unit-test environment. That is a useful algorithmic regression guard, not an end-to-end filesystem benchmark.

The product gap is precise: **folder search is saved-file-only, literal, read-only and sequential**. Current-file search has regex and replace through CodeMirror, but the workspace search surface has no regex, no live-buffer source, no folder-wide replace, no per-file diff plan and no durable index. The UI does tell the user that it searches saved files only, which is honest but not competitive with the search expectations set by Notepad++, VS Code and Zed.

### 3.6 AI and network boundaries

#### Local Ollama

- Endpoint is fixed to `http://127.0.0.1:11434` and permitted by the Tauri HTTP capability.
- Inline completion sends bounded text around the cursor, not a filename or path, and returns one line up to 240 characters.
- Selection actions cap selection at 12,000 characters, instructions at 2,000 and output at 20,000; they use delimiter framing and treat selected text as data rather than instructions.
- A model must be explicitly enabled for the session; action consent is separate and model-specific; changes go through review.
- Responses and errors are bounded by byte size; requests have cancellation and timeouts.

**Important privacy qualification:** a loopback destination identifies the transport endpoint, not the ultimate provider. Ollama documents cloud models through its local API. Wrytrove correctly warns about this in its docs, but the UI does not yet provide a provider capability/route ledger that proves whether a selected model is local-only.

#### Arena browser/API

- Browser handoff generates a copyable prompt and does not copy/open/send automatically.
- API mode requires an explicit key, model ID, instruction and per-request confirmation; keys are cleared on close and not persisted.
- One or two explicit model requests are possible; comparison is never an invisible fallback and can be separately billable.
- The fixed endpoint, no-redirect policy, bounded response and selected-text-only payload are tested.

**Derived architecture risk:** local actions, inline completion and Arena have three related but separate policy implementations. This is manageable at the current feature count but becomes a security and UX drift vector as soon as Wrytrove adds document Q&A, embeddings, providers, streaming or model setup.

### 3.7 Markdown and notes

The preview pipeline is a real security strength:

```text
source → optional pure extension preprocessing → markdown-it tokens in worker
       → closed PreviewNode union → allowlisted createElement/text nodes
```

No source HTML, URL, image source, `style`, arbitrary tag or external resource is inserted. Links are spans, images are text placeholders, task lists and callouts are read-only. The parser and DOM renderer are separately bounded.

The notes layer already supports plain-file front matter, tags, `[[wiki links]]`, ambiguity-aware backlinks, orphan detection, daily notes, quick capture, templates and a disposable local index. This is more than the older “no notes layer” description in historical documents. The remaining issues are lifecycle and scale: automatic index refresh after saves, rename/delete/reference updates, index progress and invalidation semantics, and the absence of grounded full-text Q&A.

### 3.8 Security and threat model

| Boundary | Existing control | Remaining blind spot / next validation |
|---|---|---|
| Renderer to filesystem | Tauri capability allowlist; only main webview receives custom commands; paths must be absolute and no `..`; scope check on read/write/create. | Persisted scope may retain access after a view closes; scope revocation/lease UX is not implemented. Parent-directory TOCTOU races remain documented. |
| Native file reads | Size cap, no-follow/reparse checks, bounded `Read`, regular-file checks. | Windows-specific junction/reparse behavior, network shares, ACLs and race coverage need consumer-Windows tests. |
| Native saves | Expected hash, explicit force, temp file in destination directory, flush, atomic persist, no-clobber new-file path. | Not a transaction log or file lock; power-loss durability and metadata/ACL preservation are unverified. |
| Remote navigation | CSP blocks frames/objects, navigation guard accepts bundled origins and debug localhost only; external URLs go through opener allowlist. | Every new external destination must remain capability-scoped; regression tests should assert CSP and URL allowlists from built config. |
| HTTP egress | Tauri HTTP allowlist restricts Ollama endpoints and exact Arena endpoint; no redirects; request bodies are bounded. | No centralized egress audit or local/cloud route proof; future providers could bypass the existing modules. |
| AI prompt/data | Explicit consent, bounded context, stale target checks, review-first edits, no content logging by design. | Heuristic secret detection is not redaction; model output is not truth; API-key entry is held in UI memory and recovery does not include it, but no OS keychain is used. |
| Recovery/settings | Sanitization, session-only AI consent, quota fallback, explicit removal warnings. | Recovery document contents and recent paths are unencrypted local storage. Turning recovery off is deletion, not secure erase. |
| Markdown | Inert closed node set and worker timeout. | No enhanced renderer profile exists; if one is added, it must not quietly reintroduce HTML/network/script execution. |
| Supply chain/distribution | npm lockfile and `npm audit`; Rust lockfile; Dependabot; unsigned installer warning. | No signed artifact, SBOM/provenance attestation, update verification or complete transitive license inventory in the release gate. |

### 3.9 Developer experience and maintainability

The repository is unusually candid about what contributors can do without Windows. Pure TypeScript modules and Vitest tests are a real cross-platform contribution path, and the issue bot requires acceptance criteria, verification commands, files and theme serialization. That is a strong open-source maintainer instinct.

Friction points:

1. **The real inner loop is not completely reproducible from the README:** Playwright needs a separately installed browser, Rust needs native prerequisites, and consumer-Windows behavior is outside the Linux loop.
2. **No lint/format/coverage baseline is part of the main CI workflow.** Strict TypeScript catches a class of errors, but not style, dead UI wiring, accessibility regressions or untested branches.
3. **Architecture knowledge is in the maintainer’s head and in comments:** the two large UI coordinators make it hard to identify a safe extension seam.
4. **The release path is not yet a trusted product path:** a successful CI build creates an unsigned preview artifact; tags intentionally skip E2E because the commit should already have passed on `main`.
5. **Documentation drift is a real issue class:** historical documents contain old counts and the unrelated `Pinch` roadmap proposal. The current guide is honest, but a contributor can still find contradictory historical statements.

---

## 4. Gold-standard comparison set

The five references were chosen to cover Wrytrove’s actual design space rather than to create a feature-count contest.

| Reference | Current GitHub snapshot captured during audit | Why it belongs |
|---|---:|---|
| [VS Code / Code - OSS](https://github.com/microsoft/vscode) | 195,347 stars; TypeScript-dominant; MIT; 21,584 open issues | Gold standard for a TypeScript desktop workbench, service boundaries, workspace search, language intelligence, extension isolation and release engineering. |
| [Zed](https://github.com/zed-industries/zed) | 94,945 stars; Rust-dominant; GPL-3.0-or-later with marked Apache components; 3,059 open issues | Gold standard for high-performance native editing, GPU UI, rope/sum-tree text structures, async tasks, model choice and reviewable AI interaction. |
| [Notepad++](https://github.com/notepad-plus-plus/notepad-plus-plus) | 29,873 stars; C++/Win32/Scintilla; GPL; 2,898 open issues | Direct Windows notepad benchmark for speed, sessions, encoding, search/replace, macros, plugins and “open a file without ceremony.” |
| [MarkText](https://github.com/marktext/marktext) | 63,954 stars; TypeScript/Electron/Vue; MIT; 248 open issues | Closest open-source Markdown-writing benchmark for live preview, focus/typewriter modes, export, themes and a rich but approachable writer surface. |
| [Joplin](https://github.com/laurent22/joplin) | 57,168 stars; TypeScript; AGPL-3.0-or-later; 668 open issues | Notes/ownership benchmark for a large TypeScript monorepo, local database, sync targets, E2EE, search, renderer, plugins and multi-platform distribution. |

The counts are a snapshot, not a ranking. Competitor implementation code must not be copied into Wrytrove without a license review; behavior and architecture can be studied and independently implemented.

### 4.1 VS Code / Code - OSS

**Architecture — competitor evidence.** The Code - OSS tree separates `src/vs/base`, `editor`, `platform`, `workbench`, `server`, `sessions` and `code`. The workbench service tree has dedicated services for files, search, text models, working copies, storage, settings, outline, language, extension management, secrets, updates, accessibility, terminal and workspace trust. The source exposes service interfaces such as `IFileService`, provider registration and a `SearchService` with file/text/AI provider maps, cancellation and deferred provider activation. `package.json` identifies an Electron runtime and a large build/test pipeline; built-in extensions are part of the product model.

**Performance characteristics and bottlenecks.**

- The architecture supports incremental text models, provider-specific search and asynchronous extension/service activation rather than putting every operation in one renderer callback. That is an architectural scalability signal, not a benchmark claim.
- The likely cost is the price of breadth: Electron/Node processes, extension hosts, language servers, workbench services, activation, indexing and telemetry/settings machinery all add startup, memory and failure modes. VS Code’s own repository build instructions call for substantial hardware for a full build; that is a contributor-build fact, not a runtime benchmark.
- Wrytrove should copy the *seams*—file service, search provider, working-copy/recovery service, capability registry—not the entire product surface.

**UX paradigm.** Workspace-first, command-palette-first, keyboard dense, extensible, with tabs/editors, outline, quick input, diff/review, explicit untrusted-workspace decisions and rich language intelligence. It optimizes for a professional workbench rather than a calm notepad.

**USP.** A universal editor platform: extensions and language tooling turn one shell into a broad development environment.

**Wrytrove lesson.** Make “current buffer vs saved file vs indexed note” a first-class source concept, and use explicit service contracts before adding more surfaces. Do not adopt the extension marketplace, terminal or debugger merely to match a checklist; those are different trust and maintenance products.

### 4.2 Zed

**Architecture — competitor evidence.** Zed’s Cargo workspace contains dedicated crates for `gpui`, `editor`, `text`, `rope`, `sum_tree`, `multi_buffer`, `language`, `project`, `worktree`, `fs`, `search`, `file_finder`, `markdown`, `edit_prediction`, `assistant`, `extension` and many supporting services. `gpui` describes itself as a GPU-accelerated UI framework. The editor crate depends on rope/sum-tree text structures, language/tree-sitter/LSP services, project/workspace components and edit-prediction types. The repository also has benchmark crates and explicit AI documentation for providers, local models, edit prediction, tool permissions and sandboxing.

**Performance characteristics and bottlenecks.**

- A rope/sum-tree model is suited to edits and viewport operations without repeatedly copying a whole document; a GPU UI and async task system are intended to keep interaction responsive. These are design mechanisms, not proof of a particular latency.
- Benchmark crates and input-latency surfaces show a stronger performance culture than Wrytrove currently has. Wrytrove should adopt measurement and budgets, not infer that a Rust rewrite is required.
- The trade-off is significant build and maintenance complexity: a large Rust workspace, platform-specific GPU code, language servers, collaboration and AI services create more compile time, binary surface and contributor specialization.
- AI/model calls, indexing and extension tasks are still potential latency and privacy bottlenecks; “native” does not remove network or model latency.

**UX paradigm.** Low-friction, keyboard-forward, high-performance editing with multiplayer collaboration, partial inline acceptance, model/provider selection and explicit agent/tool permission surfaces.

**USP.** A native high-performance editor that treats collaboration and AI as first-class without giving up a serious code-editing surface.

**Wrytrove lesson.** Partial acceptance, explicit provider choice, visible AI scope and cancelable background work are worth borrowing. A complete native editor rewrite is not justified by the current evidence; CodeMirror plus a careful large-file path can preserve Wrytrove’s smaller contributor footprint.

### 4.3 Notepad++

**Architecture — competitor evidence.** The repository is a native Windows C++ application. `PowerEditor/src` contains the application window/controller, buffer and tab management, encoding mapping, search/replace dialogs, docking/project panels, preferences, localization, printing, plugins, file browser and Scintilla integration. The repository includes Scintilla and Lexilla components. `Notepad_plus.cpp` includes the native UI, buffer, tab, encoding, printer and plugin subsystems; `ScintillaEditView.cpp` owns the editor-view integration. The README describes a Windows text/source editor and documents GPG release-key identity.

**Performance characteristics and bottlenecks.**

- Native Win32 plus Scintilla is a plausible reason for low overhead and mature handling of text buffers; it avoids a browser renderer and JavaScript heap. This audit did not measure its startup, memory or large-file behavior.
- Its depth is also its risk: a large native controller, plugin ABI, many dialogs and Windows-specific compatibility paths create long-term maintenance costs. A plugin or lexer can add latency or instability.
- Its product history shows that reliability features—sessions, encoding choices, search/replace and macro behavior—can matter more to a notepad user than AI novelty.

**UX paradigm.** Dense and configurable classic desktop UI. It favors discoverability for power users, high task breadth and a predictable local/offline path over a minimal visual surface.

**USP.** Decades of trust for opening, editing, searching and saving text on Windows, with a large ecosystem and no account requirement.

**Wrytrove lesson.** Wrytrove must eventually match the basic “find/replace/session/encoding/open a difficult file” trust contract. It should not copy GPL code or reproduce plugin sprawl/density. The better response is a calm UI with mature semantics underneath.

### 4.4 MarkText

**Architecture — competitor evidence.** MarkText is an MIT TypeScript monorepo using Electron. `packages/desktop` separates Electron `main`, `preload`, `renderer`, `shared` and application state. It uses Vue, Element Plus, a Muya Markdown editor package with block/editor/history/search/state modules, CodeMirror 5, `@vscode/ripgrep`, `chokidar`, `dompurify`, KaTeX, Mermaid, `electron-store`, `electron-updater`, `write-file-atomic` and platform builders. The package exposes unit/E2E/typecheck and performance-inspection commands.

**Performance characteristics and bottlenecks.**

- Ripgrep and a dedicated editor package are appropriate choices for file search and editing; a separate desktop/main/preload shape gives the renderer less direct authority than a single privileged page.
- Rich live Markdown, diagrams, math, image handling and a DOM renderer can be more expensive than plain text, especially on large documents. Electron, Vue state and a broad dependency surface increase memory/startup cost. These are derived risks, not measured results from this audit.
- MarkText explicitly includes performance-inspection scripts, which is a useful process signal for Wrytrove.

**UX paradigm.** Writing-first and WYSIWYG/live-preview oriented: CommonMark/GFM, themes, source/focus/typewriter modes, formatting shortcuts, images, HTML/PDF output and distraction-free writing.

**USP.** It makes Markdown feel like a normal writing tool without requiring users to think in raw syntax all the time.

**Wrytrove lesson.** Focus/typewriter modes, outline, export and a richer writer flow are relevant. Wrytrove’s inert preview is a better security baseline than blindly trusting rendered HTML; any richer mode should be opt-in, local-only and capability-limited.

### 4.5 Joplin

**Architecture — competitor evidence.** Joplin is an AGPL TypeScript monorepo with workspaces for desktop, mobile, CLI, renderer, server, plugins and a shared `packages/lib`. The library includes models, database drivers, filesystem drivers, synchronization targets, external-edit watchers, E2EE, search, keychain, plugin and conflict services. The renderer packages Markdown, diagrams, syntax highlighting and math. The desktop package builds Electron artifacts; the server uses Koa/SQLite/PostgreSQL-related components and shared library services. The shared library exposes filesystem, WebDAV, S3, Nextcloud, OneDrive, Joplin Server and no-sync targets.

**Performance characteristics and bottlenecks.**

- A database-backed model and dedicated search/sync services scale note metadata and synchronization beyond scanning a folder on every operation. Queues, watchers and database indexes are the right tools once a product commits to sync and a large note collection.
- The costs are operational and cognitive: migrations, database integrity, attachment storage, encryption/decryption, sync conflicts, server compatibility and a larger cross-platform runtime. Renderer/plugin/attachment work can also dominate memory and startup.
- Joplin’s architecture is evidence that “notes app” is a different product category from “plain-file editor,” not a small feature toggle.

**UX paradigm.** Notebook/stack organization, tags, search, attachments, plugins, mobile clients, clipper and user-selected sync with E2EE/self-hosting options.

**USP.** Ownership plus a broad, portable notes ecosystem and synchronization story.

**Wrytrove lesson.** Make any note index disposable, local, inspectable and derived from files. Do not add a proprietary database or sync service until Wrytrove has a clear product decision, conflict model, key-management design and maintainer capacity.

---

## 5. Wrytrove versus the reference set: gap matrix

| Capability | Wrytrove today | Reference expectation | Severity | Evidence and interpretation | Beyond-best-in-class direction |
|---|---|---|---|---|---|
| Launch/edit/save trust | Explicit hashes and atomic writes; recovery snapshot; no durable autosave journal. | Notepad++/Notepads sessions and mature save behavior; VS Code working-copy/backup services. | P0 | Observed missing journal and documented power-loss/metadata limits. | A local, content-addressed draft journal with a human-readable timeline and one-click verified restore. |
| Recovery privacy | IndexedDB session contains text/paths and is unencrypted; warning is visible. | Joplin has a designed encryption/sync model; simple editors often have local session files. | P0 | `storage.ts`, `index.html`, `SECURITY.md` and guide state this directly. | Optional OS-key-backed encryption with an explicit threat model, migration and inspectable deletion semantics. |
| File compatibility | UTF-8/BOM/UTF-16 LE/BE; no legacy code pages, UTF-32, binary mode or mixed-ending preservation. | Notepad++ has broad encoding/configuration depth; Zed has encoding crates. | P1 | `encoding.ts` and user guide. | Encoding negotiation that never guesses silently, raw-byte preservation sidecar and lossless mixed-ending mode. |
| Large files | 20 MiB hard cap for open/save; 2 MiB search reads. | Notepad++/Zed/VS Code are designed for substantially larger project/log workflows, though their actual limits vary. | P1 | Observed hard constants; no measured large-file mode. | Adaptive streaming/mmap mode with feature degradation, visible limits and cancelable search. |
| Search source | Current document regex/replace; workspace saved-file literal search only. | Notepad++ and VS Code normalize project search/replace; VS Code has provider architecture. | P1 | `workspace.ts` and `workbench.ts` explicitly say saved-only. | A source-aware search ledger over live buffers, disk snapshots and note index, with stale hashes and per-file diff transactions. |
| Folder-wide replace | Absent. | Notepad++/VS Code/Zed provide mature replacement workflows. | P1 | No workspace replace command or API. | Preview a complete change set, apply only hash-matching files, support per-hunk acceptance and atomic rollback journal. |
| Compare/split | Selection review diff exists; no two-file compare/split editor. | Notepads, Notepad++ ecosystem, VS Code and Zed set this expectation. | P1 | Existing `change-review.ts` is selection-based. | A reusable review engine for selection, file pair and multi-file plans with identical stale-safety semantics. |
| Application modularity | One large `WrytroveApp`; Workbench is a second controller. | VS Code services; Zed crates/modules. | P1 | LOC and host interface observed. | A small evented document/file/recovery/search/AI service graph without a rewrite. |
| AI provider model | Ollama, selection actions and Arena have separate transports/consent/payload rules. | Zed and Continue normalize provider choice/capabilities. | P1 | Separate `ai.ts`, `ai-actions.ts`, `arena.ts`. | Capability-based provider registry plus an egress manifest and exact payload preview. |
| AI grounding | Selection actions and Arena; no ask-this-document citations or workspace Q&A. | Open Notebook/Joplin-adjacent AI projects and modern editors set context expectations. | P2 | No citation/index retrieval path in current source. | Local retrieval with line/byte/hash citations and “not found” as a valid answer. |
| Note graph lifecycle | Tags, links, backlinks, orphans and index exist; refresh/coordination issues remain. | Joplin/Obsidian/Logseq make organization central. | P2 | Existing open issue #41 covers refresh; no rename transaction. | A filesystem-derived graph with ambiguity-first resolution, rename preview and disposable event-sourced index. |
| Markdown richness | Secure inert preview, no active links/images/math renderer/export. | MarkText/Joplin offer richer writer/export surfaces. | P2 | Deliberate current contract. | Safe-by-default preview profiles: inert, local-resource sandbox, and explicit export—never ambient network execution. |
| Distribution | Unsigned NSIS preview; no verified update channel or package-manager manifest. | Notepads/Notepad Next/MarkText/Joplin have established distribution/update paths; Notepad++ signs releases. | P0 | README, workflow and user guide. | Signed, reproducible, SBOM-attested updates with rollback and user-visible provenance. |
| Accessibility | Automated keyboard/contrast checks and ARIA work; no full Narrator/NVDA/scale audit. | Mature desktop products publish broad platform support; MarkText/Notepads have localization/accessibility expectations. | P1 | 54 E2E inventory but browser binary unavailable locally; docs say audit outstanding. | Accessibility as task contracts in CI plus a privacy-preserving manual test kit and issue log. |
| Performance discipline | Some local caps and one Quick Open micro-benchmark; no startup/memory/edit budget in CI. | Zed has benchmark crates; MarkText exposes performance inspection; VS Code has extensive profiling. | P1 | No `performance.mark`, benchmark workflow or release thresholds. | Synthetic workload suite with medians/ranges, budget diffs and locally inspectable profiles. |
| LSP/extensions/terminal | Deliberately absent. | VS Code/Zed provide them. | P2 / defer | README explicitly says Wrytrove is not a full IDE. | If demand proves real, a brokered capability sandbox—not arbitrary plugin code in the privileged webview. |
| Sync/collaboration | Deliberately absent; files are user-owned. | Joplin/AppFlowy emphasize sync; Zed collaboration. | Defer | Product docs say not to build yet. | If ever added, user-owned Git/folder sync with conflict provenance before a hosted service. |

### Existing issue overlap

The current GitHub queue already contains work that should not be duplicated:

- **#41** — refresh backlinks/tag cloud when an indexed note is saved;
- **#42** — keep focus and typewriter modes legible and announced;
- **#43** — bound quick capture and daily notes against re-entrancy and partial writes.

The issue drafts below are the audit backlog around those items, not replacements for them. Their acceptance criteria should be merged into those existing issues if the maintainer prefers fewer tracker entries.

---

## 6. Beyond-best-in-class strategy

The opportunity is not to out-feature VS Code. It is to make the safety and local-first properties *more observable and more useful* than competitors’ implicit behavior.

### 6.1 Verifiable local-first

A loopback URL, an “offline” label or an unsigned hash is not enough. Wrytrove should expose a **data-flow ledger** for each operation:

```text
intent → selected source revision → exact bytes/chars → provider route → model
       → response bound → review/apply decision → resulting file hash
```

The ledger should be local, ephemeral by default and exportable only after redaction. It should say “loopback transport; provider route not proven local” when that is the truth. This exceeds a generic privacy label because users can inspect the actual payload and result provenance without enabling telemetry.

### 6.2 Recovery as a local timeline, not a hidden blob

A mature editor’s session restore is useful, but a local-first editor can do better by separating:

- **draft journal:** crash recovery and unsaved edits;
- **backup/export:** user-controlled copies;
- **undo history:** in-process editing semantics;
- **file version history:** optional, bounded and explicitly enabled.

Use content-addressed chunks and a manifest with file hash, timestamp, encoding and line-ending metadata. Encrypt the journal with an OS-protected key when the user opts in. Make every restore a diff/three-way decision, never a blind replacement. The original plain file remains authoritative.

### 6.3 Search as a provenance-aware transaction

Instead of a generic search result, each result should carry:

- source: live buffer, disk snapshot or note index;
- source revision/hash and read time;
- root/relative path;
- line/column and a bounded preview;
- stale state if the source changed;
- a link to the exact bytes that would be replaced.

Replace-in-files then becomes a change plan. This is safer than a traditional “Replace All” and more transparent than an AI agent editing files invisibly.

### 6.4 AI as a capability, not a chat panel

Every provider declares capabilities such as `completion`, `rewrite`, `answer`, `embeddings`, `streaming`, `localOnlyClaim`, and `costClass`. Every request is a typed object with source revision, character/byte count, model, destination and consent scope. The UI can then render one consistent review/payload component for Ollama, Arena and future providers.

For AI editing, acceptance should be per diff hunk or selected range. For answers, citations should be verifiable against the exact sent chunk hashes. For autonomous behavior, the default answer remains “not in scope until a capability sandbox exists.”

### 6.5 Secure rich Markdown profiles

Keep the current inert renderer as the default. Add a second profile only if users need it:

1. **Inert:** current allowlisted tree, no links/images/network.
2. **Local-resource:** explicit per-document permission, local workspace resources only, DOMPurify/sanitized DOM, no scripts, no external network, CSP `img-src` limited to approved local asset handles.
3. **Export:** deterministic HTML/PDF generated from a sanitized snapshot, with a manifest of omitted/blocked resources.

A document should never silently escalate from profile 1 to profile 2. This is a stronger privacy/security story than simply matching MarkText’s renderer.

### 6.6 Recommended release sequence and gates

#### Release gate A — trust baseline

Do not call Wrytrove a production daily driver until the project can demonstrate:

- forced termination during typing restores the newest complete journal entry;
- disk copy and draft are distinguishable and compared before recovery;
- native save behavior is tested on consumer Windows with external edits, read-only files, network shares and an interrupted write simulation;
- artifact is signed or the release explicitly includes reproducible-build/provenance verification that a normal user can follow;
- AI/network destinations and payload sizes are visible before send;
- Narrator/NVDA and high-contrast core tasks have a published result;
- the release is built from the tagged commit and a machine-readable SBOM/license inventory is attached.

#### Release gate B — daily editing

- Search current buffers and disk with explicit source labels.
- Regex and replace-in-files with preview, hash checks, cancellation and per-file diff.
- Measured large-file mode or an explicit, tested support boundary that is competitive for the target persona.
- Split/compare for two files, reusing the existing review engine.
- Startup, first keystroke, memory, edit latency, search and save budgets established on at least one low-resource and one typical Windows machine.

#### Release gate C — local intelligence

- Provider interface migrated across inline completion, actions and Arena.
- Ask-this-document answers cite exact lines or explicitly say “not found.”
- Workspace Q&A requires an explicit indexed scope and shows passages before cloud send.
- Evaluation fixtures report latency, bounded failures, citation correctness and human acceptance without collecting user content.

### Defer list

Do not make the following the next milestone merely because competitors have them:

- terminal and arbitrary command execution;
- autonomous multi-file edits;
- extension marketplace;
- background remote code execution or LSP auto-start from project files;
- hosted sync or CRDT collaboration;
- proprietary note database;
- automatic model downloads;
- telemetry that captures document contents, paths, prompts or API keys.

---

# 7. Issue-ready backlog

The following drafts are ready to paste into GitHub after maintainer review. They use the repository’s four allowed categories and three priority levels. Each draft names the technical seam, the benchmark rationale, the beyond-best-in-class differentiator and a testable Definition of Done.

## AUD-01 — Ship a signed, reproducible and provenance-attested Windows release

- **Category:** `Bug/Vulnerability Fix`
- **Priority:** `P0 - Critical`
- **Why it matters / benchmark reference:** The current NSIS installer is explicitly unsigned and the project says SmartScreen warnings are expected. Notepad++ publishes a GPG release key; Notepads and Notepad Next have established package-manager/store paths; Joplin and MarkText expose mature installer/update configurations. An unsigned binary is not automatically malicious, but it creates an avoidable trust and adoption barrier.
- **Exact technical design:**
  1. Keep the existing `windows.yml` split between read-only build and tag-only publish jobs.
  2. Add a release provenance step using GitHub artifact attestations/SLSA-compatible metadata for the installer, frontend lockfile and Rust lockfile.
  3. Add a complete SBOM generated from `npm sbom`/CycloneDX-compatible output and `cargo metadata`, then validate licenses against `THIRD_PARTY_NOTICES.md` before publish.
  4. When a Windows code-signing certificate is available, sign the NSIS executable with `signtool` and timestamp it; fail the tagged release if signing is configured but absent.
  5. Add a `winget` manifest or documented package-manager path, and publish SHA-256 plus signature/provenance verification instructions.
  6. Do not add an auto-updater until update metadata is signed, rollback behavior is tested and the user can opt out.
- **Beyond-best-in-class differentiator:** A normal user can inspect not only a checksum but the source commit, build inputs, dependency inventory and signature chain, without an account or Wrytrove telemetry.
- **Acceptance criteria / Definition of Done:**
  - [ ] A `v*` tag produces a release containing installer, checksum, SBOM and provenance attestation.
  - [ ] Signed mode verifies the publisher and timestamp on a clean consumer-Windows VM.
  - [ ] Unsigned fallback, if still used for previews, is labelled in the release and README exactly as such.
  - [ ] The documented verification path works without Rust, Node or a GitHub token.
  - [ ] Release job refuses to publish an artifact whose commit, version or checksum does not match the tag.
  - [ ] A rollback/reinstall procedure is documented; no update is silently forced.

## AUD-02 — Replace whole-session recovery snapshots with a crash-safe draft journal

- **Category:** `Architectural Refactor`
- **Priority:** `P0 - Critical`
- **Why it matters / benchmark reference:** Wrytrove’s IndexedDB recovery is carefully validated and quota-aware, but it rewrites a whole session and is not a durable autosave journal. Notepad++/Notepads-style session restore is the minimum expectation; VS Code has dedicated working-copy/backup services. Recovery is the difference between a preview and a tool trusted with ordinary work.
- **Exact technical design:**
  1. Add a pure `src/recovery-journal.ts` format with versioned manifest records: document ID/path token, base disk hash, sequence, timestamp, encoding, line ending, cursor and content chunks.
  2. Store append-only journal chunks in IndexedDB object stores (`journal`, `manifests`, `complete-marker`) rather than replacing a single large object.
  3. Serialize writes through the existing queue, write chunks first, then commit a manifest marker; garbage-collect old sequences only after a complete marker exists.
  4. Enforce both per-document and total-session byte caps; expose “last complete recovery” and “newer partial draft” separately.
  5. On startup, restore into a three-way review state: disk, last saved snapshot and newest draft. Never overwrite a file automatically.
  6. Keep the current `storage.ts` quota fallback as a compatibility migration path.
- **Beyond-best-in-class differentiator:** A user gets a local timeline of verifiable drafts, not an opaque “restore session” blob. Every recovery candidate is a diff against the file hash that existed when it was captured.
- **Acceptance criteria / Definition of Done:**
  - [ ] A forced process termination during a write leaves either the previous complete journal or a complete newer journal; never a half-manifest presented as current.
  - [ ] The newest recoverable text, cursor and encoding metadata are restored in a synthetic crash test.
  - [ ] Disk-newer, draft-newer and equal-hash cases each have distinct UI and tests.
  - [ ] Quota failure preserves the last complete draft and reports the partial state.
  - [ ] Journal contents are bounded and old entries are garbage-collected without deleting the current complete entry.
  - [ ] Migration from the v1 IndexedDB session is tested; users are not silently dropped.
  - [ ] Documentation continues to say recovery is not a backup.

## AUD-03 — Make recovery and persisted file access privacy-preserving and revocable

- **Category:** `Bug/Vulnerability Fix`
- **Priority:** `P0 - Critical`
- **Why it matters / benchmark reference:** `SECURITY.md` correctly states that recovery is unencrypted and Tauri persisted scope may outlive the visible folder. “Local-first” is not equivalent to “private from another process/user profile.” Joplin’s E2EE/keychain model demonstrates that at-rest protection is a product feature, while Wrytrove’s plain-file positioning requires an opt-in design rather than a mandatory vault.
- **Exact technical design:**
  1. Add a privacy settings model with three independent controls: recovery enabled, recovery encryption enabled, and remember selected-file/folder access.
  2. On Windows, use an OS-protected key (DPAPI/credential-protected secret through a small Rust command) to wrap a random AES-256-GCM journal key; keep plaintext keys out of localStorage/IndexedDB.
  3. Store journal records as authenticated encrypted chunks with version, nonce and associated data containing document ID/sequence—not raw paths in the index.
  4. Add a visible “Access leases” panel listing selected roots/files, why they remain retained, and a revoke action. Closing a folder revokes its scope when no open document or pending operation needs it.
  5. Add a migration and recovery path for users who disable encryption or cannot unlock the key; never silently discard drafts.
- **Beyond-best-in-class differentiator:** Privacy is expressed as inspectable, revocable capabilities and a user-chosen threat model, not as a blanket “offline/private” claim.
- **Acceptance criteria / Definition of Done:**
  - [ ] Recovery text is unreadable from the IndexedDB object store without the OS-protected key when encryption is enabled.
  - [ ] A locked/unavailable key pauses recovery with an explicit export/delete decision; it never replaces data with samples.
  - [ ] Revoking a closed-folder lease prevents subsequent native reads/writes through that scope.
  - [ ] Open documents remain usable until closed, then their lease is released.
  - [ ] Tests cover restart, key rotation/version migration, failed deletion and revoked scope.
  - [ ] Documentation distinguishes file ownership, OS access controls and optional Wrytrove encryption.

## AUD-04 — Close the native save durability and race gaps

- **Category:** `Bug/Vulnerability Fix`
- **Priority:** `P0 - Critical`
- **Why it matters / benchmark reference:** Wrytrove already has better-than-average hash checks and atomic temp replacement, but `src-tauri/src/lib.rs` explicitly admits a parent-directory race and unverified Windows/network/ACL/power-loss behavior. A mature text editor’s primary security promise is not silently losing or replacing a file.
- **Exact technical design:**
  1. Introduce a Rust `SaveTransaction` result with stages: `Verified`, `TempWritten`, `TempFlushed`, `TargetRevalidated`, `Committed`, `RollbackRequired`.
  2. Revalidate target identity immediately before replacement using file ID/volume identity where Windows APIs permit, plus expected hash and size; reject a changed identity rather than force-replacing by path.
  3. Use platform-specific replace semantics that preserve the original on failure and document when directory flush is unavailable.
  4. Add optional backup-to-sibling (`.wrytrove-backup`) only when the user enables it; never leave hidden backups without a retention policy.
  5. Preserve/restore ACL and file metadata where safe; explicitly report metadata not preserved.
  6. Add an integration harness that mutates/renames/replaces the target between each stage, plus consumer-Windows tests for read-only/network paths.
- **Beyond-best-in-class differentiator:** The save dialog can show a machine-readable transaction outcome and offer “save as copy / compare / retry” instead of reducing every failure to a generic overwrite prompt.
- **Acceptance criteria / Definition of Done:**
  - [ ] A changed file ID or hash aborts a normal save and leaves the destination bytes unchanged.
  - [ ] A failed temp flush or replace leaves the prior destination intact.
  - [ ] New-file no-clobber behavior remains intact under a creation race test.
  - [ ] Metadata/ACL behavior is verified or clearly reported on supported Windows configurations.
  - [ ] No test or API introduces arbitrary overwrite permission through an empty/malformed header.
  - [ ] The documented remaining platform limitations are updated from evidence, not removed.

## AUD-05 — Add unified live-buffer and disk search with transactional replace-in-files

- **Category:** `Feature Addition`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** Notepad++’s documented search behavior, VS Code’s search service and Zed’s search/worktree architecture establish project search as a core editor operation. Wrytrove currently searches saved files only, literal text only and read-only. Users can otherwise find a string in the editor and fail to find the unsaved version in the folder.
- **Exact technical design:**
  1. Add a `SearchSource` abstraction: `buffer`, `disk`, `note-index`; each result carries source revision/hash and root-relative path.
  2. Snapshot open CodeMirror documents without reading disk, deduplicate a native file when both buffer and disk are in scope, and let the user choose `Open buffers`, `Saved files` or `Both`.
  3. Add literal/regex modes using a bounded Rust or worker search implementation. Prefer existing CodeMirror regex semantics for buffers and a dedicated bounded worker/native searcher for files; never run unbounded regex on the UI thread.
  4. Add a replace plan containing expected hashes, replacement ranges, per-file diffs and stale status. Reuse `change-review.ts`/`diff` and the Rust `safe_write` precondition.
  5. Add cancellation, result caps, truncation status, invalid-regex feedback and progress per root/file.
- **Beyond-best-in-class differentiator:** Search results are provenance-aware and stale-safe. “Replace all” becomes a reviewable, hash-guarded change set rather than an irreversible command.
- **Acceptance criteria / Definition of Done:**
  - [ ] A dirty open buffer is searchable without saving; the result is labelled `Open buffer`.
  - [ ] Disk and buffer results for the same file are not silently conflated.
  - [ ] Literal, regex, case and file-filter queries have bounded behavior and cancellation.
  - [ ] A changed-on-disk file is marked stale and is not modified without an explicit refresh/force decision.
  - [ ] Replace previews per-file and per-hunk; cancel/close performs zero disk writes.
  - [ ] Apply uses expected hashes and atomic writes; partial failure reports exactly what committed.
  - [ ] Tests cover Unicode columns, invalid regex, unsaved tabs, external edits, 500-result truncation and cancellation.

## AUD-06 — Introduce adaptive large-file mode instead of a universal 20 MiB ceiling

- **Category:** `Performance Optimization`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** Notepad++ and native editor expectations include opening logs and generated text well above 20 MiB; Zed’s rope/text architecture and VS Code’s model providers show that large documents need specialized data structures. The current 20 MiB limit is defensible as a preview safety bound but blocks common logs and source dumps.
- **Exact technical design:**
  1. Keep the current safe mode for ordinary text, then add a native `LargeFileHandle` path using bounded chunk reads and memory mapping (`memmap2` where supported, buffered range reads otherwise).
  2. Implement a CodeMirror-compatible windowed document adapter or a dedicated read-only/limited-edit view. Do not materialize the entire file in WebView memory.
  3. Disable or clearly badge features that require the whole document: syntax highlighting, full recovery, note indexing, AI context, minimap and full document statistics.
  4. Provide chunked literal/regex search with progress, cancellation and byte/line mapping; never expose a partial result as complete.
  5. Add a threshold decision based on bytes and measured memory, not an arbitrary single ceiling; keep a hard maximum and allow the user to stop before reading.
- **Beyond-best-in-class differentiator:** A “degraded but honest” mode keeps the file usable while telling the user exactly which features are disabled and allowing an export of the matched ranges, rather than crashing or pretending the whole file is loaded.
- **Acceptance criteria / Definition of Done:**
  - [ ] Synthetic 100 MiB and 500 MiB UTF-8 fixtures open or are rejected with an explicit measured reason; no full-file IPC transfer occurs in large mode.
  - [ ] Scroll, bounded search, cancel and close remain responsive on the supported benchmark machine.
  - [ ] No large-file content enters IndexedDB recovery or AI payloads by default.
  - [ ] Feature badges explain disabled syntax, preview, index and save semantics.
  - [ ] A large-file save path is either implemented with atomic range-safe semantics or explicitly read-only.
  - [ ] The benchmark records peak memory, open latency, search latency and cancellation latency.

## AUD-07 — Generalize change review into compare, split view and multi-file plans

- **Category:** `Feature Addition`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** Wrytrove already has the safest interaction primitive in the codebase: capture a target, calculate a bounded diff, reject stale/no-op changes and apply one isolated undo step. Notepads ships a diff viewer; Notepad++ users rely on compare workflows; VS Code/Zed make side-by-side review normal. Wrytrove currently limits that safety model to pasted/AI selection replacement.
- **Exact technical design:**
  1. Extract a generic `ReviewPlan` model from `change-review.ts`: source identity, before hash, after text/bytes, hunks, line summary, target revision and apply policy.
  2. Add file-pair compare with read-only left/right panes and optional merge target; use existing `diff` dependency and bounded line/token diff.
  3. Add a plan viewer for replace-in-files and AI multi-file proposals; apply per hunk or all hash-valid hunks.
  4. Recheck CodeMirror revision and disk hash immediately before apply. Every applied plan becomes one undo group per document and a journal entry.
  5. Keep selection review and file review on the same UI language: before/after, stale, reject, apply, undo.
- **Beyond-best-in-class differentiator:** Wrytrove can make every mutation—from a one-line AI rewrite to a multi-file replace—look and behave like the same user-owned, reversible transaction.
- **Acceptance criteria / Definition of Done:**
  - [ ] Two selected files can be compared without changing either file.
  - [ ] A user can accept/reject individual hunks and see line summaries.
  - [ ] External modification invalidates only affected hunks/files and prevents blind apply.
  - [ ] Apply is atomic per file and never saves automatically merely by opening a review.
  - [ ] Undo returns the document to its exact pre-apply text in one logical step.
  - [ ] Existing AI/pasted-change E2E tests continue to pass through the generalized engine.

## AUD-08 — Extract document, file, recovery and command services from `WrytroveApp`

- **Category:** `Architectural Refactor`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** `main.ts` is 2,097 lines and holds unrelated state machines; `workbench.ts` is another 951-line UI coordinator. VS Code’s service interfaces and Zed’s crates demonstrate the long-term value of seams between text model, file service, search and UI. Wrytrove should not copy their scale, but it should stop making every new feature edit the same controller.
- **Exact technical design:**
  1. Define pure/domain interfaces under `src/services/`: `DocumentStore`, `FileService`, `RecoveryService`, `SearchService`, `AiService`, `NoteIndexService`.
  2. Move `Doc` lifecycle, revision/dirty/hash transitions and save conflict decisions into a platform-neutral `DocumentStore` tested without DOM.
  3. Move Tauri/browser differences behind the existing `platform.ts` and a typed `FileService`; no service imports CSS or global UI selectors.
  4. Move recovery scheduling/flush/migration behind `RecoveryService`; expose events/results to UI instead of UI-owned flags.
  5. Replace stringly `WorkbenchHost.action(name)` with typed commands or a discriminated union, preserving the command palette as a UI adapter.
  6. Add a small event bus or typed callbacks; do not add a heavyweight state-management dependency.
- **Beyond-best-in-class differentiator:** The editor can expose a local, inspectable state transition log for debugging/recovery while remaining small; contributors can test safety policies without a browser or Windows.
- **Acceptance criteria / Definition of Done:**
  - [ ] No new service imports `document`, CSS or global UI selectors.
  - [ ] Save/conflict/recovery state transitions have pure unit tests covering stale revisions and failures.
  - [ ] `main.ts` delegates file/recovery/AI policy rather than implementing transport details.
  - [ ] Existing E2E behavior is unchanged; command palette actions are type-checked.
  - [ ] A contributor guide includes a module-boundary diagram and a rule for adding new capabilities.
  - [ ] The refactor is behavior-preserving; no feature expansion is hidden inside it.

## AUD-09 — Create one capability-based AI provider registry and egress ledger

- **Category:** `Architectural Refactor`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** Zed and Continue make provider/model selection a product concern. Wrytrove’s `ai.ts`, `ai-actions.ts` and `arena.ts` each have sound local safeguards, but future streaming, citations, embeddings or providers would otherwise duplicate consent and payload rules.
- **Exact technical design:**
  1. Add `src/ai-provider.ts` types: `AiCapability`, `AiProviderDescriptor`, `AiRequest`, `AiPayloadPreview`, `AiResponse`, `AiRouteState`.
  2. Implement adapters for current Ollama completion/action and Arena ask/edit; preserve exact endpoints and no-redirect behavior.
  3. Require each request to declare source revision, selected text/context, instruction, model ID, destination, route claim (`local`, `cloud`, `unknown`) and byte/character limits.
  4. Render a shared preflight component showing provider, model, destination, exact source scope, size, cost/account warning and whether local-only routing is proven.
  5. Keep consent session-only and keyed by provider/model/capability; changing any of those asks again.
  6. Emit a local ephemeral egress record with hashes and metadata, never raw content or credentials; allow “copy redacted diagnostics.”
- **Beyond-best-in-class differentiator:** Instead of a vague privacy badge, Wrytrove can show a request receipt that proves what it intended to send and what it cannot prove about the provider’s downstream route.
- **Acceptance criteria / Definition of Done:**
  - [ ] Inline completion, selection actions and Arena all use the same typed preflight/consent contract.
  - [ ] No request can be sent without an explicit capability and source revision.
  - [ ] Provider/model changes invalidate consent; no silent fallback or hidden comparison occurs.
  - [ ] Egress ledger never stores raw selection, prompt, API key or file path by default.
  - [ ] Unit tests assert exact endpoint, redirect refusal, byte limits, cancellation and route labels.
  - [ ] Existing AI and Arena tests remain green with adapter fakes.

## AUD-10 — Add a reproducible Windows performance budget and profiling harness

- **Category:** `Performance Optimization`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** “Fast and lightweight” is an expectation from Notepad++/Notepads, a design goal of Zed, and a profiling concern in MarkText. Wrytrove currently has safety caps and one Quick Open micro-benchmark but no release-level cold-start, memory, edit-latency or search budget.
- **Exact technical design:**
  1. Add synthetic fixtures under an ignored/external benchmark directory: 1, 5, 20, 100 and 500 MiB text; 5,000-file workspace; Unicode/long-line/Markdown fixtures.
  2. Add a `scripts/benchmark.mjs`/Playwright harness that records cold start to interactive, first keystroke, tab switch, open, save, search, preview update and close.
  3. Instrument named `performance.mark` points in the frontend and structured timing events in Rust, with no content/path logging.
  4. Capture peak working set/private bytes on Windows via a small PowerShell/PowerShell Core helper; record WebView2 and machine metadata.
  5. Store only aggregate JSON artifacts; compare medians and p95/ranges between a baseline and PR when the Windows runner is available.
  6. Start with warning budgets; promote stable regressions to CI failures.
- **Beyond-best-in-class differentiator:** Performance reports are privacy-preserving and reproducible by users: they can run the same synthetic fixture locally without uploading documents or enabling telemetry.
- **Acceptance criteria / Definition of Done:**
  - [ ] A documented Windows run produces machine/version/commit metadata and median plus range for each scenario.
  - [ ] No benchmark fixture contains real user content or paths.
  - [ ] At least startup, first edit, open, save, folder search and Markdown preview have baseline numbers.
  - [ ] A PR with an intentionally injected regression produces a visible warning/failure.
  - [ ] Results distinguish app work from provider/network/model latency.
  - [ ] README avoids comparative speed claims until a disclosed benchmark exists.

## AUD-11 — Complete an accessibility and high-scaling validation pass

- **Category:** `Bug/Vulnerability Fix`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** Existing tests cover focus indicators, contrast, keyboard menus, labelled dialogs and compact geometry, and #42 covers a known focus/typewriter issue. The remaining docs explicitly say Narrator/NVDA, high contrast, scaling and consumer Windows are unverified. Accessibility is not equivalent to automated DOM assertions.
- **Exact technical design:**
  1. Add `@axe-core/playwright` to dev dependencies or use an equivalent isolated audit runner; keep it dev-only.
  2. Define task scripts for keyboard-only open/edit/save/search/review/recovery/settings/Arena flows.
  3. Test Windows Narrator and NVDA manually at 100%, 150%, 200% scale, forced colors/high contrast and 720×500 minimum window geometry.
  4. Ensure dialogs restore focus, status/live regions announce progress/errors, focus/typewriter state has non-color cues, and preview/notes/search lists expose stable names and relationships.
  5. Add a checked-in accessibility findings document with reproducible steps and a release-blocker classification.
- **Beyond-best-in-class differentiator:** The audit never requires sending document contents or telemetry; assistive-technology test fixtures are synthetic and the result log is public and reproducible.
- **Acceptance criteria / Definition of Done:**
  - [ ] Core tasks complete with keyboard only and no focus trap.
  - [ ] Narrator and NVDA can identify editor, tabs, dialogs, search results, review actions and error/status messages.
  - [ ] 200% scaling and forced colors preserve usable layout and distinguish active/dirty/stale states without color alone.
  - [ ] All critical axe findings are fixed or documented with an owner and release decision.
  - [ ] Existing #42 is updated rather than duplicated where scopes overlap.

## AUD-12 — Make note indexing incremental, cancelable and transaction-aware

- **Category:** `Performance Optimization`
- **Priority:** `P1 - High`
- **Why it matters / benchmark reference:** Wrytrove already has a bounded disposable index—an excellent local-first choice—but the open #41 issue shows that changes can make the tag/backlink view stale. Joplin/Obsidian-like note workflows require users to trust that navigation reflects current files; a full rescan after every save will not scale.
- **Exact technical design:**
  1. Extend `NoteIndex` records with source byte hash, file size, mtime/file identity where available, parser version and index state.
  2. Add an event-driven queue: open-folder change, save, create, delete, rename and external-change detection enqueue affected paths; coalesce bursts.
  3. Parse changed notes in a worker or bounded task queue; preserve the old record until the new record commits successfully.
  4. Show `fresh`, `updating`, `partial`, `ambiguous` and `stale` states in the notes panel; never imply a complete graph when traversal was truncated.
  5. Persist only user-approved index metadata if desired; default remains disposable and deleteable.
  6. Use #41 and #43 as dependent work rather than filing duplicate refresh issues.
- **Beyond-best-in-class differentiator:** The graph is a live, content-addressed view with explicit freshness and ambiguity—not a magical database that quietly guesses or silently falls behind.
- **Acceptance criteria / Definition of Done:**
  - [ ] Saving one indexed note updates its tags/backlinks without rescanning unrelated files.
  - [ ] A failed parse/read leaves the previous good record and reports the path as stale.
  - [ ] Rapid saves are coalesced and cancel cleanly when the folder closes.
  - [ ] Rename/delete removes or rehomes records only after the filesystem operation succeeds.
  - [ ] Index truncation and skipped files are visible; “complete” is never shown for a partial walk.
  - [ ] Unit and E2E tests cover #41’s scenario, external edits, ambiguity and cancellation.

## AUD-13 — Add ask-this-document and workspace Q&A with verifiable citations

- **Category:** `Feature Addition`
- **Priority:** `P2 - Strategic Enhancement`
- **Why it matters / benchmark reference:** Open Notebook-like products demonstrate demand for source-grounded Q&A; Zed/Continue show context selection is now an AI UX concern. Wrytrove’s current selection actions are safer than an agent but do not answer “what does this document say?” without copy/paste.
- **Exact technical design:**
  1. Add a read-only `ask-document` capability to the provider registry from AUD-09.
  2. Chunk the active document by line boundaries with bounded overlap; store chunk ID, line range, UTF-8 byte range, source document ID/revision and SHA-256.
  3. For workspace Q&A, retrieve from the disposable lexical note index first; use a bounded inverted index/term scorer in a worker before considering embeddings.
  4. Show candidate passages and source hashes before any cloud request; local Ollama can run directly after session consent, cloud requires explicit confirmation.
  5. Parse citations as structured IDs, then verify every cited range/hash against the exact sent chunks. If verification fails, show “citation unavailable” rather than fabricate a link.
  6. No answer may mutate files; copy/export is explicit.
- **Beyond-best-in-class differentiator:** “I don’t know” and “not found in the sent scope” are first-class successful outcomes, and every citation can be checked against the exact bytes the model received.
- **Acceptance criteria / Definition of Done:**
  - [ ] Active-document questions show selected line ranges and send no unrelated file/path data.
  - [ ] Workspace Q&A lists retrieved passages and scope before send.
  - [ ] Every displayed citation resolves to an existing line range and matching source hash, or is marked unverifiable.
  - [ ] Cloud requests show destination, model, characters and route warning.
  - [ ] Cancellation, oversized documents, missing model and no-result cases fail closed.
  - [ ] A 30-fixture synthetic evaluation reports citation precision and “not found” behavior without user telemetry.

## AUD-14 — Add a capability-based secure Markdown preview profile and deterministic export

- **Category:** `Feature Addition`
- **Priority:** `P2 - Strategic Enhancement`
- **Why it matters / benchmark reference:** MarkText and Joplin set expectations for richer Markdown, math, diagrams and export. Wrytrove’s current inert preview is safer but intentionally omits active links, images, TeX rendering and HTML/PDF export. The correct response is not to weaken the default renderer.
- **Exact technical design:**
  1. Keep the current closed `PreviewNode` profile as the default and security baseline.
  2. Add an explicit `Local resources` profile backed by a sanitizer (DOMPurify or a pure allowlisted renderer), no scripts/event handlers, no external network, and a local asset resolver limited to the selected workspace scope.
  3. Add an `Export snapshot` command that renders a sanitized static tree to HTML and optionally hands a deterministic print document to the system print/PDF path; include a blocked-resource manifest.
  4. Render math through a bundled, bounded KaTeX-like renderer only if dependency/license/size review passes; otherwise preserve the current labelled literal behavior.
  5. Do not let a Markdown file, front matter or link activate the richer profile automatically.
- **Beyond-best-in-class differentiator:** The same document can be previewed safely, rendered with explicitly granted local resources or exported deterministically, with the profile and omitted content visible to the user.
- **Acceptance criteria / Definition of Done:**
  - [ ] Default preview remains inert and passes existing security tests.
  - [ ] Local-resource mode cannot fetch external URLs, execute scripts or escape the selected workspace scope.
  - [ ] Export is deterministic for the same source/settings and reports blocked images/HTML/resources.
  - [ ] Worker/parser/node/asset limits remain enforced and cancellation works.
  - [ ] Dependency/license/size review is recorded before adding a math/diagram renderer.
  - [ ] E2E tests cover profile switching, external-resource refusal and export output.

## AUD-15 — Make note rename, move and link repair a reviewable filesystem transaction

- **Category:** `Feature Addition`
- **Priority:** `P2 - Strategic Enhancement`
- **Why it matters / benchmark reference:** Wrytrove’s ambiguity-aware wikilink resolution is safer than guessing, while Joplin/Obsidian-like note systems make links/backlinks a core navigation promise. The current plain-file model has no safe rename/move workflow that previews references and preserves portability.
- **Exact technical design:**
  1. Add a note operation planner that scans the disposable index and produces a list of affected source files, line ranges and proposed `[[target]]` replacements.
  2. Use native `workspace_create_entry`/`safe_write` and expected hashes; stage the new path, write reviewed link changes, then remove the old path only after all writes succeed.
  3. If any file changes externally, abort and leave the original note and all untouched files intact; offer a manual copy path.
  4. Treat duplicate/ambiguous targets as warnings requiring per-link acceptance; never auto-repair an ambiguous link.
  5. Rebuild/index-update only after the filesystem transaction commits.
- **Beyond-best-in-class differentiator:** Plain files get database-like referential integrity without a database lock-in or hidden file mutation.
- **Acceptance criteria / Definition of Done:**
  - [ ] Rename preview lists every affected link, ambiguous link and skipped/unreadable file.
  - [ ] Cancel changes nothing; apply uses expected hashes and atomic saves.
  - [ ] A conflict in any planned file aborts or clearly reports partial state according to the chosen transaction policy.
  - [ ] Backlinks, tags and Quick Open reflect the new path after commit.
  - [ ] External tools opening the same Markdown files continue to see ordinary portable text.

## AUD-16 — Introduce a brokered LSP/extension capability sandbox only after demand is proven

- **Category:** `Architectural Refactor`
- **Priority:** `P2 - Strategic Enhancement`
- **Why it matters / benchmark reference:** VS Code and Zed win developer workflows through language servers/extensions, but Wrytrove explicitly does not provide them. The risk is not merely implementation work: project files can cause tool startup, network access, process execution and supply-chain exposure.
- **Exact technical design:**
  1. Begin with a discovery/decision document and two-language user study; do not ship a runtime in the first PR.
  2. If approved, add a Rust `ToolBroker` that starts only user-selected executables, with workspace trust, explicit command/path, environment allowlist, no network by default, stop/restart, stdout/stderr caps and CPU/time limits.
  3. Communicate over a narrowly scoped JSON-RPC/LSP channel; keep the privileged webview unaware of arbitrary process APIs.
  4. Store no project-provided command configuration as executable permission; require an explicit approval per workspace/tool.
  5. Add an untrusted-workspace mode that leaves syntax highlighting and plain editing available while all subprocesses remain disabled.
- **Beyond-best-in-class differentiator:** If semantic tooling arrives, it is permissioned like a capability and can be audited/stopped, rather than inheriting the trust of the editor merely because a folder was opened.
- **Acceptance criteria / Definition of Done:**
  - [ ] A product decision records demand, supported languages, maintenance owner and threat model before implementation.
  - [ ] Untrusted workspaces never auto-start an LSP or extension.
  - [ ] Tool process, network, environment and resource controls are tested with malicious/misconfigured fixtures.
  - [ ] Stop/revoke kills the process and releases handles.
  - [ ] No extension marketplace or arbitrary JavaScript execution is introduced as a hidden dependency.

## AUD-17 — Add user-configurable keybindings, localization groundwork and RTL validation

- **Category:** `Feature Addition`
- **Priority:** `P2 - Strategic Enhancement`
- **Why it matters / benchmark reference:** Notepads documents RTL and localization contributions; MarkText publishes many translations; VS Code and Joplin treat localization and keybindings as platform-scale concerns. Wrytrove already has many shortcuts, menus and a compact layout, but strings and bindings are mostly hard-coded.
- **Exact technical design:**
  1. Extract user-facing strings to typed locale resources with fallback to English; keep security/consent strings versioned and reviewable.
  2. Add a keybinding registry mapping command IDs to default chords and conflict diagnostics; persist only sanitized command/chord data.
  3. Add RTL layout tests for tabs, editor, dialogs, notes and diff; use logical CSS properties and `dir`-aware icon placement.
  4. Test Tamil and other non-Latin text in encoding, word stats, line/column display, search columns and preview; keep text content out of telemetry.
  5. Add a reset-to-default path that cannot lock the user out of Settings/Command Palette.
- **Beyond-best-in-class differentiator:** Localization and RTL are treated as data-integrity and keyboard-safety concerns, not only translated labels; the same Unicode fixtures validate editor and search behavior.
- **Acceptance criteria / Definition of Done:**
  - [ ] No visible product string is newly hard-coded outside locale resources.
  - [ ] Conflicting/custom shortcuts are reported and can be reset without editing a file manually.
  - [ ] RTL and 200% scaling E2E fixtures preserve focus order and readable diff/review controls.
  - [ ] Tamil/CJK/emoji fixtures round-trip through open/edit/save/search without surrogate or column corruption.
  - [ ] Locale fallback and malformed locale data are tested.

## AUD-18 — Build a privacy-preserving local AI evaluation harness

- **Category:** `Performance Optimization`
- **Priority:** `P2 - Strategic Enhancement`
- **Why it matters / benchmark reference:** Zed/Continue make model/provider choice visible; Wrytrove’s AI actions are currently unit-tested with mocked transport, while a real model response on Windows remains unverified. Without an evaluation harness, model selection and prompt changes will be driven by anecdotes.
- **Exact technical design:**
  1. Add 30–50 synthetic fixtures across prose grammar, Markdown, code explanation, formatting preservation, prompt-injection text, Unicode and no-op cases.
  2. Define expected invariants rather than only exact answers: no invented facts for bounded rewrite actions, delimiters treated as data, output limit, no unintended fence removal, citation validity when applicable.
  3. Run against injected fake providers in CI and optionally against a user-supplied local Ollama model from a manual command; never download a model or call Arena in CI.
  4. Record model ID, quantization/hardware entered by the user, latency, output size, invariant pass/fail and human acceptance labels only when explicitly supplied.
  5. Publish aggregate fixture results, not prompts/responses by default; support a local redacted report.
- **Beyond-best-in-class differentiator:** Users can compare local models with their own synthetic/private fixtures without Wrytrove collecting prompts, documents or usage telemetry.
- **Acceptance criteria / Definition of Done:**
  - [ ] CI covers transport/policy invariants with no network.
  - [ ] Manual local run clearly distinguishes mocked, local-model and cloud results.
  - [ ] Prompt-injection, NUL, surrogate, delimiter and stale-target fixtures are included.
  - [ ] A model cannot pass by returning an unbounded or malformed response.
  - [ ] Reports contain no raw private text unless the user explicitly exports it.

---

## 8. Final maintainer decisions required

The backlog is actionable, but several product choices cannot be inferred from source code:

1. Is Wrytrove primarily a **calm text editor with a light notes layer**, or a **plain-file notes product that also edits code**?
2. Is Windows-only acceptable through 1.0, or should browser/Linux contributors eventually become supported users rather than just contributors?
3. Will the project fund code signing and a verified update channel, or remain a clearly labelled unsigned research preview?
4. Is encrypted recovery opt-in, mandatory for sensitive work, or intentionally delegated to OS disk encryption?
5. Is “your files, your sync” a permanent positioning decision, or is user-owned Git/folder sync a future product?
6. Is cloud AI BYO-key only, and should the product ever provide a paid Wrytrove service?
7. Which two user personas define the large-file and LSP decisions?
8. How much maintainer capacity can be committed to a native tool broker or extension API without undermining the local-first core?

The safe default answers are: keep plain files, keep an AI-free path, do not add a database or agent runtime yet, make release trust and recovery first-class, and measure before claiming superiority.

---

## 9. Sources and inspected paths

### Wrytrove source and documentation

- [`src/main.ts`](../src/main.ts) — application lifecycle, document model, recovery, save/conflict, UI and AI orchestration.
- [`src/workbench.ts`](../src/workbench.ts) — workspace, Quick Open, search, review and Arena workflows.
- [`src/workspace.ts`](../src/workspace.ts) — selected roots, traversal, limits and saved-file search.
- [`src/platform.ts`](../src/platform.ts) — browser/native file transport and save protocol.
- [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) — native bounds, scope checks, safe writes, navigation and tests.
- [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json), [`src-tauri/capabilities/default.json`](../src-tauri/capabilities/default.json) — CSP, bundle and capability allowlists.
- [`src/encoding.ts`](../src/encoding.ts), [`src/storage.ts`](../src/storage.ts), [`src/change-review.ts`](../src/change-review.ts), [`src/ai.ts`](../src/ai.ts), [`src/ai-actions.ts`](../src/ai-actions.ts), [`src/arena.ts`](../src/arena.ts), [`src/bounded-json.ts`](../src/bounded-json.ts).
- [`src/markdown-render.ts`](../src/markdown-render.ts), [`src/markdown-preview.ts`](../src/markdown-preview.ts), [`src/markdown-extensions.ts`](../src/markdown-extensions.ts).
- [`src/notes.ts`](../src/notes.ts), [`src/note-index.ts`](../src/note-index.ts), [`src/outline.ts`](../src/outline.ts), [`src/daily.ts`](../src/daily.ts).
- [`tests/`](../tests/) and [`tests/e2e/`](../tests/e2e/) — unit and browser test inventory.
- [`README.md`](../README.md), [`SECURITY.md`](../SECURITY.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`docs/USER-GUIDE.md`](USER-GUIDE.md), [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), [`ROADMAP-STATUS.md`](../ROADMAP-STATUS.md).

### Competitor repositories and official documentation

- [VS Code / Code - OSS README](https://github.com/microsoft/vscode#readme), [source architecture](https://github.com/microsoft/vscode/tree/main/src/vs), [workspace trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust), [Markdown](https://code.visualstudio.com/docs/languages/markdown).
- [Zed README](https://github.com/zed-industries/zed#readme), [crate workspace](https://github.com/zed-industries/zed/tree/main/crates), [AI documentation](https://github.com/zed-industries/zed/tree/main/docs/src/ai).
- [Notepad++ README](https://github.com/notepad-plus-plus/notepad-plus-plus#readme), [PowerEditor source](https://github.com/notepad-plus-plus/notepad-plus-plus/tree/master/PowerEditor/src), [Scintilla](https://github.com/notepad-plus-plus/notepad-plus-plus/tree/master/scintilla).
- [MarkText README](https://github.com/marktext/marktext#readme), [desktop package](https://github.com/marktext/marktext/tree/develop/packages/desktop), [Muya editor package](https://github.com/marktext/marktext/tree/develop/packages/muya).
- [Joplin repository](https://github.com/laurent22/joplin#readme), [shared library](https://github.com/laurent22/joplin/tree/dev/packages/lib), [renderer](https://github.com/laurent22/joplin/tree/dev/packages/renderer), [desktop app](https://github.com/laurent22/joplin/tree/dev/packages/app-desktop).
- [Ollama API authentication/cloud documentation](https://docs.ollama.com/api/authentication), [Ollama cloud](https://docs.ollama.com/cloud).

