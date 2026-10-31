# Contributing to Morrow

Morrow is a Windows desktop editor built on Tauri 2, but **most of it is platform-neutral
TypeScript, and all of that is testable on Linux and macOS.** You do not need Windows, Rust,
MSVC Build Tools or WebView2 to make a meaningful contribution.

## You do not need Windows

```bash
npm ci
npm test          # 71 unit tests, ~2 seconds
npm run build     # typecheck + bundle
```

That is the whole inner loop. Verified on Linux against the 0.4.0 tree.

| Task | Needs Windows? |
| --- | --- |
| Adding or extending a unit test in `tests/*.test.ts` | **No** |
| Editing pure modules: `src/encoding.ts`, `src/markdown-render.ts`, `src/samples.ts` | **No** |
| Browser UI work: `npm run dev`, `npm run test:e2e` | **No** (needs `npx playwright install --only-shell chromium`) |
| `npm run tauri dev`, the installed app | **Yes** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **Yes** |
| Native dialogs, file associations, Ollama over desktop IPC | **Yes** |

If a task requires Windows, the issue says so in its first paragraph. If it does not say that,
you can do it on any OS.

## Your first PR

Your workflows will show **"awaiting approval"** on your first pull request. That is normal:
GitHub holds CI runs from first-time contributors until a maintainer approves them, and Morrow
keeps that gate on because the Windows job builds an installer artifact. Approve-by-hand is the
price of not handing fork PRs a writable token.

Expect the approval, and a first review, within **24 hours**. You do not need to ping, re-push,
or close and reopen the PR.

## Where things live

| Path | What belongs there |
| --- | --- |
| `src/` | the editor. `main.ts` (1,105 lines) wires the UI; `workbench.ts` (791) owns the workspace |
| `src/encoding.ts` | decode/encode, BOMs, line endings — pure functions over `Uint8Array` |
| `src/markdown-render.ts` | Markdown to a bounded, inert preview tree |
| `src/sensitive-text.ts` | the credential-shape warning. Fallible by design; see the README |
| `src-tauri/` | the Rust shell. Small on purpose |
| `tests/*.test.ts` | vitest. Must pass on every OS |
| `tests/e2e/*.spec.ts` | Playwright against the browser build |

## Ground rules

1. **The documentation must stay honest.** This project's credibility comes from
   `docs/IMPLEMENTATION-0.4.0.md`, which lists what has *not* been verified. If your change makes
   a claim, either verify it or say it is unverified. Do not soften the limitations section.
2. **No new runtime dependency without a reason in the PR.** The dependency list is short and
   deliberate. `diff`, `markdown-it` and CodeMirror are there because writing them is worse.
3. **Anything that touches files, keys or the network gets a test that fails without it.** If you
   cannot make the test fail, it is not testing the thing.
4. **Do not widen the file-access boundary to make a test pass.** `src-tauri` bounds native reads
   on purpose; a resolution that reaches outside the selected folder means the test is wrong.
5. **Say what you did not test.** A sentence in the PR body is enough, and it is expected.

## Commits and PRs

Conventional commits, imperative: `test: cover markdown-render node limits`,
`docs: name the Windows-only tasks`, `fix: accept a UTF-8 BOM on decode`.

In the PR body, include: what changed and why, whether it needs Windows to verify, and the
command you ran. Screenshots for UI changes.

## Reporting bugs

Include your Windows version, steps to reproduce, and expected versus actual behaviour. **Never
paste API keys, private files or sensitive text into a public issue** — see
[`SECURITY.md`](../SECURITY.md) for the private channel.

## Not sure where to start?

The [`good first issue`](https://github.com/RANJITHROSAN17/morrow-editor/labels/good%20first%20issue)
label holds tasks that are fully specified — file path, acceptance criteria, and a command that
proves it — and that do not require Windows. Comment on one and it is yours.
