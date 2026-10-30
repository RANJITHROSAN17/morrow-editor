# Morrow product research and future roadmap

**Research date:** 30 October 2026
**Product:** Morrow, an early open-source Windows text and code editor
**Audience:** project owner, contributors and prospective testers
**Decision status:** recommendations and hypotheses, not commitments. The 0.2.0 work described below is implemented in the source tree; Windows release validation is still pending.

## Executive summary

**Recommended position:** Morrow should be a small, approachable editor for ordinary text and quick code work, with files the user controls and AI that is optional, transparent and reviewable. Its best opportunity is not to out-IDE VS Code or out-agent Cursor. It is to make common editing tasks trustworthy and understandable, while allowing people to bring a local model or deliberately use a cloud assistant.

**Most important finding:** reliability, accessibility and trust must precede an ambitious AI-agent roadmap. A developer survey found that 48.0% of the 14,304 people answering its trust question said they trust AI output when they can easily verify it; that supports testing reviewable AI as a product hypothesis, not treating it as proven demand among Morrow users. The same survey reports that 76.5% of 13,162 respondents run AI output locally as a next step [1](https://survey.stackoverflow.co/2026/ai/data/ai-trust) [2](https://survey.stackoverflow.co/2026/ai/data).

**What has been added in the current 0.2.0 source:** folder browsing and bounded saved-file search, navigation, pasted-change review, a manual browser-based Arena path and optional API panel. In response to this research, the source also includes an optional Markdown preview that does not load document-specified images or links, and a limited local warning for a few possible credential patterns before an Arena API send. The warning is not a scanner or a guarantee; the preview is intentionally limited. Their Windows behavior has not been verified.

**What has not been built:** a language server, full IDE features, a multi-agent system, autonomous commands or file edits, a collaboration service, Windows ML integration, encrypted recovery, a signed release, and a complete accessibility/security audit. These remain proposals or release work, not existing capabilities.

**Next decision:** validate the current build on real Windows systems and obtain direct user feedback before adding large execution or cloud surfaces. After that, prioritize accurate search across unsaved tabs, recovery/conflict handling and accessibility; then consider opt-in language intelligence and improved model choice.

---

## 1. Scope and methodology

This is **secondary product research plus an inspection of Morrow's current code, documentation and automated tests**. We reviewed official product documentation for Notepad++, Windows Notepad, VS Code, Zed, Cursor, Obsidian and other editors; standards and guidance for language servers, Windows accessibility, privacy and AI security; and recent developer survey and GitHub reports. Public claims in vendor documentation are treated as vendor descriptions, not independent benchmark results. Sources were accessed on or before 30 October 2026 and may change.

We did **not** conduct Morrow user interviews, field studies, a representative survey, a comparative performance benchmark, an independent penetration test, or a complete Windows usability/accessibility evaluation. We have not verified a successful authenticated Arena response or a real local-model response in the current release. The developer surveys and GitHub telemetry describe their own populations, not Morrow's users. Where this report recommends a feature, its value and priority are explicitly hypotheses.

### Product constraints

- Free and open-source editor, primarily for Windows; the core editor should not require an account.
- Support both ordinary text/notes and quick source-code edits with broad syntax coloring.
- Keep AI optional and preserve clear user control over what is shared and applied. Cloud provider access may be paid or account-dependent even when Morrow itself is free.
- Aim for a responsive, modest application; do not claim comparative speed, installer size or memory superiority without reproducible Windows measurements.
- Prefer interoperable text files over a proprietary database. Recovery is helpful but is not a backup.

---

## 2. Users, jobs and positioning hypotheses

| Audience / job to be done | Current help | Important gap / research question |
|---|---|---|
| **Everyday note taker:** open or make a note, read it comfortably and find it later. | Tabs, text files, themes, basic search, optional local Markdown preview. | Is preview discoverable and readable? Can a new user understand saved vs unsaved and recovery vs backup? |
| **Developer doing a quick edit:** browse a project, find a string and save a small change safely. | Broad syntax-color catalog, folder tree, literal saved-file search, go-to-line, quick open. | Search ignores unsaved buffers; no semantic completion, diagnostics, definition or trustworthy large-file measurements. |
| **AI-assisted editor:** ask for a suggestion without surrendering control. | Session-only Ollama opt-in; manual Arena browser path; API confirmation; captured selection, diff review and undo. | Is the consent understandable? How useful is single-line completion? Can users verify changes efficiently? |
| **Accessibility- or privacy-sensitive user:** work without an account and understand data flows. | Keyboard commands, selected contrast fixes, local file editing, no Morrow account, optional AI. | Screen reader, Windows contrast themes, scaling, recovery storage and real-world threat boundaries need hands-on testing. |

**Positioning statement to test:** “A free, open-source Windows editor for notes and code. Your files remain ordinary files; AI is optional, and proposed changes are yours to review.” This is a positioning hypothesis, not a promise of total privacy or a claim that no underlying OS component ever uses the network. Morrow's optional Arena API is cloud-based; Ollama's locally addressed API can also route to cloud models [1](https://docs.ollama.com/api/authentication).

**Avoid saying:** “always offline,” “never sends data,” “secure by design,” “faster than Notepad++,” “fully private local AI,” or “production-ready” until each claim has an appropriate, tested scope.

---

## 3. Competitive landscape and implications

This compares useful product behaviors, not complete feature lists or speed measurements. Editions, availability and pricing can change.

| Product | Observed strengths | Morrow implication |
|---|---|---|
| **Notepad++** | Mature Windows text editing, search/replace across files, sessions and rich configuration. Its documented preference can search unsaved open versions instead of the disk version [2](https://npp-user-manual.org/docs/searching/) [1](https://npp-user-manual.org/docs/preferences/). | Do not market folder search as unique. Make saved-versus-unsaved search explicit and dependable; earn trust through data handling and simplicity. |
| **Windows Notepad** | Familiar, built-in text editing; Microsoft documents optional Rewrite, Summarize and Write for supported Windows Insider configurations, with Microsoft sign-in/cloud credits for the described GPT features [1](https://support.microsoft.com/en-us/windows/ai/ai-apps/enhance-your-writing-with-ai-in-notepad). | “AI in Notepad” alone is not a differentiator. Test whether transparent provider choice and reviewed edits matter, while matching basic ease of use. |
| **VS Code** | Extensive language intelligence and extensions; Markdown preview, outline and security controls for untrusted workspaces [1](https://code.visualstudio.com/docs/languages/markdown) [1](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust). | A small preview can help notes and READMEs. Any future code execution or server integration needs an explicit trust boundary; do not copy the entire IDE. |
| **Zed** | Edit prediction supports multiple providers including local/self-hosted options; its UI offers partial acceptance and configurable behavior [1](https://zed.dev/docs/ai/edit-prediction). | Provider choice, flexible acceptance and low-friction interaction are plausible future improvements, but Morrow's present single-line completion is much narrower. |
| **Cursor** | Agent-oriented development and documented organizational controls including privacy and agent protections [1](https://cursor.com/docs/enterprise/security-hardening). | Agent features bring operating, authorization and security obligations. Review and least privilege must be structural, not just prompt wording. |
| **Obsidian** | Markdown notes remain plain files in a local folder and can be edited by other tools [1](https://obsidian.md/help/data-storage). | Keep Morrow's files portable; do not introduce lock-in just to add notes features. A preview is useful without becoming a whole knowledge-management platform. |

**Gap rather than parity:** Morrow's chosen niche is an approachable *small-editor workflow with intentional AI*. It cannot currently claim feature parity with any mature competitor. It must first prove that open, edit, save, recover and search are dependable on Windows.

---

## 4. Evidence-led trends and decisions

### A. Verification and model choice are more useful than AI novelty

The Stack Overflow 2026 survey shows substantial conditional trust in AI and self-reported verification practices; it is not a random sample of all editor users [1](https://survey.stackoverflow.co/2026/ai/data/ai-trust) [2](https://survey.stackoverflow.co/2026/ai/data). GitHub reports that 61% of Copilot users who selected a model themselves used more than one model across sessions in September 2026; that is a GitHub-specific population, not evidence that 61% of Morrow users need multi-model UI [1](https://github.blog/news-insights/octoverse/octoverse-commits-pushes-reach-new-highs-in-2026-as-developers-build-with-agents/).

**Decision:** keep explicit capture, compare, reject, apply and undo. Make possible costs and provider/data routes visible. Test a small number of provider choices only after real user demand and authentication are verified. Do not add autonomous command execution to make AI appear more advanced.

### B. Local address does not equal local inference

Ollama's own documentation demonstrates a cloud model invoked through `http://localhost:11434` after sign-in [1](https://docs.ollama.com/api/authentication). Morrow cannot infer where computation occurred merely from the loopback URL or the model name.

**Decision:** say what Morrow sends to Ollama, warn that Ollama can route to cloud models, and point people to their model/configuration and Ollama's cloud controls. Do not promise on-device processing unless the complete path is verified. The recommended local model is downloaded separately and performance varies.

### C. Language intelligence is valuable but crosses a trust boundary

LSP standardizes editor-to-language-server messages for completion, definitions and related features [1](https://microsoft.github.io/language-server-protocol/). A server is an executable with its own behavior; running it can expose workspace contents or execute workspace-controlled configuration.

**Decision:** research an opt-in, per-language LSP adapter only after core reliability and Windows testing. Never auto-download or auto-run an unknown server. Show the executable, source, requested folder and whether it can use the network; provide stop/revoke controls. A simple approval dialog alone is not a sandbox. Start with user-installed servers and document residual risk.

### D. Hardware-accelerated local AI is promising, not a requirement

Microsoft describes Windows ML/ONNX Runtime execution on CPUs, GPUs and NPUs, with OS and execution-provider differences and possible separate model/provider distribution [1](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview).

**Decision:** treat Windows ML as a future experiment, not a shipped feature or a reason to require new hardware. Compare cold start, download size, RAM, battery and quality against the existing optional Ollama path; always offer an AI-free editor and a CPU-compatible route if supported. Confirm model license and provenance before any distribution.

### E. Agents and MCP increase the attack surface

OWASP reports real AI/agent incidents involving excessive permissions, prompt injection and exfiltration; its report is illustrative rather than exhaustive [1](https://genai.owasp.org/2026/04/14/owasp-genai-exploit-round-up-report-q1-2026/). MCP is a protocol for connecting tools and data, not an AI provider; its specification calls for consent and warns that tools can execute arbitrary code [1](https://modelcontextprotocol.io/specification/2026-07-28).

**Decision:** defer MCP and autonomous agents. If investigated later, separate read, write, command and network capabilities; scope each operation; show exact destination and changes; require approval for consequential actions; and maintain an audit trail without silently collecting content. User consent is necessary but not sufficient against malicious code or prompt injection.

---

## 5. Current product-quality assessment

| Quality | Current evidence | Remaining risk / next action |
|---|---|---|
| **File integrity** | Native save checks the expected hash and uses a same-directory temporary replacement; review applies to the buffer as one undoable transaction. | Windows filesystem, ACL, lock, network share, crash and time-of-check races remain. Test and document; never advertise a transactional guarantee. |
| **Recovery** | Local snapshots, failure warnings and opt-out/removal behavior exist. | Snapshots are unencrypted, may miss recent edits, and are not backups or secure erase. Verify abrupt termination and low-disk-space scenarios on Windows. |
| **Search and navigation** | Folder search is bounded, literal, read-only and explicitly searches saved files; results can navigate. | Unsaved buffers may diverge; limits and skipped items can make results incomplete. Prioritize explicit buffer-aware search and source labels. |
| **AI review** | One captured range is compared before acceptance; stale targets are rejected; API requests require consent. | Authenticated Arena success and a real local model are not verified; model results can be wrong, and users can still send secrets. |
| **Privacy** | AI is off on each launch; API key is held only for the session and cleared when the dialog closes; recent paths default off. | Ollama may route to cloud; local recovery contains plaintext; file-access scopes can persist. The credential heuristic is incomplete and may produce false positives. |
| **Markdown** | Optional preview renders unsaved buffer text with a worker and inert allowlisted nodes. Images and links are disabled; raw HTML is text. | Limit 150,000 UTF-16 code units, 5,000 nodes and eight seconds; not a full compatibility or security audit. Linux native and Chromium were exercised, Windows WebView2 was not. |
| **Accessibility** | Selected color-contrast and keyboard-focus fixes; some controls carry names and roles. | No full keyboard, Narrator/NVDA, high-contrast, scaling or screen-reader audit. Microsoft's guidance calls for programmatic access, keyboard operation and contrast testing [1](https://learn.microsoft.com/en-us/windows/apps/develop/accessibility). |
| **Performance** | Preview parsing is isolated in a worker and language modes are loaded on demand. | No representative Windows measurements. A Vite bundle chunk exceeds its 500 kB warning threshold; this is not itself a startup benchmark. |
| **Distribution and supply chain** | Public source, lockfiles, Windows CI workflow and an unsigned prior installer exist. | No verified 0.2.0 Windows installer or signed release yet; a Linux-only `glib` advisory remains in the lockfile. Complete license/SBOM review and signing/reputation work before broad distribution. |

The current Windows installer configuration uses a WebView2 download bootstrapper when the runtime is missing; that can require internet. Tauri documents a larger offline-installer option as an alternative [1](https://v2.tauri.app/distribute/windows-installer/). Signing helps identify the publisher but does not guarantee SmartScreen reputation or user trust.

---

## 6. Prioritized roadmap

Effort and priority below are **relative estimates**, not dates, funding commitments or validated demand. Sequence dependencies matter more than adding many features.

### P0 — Release and trust gate: before recommending everyday use

1. **Real Windows validation (medium):** build and install on clean Windows 10/11 x64; test WebView2 availability, file association, multiple open/save, folder scope, external-change conflict, close/reopen, recovery failure, Unicode, preview worker and Arena consent/errors. Publish exact OS/build/test results and checksums.
2. **Security and distribution (medium/large):** review native filesystem and IPC boundaries, sandbox assumptions, persisted scope, dependency advisories, licenses and a full SBOM; pin/review CI actions and use least-privilege workflows. Plan a reproducible, signed and timestamped release and an update policy. GitHub recommends full commit-SHA pinning for third-party actions, with an explicit update process [2](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/using-pre-written-building-blocks-in-your-workflow).
3. **Accessibility pass (medium):** keyboard-only operation of all dialogs and lists, visible focus, screen-reader names/announcements, Narrator/NVDA testing, 200% scale and Windows contrast themes. Fix failures before claiming conformance.
4. **Measure instead of speculate (medium):** perform the benchmark plan below; choose budgets after establishing a baseline. Address regressions before feature expansion.
5. **Provider validation (small/medium, access-dependent):** with the owner's consent and a test account, verify a successful eligible Arena API request, rejection/timeout/cancel, cost disclosure and retention links. Test one actual local Ollama model separately. Do not log secrets or real private content.

**Exit criteria:** all release-blocking data-loss and security issues resolved; limitations documented; Windows test results reproducible; a maintainer can identify and verify the release artifact. Signing may require organizational setup and expense, so an unsigned preview must be visibly labeled if shared earlier.

### P1 — Everyday editing quality: next after the gate

1. **Search unsaved open buffers (medium):** offer a clear choice between current editor buffers and saved files. Label each result's source, avoid duplicate results for the same file, snapshot a revision and warn if a result goes stale. Never change disk during search. Test Unicode columns, renamed/closed tabs, external edits, cancellation and limits.
2. **Recovery and conflict UX (medium):** show whether a recovery copy is current and allow deliberate comparison/recovery of disk versus draft. Keep backups separate; do not overwrite a newer file silently. Explore encrypted, opt-in recovery only after key-management design and migration tests.
3. **Markdown outline and navigation (small/medium):** identify document headings, skip fenced code, move keyboard focus and jump without editing. No file indexing or external resources required. Verify accessibility and large-input limits. This is proposed; it is not present now.
4. **Configurable search exclusions and scope clarity (medium):** preview excluded directories and truncation, offer safe per-folder settings, and distinguish a view being closed from native permission revocation. Explore a reliable revoke path before promising one.
5. **Windows ergonomics (medium):** test DPI and contrast themes, improve dense/narrow layouts, and ensure discoverable save, preview and keyboard actions.

**Acceptance:** users can tell which version they searched or are about to save; tests demonstrate no silent file mutation or loss on the supported cases. User studies must verify discoverability rather than relying only on automated tests.

### P2 — Better optional AI: after basic trust and provider verification

1. **Review-first AI improvements (medium):** evaluate partial or multi-line suggestion acceptance with clear undo and cancellation. Keep suggestions distinguishable from saved text. Never apply generated output in the background.
2. **Context and destination controls (medium):** show the exact selected excerpt/instruction, destination and model before sending. Preserve explicit consent; improve the current basic credential warning only with measured false-positive/negative tests. Never claim it finds all secrets or personal data.
3. **Provider-neutral design (medium/large):** an internal adapter interface can support optional providers without bundling them or binding the editor to one vendor. Disclose pricing, model availability and data policies individually; website login is not an API key. Model comparisons should not secretly send the same text to multiple providers.
4. **Local model setup and diagnostics (medium):** guide users through installed/missing model, compatible FIM format, local versus cloud configuration, cancellation and timeout. No model is silently downloaded.

**Acceptance:** every outbound request has a clear user action and destination; stale suggestions cannot apply; tests cover cancellation and undo. Measure quality and latency using a consented, synthetic benchmark before expanding default context.

### P3 — Optional language intelligence and hardware R&D

- Prototype **user-installed LSP servers** for one or two high-demand languages, separately from syntax highlighting. Include process/network controls, workspace trust, disable/stop and resource limits; test malicious or misconfigured workspaces. Do not auto-run tools from project files.
- Explore **Windows ML/ONNX** for a small opt-in local model only if it improves measured user outcomes and does not make a large download mandatory. Test CPU fallback, GPU/NPU availability, model license, battery and uninstall/cleanup.
- Consider local, disposable indexing or symbol navigation only with user control over scope, exclusions and index deletion. Index contents can be sensitive.

**Gate:** direct-user evidence plus a security design review; no feature graduates merely because it uses a newer technology.

### Later / do not commit yet

Real-time collaboration, CRDT synchronization, multi-agent orchestration, plugin marketplaces, remote execution, automatic terminal commands and multi-file autonomous editing are possible research topics, not scheduled features. They add identity, permissions, conflict, supply-chain, moderation and operational burdens. A CRDT does not by itself provide encryption or access control. Revisit only after sustained demand and a credible maintenance/security plan.

---

## 7. Suggested research and validation plan

### A. Recruit for learning, not statistical proof

Recruit roughly 12–15 Windows volunteers: people who mainly write notes, developers who make quick edits, and people using assistive technology or high display scaling. These are proposed starting numbers, not a representative sample. Avoid asking participants to expose personal files; use synthetic fixtures. Ask informed consent before recording screens or collecting feedback, and allow participation without telemetry.

Run comparable tasks on the latest Morrow build and, where appropriate, each person's usual editor:

1. Open a Markdown file, make an unsaved change, use preview and save it somewhere new.
2. Open a folder, find a term, identify whether the result is from disk or an unsaved buffer, then navigate to it.
3. Simulate an external file change and recover a draft without overwriting the newer version.
4. Select synthetic code, use the manual browser workflow or a fake AI response, review and undo a replacement.
5. Repeat essential tasks with keyboard only; separately test with Narrator/NVDA, Windows contrast themes and 200% scaling.

Record completion, help needed, wrong assumptions, recoverability and qualitative comments—not document contents. An initial working target could be **at least 80% independent completion per core task** with no observed silent data loss; these are proposed thresholds for deciding what to improve, not measurements or proof of accessibility. Review failures and individual accessibility findings even if the average looks good.

### B. Reproducible Windows benchmark proposal

Document CPU, RAM, storage, GPU, Windows build, power mode, WebView2 version, display scale, Morrow commit and AI/recovery state. Use synthetic UTF-8 files and identical scenarios. Measure cold and warm start to interactive editor, idle/peak memory, time to open and search 1/5/20 MiB text and a 5,000-file folder, edit latency, Markdown preview behavior, and save duration. Include a low-resource and a typical machine; run multiple repetitions and report median plus range. Account for OS caching and compare other editors only with their versions, settings and workloads disclosed.

Do not set a “fastest” claim based on browser screenshots or Linux runs. Establish a baseline first; then agree on budgets and track regressions in CI where meaningful. A real AI benchmark should report model, context, hardware, warm-up, first-token and completion latency, memory, qualitative usefulness and failure rate separately.

### C. Privacy-respecting signals

Default to no product analytics. Use optional issue reports, opt-in interviews and locally generated diagnostics that the user can inspect and redact before sharing. Never include file contents, paths, API keys or model prompts by default. Track: reproducible crash/data-loss reports, task completion in studies, accessibility blockers, opt-in feature requests, and release-test coverage. Do not confuse GitHub stars with retention or user satisfaction.

---

## 8. Product decisions and open questions

**Decisions embodied in this iteration**

- Keep standard text files and an AI-free path.
- Make AI suggestions session-only and cloud sends explicit; show changes before applying.
- Ship a deliberately limited offline Markdown preview rather than rendering arbitrary HTML or fetching document images.
- Add a small local credential-pattern warning for Arena API text, with prominent limitations.
- Treat safety, Windows testing and accessibility as prerequisites for bigger features.

**Questions to validate with actual users**

1. Do most people need an exceptionally small quick editor, or a broader IDE with semantic navigation? Where is the line they do not want Morrow to cross?
2. Should folder search default to unsaved buffer contents, saved files, or ask the user? What labels make the difference clear?
3. Would Markdown outline, split view, snippets or keyboard customization save more time than AI expansion?
4. Which specific languages and user-installed servers are worth supporting first? What execution permissions are acceptable?
5. Is Arena access available to target users, and do they understand that website sign-in, API eligibility and pricing are separate?
6. What recovery, privacy and accessibility expectations are non-negotiable for real users?

---

## Source guide

Primary sources linked throughout include the 2026 Stack Overflow developer survey, GitHub Octoverse, Notepad++ manual, Microsoft Notepad and Windows ML documentation, VS Code documentation, Zed documentation, Cursor security guidance, Obsidian storage documentation, Ollama documentation, LSP, MCP, OWASP and Microsoft accessibility guidance. The survey, GitHub telemetry and vendor claims have different populations and methods; none is a direct measure of Morrow demand. See also the earlier `RESEARCH-AND-ROADMAP.md`, the project README and `THIRD_PARTY_NOTICES.md` for technical and licensing details.
