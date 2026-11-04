# Morrow: competitive audit, user-expectation research and AI upgrade plan

**Prepared:** 4 November 2026
**Repository:** [`RANJITHROSAN17/morrow-editor`](https://github.com/RANJITHROSAN17/morrow-editor) at `c30c518`
**Scope:** product review, comparison with the most-starred notepad, note-taking and AI-editor repositories, a synthesis of what users ask for in public reviews, an AI product design, and a phased upgrade plan.
**Status:** research and plan. One small, tested AI slice — reviewable actions on a selection — is implemented on this branch. Everything else is a proposal, not a promise.

> **How to read the evidence.** This audit combines (a) reading the repository, tests and docs, (b) GitHub metadata captured on 4 November 2026, and (c) public review pages and vendor documentation. Review sites are self-selected and sometimes incentivised; star counts measure attention, not quality or retention. These are signals for prioritisation, not proof of demand. Nothing here is a user interview, a security audit or a Windows compatibility test. See [§11](#11-what-this-audit-does-not-establish).

---

## 1. Executive summary

Morrow is a credible, unusually careful small editor. The engineering posture is better than its popularity: explicit AI consent, bounded native reads, atomic saves, stale-target rejection, a review-before-apply workflow, 118 passing tests and unusually honest documentation. Those are real assets and they are rare.

It is **not yet a daily driver**, and the gap is not AI. It is the unglamorous layer that notepad users judge in the first ten minutes: never losing a draft, opening a 200 MB log, finding a string across unsaved tabs and a folder, zooming, spell-checking, printing, and comparing two files. The top notepad projects earn their stars mostly on those basics, not on intelligence.

The AI story is also narrower than the surrounding language suggests. Today Morrow has single-line Ollama completion, a manual browser hand-off to Arena, and an optional Arena API panel. That is three separate surfaces, none of which is a general assistant, and the single-line completion is the least useful shape of AI for most note-takers.

**The opportunity is not to out-feature Obsidian or out-agent Cursor.** It is to be *the small editor that never surprises you*: plain files you own, no account, and AI that proposes changes in a diff you can read, accept, reject or undo. That is a defensible position because the loudest AI complaints in verified reviews are exactly about surprise: silent context truncation, edits outside the requested scope, hallucinated facts, forced accounts and unclear cost.

### The seven moves that matter

1. **Close the trust loop.** Signed or at least reproducible builds, an update path, crash-safe autosave, and documentation that agrees with the shipped version.
2. **Make search real.** Search open buffers *and* saved files, label which is which, add replace-in-files and regular expressions, and never mutate disk during a search.
3. **Make big files boring.** A large-file mode with syntax highlighting and feature degradation above a measured threshold, plus published benchmarks instead of adjectives.
4. **Ship daily-driver ergonomics.** Zoom, font family, spell-check, tab context menus and reordering, split view, file compare, print/export, and an outline.
5. **Add a thin notes layer, not a knowledge platform.** Quick capture, tags, wikilinks/backlinks, headings outline, templates and a daily note — all stored as ordinary Markdown files.
6. **Turn AI into one coherent, reviewable workflow.** Selection actions (shipped here), "ask this document" with line citations, workspace Q&A behind an explicit index, and a provider adapter so Ollama, LM Studio, Arena and other compatible endpoints are peers rather than hard-coded paths.
7. **Protect the wedge.** No account, no content telemetry, no silent edits, no autonomous multi-file agents, no plugin marketplace, no mobile app before the desktop basics are finished.

### What not to build before 1.0

Real-time collaboration, CRDT sync, an extension marketplace, terminal execution, autonomous agents, a mobile client, a proprietary note database, and any feature whose main selling point is a bigger model. Each adds permission, conflict, supply-chain or maintenance burdens that a project with five contributors cannot yet carry.

---

## 2. Repository review

### 2.1 Snapshot

| Dimension | Observed on this branch |
|---|---|
| Product | Windows-first text and code editor, Tauri 2 + CodeMirror 6, MIT |
| Frontend | TypeScript, Vite; ~3,971 lines in `src/`; `main.ts` 1,193 and `workbench.ts` 802 lines |
| Native | Rust commands for bounded reads/writes, atomic replace, hashes, file scope |
| Tests | 118 Vitest tests in 15 files, plus Playwright specs and Rust unit tests |
| Checks run for this audit | `npm ci`, `npm test` (118 passed), `npm run build` (passed) on Linux |
| Docs | README, user guide, product research, implementation notes, contributor queue, security policy |
| Distribution | v0.4.0 marked pre-release; unsigned NSIS installer; no auto-update |
| Traction | 3 stars, 2 forks, 5 contributors including Dependabot; no substantive user discussion yet |

### 2.2 What is genuinely good

- **Consent is structural, not a checkbox.** AI starts off every launch, consent is session-only, and `saveSettings()` deliberately refuses to persist an enabled flag (`src/storage.ts`). That is the right default.
- **Review-before-apply already exists.** `src/change-review.ts` captures a selection with a document revision, refuses stale targets, normalises replacement text literally, and applies one isolated undo step. This is the perfect substrate for reviewable AI.
- **Native I/O is bounded and cautious.** 20 MiB read/write limit, link/reparse-point rejection, SHA-256 version checks, temp-file atomic replacement, and explicit conflict handling (`src-tauri/src/lib.rs`).
- **External-change detection** on focus, with a reload prompt, addresses a real data-loss fear.
- **Tests are meaningful**, not decorative: surrogate-pair handling, stale targets, storage quota failure, transport bounds, contrast pairs.
- **Documentation admits limits.** That is rare and worth preserving as the product grows.

### 2.3 Gaps found by inspection

These are factual gaps in the current tree, not opinions about strategy.

| Area | Current state | Consequence |
|---|---|---|
| Autosave | No save-to-disk autosave. Recovery snapshots are best-effort, unencrypted `localStorage` | Users who expect “it just keeps my work” can still lose a draft |
| Large files | 20 MiB hard cap; no large-file mode or streaming editor | Cannot open logs or dumps that Notepad++ users treat as routine |
| Search | Literal search of **saved** files; no unsaved buffers, no replace-in-files, no regex in folder search | Weakest core feature relative to Notepad++ |
| Notes | No tags, backlinks, outline, templates, daily note or quick capture | Competes as a text editor only, despite “notes” in the pitch |
| Ergonomics | No zoom, font family, spell-check, print/export, split view, file compare, tab context menu | Visible omissions against even 10k-star notepad apps |
| AI | Single-line completion; manual Arena paste; optional API panel | Three disconnected surfaces, no document Q&A, no provider abstraction |
| Distribution | Unsigned installer, no auto-update, no documented package-manager presence | First-run friction that suppresses adoption |
| Docs | `docs/ROADMAP-PROPOSED.md` is a proposal for a different product (“Pinch”); `docs/contributing-queue.md` opened with “Pinch keeps…”. This branch adds a scope banner to the proposal and fixes the queue typo | Contributors could not tell which plan is current; the banner removes the ambiguity |
| Release messaging | `README` says “0.4.0 preview”; `CHANGELOG` calls 0.4.0 “unreleased preview”; GitHub shows v0.4.0 as a pre-release | Small but corrosive credibility gap |

### 2.4 Code-health observations

- `src/main.ts` and `src/workbench.ts` carry most UI behaviour. Adding dialogs, AI and notes into them will make review and testing harder. Before Phase 2, extract feature controllers (`ai-panel.ts`, `notes.ts`, `search.ts`) behind narrow interfaces.
- The AI surface is already split cleanly at the transport boundary (`src/ai.ts`, `src/arena.ts`). A provider interface can be introduced without touching the editor.
- The existing unit-test style is excellent for pure modules. Keep new product logic pure and testable; keep DOM wiring thin.
- No performance budget exists in CI. Once a benchmark harness exists, a regression should fail a check rather than be discovered in a review.

### 2.5 What this branch changes

To prove the AI direction rather than only describe it, this branch adds the first rung of the AI ladder:

- `src/ai-actions.ts` — a pure catalogue of eight actions (improve, grammar, shorten, expand, summarize, bullets, explain, custom), bounded request construction, a delimiter that cannot be closed by the selection, and conservative output cleaning.
- `src/ai.ts` — `runAction()` over the existing bounded, no-redirect Ollama transport.
- Assistant panel — action picker, optional instruction, explicit per-session consent, cancel, timeout, and a read-only answer area for “Explain”. A command-palette entry opens the panel and focuses the actions.
- Replace actions open the **existing diff review dialog**; nothing is applied or saved automatically.
- 15 new tests (118 total): size limits, NUL rejection, model-name validation, delimiter collision, custom instructions, fence stripping, indentation preservation, surrogate-safe truncation, transport bounds and error trimming.

**Not verified:** a real Ollama response on Windows, model quality, latency on consumer hardware, or screen-reader behaviour of the new controls. Those remain release gates, not claims.

---

## 3. Competitive landscape

### 3.1 GitHub snapshot (stars captured 4 November 2026)

Stars are rounded and change daily. Licence matters: code from GPL/AGPL projects cannot be copied into an MIT project, although UX patterns and ideas can be learned from.

#### League 1 — direct notepad competitors

| Repository | Stars | Stack | Licence | What earns its stars | What Morrow should take | What to skip |
|---|---:|---|---|---|---|---|
| [notepad-plus-plus/notepad-plus-plus](https://github.com/notepad-plus-plus/notepad-plus-plus) | 29.8k | C++ | GPL | Speed, tabs, huge-file tolerance, regex search/replace across files, macros, plugins, session save, portable use | Search depth, macro recording, compare, session restore, “open anything” reliability | Dated UI, plugin sprawl, Windows-only architecture |
| [dail8859/NotepadNext](https://github.com/dail8859/NotepadNext) | 14.8k | C++/Qt | GPL-3.0 | Cross-platform Notepad++ reimplementation | Feature parity checklist as a roadmap input | Desktop-native complexity Morrow does not need |
| [0x7c13/Notepads](https://github.com/0x7c13/Notepads) | 10.3k | C# UWP | MIT | Clean Fluent UI, tabs, Markdown preview, diff viewer, session snapshot, always-on-top, 4.6★ Store rating | Modern calm UI, compact overlay, built-in diff, “stay on top” | 1 MB file limit, UWP restrictions, no zoom |
| [rizonesoft/Notepad3](https://github.com/rizonesoft/Notepad3) | 6.7k | C | — | Scintilla-based lightweight editor, code folding, braces | Restraint and startup speed | Niche feature set |
| [zufuliu/notepad4](https://github.com/zufuliu/notepad4) | 5.1k | C++ | — | Successor to Notepad2, syntax breadth, small binary | Broad language detection | Minimal product surface |

#### League 2 — note and knowledge apps (adjacent, much larger)

| Repository | Stars | Stack | Licence | Pattern worth studying |
|---|---:|---|---|---|
| [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 78.2k | Dart/Rust | AGPL-3.0 | Local-first workspace, databases, self-hosting, AI integration |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | 74.2k | TypeScript | — | Docs + whiteboard, local-first, polished onboarding |
| [usememos/memos](https://github.com/usememos/memos) | 64.3k | Go | MIT | Frictionless capture, tags, single-binary self-hosting |
| [marktext/marktext](https://github.com/marktext/marktext) | 63.6k | TypeScript | MIT | Clean WYSIWYG Markdown, focus mode, typewriter mode |
| [laurent22/joplin](https://github.com/laurent22/joplin) | 57.0k | TypeScript | AGPL-3.0 | Markdown + notebooks + tags + E2EE sync + web clipper + plugins |
| [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan) | 47.1k | TypeScript | AGPL-3.0 | Block references, local-first, agent-friendly workspace |
| [logseq/logseq](https://github.com/logseq/logseq) | 45.5k | Clojure | AGPL-3.0 | Outliner, backlinks, daily notes, queries |
| [TriliumNext/Trilium](https://github.com/TriliumNext/Trilium) | 38.7k | TypeScript | AGPL-3.0 | Hierarchical knowledge base, scripting, attributes |
| [streetwriters/notesnook](https://github.com/streetwriters/notesnook) | 14.9k | TypeScript | GPL-3.0 | Verified end-to-end encryption, cross-platform |
| [codexu/note-gen](https://github.com/codexu/note-gen) | 13.0k | TypeScript | GPL-3.0 | “Capture first, organise later” with AI summarisation |
| [vnotex/vnote](https://github.com/vnotex/vnote) | 13.0k | C++ | LGPL-3.0 | Markdown, mind maps, Typst, native speed |
| [standardnotes/app](https://github.com/standardnotes/app) | 6.7k | TypeScript | AGPL-3.0 | Longevity, E2EE, self-hosting |
| [pbek/QOwnNotes](https://github.com/pbek/QOwnNotes) | 5.9k | C++ | GPL-2.0 | Plain-text Markdown notes + Nextcloud sync + scripting |

#### League 3 — AI-native editors and runtimes (where expectations are set)

| Repository | Stars | Licence | Pattern worth studying | Relevance to Morrow |
|---|---:|---|---|---|
| [ollama/ollama](https://github.com/ollama/ollama) | 185.9k | MIT | One-command local models, OpenAI-compatible API, huge ecosystem | The default local provider; already integrated |
| [zed-industries/zed](https://github.com/zed-industries/zed) | 92.7k | GPL/AGPL mix | Fast editor, edit prediction, multi-provider choice, partial acceptance | Best model of AI that stays out of the way |
| [lfnovo/open-notebook](https://github.com/lfnovo/open-notebook) | 41.6k | MIT | NotebookLM-style source-grounded Q&A | Blueprint for “ask your own documents” with citations |
| [continuedev/continue](https://github.com/continuedev/continue) | 36.4k | Apache-2.0 | IDE assistant with local models, chat, edit, autocomplete | Provider abstraction and capability split |
| [cursor/cursor](https://github.com/cursor/cursor) | 33.3k | Closed source | Agentic edits, codebase context, diff review | Shows demand, but also the trust failure modes to avoid |
| [YishenTu/claudian](https://github.com/YishenTu/claudian) | 15.9k | MIT | Embeds coding agents inside Obsidian | Proof that users want AI inside their notes, not beside them |

**Demand signal:** the most-starred AI-note projects (`claudian` 15.9k, `open-notebook` 41.6k, `note-gen` 13.0k, `obsidian-smart-connections` ~5.5k) all put AI *inside* the place where notes live. They do not ask users to copy text into a separate chat app. Morrow's current browser hand-off does exactly that, which caps its usefulness.

### 3.2 What the leaders actually compete on

- **Notepad++** wins on trust earned over two decades: it opens nearly anything, searches almost anywhere, and never gets in the way. Its own reviews still complain about a dated interface, no autocomplete, and lag on very large files.
- **Notepads** proves that a calm, modern UI plus tabs, a diff viewer, Markdown preview and always-on-top is enough to earn 4.6★ from ordinary users — and that a 1 MB limit and missing zoom will be called out immediately.
- **Joplin** wins on ownership: Markdown, E2EE, self-chosen sync, plugins, mobile. It loses on complexity and search quality.
- **Obsidian** wins on local files plus links, plugins and speed on desktop. It loses on mobile performance and paid sync (the most repeated complaint).
- **Zed/Continue** show that model choice, partial acceptance and local inference are product features, not implementation details.
- **Notion AI and Windows Notepad AI** show the backlash pattern: paywalling or account-gating AI inside a previously simple tool generates more hostility than the feature generates value.

### 3.3 Coarse feature matrix

Legend: ✓ present, ◐ partial/plugin, — absent, ? unverified. Compiled from project docs and repositories, not hands-on testing.

| Project | Plain files | Tabs | Session/autosave | Large files | Find in files | Replace in files | Tags/backlinks | Sync/E2EE | Extensions | Built-in AI | Mobile |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Morrow | ✓ | ✓ | ◐ recovery only | — 20 MiB cap | ✓ saved only | — | — | — | — | ◐ 3 disjoint surfaces | — |
| Notepad++ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | — | — | ✓ | — | — |
| Notepad Next | ✓ | ✓ | ◐ | ◐ | ✓ | ◐ | — | — | ◐ | — | — |
| Notepads | ✓ | ✓ | ✓ | — 1 MB | ? | — | — | — | — | — | — |
| Joplin | ◐ DB + MD export | ✓ | ✓ | ◐ | ✓ | — | ✓ tags | ✓ | ✓ | ◐ plugins | ✓ |
| memos | ◐ DB | ◐ | ✓ | ◐ | ✓ | — | ✓ tags | — | — | ? | ✓ web |
| AppFlowy | ◐ DB | ✓ | ✓ | ◐ | ✓ | ◐ | ✓ | ✓ self-host | ◐ | ✓ | ✓ |
| MarkText | ✓ | ✓ | ◐ | ◐ | ✓ | ◐ | — | — | — | — | — |
| NoteGen | ✓ | ✓ | ✓ | ◐ | ✓ | — | ◐ | — | — | ✓ | ✓ |
| Zed | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ◐ collab | ◐ | ✓ | — |
| Continue | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ✓ local+cloud | — |

### 3.4 The licensing warning

Copying implementation from GPL/AGPL projects into an MIT repository is a licence violation. This is not a reason to ignore them: reading UX, feature specs and public documentation is normal competitive research. Copy **ideas and behaviours**, write **your own code**, and keep a note in `THIRD_PARTY_NOTICES.md` when a design is inspired by a specific source. Notepads (MIT) and Continue (Apache-2.0) are safer to study at code level than Joplin/Logseq/SiYuan (AGPL).

---

## 4. What users actually ask for

### 4.1 Method and caveat

I reviewed public, mostly verified reviews on Capterra, Software Advice, G2, Product Hunt, AlternativeTo, the Microsoft Store summary, and app-store review aggregators, plus vendor documentation and repository READMEs. Reviewers skew toward people with a complaint or a strong preference; ratings are not a census. The goal is to find **repeated** expectations, not to estimate their prevalence.

### 4.2 Twelve recurring expectations

| # | Expectation | What reviewers say | Product implication for Morrow |
|---|---|---|---|
| 1 | **It opens instantly and stays light** | Notepad++ praised for launch speed and low memory; Notepads praised for being “as fast as Notepad”; Joplin criticised for heaviness | Protect startup budget; avoid a splash screen, background indexer or model at launch; measure cold start |
| 2 | **Never lose my work** | Notepads users ask for Notepad++-style restore of unsaved tabs; Notepad++ auto-save praised; recovery confusion appears in Joplin/Obsidian reviews | Autosave to a crash-safe journal, plain “restore draft” UX, and a backup story that is not confused with recovery |
| 3 | **Open big files and logs** | Notepad++ reviews complain above ~50 MB; Notepads’ 1 MB limit is a top complaint | Large-file mode with feature degradation, progress and cancel; publish measured limits |
| 4 | **Find anything, across files, including unsaved work** | Notepad++ search-in-files and filters are its most praised features; Joplin’s “limited search” is a common con | Search both buffers and disk, label the source, add replace-in-files, regex, scope preview and cancellation |
| 5 | **A modern, calm interface** | Notepad++ called dated/cluttered; Notepads praised for Fluent design and dark mode | Keep the current visual direction; invest in typography, spacing, keyboard focus and contrast |
| 6 | **Make it mine** | Requests for zoom, font size, themes, language localisation, RTL, larger icons | Zoom, font family, themes, keybinding editor; do not hide basic preferences |
| 7 | **Stay on top / capture quickly** | Notepads’ compact overlay and always-on-top are repeatedly praised | A small always-on-top note window and a global quick-capture shortcut are high-value, low-risk |
| 8 | **Compare and review changes** | Notepad++’s Compare plugin is a favourite; Notepads ships a diff viewer | File compare and split view; the existing review dialog is already the right interaction |
| 9 | **Organise without a database** | Obsidian/Joplin/Logseq users value tags, backlinks, notebooks, daily notes and templates; Markdown portability is the reason they stay | Add tags, wikilinks/backlinks and an outline over plain files; never invent a proprietary store |
| 10 | **Sync that is not a tax** | Obsidian Sync price (~$4–5/month, $48/year) is the single most repeated complaint; Joplin sync conflicts annoy users | Do not build sync yet; make files sync-friendly and document conflicts; consider a user-owned folder or Git workflow |
| 11 | **Privacy I can verify** | Notesnook/Standard Notes/Joplin users cite E2EE and data ownership; Notepad AI backlash is about accounts and paywalls | Stay account-free; keep AI opt-in; show destination, model and size; never log content |
| 12 | **AI that helps without taking over** | Cursor users want context transparency and review; Copilot users complain about confident wrong edits; Notion AI is called overpriced; Windows Notepad AI is called bloat | Review-first AI, visible context, model choice, cost clarity, and a usable non-AI path |

### 4.3 What users dislike about AI, specifically

These complaints repeat across Cursor, Copilot, Notion AI and Windows Notepad reviews:

- **Silent context loss.** “It quietly loses the thread on a big repo and doesn’t tell you.” Morrow must show *what* will be sent and how much was truncated.
- **Edits beyond scope.** Agents change signatures or files nobody asked about. Morrow should scope every request to an explicit selection or named document.
- **Confident hallucination.** Invented APIs, facts and citations. The UI must say “model output, may be wrong”, and review must be the default.
- **Forced account or paywall.** The Windows Notepad “Rewrite” backlash is the clearest signal: an optional feature becomes a trust problem when it demands sign-in or a subscription.
- **Opaque cost.** Notion AI’s 2025 repricing and Cursor’s usage caps dominate negative sentiment. Show an estimate before a cloud request.
- **Unclear model routing.** Cursor is criticised for not publishing model IDs. Let users choose the model and display it on every request.
- **No offline path.** Users value local inference even when quality is lower. Keep Ollama first-class.

### 4.4 What this means for Morrow

The market does not need another chat sidebar. It needs the boring promises kept, plus a small number of AI actions that are faster than copy-paste and safer than an agent. The evidence supports this ordering:

1. Data safety and speed.
2. Search and file handling.
3. Everyday ergonomics.
4. Notes organisation.
5. AI that is reviewable and optional.

AI before step 1–3 would repeat the Windows Notepad mistake: adding intelligence to a tool whose users are there because it is predictable.

---

## 5. Positioning

**One sentence:** *Morrow is the calm, local-first Windows editor for notes and quick code — plain files you own, and AI that shows you the change before it makes it.*

**Three promises the product can keep:**

1. **Instant.** Opens fast, edits without lag, never blocks on the network.
2. **Safe.** Never silently overwrites, never applies an AI change without a diff, never sends text without an explicit action.
3. **Honest.** Says what it can and cannot do; no invented benchmarks, no “fully private” claims that the provider stack cannot support.

**Two promises to avoid:** “better than Notepad++” (unmeasured) and “private AI” (Ollama can route to cloud models; a loopback address is not a guarantee).

**The wedge:** verification-first AI inside a small editor. Zed, Cursor and Continue are excellent, but they are developer tools with accounts, agents and large surfaces. Morrow can own the user who wants a safe “rewrite this paragraph” or “summarise this file” without signing up for an agent platform.

---

## 6. AI design

### 6.1 Principles

1. **Nothing changes without a diff.** Model output is text in a review dialog, never a direct edit.
2. **Explicit context only.** A selection, the active document, or a workspace the user named. No ambient scanning.
3. **Show the payload.** Destination, model, character count, and truncation status before sending.
4. **Session consent, per surface and model.** Inline completion consent does not authorise a different kind of request, and changing the model asks again.
5. **Provider-neutral.** Ollama is the default, not the architecture.
6. **Bounded and cancellable.** Character limits on input and output, timeouts, abort, and no retries that duplicate billing.
7. **No content logging.** No prompts or responses in logs, crash reports or telemetry.
8. **Treat model output as untrusted text.** Never execute it, never interpret it as instructions, never let it widen file permissions.
9. **Cost and quality are visible.** Model name, approximate size, cloud/paid status, and a clear “may be wrong”.
10. **Fail closed.** No model, no consent, stale target, oversized input → stop with an explanation.

### 6.2 Capability ladder

| Level | Capability | Status | Why this order |
|---|---|---|---|
| L0 | Single-line inline completion | Shipped, opt-in | Low friction, but narrow value |
| L0 | Manual Arena browser hand-off; pasted-change review | Shipped | Useful without an account, but breaks flow |
| L1 | **Selection actions → diff review** | **Shipped on this branch** | Highest value per unit of risk; reuses existing review safety |
| L2 | Ask about this document, with line citations | Next | Read-only, grounded, no workspace indexing |
| L3 | Ask across workspace, explicit scope and local index | Planned | Where the real “second brain” value lives |
| L4 | Multi-step edit plans, one diff per file | Later | Still human-approved, but much more design work |
| L5 | Autonomous agents, terminal execution | Not planned | Permission, supply-chain and trust costs too high |

### 6.3 L1 — the shipped slice

**Flow**

```
select text → choose action → (optional instruction) → consent per session/model
      → Ollama /api/generate → clean output
      → replace actions: diff dialog → Apply / Reject → one undo step
      → explain: read-only answer → Copy
```

**What is bounded**

- 12,000 characters of selection, 2,000 characters of instruction, 20,000 characters of output.
- NUL rejection; surrogate-safe truncation; indentation preserved; one wrapping code fence stripped unless the selection was itself fenced or the answer is read-only.
- Model names restricted to `[A-Za-z0-9._:/-]{1,120}`.
- 60-second timeout; explicit cancel; no automatic retry.
- Consent is per session and per model; changing the model asks again.
- No file path, filename, folder contents or surrounding text is sent.

**Prompt-injection handling**

The selection is framed between delimiters that are guaranteed not to appear in it (`<<<MORROW_PASSAGE_n>>>`), the system prompt says the passage is data and not instructions, and the output is still treated as untrusted text. This reduces the risk; it does not eliminate it. A model can still follow injected instructions inside the passage, which is exactly why nothing is applied automatically.

**UI states**

- Browser preview: actions explain that they require the desktop app; nothing is attempted.
- No selection: inline error, focus stays in the editor.
- Consent cancelled: “Nothing was sent.”
- Model unavailable/timeout: actionable error, cancel visible, request aborted.
- Stale target: refuse, explain, ask the user to select again.
- Same text returned: no review dialog, explicit “nothing to review”.

**Known limits**

- Quality depends entirely on the model; a 1.5B coder model is acceptable for grammar, weak for nuanced rewriting.
- `num_predict` caps output; long documents need chunking, which is deliberately not implemented yet.
- No streaming: the UI waits with a disabled Run button and a status line. Streaming into a review dialog would encourage premature application.
- No Windows or real-model verification yet.

### 6.4 L2 — Ask this document

The next step and the highest-value safe AI feature for notes.

- A single “Ask” input in the assistant panel, scoped to the **active document**.
- The document is chunked client-side (target 8–12k characters per request), with the current selection given priority.
- Answers cite line ranges (`L42–L47`) derived from the chunks actually sent; citations are links that scroll the editor.
- The model is instructed to say when the document does not contain the answer. The UI repeats that warning.
- Read-only. No edit button in this mode; a separate “propose a change” action opens review.
- Context preview shows the chunks and total characters before sending.
- If the document exceeds the budget, show “using N of M chunks” rather than silently truncating.

**Acceptance criteria:** an answer either cites lines that exist and contain the quoted text, or explicitly says it could not find it. No citation may be fabricated without being visibly marked as unverified.

### 6.5 L3 — Ask across workspace

This is the feature that makes notes useful at scale, and the one with the largest privacy surface.

**Design**

- Opt-in index, per workspace root, with an explicit list of included folders and exclusions.
- Chunk locally; embed with a local model (e.g. `nomic-embed-text` via Ollama) **or** use lexical BM25 first. Start lexical: no model download, predictable, testable.
- Store the index in a user-visible folder with a size limit, a “delete index” button and no cloud upload by default.
- Retrieval returns passages with file, line range and a snippet; answers must cite them.
- Indexing runs only when the user starts it, shows progress, is cancellable, and never follows links/reparse points.
- The query and retrieved passages are shown before any cloud provider is used. Local provider → send automatically after consent; cloud provider → per-request confirmation with cost/size.
- Deleted, renamed and externally changed files are handled explicitly; stale passages are marked, not silently trusted.

**Why lexical first:** embeddings add a model download, a vector store, migration and privacy questions. BM25 plus good chunking delivers most of the value for a small editor and is far easier to test.

### 6.6 Provider architecture

Introduce one interface and keep every caller ignorant of the vendor.

```ts
interface AiProvider {
  id: 'ollama' | 'openai-compatible' | 'arena';
  label: string;
  capabilities: { complete: boolean; action: boolean; chat: boolean; embed: boolean };
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  action(request: ActionRequest, signal?: AbortSignal): Promise<string>;
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
```

- **Ollama adapter** (existing transport) — default, localhost only.
- **OpenAI-compatible adapter** — LM Studio, llama.cpp server, vLLM, OpenRouter, etc. Endpoint allowlist, HTTPS by default, localhost HTTP allowed; no redirects; key in memory only.
- **Arena adapter** — wraps the existing `src/arena.ts` request builder and its two-model comparison.
- **Capability discovery** — hide actions a provider cannot do rather than failing at click time.
- **Per-task model choice** — completion, action and chat can use different models; display the model on every request.
- **No silent fallback.** If a provider fails, show the failure; never send the same text to a different vendor to “help”.

### 6.7 Safety model

| Risk | Control |
|---|---|
| Prompt injection from a document | Data delimiters, system instruction, output treated as text, no tool execution, human review |
| Data leakage | Explicit selection, char count, destination/model shown, session consent, no logs, cloud confirmation |
| Silent file change | AI never edits; reuse of `ReviewTarget` revision checks; one undo step |
| Cost surprise | Cloud requests require confirmation with model and size; no automatic retries; no parallel hidden calls |
| Stale output applied | Revision + text equality check before opening and applying a review |
| Oversized input/output | Hard limits on selection, instruction, output and response bytes |
| Path leakage | No paths, filenames or folder contents in AI payloads unless the user explicitly adds a file to context |
| Model supply chain | Do not bundle models; require the user to install/pull one; document licence and size |

### 6.8 Model guidance

| Task | Sensible starting model | Notes |
|---|---|---|
| Inline completion | `qwen2.5-coder:1.5b` (current) | FIM-compatible; low RAM; single-line only |
| Grammar/shorten/summarise | 3–8B instruct model | Quality improves sharply above 1.5B |
| Ask this document | 7–8B with 8k+ context | Context window matters more than parameter count |
| Embeddings (if ever) | `nomic-embed-text` | Keep optional; lexical retrieval first |

Document RAM/VRAM expectations, first-token latency and the fact that a 1.5B model will sometimes produce worse text than the original. Do not promise “local = private” without explaining Ollama’s cloud routing.

### 6.9 Evaluation

Build a small, synthetic, checked-in benchmark before expanding AI:

- 30–50 fixtures: a paragraph to tighten, a buggy function, meeting notes to summarise, a note with an answerable question and one without.
- Metrics: acceptance rate (diff applied), rejection rate, edit distance after apply, latency, output failure rate, citation correctness.
- Run on named models and hardware; publish results with the model and version.
- Never use real user files. Never log prompts from production.

A feature that cannot show improved acceptance or reduced time-to-result should not ship.

---

## 7. Roadmap

### 7.1 Release sequence

Sized for a solo maintainer with occasional contributors. Dates are deliberately omitted; sequence and exit criteria matter more.

| Release | Theme | Must include | Exit criteria |
|---|---|---|---|
| **0.5** | Never lose work | Autosave journal, restore-draft UX, crash test, signed or reproducible build, auto-update check, docs consolidation | Kill the process mid-edit and recover; no contradictory roadmap docs; update path documented |
| **0.6** | Find anything | Buffer + disk search, replace in files, regex, scope labels, cancellation, outline panel | Search never mutates disk; results are labelled and stale-safe; benchmark published |
| **0.7** | Daily driver | Zoom, font family, spell-check, tab context menu/reorder, split view, file compare, print/export | A Notepad++ user can complete a week of ordinary work without another editor |
| **0.8** | Notes, lightly | Quick capture, tags, wikilinks/backlinks, templates, daily note, workspace index (lexical) | Notes remain plain Markdown; no proprietary store; index can be deleted |
| **0.9** | Ask your notes | Ask-this-document with citations, workspace Q&A, provider adapter, model picker, eval harness | Every answer cites real lines or says it could not find the answer |
| **1.0** | Trusted distribution | Signing, installer polish, winget/Store, accessibility audit, localization groundwork | A stranger can install, update, use and uninstall without instructions |

### 7.2 Phase detail

#### Phase 0 — Trust and baseline (1–2 weeks)

- Add a release checklist that distinguishes “merged”, “built”, “installed”, “verified on consumer Windows”.
- Decide signing: purchase a certificate or publish reproducible-build instructions and keep the warning visible. Do not imply safety from an unsigned hash.
- Add an update check (manual or automatic with consent), or explicitly document that there is none.
- Consolidate docs: keep the new scope banner on `docs/ROADMAP-PROPOSED.md` (added on this branch), confirm no current document presents it as Morrow's plan, and align README, CHANGELOG and release metadata.
- Add a benchmark harness for cold start, open 1/5/20 MiB, search and save; record results per release.
- Resolve or document the open Dependabot alert on the default branch. GitHub reported one moderate alert on 4 November 2026; `npm audit` was clean locally, so check the Rust/Cargo alerts (the user guide already documents the Linux `glib` advisory).

#### Phase 1 — Data safety (2–3 weeks)

- Autosave every N seconds and on blur to a bounded journal, separate from session recovery; restore flow distinguishes “disk”, “autosave” and “recovery”.
- Detect unclean shutdown and offer the newest draft with a timestamp.
- Test forced termination, disk full, permission loss, read-only files and network drives.
- Make “recovery is not a backup” visible in the restore UI, not only in docs.

#### Phase 2 — Search (2–3 weeks)

- Unified search UI with source tabs: Open buffers / Saved files / Both.
- Literal and regex; case/word/extension filters; replace-in-files with a mandatory preview and per-file diff.
- Snapshot revision per result; label stale results; never write during search.
- Keep the existing bounds and cancellation; add progress and a result cap with an explicit “truncated” message.

#### Phase 3 — Ergonomics (2–4 weeks)

- Zoom (Ctrl +/-/0), font family, spell-check toggle (native WebView2 support where available), print/export.
- Tab context menu (close others, close to the right, copy path, reveal), reorder, middle-click close.
- Split view and compare-two-files using the existing diff renderer.
- Outline panel from Markdown/code headings; click to jump, no edits.

#### Phase 4 — Notes layer (3–5 weeks)

- Quick capture: global shortcut and/or always-on-top mini window; writes a Markdown file immediately.
- Tags via `#tag` and front-matter; a tag pane that is a view, not a database.
- `[[wikilinks]]` with autocomplete; backlinks panel; unresolved links shown distinctly.
- Templates and daily note using plain files in a user-chosen folder.
- Workspace index (lexical) with include/exclude, size limit, progress, delete.

#### Phase 5 — AI knowledge (4–6 weeks)

- Provider interface and adapters; migrate inline completion and Arena to it.
- Ask-this-document with line citations and chunk preview.
- Workspace Q&A over the lexical index, local-first, cloud confirmation.
- Note actions: suggest title, tags, summary; all as reviewable text or accept/reject chips.
- Evaluation harness and published results.

#### Phase 6 — Distribution and scale (ongoing)

- Auto-update, winget, optional Microsoft Store package, portable build.
- Localization and RTL groundwork (a repeated accessibility/localisation complaint).
- Accessibility audit with Narrator/NVDA and high-contrast themes.
- Crash reporting only if opt-in, content-free and inspectable.

### 7.3 Capacity reality

This is 4–8 months of part-time work for one maintainer, not a weekend. The failure mode is starting all six phases at once and finishing none. A better plan is to keep two workstreams: one **user-visible** (the next release theme) and one **trust** (tests, docs, performance). If only one can move in a month, move trust.

---

## 8. Backlog ready to file

Every item below is written to be independently reviewable. “Windows-free” means a contributor on Linux/macOS can implement and test it — important for this repository's contributor model.

| ID | Title | Area | Size | Windows-free | Acceptance signal |
|---|---|---|---|---|---|
| M-01 | Autosave journal with crash recovery | editor | L | ✓ | Kill process mid-edit; newest draft restored; disk copy never overwritten silently |
| M-02 | Unified search across buffers and saved files | search | L | ✓ | Source label per result; stale results marked; disk unchanged |
| M-03 | Replace in files with per-file diff | search | L | ✓ | Preview first; cancel leaves disk untouched |
| M-04 | Regex and filters in folder search | search | M | ✓ | Valid/invalid regex handled; bounds preserved |
| M-05 | Large-file mode with measured thresholds | editor | L | ◐ | 100 MB log opens, scrolls, searches; syntax disabled with a badge |
| M-06 | Zoom, font family, spell-check | UI | M | ✓ | Persisted; keyboard accessible |
| M-07 | Tab context menu and reorder | UI | M | ✓ | Close-others/right; drag reorder; middle-click close |
| M-08 | Split view and file compare | UI | L | ✓ | Two panes, independent cursors, existing diff renderer reused |
| M-09 | Print and export (HTML/PDF) | UI | M | ◐ | Preview; no external resources loaded |
| M-10 | Markdown outline panel | notes | M | ✓ | Headings only; fenced code skipped; keyboard navigable |
| M-11 | Quick capture window and shortcut | notes | L | ◐ | Captures to a Markdown file within one keystroke |
| M-12 | Tags from `#tag` and front-matter | notes | M | ✓ | Tag view is read-only over files; no index required |
| M-13 | Wikilinks and backlinks | notes | L | ✓ | Unresolved links visible; no automatic file creation |
| M-14 | Templates and daily note | notes | M | ✓ | Plain files in a chosen folder; no lock-in |
| M-15 | Lexical workspace index with delete | notes | L | ✓ | Include/exclude list; size cap; index removable |
| M-16 | Provider adapter for AI | AI | M | ✓ | Inline, actions and Arena share one interface; no silent fallback |
| M-17 | Ask this document with line citations | AI | L | ✓ | Citations verified against sent chunks; “not found” path |
| M-18 | Workspace Q&A over lexical index | AI | L | ✓ | Passages shown before send; cloud requires confirmation |
| M-19 | AI evaluation harness | AI | M | ✓ | 30+ fixtures; latency/acceptance reported per model |
| M-20 | Streaming chat with cancel (read-only) | AI | M | ✓ | No partial apply; cancel stops the request |
| M-21 | Cloud cost/size confirmation | AI | S | ✓ | Bytes, model, provider shown before send |
| M-22 | Update check or explicit “no updates” policy | distro | M | ◐ | Documented and testable |
| M-23 | Reproducible build instructions | distro | M | ✓ | Hash matches across clean builds |
| M-24 | Portable build and winget manifest | distro | M | ◐ | Installs per-user without admin |
| M-25 | Accessibility pass (Narrator/NVDA, contrast) | a11y | L | ◐ | Keyboard-only core tasks; findings published |
| M-26 | Performance budget in CI | quality | M | ✓ | Benchmark regression fails or warns |
| M-27 | Docs consolidation (remove “Pinch”, align versions) | docs | S | ✓ | One current roadmap; README/CHANGELOG agree |
| M-28 | Recovery encryption design (opt-in) | security | L | ✓ | Key management and migration tested before shipping |
| M-29 | Folder-sync conflict guidance | notes | S | ✓ | Documented workflow; no fake sync |
| M-30 | Localisation groundwork and RTL audit | i18n | M | ✓ | Strings externalised; RTL selection bug documented |

---

## 9. Metrics and validation

Without telemetry, most product metrics must come from opt-in studies and issue reports. That is acceptable; do not trade the privacy position for a dashboard.

### 9.1 Guardrail metrics (must never regress)

- Silent data loss incidents: **0**.
- Outbound AI requests without an explicit user action: **0**.
- AI-applied changes without a review diff: **0**.
- Cold start and first keystroke: budget set after the first benchmark, then enforced.
- Large-file open and search: measurable progress per release.

### 9.2 Product signals

- **Time to first useful edit** (new user): target under 10 seconds.
- **Draft survival rate** in forced-crash tests: 100% of autosaved content.
- **Search success**: task-based study; users find a term in an unsaved tab and a folder file without help.
- **AI acceptance rate** per action/model from the synthetic benchmark.
- **Undo-after-apply rate** for AI actions: a high rate means review quality or model quality is failing.
- **Accessibility task completion** with Narrator/NVDA; publish failures, not just pass rates.

### 9.3 Research plan

Recruit 12–15 Windows users across three groups: everyday note-takers, developers doing quick edits, and people using assistive technology or 200% scaling. Use synthetic files. Ask them to:

1. Write, close without saving, reopen and recover.
2. Open a large log and find a term.
3. Search an unsaved tab and a folder, and explain which is which.
4. Use an AI action, review the diff, reject it, then accept and undo.
5. Complete the core tasks with the keyboard only.

Record completion, help needed, wrong assumptions and recoverability — never document contents. A reasonable target is ≥80% independent completion per task with zero observed silent data loss; treat accessibility findings individually, not as an average.

---

## 10. Risks and open questions

### 10.1 Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scope outruns a small team | High | One theme per release; trust work always continues |
| AI quality on modest hardware disappoints | High | Small, clearly scoped actions; model guidance; evaluation harness |
| Privacy claims outpace reality | Medium | Show destination/model; explain Ollama cloud routing; never say “fully private” |
| GPL/AGPL code contamination | Medium | Behaviour-level research only; record inspiration; licence review |
| Unsigned distribution suppresses adoption | High | Signing budget or explicit reproducible-build trust path |
| Becoming heavy and cluttered | Medium | Enforce start-up and memory budgets; hide advanced surfaces |
| Docs drift and contradict the product | High (already happening) | Single roadmap, release checklist, versioned docs |
| Contributor burnout | Medium | Small, well-specified issues; reply SLA honesty; reduce WIP |

### 10.2 Decisions only the maintainer can make

1. Is Morrow primarily a **notepad** or a **notes app**? The answer changes the next three releases.
2. Is Windows-only acceptable for the next 12 months?
3. Can you fund code signing? If not, what is the trust story?
4. Will sync ever be built, or is “your files, your sync” the permanent answer?
5. Should cloud AI be BYO-key only, or a paid Morrow feature?
6. Will a model ever be bundled, or is Ollama a hard prerequisite?
7. How much of the notes layer is in scope before 1.0?
8. Who maintains LSP/plugins if those ever ship?

---

## 11. What this audit does not establish

- It does not measure Morrow's demand, retention, performance or accessibility.
- It does not verify the new AI actions against a real model, on Windows, with a screen reader.
- It does not test competitors hands-on; feature claims come from their docs, repositories and public reviews.
- It does not establish that any proposed feature improves outcomes. Each is a hypothesis with a stated acceptance test.
- It does not constitute legal advice on licences.

---

## Appendix A — Sources

Repository and docs (accessed 4 November 2026):

- Morrow repository, README, USER-GUIDE, `docs/PRODUCT-RESEARCH-2026.md`, `docs/IMPLEMENTATION-0.4.0.md`, `docs/ROADMAP-PROPOSED.md`, `src/*`, `tests/*`.
- [Notepad++ repository](https://github.com/notepad-plus-plus/notepad-plus-plus) · [manual: searching](https://npp-user-manual.org/docs/searching/) · [preferences](https://npp-user-manual.org/docs/preferences/)
- [Notepad Next](https://github.com/dail8859/NotepadNext) · [Notepads](https://github.com/0x7c13/Notepads) · [Microsoft Store listing](https://www.microsoft.com/store/apps/9nhl4nsc67wm)
- [Notepad3](https://github.com/rizonesoft/Notepad3) · [notepad4](https://github.com/zufuliu/notepad4)
- [Joplin](https://github.com/laurent22/joplin) · [memos](https://github.com/usememos/memos) · [MarkText](https://github.com/marktext/marktext)
- [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) · [AFFiNE](https://github.com/toeverything/AFFiNE) · [Logseq](https://github.com/logseq/logseq) · [SiYuan](https://github.com/siyuan-note/siyuan) · [Trilium](https://github.com/TriliumNext/Trilium)
- [Notesnook](https://github.com/streetwriters/notesnook) · [Standard Notes](https://github.com/standardnotes/app) · [NoteGen](https://github.com/codexu/note-gen) · [VNote](https://github.com/vnotex/vnote) · [QOwnNotes](https://github.com/pbek/QOwnNotes)
- [Zed](https://github.com/zed-industries/zed) · [Continue](https://github.com/continuedev/continue) · [Ollama](https://github.com/ollama/ollama) · [claudian](https://github.com/YishenTu/claudian) · [open-notebook](https://github.com/lfnovo/open-notebook)
- [Obsidian data storage](https://obsidian.md/help/data-storage) · [Zed edit prediction](https://zed.dev/docs/ai/edit-prediction) · [VS Code Markdown](https://code.visualstudio.com/docs/languages/markdown)

Reviews and product research (public, self-selected):

- Notepad++: [Capterra](https://www.capterra.com/p/185965/Notepad/reviews/), [Software Advice](https://www.softwareadvice.com/app-development/notepad-profile/), [TopBusinessSoftware](https://topbusinesssoftware.com/products/Notepad-Plus-Plus/reviews/)
- Notepads: [Yahoo/Windows roundup citing 4.6★ and 700+ ratings](https://www.yahoo.com/lifestyle/slideshows/6-windows-notepad-alternatives-worth-173500902.html), [AlternativeTo](https://alternativeto.net/software/notepads/about/), [Reddit launch thread](https://www.reddit.com/r/Windows10/comments/c8kcwa/notepads_is_available_on_microsoft_store_modern/)
- Obsidian: [Capterra](https://www.capterra.com/p/220063/Obsidian/), [TechJockey](https://www.techjockey.com/us/detail/obsidian), [ToolGuide](https://toolguide.io/en/tool/obsidian/)
- Joplin: [Product Hunt](https://www.producthunt.com/products/joplin/reviews), [TechJockey](https://www.techjockey.com/ae/reviews/joplin), [JustUseApp iOS reviews](https://justuseapp.com/en/app/1315599797/joplin/reviews)
- Notion AI: [workflowautomation review](https://workflowautomation.net/reviews/notion-ai), [AIonX](https://aionx.co/ai-comparisons/notion-ai-review/), [Reddit synthesis](https://www.aitooldiscovery.com/guides/notion-ai-reddit)
- Cursor: [Product Hunt](https://www.producthunt.com/products/cursor/reviews), [UC Strategies](https://ucstrategies.com/news/cursor-ai-guide-specs-pricing-how-it-compares-to-copilot-2026/), [Hacker News](https://news.ycombinator.com/item?id=43683012)
- Windows Notepad AI backlash: [Cybernews](https://cybernews.com/tech/microsoft-ai-notepad-users-leave-alone/), [WindowsForum](https://windowsforum.com/windows-news.4/windows-11-notepad-update-ai-rewrite-feature-sparks-mixed-reactions.352575/), [Slashdot](https://slashdot.org/story/25/02/19/1356215/microsoft-puts-notepads-ai-rewrite-feature-behind-paywall)
- Ollama: [G2](https://www.g2.com/products/ollama/reviews), [Product Hunt](https://www.producthunt.com/products/ollama/reviews), [AISOTools](https://aisotools.com/blog/ollama-review-2026)
- Note-app market expectations: [Tech Insider roundup](https://tech-insider.org/au/best-note-taking-apps/), [CodeWave market trends](https://codewave.com/insights/note-taking-app-market-trends-analysis/)
- Stack Overflow 2026 AI trust data: [trust](https://survey.stackoverflow.co/2026/ai/data/ai-trust), [usage](https://survey.stackoverflow.co/2026/ai/data)

## Appendix B — Summary of the shipped change

| File | Change |
|---|---|
| `src/ai-actions.ts` | New pure module: action catalogue, bounded request builder, safe output cleaning |
| `src/ai.ts` | `runAction()` over the existing bounded Ollama transport |
| `src/workbench.ts` | Public `previewChange()` so AI output uses the same review dialog |
| `src/main.ts` | Action selection, consent, cancel, timeout, answer display, review hand-off |
| `index.html`, `src/style.css` | Assistant-panel controls and result area |
| `tests/ai-actions.test.ts` | 13 tests for limits, prompts, delimiters and cleaning |
| `tests/ai-transport.test.ts` | 2 tests for the action transport path |
