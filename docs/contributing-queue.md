# The contributor queue

Pinch keeps a **small** number of fully specified `good first issue` tasks open, and a bot keeps it
stocked from a manifest a human reviewed. This document is the human side of that loop.

## Why small

An open issue is a promise that someone will answer. Nine bot-filed proposals with zero human
replies reads as an abandoned project with a bot talking to itself — and it buries the three tasks
a newcomer could actually finish tonight. The cap is three open `difficulty/easy` issues. Overflow
lives in `.github/roadmap.json` with `"status": "backlog"` and is invisible to the bot.

## The loop

```
you edit roadmap.json  →  PR review  →  merge  →  bot files ONE issue  →  you reply  →  they PR
        ↑                                                                       ↓
        └───────────────── status: shipped, credit in the release ──────────────┘
```

1. **Propose.** Add an entry to `.github/roadmap.json` with `status: "backlog"` and open a normal
   PR. Nothing is filed from `backlog`.
2. **Specify.** Move it to `status: "ready"` only when the body has all four sections:
   `## Context`, `## Acceptance criteria`, `## How to verify`, `## Time estimate`. CI runs
   `scripts/validate-roadmap.js` and **fails the PR** if any is missing, or if the body does not
   name a file, or if there are more than three `easy` candidates. You cannot merge a
   half-specified task, which is the entire point.
3. **File.** A weekly workflow (Mondays, and the cap-gated part matters more than the schedule)
   files the first eligible item with a hidden `<!-- roadmap:ID -->` marker and a footer naming
   you and your reply SLA.
4. **Answer.** Reply within the SLA stated in `meta.reply_sla_hours`. If you cannot, set
   `"status": "backlog"` and close with a note — a closed, honestly-parked issue is better than an
   open one nobody answers.
5. **Ship.** Set `"status": "shipped"` **and** `"release": "v0.2.0"`. The bot comments that tag
   and closes **only** issues it created itself; it refuses to touch anything a human opened.
   Without the `release` field the validator fails the PR, because a close comment that cannot
   name a release is a promise nobody can keep.

## Rules the bot enforces in code, not in a prompt

| Rule | Where |
|---|---|
| Never improvises what to file | reads `roadmap.json` only; no model at runtime |
| Re-running is a no-op | searches for `<!-- roadmap:ID -->` before creating |
| One issue per run, cap 3 | `meta.open_easy_cap` + the queue count step |
| Refuses incomplete issues | `scripts/validate-roadmap.js` (CI gate) |
| Cannot touch human work | author check before any comment/close |
| Least privilege | `contents: read`, `issues: write` only |
| No PR comments | the workflow never calls `gh pr comment` |
| No injection | manifest strings reach the shell via `env:` + `"$VAR"` only |

## Running it by hand

```bash
node scripts/validate-roadmap.js .github/roadmap.json     # same gate CI uses
gh workflow run contributor-queue.yml -f dry_run=true     # report, change nothing
```

A scheduled run is **live** and files one issue. A manual dispatch defaults to `dry_run: true`,
so the only way to file by accident is to ask for it explicitly with `-f dry_run=false`.

To seed the first issue, dispatch once with `-f dry_run=false`, then read what it filed before
leaving the schedule to do the rest.

## There is deliberately only one filing loop

Morrow has no `scripts/growth.js` and no growth workflow — unlike the sibling `Pinch` repo, where
this manifest came from. Two filing loops means two queues and a breached cap, so if a growth bot
is ever added here, it must **not** create issues. Let it research and annotate; all issue
creation stays in the reviewed manifest above.
