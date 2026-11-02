# Pinch product roadmap proposal

This proposal is grounded in the actual repository evidence for `RANJITHROSAN17/morrow-editor` as of 2026-11-02. The repo is a Windows-first local-editor product, not a Pinch assistant product yet, but it demonstrates the architectural patterns that are consistent with Pinch’s intended direction: local-first defaults, optional local AI, explicit approval for sensitive actions, strong file-safety guardrails, and honest documentation of limits.

The roadmap below translates those patterns into a product strategy for Pinch rather than a feature list for the editor. It intentionally does not assume that a merged change is finished or a closed issue means a user journey is complete.

## A. Executive summary

Current strengths:
- The repo already expresses the right product posture: local-first defaults, explicit AI consent, default-off AI, local file recovery with warnings, and a documented security policy.
- The architecture is lightweight and maintainable: TypeScript frontend, Tauri shell, file-scoped native operations, worker-based Markdown preview, and focused unit + build validation.
- The project has contributor hygiene: CI, roadmap validation, issue templates, contributor docs, and a public “what is not verified” posture.
- The repo’s release process is conservative and transparent: unsigned preview binaries, checksums, and explicit honesty about missing consumer Windows/security validation.

Major gaps relative to the Pinch product direction:
- No evidence of a continuously available Windows companion, continuous background service, tray/widget or wake activation.
- No visible, controllable microphone use or speech output model, despite the product direction explicitly requiring opt-in voice capability.
- No end-to-end workflow for assistant memory, retrieval or saved preferences with portability and export/import decisions.
- No robust permission boundary model for app, file, clipboard, and system-task automation beyond isolated file I/O and editor operations.
- No evidence of non-technical setup, onboarding, recovery, or update/uninstall experience for a real end-user assistant product.
- The roadmap is mainly issue-driven and feature-oriented rather than product-outcome-oriented; it does not clearly distinguish “implemented”, “validated”, and “ready for user-facing release”.

Recommended direction:
- Keep the repo’s local-first, privacy-respecting posture as the core brand.
- Treat the “assistant” as a lightweight, reliable Windows companion, not a chat app with a website wrapper.
- Prioritize a small set of user journeys that finish reliably: quick notes, file/task recall, safe clipboard actions, basic system tasks, and local-model assistance.
- Build the voice stack only behind explicit consent and visible microphone indicators; do not require cloud audio or general LLM chat features to claim product value.
- Use the existing repo mindset as a model: explicit consent, bounded actions, honest limitations, and small validated increments.

## B. Evidence-backed current-state matrix

