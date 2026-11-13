#!/usr/bin/env node
/**
 * Validate .github/roadmap.json before the curation bot is allowed to file anything.
 *
 * The bot's whole safety argument is "humans review the manifest in a PR". That is only true
 * if a broken manifest fails loudly here, in CI, instead of becoming a half-specified issue
 * that a newcomer cannot start. This script is the gate.
 *
 * Usage:
 *   node scripts/validate-roadmap.js [path]     # exit 0 valid, exit 1 invalid
 *
 * No dependencies. Node standard library only, like the rest of the repo.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATH = process.argv[2] ?? ".github/roadmap.json";
const ALLOWED_STATUS = new Set(["backlog", "ready", "filed", "shipped"]);
const ALLOWED_DIFFICULTY = new Set(["easy", "medium", "hard"]);
const REQUIRED_LABELS = ["good first issue", "help wanted"];
// Every filed issue must be startable by a stranger. These four markers are the difference
// between a task and a wish.
const REQUIRED_BODY_MARKERS = [
  ["## Context", "context section"],
  ["## Acceptance criteria", "acceptance criteria"],
  ["## How to verify", "verification command"],
  ["## Time estimate", "time estimate"],
];

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

let doc;
try {
  doc = JSON.parse(readFileSync(resolve(PATH), "utf8"));
} catch (err) {
  console.error(`validate-roadmap: cannot read ${PATH}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(doc.items)) {
  console.error("validate-roadmap: top-level 'items' must be an array");
  process.exit(1);
}

const seen = new Set();
const themes = new Map();
let readyCount = 0;
let easyReady = 0;

for (const [i, item] of doc.items.entries()) {
  const at = `items[${i}]${item?.id ? ` (${item.id})` : ""}`;

  for (const key of ["id", "title", "status", "difficulty", "labels", "body"]) {
    if (!item?.[key]) fail(`${at}: missing required key '${key}'`);
  }
  if (!item?.id) continue;

  if (seen.has(item.id)) fail(`${at}: duplicate id`);
  seen.add(item.id);

  if (item.status && !ALLOWED_STATUS.has(item.status)) {
    fail(`${at}: status '${item.status}' is not one of ${[...ALLOWED_STATUS].join(", ")}`);
  }
  if (item.difficulty && !ALLOWED_DIFFICULTY.has(item.difficulty)) {
    fail(`${at}: difficulty '${item.difficulty}' is not one of ${[...ALLOWED_DIFFICULTY].join(", ")}`);
  }
  if (Array.isArray(item.labels) && item.labels.length === 0) {
    fail(`${at}: labels is empty; needs at least one of ${REQUIRED_LABELS.join(" / ")}`);
  }
  if (Array.isArray(item.labels) && !item.labels.some((l) => REQUIRED_LABELS.includes(l))) {
    warnings.push(`${at}: no contributor-facing label (${REQUIRED_LABELS.join(" / ")}); the bot will still file it`);
  }

  // The completeness gate only applies to things the bot may actually file.
  // A shipped entry is what lets the bot close an issue it opened, and the close comment names
  // the release. Without one the workflow refuses to close, so a missing `release` is a
  // silent stall, not a cosmetic gap.
  if (item.status === "shipped" && !item.release) {
    fail(`${at}: status 'shipped' needs a 'release' (the tag it shipped in)`);
  }

  // One-at-a-time work is the whole point of the queue: every candidate needs a `theme`, so the
  // bot can hold back siblings of the theme already being worked on. Without it the queue
  // degenerates back into five unrelated issues and a newcomer picks the wrong one.
  if (item.theme && typeof item.theme !== "string") {
    fail(`${at}: 'theme' must be a string`);
  }
  if (item.release && typeof item.release === "string" && !/^v?\d+\.\d+\.\d+$/u.test(item.release)) {
    fail(`${at}: release '${item.release}' is not a version tag like v0.5.0; the close comment would mislead`);
  }

  if (item.status === "ready" || item.status === "filed") {
    readyCount += 1;
    if (item.difficulty === "easy") easyReady += 1;
    if (!item.theme) fail(`${at}: filing candidate must name a 'theme' so the bot can serialise work`);
    else themes.set(item.theme, (themes.get(item.theme) ?? 0) + 1);

    if (typeof item.body !== "string") {
      fail(`${at}: filing candidate has no body`);
      continue;
    }
    for (const [marker, label] of REQUIRED_BODY_MARKERS) {
      if (!item.body.includes(marker)) fail(`${at}: filing candidate is missing ${label} ('${marker}')`);
    }
    if (!Array.isArray(item.files) || item.files.length === 0) {
      fail(`${at}: filing candidate must name at least one file under 'files'`);
    }
    if (!item.verify) {
      fail(`${at}: filing candidate must include a 'verify' command`);
    }
  }
}

// Two caps, both anti-pattern guards. `open_easy_cap` protects a newcomer from picking a task
// nobody has time to review; `open_curated_cap` protects the reviewer from a tracker full of
// bot issues with no human replies, which reads as an abandoned project.
const cap = doc.meta?.open_easy_cap ?? 3;
const curatedCap = doc.meta?.open_curated_cap ?? cap + 1;
if (easyReady > cap) {
  fail(`too many 'easy' items in status ready/filed: ${easyReady} > cap ${cap}. Move the rest to backlog.`);
}
if (readyCount > curatedCap) {
  fail(`too many filing candidates: ${readyCount} > cap ${curatedCap}. Keep the open queue small enough to answer.`);
}

// The bot files at most one candidate per theme per run, so a theme with more than one ready
// entry is a manifest bug: the second one would stall indefinitely with no visible reason.
for (const [theme, count] of themes) {
  if (count > 1) fail(`theme '${theme}' has ${count} filing candidates; the queue works one at a time per theme`);
}

for (const w of warnings) console.warn(`validate-roadmap: warn: ${w}`);

if (errors.length) {
  console.error(`validate-roadmap: ${errors.length} problem(s) in ${PATH}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `validate-roadmap: ${PATH} OK (${doc.items.length} item(s), ${readyCount} filing candidate(s) `
  + `across ${themes.size} theme(s), caps ${cap}/${curatedCap})`,
);
