# Morrow Editor validation report

**Date:** 13 November 2026 UTC  
**Repository:** `RANJITHROSAN17/morrow-editor`  
**Audited commit:** `61926de80f2f4f0386666ad660fa35213fcc421d`  
**Purpose:** record what was actually validated after the architectural audit, distinguish automated evidence from blocked manual work, and connect every remaining gap to an open issue.

This report is intentionally not a certification. A successful unit test, CI run or static check is evidence for the tested boundary only; it is not evidence that the whole desktop product is secure, fast, accessible or competitive.

## Executive status

### Completed or reproduced

- The Windows x64 GitHub Actions preview run [43499385141](https://github.com/RANJITHROSAN17/morrow-editor/actions/runs/43499385141) passed the frontend build/unit-test step, Playwright Chromium installation, Windows browser E2E suite, Rust file-safety tests, unsigned NSIS installer build and checksum generation on the audited `main` commit.
- Local frontend validation passed after a clean `npm ci`: **25 Vitest files / 281 tests**, strict production build, `npm audit --omit=dev --audit-level=moderate` with zero production vulnerabilities.
- A new static security boundary audit passes locally and is now part of the Ubuntu CI gate through `npm run audit:static`.
- A new repeatable pure-workload benchmark command exists as `npm run benchmark`; it measures bounded encoding, Quick Open ranking and review diff paths without claiming end-to-end desktop performance.
- Existing Linux unit tests already exercise symlink refusal, bounded reads/listings, expected-hash saves, no-clobber creation, prompt framing, Markdown inertness, recovery failure behavior and accessibility-related pure helpers.

### Still not complete

- No consumer-Windows test matrix, power-loss test, Windows junction/ACL/UNC test, independent penetration test, Narrator/NVDA study, real Ollama response, authenticated Arena request, user study or signed release was performed in this environment.
- No hands-on benchmark against installed competitor applications was performed. The competitive audit remains source/documentation-based until the same Windows machine, fixtures and workload protocol are available.
- The current 20 MiB file ceiling remains a product boundary; the local benchmark does not demonstrate support for 100 MiB/500 MiB files or responsive WebView2 editing.

## Evidence matrix

| Area from the audit | What was done now | Status | What the result proves | Remaining work |
|---|---|---|---|---|
| Hands-on competitor benchmark | Added a protocol issue; ran Morrow-only pure benchmarks. | **Partial** | Morrow has reproducible starting measurements for selected pure functions. | Run paired Windows workloads against reference products under [#65](https://github.com/RANJITHROSAN17/morrow-editor/issues/65). |
| Consumer Windows compatibility | Reviewed the workflow and checked the successful Windows x64 run. | **Partial** | The audited commit built, ran automated Windows E2E and Rust file-safety tests, and produced an installer/checksum. | Real Windows 10/11, WebView2, permissions, network shares, reparse points and upgrade/recovery matrix in [#66](https://github.com/RANJITHROSAN17/morrow-editor/issues/66). |
| Real large-file performance | Benchmarked UTF-8 decode at 1/5/20 MiB and encode at 1/5 MiB. | **Partial** | Pure encoding cost and the current safety-boundary workload are measurable on this runner. | 100/500 MiB open/scroll/search/memory tests and an adaptive mode in [#51](https://github.com/RANJITHROSAN17/morrow-editor/issues/51), with paired measurement in [#65](https://github.com/RANJITHROSAN17/morrow-editor/issues/65). |
| Power loss/interrupted save | Reviewed the save transaction and existing hash/atomic-write tests. | **Not run** | The current code has temp-file flush, expected hashes and no-clobber semantics in tested paths. | Termination/power interruption and recovery timeline tests in [#47](https://github.com/RANJITHROSAN17/morrow-editor/issues/47), [#49](https://github.com/RANJITHROSAN17/morrow-editor/issues/49), and the Windows matrix [#66](https://github.com/RANJITHROSAN17/morrow-editor/issues/66). |
| Penetration test | Added and passed a static boundary audit. | **Partial** | CSP, exact native capability URLs, main-webview scoping, forbidden dynamic code/HTML patterns, inert Markdown DOM and HTTP import boundaries are checked. | Independent threat model and penetration assessment in [#67](https://github.com/RANJITHROSAN17/morrow-editor/issues/67). Static checks are not a penetration test. |
| Reparse/ACL/network-share safety | Existing Rust/Linux tests cover symlink refusal; Windows CI Rust safety tests passed. | **Partial** | The project exercises safe file primitives and Windows Rust tests run in CI. | Actual junction/reparse, ACL, UNC/network-share and parent-directory race cases in [#66](https://github.com/RANJITHROSAN17/morrow-editor/issues/66) and [#67](https://github.com/RANJITHROSAN17/morrow-editor/issues/67). |
| Narrator/NVDA/accessibility | Existing Playwright accessibility tests ran in the successful Windows workflow; static keyboard/contrast tests pass locally. | **Partial** | Core DOM keyboard/focus/contrast behavior is automated and Windows E2E was green. | Manual Narrator/NVDA, forced colors, 150/200% scaling, minimum window and task study in [#56](https://github.com/RANJITHROSAN17/morrow-editor/issues/56) and [#69](https://github.com/RANJITHROSAN17/morrow-editor/issues/69). |
| Real Ollama evaluation | Pure request framing, limits, output cleaning and mocked transport tests pass. | **Not run** | Payloads are bounded and selection text is framed as data without needing a model. | A maintainer-run local-model evaluation with route/latency/output evidence in [#68](https://github.com/RANJITHROSAN17/morrow-editor/issues/68) and [#63](https://github.com/RANJITHROSAN17/morrow-editor/issues/63). |
| Authenticated Arena evaluation | Arena endpoint, redirect, bounded-response and payload tests pass without credentials. | **Not run** | The API/browser boundary can be tested without storing a key. | Disposable-key, redacted live acceptance run in [#68](https://github.com/RANJITHROSAN17/morrow-editor/issues/68), then provider work in [#54](https://github.com/RANJITHROSAN17/morrow-editor/issues/54). |
| User interviews/usability | No participants or external users were available in this run. | **Not run** | The audit is a source/product hypothesis, not user evidence. | Recruit a privacy-preserving pilot and record task outcomes in [#69](https://github.com/RANJITHROSAN17/morrow-editor/issues/69). |
| Signed release/update validation | The Windows workflow built an unsigned installer and SHA-256 file successfully. | **Partial** | Build and checksum publication work; the artifact is explicitly not trusted/signed. | Code signing, provenance, SBOM and update/rollback verification in [#46](https://github.com/RANJITHROSAN17/morrow-editor/issues/46). |
| Native Rust test run | Local Cargo is unavailable, but the Windows workflow's `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked` step passed. | **Remote pass / local unavailable** | The audited commit passed the repository's native Rust test gate on Windows CI. | Repeat on a maintainer-controlled Windows machine as part of [#66](https://github.com/RANJITHROSAN17/morrow-editor/issues/66) when testing consumer behavior. |

## New validation tooling

### `npm run audit:static`

The new `scripts/security-audit.mjs` checks:

- required restrictive CSP directives (`frame-src`, `object-src`, `base-uri`, `form-action`);
- exact `connect-src` and Tauri HTTP capability URLs;
- native permission scope limited to the bundled `main` webview;
- no wildcard capability URLs;
- no `eval`, `new Function`, `document.write`, `insertAdjacentHTML`, `outerHTML` assignment or React raw-HTML escape hatch in TypeScript source;
- Markdown renderer/preview DOM replacement and tag allowlist;
- native HTTP imports restricted to the explicit AI transport modules.

The command prints two deliberate warnings: static checking is not a penetration test, and a loopback Ollama endpoint does not prove that a selected model is cloud-free.

### `npm run benchmark`

The new `scripts/performance-baseline.bench.ts` uses Vitest's dedicated benchmark runner and synthetic data only. One local run produced these approximate means on the sandbox runner:

| Workload | Mean |
|---|---:|
| Decode 1 MiB UTF-8 | 1.52 ms |
| Decode 5 MiB UTF-8 | 8.43 ms |
| Decode 20 MiB UTF-8 | 33.11 ms |
| Encode 1 MiB UTF-8 | 3.22 ms |
| Encode 5 MiB UTF-8 | 16.52 ms |
| Rank 5,000 Quick Open files | 2.93 ms |
| Bounded 5,000-line review diff | 0.87 ms |

These numbers are **not** startup, memory, typing-latency, filesystem, WebView2 or competitor benchmarks. They are a baseline for pure functions and should not be used as marketing claims. The benchmark intentionally has no fixed pass/fail threshold yet; [#55](https://github.com/RANJITHROSAN17/morrow-editor/issues/55) must establish hardware-specific budgets before CI rejects performance changes.

## Validation order

1. **Trust gate:** #46, #47, #48, #49, #66, and #67.
2. **Daily-driver gate:** #50, #51, #52, #55, #56, #57, #65, and #69.
3. **AI evidence gate:** #54, #58, #63, and #68.
4. **Strategic expansion:** #59, #60, #61, and #62 only after the first two gates have evidence.

Do not close an implementation issue because a plan exists. Close it only when its acceptance criteria are implemented, automated/manual evidence is attached, and the relevant validation issue has a reproducible result.

## Open issue map

### Product/architecture backlog

- [#46–#49](https://github.com/RANJITHROSAN17/morrow-editor/issues/46) — P0 release, recovery and save trust.
- [#50–#57](https://github.com/RANJITHROSAN17/morrow-editor/issues/50) — P1 search, large files, review, architecture, AI registry, performance, accessibility and note indexing.
- [#58–#63](https://github.com/RANJITHROSAN17/morrow-editor/issues/58) — P2 grounded Q&A, Markdown export, note transactions, sandboxing, localization and AI evaluation.

### Validation backlog

- [#65](https://github.com/RANJITHROSAN17/morrow-editor/issues/65) — hands-on competitor/Morrow benchmark matrix.
- [#66](https://github.com/RANJITHROSAN17/morrow-editor/issues/66) — consumer Windows reliability and filesystem matrix.
- [#67](https://github.com/RANJITHROSAN17/morrow-editor/issues/67) — independent threat-model and penetration assessment.
- [#68](https://github.com/RANJITHROSAN17/morrow-editor/issues/68) — real Ollama/Arena provider acceptance evaluation.
- [#69](https://github.com/RANJITHROSAN17/morrow-editor/issues/69) — user interviews, task study and assistive-technology validation.

The validation issues are deliberately separate from implementation issues: a green unit test cannot be used as a substitute for a Windows, security, model-provider or user-study result.
