# 90-day roadmap — status

Where the plan stands, what changed, and what still needs a decision. Days are counted from
the day this file was written; adjust the dates to the actual merge day.

## Day 1–30 — repository groundwork

| # | Action | State | Evidence |
|---|---|---|---|
| 1 | Say that non-Windows development works | **done** | `CONTRIBUTING.md`; verified with `npm ci && npm test` (76 passing) and `npm run build` on Linux |
| 2 | Make the first PR survivable | **done** | `CONTRIBUTING.md` (approval gate, scope, review tone), `.github/PULL_REQUEST_TEMPLATE.md` |
| 3 | Publish an installer | **wired, not fired** | tag-only `publish` job in `.github/workflows/windows.yml`; needs a `v*` tag to produce the first release |
| 4 | Add `SECURITY.md` | **done** | `SECURITY.md` — scope, private channel, 72 h ack |
| 5 | Issue + PR templates, CoC | **done** | `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`, `CODE_OF_CONDUCT.md` |
| 6 | Contribute without reading the whole repo | **done** | `docs/contributing-queue.md` + `scripts/validate-roadmap.js` |
| 7 | Seed the queue | **ready, not seeded** | `.github/roadmap.json`: 3 ready entries, cap 3, all Windows-free |
| 8 | Surface it | **done** | `README.md` — tip, releases link, Contributing section |

Two things are deliberately still manual because they need someone with write access and a
judgement call:

- **Cut the first tag.** `git tag v0.1.0 && git push origin v0.1.0` on a green `main` runs the
  publish job and produces a downloadable installer. Until then the releases page is empty and
  the README link correctly lands on nothing.
- **Seed the issues.** Run the contributor-queue workflow once and review the one issue it opens
  before enabling the schedule, so the first filing is eyeballed against the manifest.

## Day 31–60 — first external contributors

Not started. These depend on the above landing first, and they are the ones that need a
decision from the maintainer rather than more files:

- Chase the **50-star gate** on `0PandaDEV/awesome-windows`. The list requires 50 stars and a
  month of history; the repo has neither. This is a gate that opens on its own if the launch
  works, not an action to schedule now.
- Post the launch where Windows developers already are, with the unsigned-installer caveat in
  the title or first line so the thread does not become about SmartScreen.
- Answer the first five issues within 48 hours. Responsiveness is the cheapest reach signal
  available and this repo currently has no track record to point at.

## Day 61–90 — repeat contributors

Not started. A repeat contributor is someone whose second PR did not require re-explaining the
project, so everything here is about the review loop rather than more documentation:

- Move review of routine PRs to a checklist in the PR template instead of prose.
- Promote two queue candidates to `good first issue` proper, once the first three are gone.
- Decide whether the growth bot is wanted at all. Pinch runs one; it is only justified here
  after there is traffic to measure.

## What I did not do, and why

- **Didn't push a tag or seed issues.** Both write to the live repo and both are one-way in
  practice — a published release and a filed issue are public artefacts. They belong in the
  merge conversation, not in a branch.
- **Didn't add a `ci.yml` matrix.** Reasonable next step, but it is a separate change with its
  own failure modes (cache keys per OS, installer steps excluded on Linux) and mixing it in
  makes this branch harder to review than it needs to be.
- **Didn't touch `docs/RESEARCH-AND-ROADMAP.md`.** Still `backlog` in the manifest; it is a
  research task, not a first PR.