| Product area | Repo evidence | State | Assessment |
| --- | --- | --- | --- |
| Local-first defaults | `src/storage.ts`, `README.md`, `docs/USER-GUIDE.md`, `src/ai.ts` | Implemented in main | Local session recovery and file storage are default-on, with explicit opt-out and warnings. AI suggestions are default-off and require explicit per-session consent. Strong alignment with Pinch’s default-local privacy posture. |
| Windows desktop shell | `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `README.md` | Implemented in main | Tauri-based Windows desktop app exists. It is a native shell with file associations and packaged installer. The repo does not yet show a tray or background companion service. |
| Optional local AI | `src/ai.ts`, `docs/USER-GUIDE.md`, `README.md` | Implemented in main, but not deeply validated on hardware | Local Ollama integration exists, with explicit start-of-session consent, bounded context windows, and local loopback-only calls. This is a good base for Pinch but not yet a complete assistant runtime. |
| Voice interaction | No `microphone`, `speech`, `wake-word`, or voice pipeline files found in repo. | Not implemented | The product direction requires optional, visible and controllable microphone use. There is no repository evidence of this yet. This is a required product gap, not an incidental missing feature. |
| Task automation / app integration | `src/workbench.ts`, `src/platform.ts`, `src-tauri/src/*` | Partial, file-focused | Native file reads, writes, folder browsing, and file safety checks exist. There is no evidence of app automation, clipboard integration, reminder system, or permission model for arbitrary app actions. |
| Sensitive actions approval | `src/sensitive-text.ts`, `README.md`, `SECURITY.md`, `docs/USER-GUIDE.md` | Implemented in main | Secret-shape heuristics and user confirmation for AI requests exist. This matches Pinch’s explicit approval requirement, but it is a heuristic layer, not a full action authorization framework. |
| Memory / retrieval / persistence | `src/storage.ts`, `src/workbench.ts` | Partial | Recovery and recent files exist, but not a user-facing memory layer with retrieval, long-term context, exportability, or specific trust boundaries. |
| Windows tray/widget/startup | No repo evidence found in code search or docs. | Not implemented | No startup recovery, background life-cycle, tray visibility, or wake/sleep handling evidence in the repo. This is a major product gap for Pinch. |
| Security and privacy docs | `SECURITY.md`, `docs/USER-GUIDE.md`, `README.md` | Implemented in main | Security policy and honest limitations are unusually good for a preview product. This is a strong base for Pinch’s trust model. |
| CI and validation | `.github/workflows/ci.yml`, `scripts/validate-roadmap.js`, `tests/*.test.ts` | Implemented in main | CI validates unit tests and roadmap structure. It does not yet validate real Windows hardware behavior, accessibility, or assistant UX tasks end-to-end. |
| Release quality and hardware validation | `.github/workflows/windows.yml`, `docs/IMPLEMENTATION-0.4.0.md` | Implemented but insufficiently tested | The repo reports a Windows installer and synthetic validation, but it explicitly says consumer Windows, accessibility, and security outcomes remain unverified. This should remain a release gate, not a claim of completion. |
| Contributor attribution / maintainership | `README.md`, `CONTRIBUTING.md`, `.github/CODEOWNERS` | Implemented | Good contributor and maintainer expectations are documented. This supports a product with sustainable maintenance and avoids “fork-by-accident” confusion. |

State labels used below:
- Implemented in main
- Implemented but insufficiently tested
- Documented but missing or inconsistent
- Present only in an open PR
- Experiment / prototype
- Not implemented
- Unknown because evidence unavailable

## C. Existing roadmap reconciliation table

| Existing item / repo signal | Evidence | Current state | Recommendation |
| --- | --- | --- | --- |
| Roadmap queue and issue bot | `.github/roadmap.json`, `scripts/validate-roadmap.js`, `.github/workflows/contributor-queue.yml` | Implemented in main | Keep the queue for contributor-friendly work, but it is not a product roadmap. It is a backlog queue, not a user-outcome plan. Use it alongside, not instead of, the product roadmap. |
| Local-first AI suggestions | `src/ai.ts`, `README.md`, `docs/USER-GUIDE.md` | Implemented in main | Complete for the editor; revise for Pinch as “local model default + human approval for any side effect.” Do not expand it to full cloud chat. |
| File safety / session recovery / external change detection | `src/storage.ts`, `src/platform.ts`, `README.md`, PR #36 | Implemented in main; some aspects recently landed | Complete enough to carry into Pinch’s local-memory and safety model. Validate with real Windows behavior before claiming “production ready.” |
| Sensitive-text heuristics | `src/sensitive-text.ts`, tests, PR #33 | Implemented in main | Complete as an early heuristic, not a full data-loss prevention layer. Keep as a stopgap until explicit action policy exists. |
| Browser preview / web UI | `README.md`, `index.html`, `vite.config.ts` | Implemented in main | Useful for UI iteration, but not product value for Pinch. Treat it as a development tool only. |
| Release pipeline and installer | `.github/workflows/windows.yml`, `README.md` | Implemented but insufficiently tested | Good for preview distribution; not enough to claim “release-ready.” Continue only with strict hardware validation and explicit caveats. |
| Product research and implementation docs | `docs/PRODUCT-RESEARCH-2026.md`, `docs/IMPLEMENTATION-0.4.0.md` | Documented | Useful context, but not a replacement for a user-centric product roadmap. They are evidence, not a plan. |
| Voice / microphone support | No supporting code or docs | Not implemented | Defer until Pinch has a clear use case and explicit consent model. Adding it before the assistant can safely act is product risk. |
| Continuous background assistant | No repo evidence found | Not implemented | This is the largest missing product capability. It must be addressed earlier than a broad AI feature list. |

Key reconciliation conclusion: the repository’s roadmap is solving editor-quality issues, not making a general-purpose assistant product. The correct product direction for Pinch is to preserve the same constraints and safety posture while extending them to assistant workflows.

## D. Prioritized NOW / NEXT / LATER roadmap

### NOW (next small delivery cycle)

1. Title: Build the “local-first assistant shell”
   - User problem: Users need a continuously available, low-friction assistant on Windows without cloud dependence or constant chat UI.
   - Evidence: `src-tauri/tauri.conf.json`, `src/storage.ts`, `src/ai.ts`, `README.md` show the repo already uses a native shell and explicit consent patterns.
   - Current implementation state: Implemented in main for desktop shell and local AI hints; missing a true long-lived assistant service / tray presence.
   - Scope: app window + tray or compact widget, startup state restoration, background lifecycle handling, visible local model status, and portable settings.
   - Non-goals: full chat UI, social features, browser-based assistant, automatic cloud audio, plugin marketplace.
   - Priority: P0 / must-have
   - Dependencies: define product scope, confirm Windows tray APIs, agree on startup/recovery semantics.
   - Acceptance criteria: app launches minimized or hidden, state restores reliably, status is obvious, no silent cloud call occurs, user can disable/enable assistant without restarting.
   - Validation: unit tests for state restore, manual Windows tray validation, startup/recovery smoke test.
   - Security/privacy: no hidden microphone or cloud access; explicit local model selection; no execution without consent.
   - Effort: small-to-medium (2–4 weeks if focused)
   - Success measure: user can start app, keep it backgrounded, and resume without losing context; launch time and recovery remain under a defined threshold.

2. Title: Action consent framework for sensitive tasks
   - User problem: Users need trust when the assistant can touch files, apps, clipboard, reminders, or commands.
   - Evidence: `src/sensitive-text.ts`, `README.md`, `SECURITY.md`, `docs/USER-GUIDE.md` already establish a warning pattern and explicit consent posture.
   - Current implementation state: Implemented as heuristics and approval approach; not yet a full task authorization model.
   - Scope: action manifest, user override flows, safe defaults, explain-before-execute, linting for high-risk operations.
   - Non-goals: autonomous execution, plugin trust laundering, broad script access without approval.
   - Priority: P0 / must-have
   - Dependencies: define risk classes (read only, file write, app launch, clipboard, system commands, network).
   - Acceptance criteria: no file or system operation executes without explicit approval; every action renders a plain-language summary; deny and reauthorize flows work.
   - Validation: unit tests for consent gating, manual validation with safe file and clipboard tasks on Windows.
   - Security/privacy: prevents silent data leakage, direct file writes, and execution of hidden commands.
   - Effort: medium (2–6 weeks)
   - Success measure: all high-risk actions require visible approval and produce a clear audit trail with no silent side effects.

3. Title: Local memory, preferences, and portability model
   - User problem: Users need a stable assistant memory that is local by default and portable when they choose.
   - Evidence: `src/storage.ts` already persists settings and session data locally, with warnings about unencrypted local storage.
   - Current implementation state: Partial; there is session persistence, but not a formal assistant memory architecture.
   - Scope: local memory store, retrieval boundaries, export/import, clear-all, and privacy controls.
   - Non-goals: remote sync, account-based cloud memory, cross-device onboarding, hidden telemetry.
   - Priority: P0 / must-have
   - Dependencies: product decision on what counts as memory (notes, reminders, preferences, context).
   - Acceptance criteria: users can export or clear memory, understand data location, trust the boundary, and recover preferences reliably.
   - Validation: tests for storage schema, quota fallback, and export/import flows; manual validation on Windows profile directories.
   - Security/privacy: keep data local by default; no secret collection; clear retention boundaries.
   - Effort: small-to-medium (2–4 weeks)
   - Success measure: users understand what is stored locally and can move or clear it without support.

### NEXT (after NOW succeeds)

4. Title: Local model selection, responsiveness and realistic hardware targets
   - User problem: Users need their model choice to align with their hardware without hidden performance or quality failures.
   - Evidence: `src/ai.ts` uses local Ollama with explicit model selection and bounded context. This is a sound foundation.
   - Current implementation state: Implemented in main for local suggestions; requires product-level standardization and UX polish.
   - Scope: model catalog, quality/speed settings, CPU/GPU fallback, model download guidance, explicit “why this model is slower” messaging.
   - Non-goals: cloud-model fallback as default, broad model marketplace, performance benchmarking claims without measurements.
   - Priority: P1
   - Dependencies: clear hardware target matrix and user educational content.
   - Acceptance criteria: users can choose a model for their hardware, see expected cost and responsiveness, and know when the assistant is running on a local model.
   - Validation: measured latency and token/budget tests without exposing sensitive content; manual verification on representative Windows machines.
   - Security/privacy: no hidden model routing or telemetry; explicit local API endpoints only.
   - Effort: medium (3–6 weeks)
   - Success measure: model choice remains understandable, local-first, and predictable across supported hardware.

5. Title: Opt-in speech and wake activation with visible control
   - User problem: Users want optional hands-free interaction without sacrificing visibility, trust, or privacy.
   - Evidence: there is no current voice stack in repo; this is a new Pinch capability.
   - Current implementation state: Not implemented.
   - Scope: visible microphone indicator, explicit grant, per-session voice consent, wake phrase or shortcut activation, spoken output and interruption handling, speech fallback.
   - Non-goals: always-on listening, cloud transcription by default, voice as the only interaction mode.
   - Priority: P1
   - Dependencies: model/hardware decisions, accessibility review, user trust UX.
   - Acceptance criteria: mic is off by default; user can turn it on with clear visible state; actions execute only after confirmation; output can be interrupted.
   - Validation: manual testing on real microphones with explicit consent; accessibility testing for non-visual cues.
   - Security/privacy: no silent capture; audio data remains local or clearly disclosed; no background recording by default.
   - Effort: medium-to-large (4–8 weeks)
   - Success measure: voice is a reliable optional mode, not a privacy or trust risk.

6. Title: Safe app, file, clipboard, and system-task bridge
   - User problem: Users need the assistant to help with real work without handing it unrestricted system access.
   - Evidence: current repo has file system and security guardrails but no broader app automation or clipboard/task automation framework.
   - Current implementation state: Partial file interaction only.
   - Scope: clipboard read/write consent, app-level actions, safe file operations, reminders, and named system tasks with explain-before-execute.
   - Non-goals: unrestricted remote control, background process injection, broad plugin execution, or networked app control without approval.
   - Priority: P1
   - Dependencies: permission model, action catalog, risk classification.
   - Acceptance criteria: every task is clearly described before execution; unsafe actions are blocked; user can revoke permissions per app or capability.
   - Validation: unit tests for action manifest; manual Windows validation for clipboard, file, and reminder flows.
   - Security/privacy: least-privilege boundaries and scoped permissions are mandatory.
   - Effort: medium-to-large (4–8 weeks)
   - Success measure: users can complete focused tasks without confusion, and risky tasks remain gated and observable.

### LATER (valuable but requires more evidence)

7. Title: Personal memory retrieval and task recall
   - User problem: Users want the assistant to remember preferences and relevant context without creating a hidden surveillance system.
   - Evidence: repo has session persistence but not recall or retrieval architecture.
   - Current implementation state: Not implemented.
   - Scope: memory retrieval from local notes, recent tasks, and saved preferences; user-visible choice of what is remembered.
   - Non-goals: cross-device sync, automatic recording of all conversations, or opaque model memory without user controls.
   - Priority: P2
   - Dependencies: memory model and privacy policy decisions.
   - Acceptance criteria: retrieval is explainable and limited to user-approved data.
   - Validation: manual tests for recall quality and privacy clarity.
   - Security/privacy: explicit retention controls and local-only defaults.
   - Effort: medium (3–6 weeks)
   - Success measure: users can understand and manage memory without confusion.

8. Title: Reminders and lightweight scheduling
   - User problem: Users need simple commitments without a full productivity suite.
   - Evidence: not present in repo; this is a realistic Pinch capability but not yet implemented.
   - Current implementation state: Not implemented.
   - Scope: simple reminder mechanisms with local storage, snooze, and visible notifications.
   - Non-goals: calendar sync, team scheduling, or integrated CRM.
   - Priority: P2
   - Dependencies: local background service and notification model.
   - Acceptance criteria: reminder is visible and actionable; no silent background triggers.
   - Validation: manual tests for reminder timing and notification behavior.
   - Effort: medium (2–5 weeks)

9. Title: Portable preferences and data export
   - User problem: Users need to move safely between machines or reinstall without losing preferences.
   - Evidence: repo already stores local settings and documents; exportability is not clearly designed.
   - Current implementation state: Partial.
   - Scope: export/import of settings, local memory, and assistant preferences.
   - Non-goals: cloud backup as the primary path.
   - Priority: P2
   - Dependencies: memory model and policy.
   - Acceptance criteria: users can export and restore data, and the app warns about what is not portable.
   - Validation: schema tests and manual run-through on clean installation.

### DEFER / DO NOT BUILD

10. Title: Browser-first “chat website” as the product
   - Reason: This contradicts the repo’s product direction and local-first values. It would weaken trust and turn Pinch into a commodity web assistant.
   - Keep out of roadmap.

11. Title: Cloud audio by default / microphone always-on
   - Reason: This violates user trust, privacy, and visibility requirements. A cloud speech pipeline is optional only if clearly disclosed and user-approved.

12. Title: Feature copy from competitor assistants without user value validation
   - Reason: The repo specifically calls for not copying competitor features without establishing value. This is a guardrail to keep Pinch distinct.

13. Title: Broad plugin marketplace or arbitrary automation sandbox
   - Reason: This increases trust, security, and maintenance risk without proven user demand.

## E. Top five risks and release/validation gates

1. Risk: “Local-first” is not actually local.
   - Gate: every model request, reminder, and action must show its local-only or explicit network boundary before execution.

2. Risk: background app/service lifecycle breaks trust.
   - Gate: app startup, tray recovery, and wake state must be manually tested on Windows across reboot, sleep, and user sign-in scenarios.

3. Risk: assistant actions create hidden side effects.
   - Gate: all file, clipboard, app, or command actions must pass the approval model and produce plain-language audit logs.

4. Risk: the product is treated as “AI app” rather than “personal assistant.”
   - Gate: user journeys must be evaluated for real task completion, not feature count or model bragging rights.

5. Risk: documentation says “verified” when only synthetic or headless checks ran.
   - Gate: all launch, microphone, and hardware claims must be separated into “verified”, “inferred”, and “unverified” states.

Release requirements:
- Local-first mode is the default.
- Any sensitive action has explicit user approval and a visible human-readable summary.
- No cloud audio or web chat is required for the core product.
- Windows tray/background lifecycle is validated on real hardware.
- Data export/clear and retention policies are documented and tested.
- Security policy and release notes are updated before any wider distribution.

## F. The first three actionable GitHub issue drafts

1. Issue title: “feat: add a local-first assistant shell with tray status and startup restore”
   - Problem: Pinch needs a visible, continuously available Windows presence that does not require chat UI or cloud dependence.
   - Scope: app lifecycle, tray/status area, startup state, and local assistant status.
   - Acceptance: app can remain lightweight and visible; restarting preserves the user session and shows clear local status.

2. Issue title: “feat: add explicit action consent for file writes, clipboard, and app launch operations”
   - Problem: sensitive actions must never run silently or without user comprehension.
   - Scope: action builder, user consent modal, audit log, and permission model for risky actions.
   - Acceptance: no side effect occurs without an explicit approval step; each action is described in plain language.

3. Issue title: “feat: define local memory and export/clear controls before any durable assistant memory ships”
   - Problem: The product needs a clear memory boundary that is local by default, portable when chosen, and understandable by users.
   - Scope: memory schema, retention settings, export/import, and clear-all flow.
   - Acceptance: storage is local by default, users can inspect or remove it, and the app explains what is remembered.

## G. Unknowns and questions requiring maintainer decisions

- Is Pinch a desktop-only Windows product or a cross-platform app with Windows as the initial target?
- Is the “assistant” allowed to act on apps, clipboard, and files, or should it remain a highly bounded recommendation and note-taking assistant first?
- What is the acceptable default window: always-visible, compact tray companion, or background service with user-invoked pop-up?
- Is voice support a later mode or a near-term requirement for v1? If near-term, is it local transcription only or also local speech output?
- What constitutes “sensitive” enough to require extra approval beyond file and clipboard access?
- What is the retention policy for assistant memory, reminders, and command history?
- Is export/import of local data mandatory before any beta release, or optional for early previews?
- What is the minimum supported Windows baseline for real hardware validation?

## H. Checks run, exact results and checks not performed

This environment does not provide a local shell or file execution capability for this repository. I therefore did not execute `npm test`, `npm run build`, or any Windows-specific validation commands in the API environment.

Repository evidence for intended validation is nonetheless explicit in the code and workflows:
- `.github/workflows/ci.yml` declares: `node scripts/validate-roadmap.js .github/roadmap.json`, `npm test`, `npm run build`.
- `.github/workflows/windows.yml` declares: `npm run build`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked`, Playwright tests, and installation artifact builds for Windows.
- `docs/IMPLEMENTATION-0.4.0.md` states the project had synthetic validation and an unsigned Windows install run, but also states that consumer Windows, accessibility, and security validation remained incomplete.

Therefore, the validation status is:
- Verified from repo evidence: workflow and unit-test gates are configured.
- Inferred from docs: some synthetic or VM validation happened.
- Unverified in this environment: all real Windows, microphone, and hardware behavior claims, as well as release-readiness claims.

The product roadmap above is therefore evidence-based but intentionally conservative: it uses repo evidence as ground truth and treats any release claim requiring hardware validation as unverified until a real Windows test confirms it.

## File evidence used

- `README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `ROADMAP-STATUS.md`
- `.github/roadmap.json`
- `.github/workflows/ci.yml`
- `.github/workflows/windows.yml`
- `docs/IMPLEMENTATION-0.4.0.md`
- `docs/USER-GUIDE.md`
- `src/ai.ts`
- `src/platform.ts`
- `src/storage.ts`
- `src/sensitive-text.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- PR #33, #36, and the current open/closed issue history in the repo metadata

This proposal should be treated as a product strategy document for Pinch, not as a command to rebuild existing editor features. It preserves the repository’s strengths—local-first defaults, user approval, bounded file access, honest limits, and maintainable architecture—while redirecting the roadmap toward the real user outcome: a trusted local Windows assistant that helps without demanding cloud services or careless automation.
