# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:
[Security → Report a vulnerability](https://github.com/RANJITHROSAN17/morrow-editor/security/advisories/new).

Include what you did, what happened, and the version (`package.json`) plus your Windows build.
A proof of concept helps; a screenshot is enough to start.

Expect an acknowledgement within **72 hours**. Morrow is a single-maintainer preview project
with no security team and no bug bounty — that is stated plainly so nobody waits for a reward
that does not exist.

## What is in scope

| Area | Why it matters |
| --- | --- |
| Native file access (`src-tauri/`) | bounded reads, symlink/reparse-point handling, folder scope |
| Tauri IPC permissions | the capability allowlist and remote-navigation denial |
| `src/arena.ts` | the optional API-key panel: key handling, request validation, confirmation |
| `src/sensitive-text.ts` | the credential-shape warning. Fallible by design — a *silent* miss is the bug, not an imperfect match |
| `src/bounded-json.ts` | size/parse bounds on Ollama and provider responses |
| Session recovery (`src/storage.ts`) | unencrypted local storage of document contents |

Out of scope: the unsigned installer triggering SmartScreen (documented, expected), anything
requiring an already-compromised machine, and vulnerabilities in CodeMirror, Tauri or the model
providers themselves — report those upstream.

## What the project already admits

This section exists because a security policy that overstates its coverage is worse than none.

- **No complete security audit has been performed.** `docs/IMPLEMENTATION-0.4.0.md` says so, and
  the README repeats it next to the download.
- **The command screen and secret warning are heuristics.** They are not sandboxes or redaction.
- **Session recovery is unencrypted.** The README says it is "**not** a backup"; it is also not
  private from anyone with access to your user profile.
- **Folder access can outlive the view.** Tauri's persisted scope may retain access after a
  folder is closed or the app restarts.
- **Parent-path races remain.** Bounded no-follow reads reject direct links and reparse points;
  they do not close every time-of-check/time-of-use window.

## Supported versions

Only the current preview line receives fixes. There are no long-term support branches; see
`CHANGELOG.md` for what changed and `docs/IMPLEMENTATION-0.4.0.md#verification-and-limits` for
what remains unverified on consumer Windows.
