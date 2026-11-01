/**
 * roadmap-bots.js — zero-dependency GitHub automation helpers for Morrow Editor.
 *
 * Subcommands:
 *   node scripts/roadmap-bots.js status [--issues-json FILE] [--out FILE]
 *   node scripts/roadmap-bots.js classify-issue --title TEXT --body TEXT
 *   node scripts/roadmap-bots.js pr-context --changed FILE --body FILE [--lines N] [--out FILE]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STATUS_MARKER = "<!-- roadmap-status -->";
export const PR_MARKER = "<!-- pr-guide-bot -->";
const ROADMAP_MARKER_RE = /<!--\s*roadmap:([A-Za-z0-9_-]+)\s*-->/;

function argValue(argv, flag, fallback = "") {
  const idx = argv.indexOf(flag);
  return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : fallback;
}

export function loadRoadmap(path = join(ROOT, ".github/roadmap.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function extractMarkerId(body) {
  const m = ROADMAP_MARKER_RE.exec(String(body || ""));
  return m ? m[1] : null;
}

export function detectDrift(roadmap, repoRoot = ROOT) {
  const notes = [];
  for (const item of roadmap.items || []) {
    if (item.status === "shipped") continue;
    for (const rel of item.files || []) {
      if ((rel.startsWith("src/") || rel.startsWith("src-tauri/")) && !existsSync(join(repoRoot, rel))) {
        notes.push(`${item.id}: missing source path '${rel}'`);
      }
    }
  }
  try {
    const pkgVer = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
    const tauriVer = JSON.parse(readFileSync(join(repoRoot, "src-tauri/tauri.conf.json"), "utf8")).version;
    if (pkgVer && tauriVer && pkgVer !== tauriVer) {
      notes.push(`version drift: package.json (${pkgVer}) != src-tauri/tauri.conf.json (${tauriVer})`);
    }
  } catch {
    // ignore if run in isolated temp fixture
  }
  return notes;
}

export function renderStatusMarkdown(roadmap, issues = [], repoRoot = ROOT) {
  const items = roadmap.items || [];
  const shipped = items.filter((i) => i.status === "shipped");
  const openByMarker = new Map();
  const closedMarkers = new Set();

  for (const iss of issues) {
    if (iss.pull_request) continue;
    const id = extractMarkerId(iss.body);
    if (!id) continue;
    if (String(iss.state || "").toLowerCase() === "open") openByMarker.set(id, iss);
    else closedMarkers.add(id);
  }

  const active = items.filter((i) => openByMarker.has(i.id));
  const queued = items.filter(
    (i) =>
      i.status !== "shipped" &&
      !openByMarker.has(i.id) &&
      !closedMarkers.has(i.id),
  );
  const doneCount =
    shipped.length +
    [...closedMarkers].filter((id) => !shipped.some((s) => s.id === id)).length;
  const total = items.length || 1;
  const filled = Math.round((doneCount / total) * 20);
  const bar = "#".repeat(filled) + ".".repeat(Math.max(0, 20 - filled));

  const lines = [
    STATUS_MARKER,
    "# Morrow Editor — Roadmap Status",
    "",
    `Progress: \`${bar}\` **${doneCount}/${items.length}** curated tasks completed.`,
    "",
  ];

  if (active.length) {
    lines.push(
      "## Open contributor queue",
      "",
      "| Issue | Task | Difficulty | Verify |",
      "|---|---|---|---|",
    );
    for (const item of active) {
      const iss = openByMarker.get(item.id);
      lines.push(
        `| #${iss.number} | ${item.title} | ${item.difficulty} | \`${item.verify || "npm test"}\` |`,
      );
    }
    lines.push("");
  } else {
    lines.push(
      "## Open contributor queue",
      "",
      "_No curated roadmap issues are currently open — `Contributor queue` replenishes automatically from `.github/roadmap.json`._",
      "",
    );
  }

  if (queued.length) {
    lines.push(
      "## Next queued tasks (auto-opened as open issues close)",
      "",
      "| ID | Title | Difficulty | Windows-free? |",
      "|---|---|---|---|",
    );
    for (const item of queued.slice(0, 6)) {
      const winFree = (item.files || []).some((f) => f.startsWith("src-tauri/")) ? "Windows/Rust" : "Yes (any OS)";
      lines.push(`| \`${item.id}\` | ${item.title} | ${item.difficulty} | ${winFree} |`);
    }
    lines.push("");
  }

  const drift = detectDrift(roadmap, repoRoot);
  const closedUnmarked = items.filter((i) => i.status !== "shipped" && closedMarkers.has(i.id));
  if (drift.length || closedUnmarked.length) {
    lines.push("## Drift & maintenance notes", "");
    for (const d of drift) lines.push(`- ⚠️ ${d}`);
    for (const item of closedUnmarked) {
      lines.push(
        `- ℹ️ \`${item.id}\` issue is closed; set \`"status": "shipped"\` + \`"release": "vX.Y.Z"\` in \`.github/roadmap.json\` once tagged.`,
      );
    }
    lines.push("");
  }

  lines.push(
    "---",
    "<sub>Maintained automatically in place by `roadmap-status-bot.yml` (zero notification spam). Source of truth: `.github/roadmap.json` and `ROADMAP-STATUS.md`.</sub>",
  );
  return lines.join("\n") + "\n";
}

const AREA_RULES = [
  ["area/ai", /\b(ollama|completion|fim|inline suggestion|ai\.ts|arena|model)\b/i],
  ["area/workspace", /\b(workspace|quick open|search|folder|directory|ctrl\+p)\b/i],
  ["area/markdown", /\b(markdown|preview|worker)\b/i],
  ["area/windows", /\b(windows|tauri|nsis|installer|webview2|rust|cargo|shell)\b/i],
  ["area/security", /\b(secret|sensitive-text|security|traversal|bounded-json|escape)\b/i],
  ["area/editor", /\b(editor|codemirror|encoding|utf-16|utf-32|bom|crlf|tab|cursor|storage|recovery|diff)\b/i],
];

export function classifyIssue(title, body) {
  const text = `${title || ""}\n${body || ""}`;
  const out = new Set();
  for (const [label, re] of AREA_RULES) {
    if (re.test(text)) out.add(label);
  }
  if (/\b(bug|crash|error|regression|broken|fails|lost|corrupt)\b/i.test(text)) {
    out.add("type/bug");
  } else if (/\b(feat|feature|enhancement|support|proposal|add)\b/i.test(text)) {
    out.add("type/feature");
  }
  return [...out];
}

export function labelsForChangedFiles(files, totalLines = 0) {
  const labels = new Set();
  for (const f of files) {
    if (f === "src/ai.ts" || f === "src/arena.ts" || f.includes("ai")) labels.add("area/ai");
    if (f === "src/workspace.ts" || f.includes("workspace")) labels.add("area/workspace");
    if (f.includes("markdown")) labels.add("area/markdown");
    if (f.startsWith("src-tauri/") || f.includes("windows")) labels.add("area/windows");
    if (f.includes("sensitive-text") || f.includes("bounded-json") || f === "SECURITY.md") {
      labels.add("area/security");
    }
    if (
      f === "src/editor.ts" ||
      f === "src/workbench.ts" ||
      f === "src/encoding.ts" ||
      f === "src/storage.ts" ||
      f === "src/change-review.ts"
    ) {
      labels.add("area/editor");
    }
    if (f.startsWith("docs/") || f.endsWith(".md")) labels.add("area/docs");
    if (f.startsWith(".github/")) labels.add("area/ci");
  }
  if (totalLines < 25) labels.add("size/XS");
  else if (totalLines < 100) labels.add("size/S");
  else if (totalLines < 300) labels.add("size/M");
  else if (totalLines < 600) labels.add("size/L");
  else labels.add("size/XL");
  return [...labels];
}

export function renderPrContext(roadmap, changedFiles, prBody = "") {
  const changed = new Set(changedFiles.filter(Boolean));
  const matches = [];
  for (const item of roadmap.items || []) {
    if (item.status === "shipped") continue;
    const hit = (item.files || []).filter((f) => changed.has(f));
    if (hit.length) matches.push({ item, hit });
  }
  const hasCloses = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/i.test(prBody || "");
  const lines = [PR_MARKER, "### Morrow PR Context"];
  if (!matches.length) {
    lines.push("", "No active `.github/roadmap.json` entry directly matches the touched files.");
  } else {
    lines.push("", "Matched curated roadmap task(s):", "");
    for (const { item, hit } of matches) {
      lines.push(
        `- **\`${item.id}\`** — ${item.title} (touched: ${hit.map((h) => `\`${h}\``).join(", ")})`,
      );
      lines.push(`  - Verify locally: \`${item.verify || "npm test"}\``);
    }
    if (!hasCloses) {
      lines.push(
        "",
        "> 💡 **Tip:** Add `Closes #<issue-number>` to the PR description if this completes an open task — closing the issue automatically triggers `Contributor queue` to open the next roadmap item.",
      );
    }
  }
  lines.push("", "<sub>Single sticky comment updated in place on push.</sub>");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === "status") {
    const issuesFile = argValue(rest, "--issues-json") || argValue(rest, "--issues");
    const outFile = argValue(rest, "--out");
    const issues =
      issuesFile && existsSync(issuesFile)
        ? JSON.parse(readFileSync(issuesFile, "utf8"))
        : [];
    const md = renderStatusMarkdown(loadRoadmap(), issues);
    if (outFile) writeFileSync(outFile, md);
    else process.stdout.write(md);
  } else if (sub === "classify-issue") {
    const labels = classifyIssue(argValue(rest, "--title"), argValue(rest, "--body"));
    process.stdout.write(JSON.stringify(labels));
  } else if (sub === "pr-context") {
    const changedPath = argValue(rest, "--changed");
    const bodyPath = argValue(rest, "--body");
    const outFile = argValue(rest, "--out");
    const lines = Number(argValue(rest, "--lines", "0")) || 0;
    const files =
      changedPath && existsSync(changedPath)
        ? readFileSync(changedPath, "utf8").split(/\r?\n/).filter(Boolean)
        : [];
    const prBody = bodyPath && existsSync(bodyPath) ? readFileSync(bodyPath, "utf8") : "";
    const md = renderPrContext(loadRoadmap(), files, prBody);
    const labels = labelsForChangedFiles(files, lines);
    if (outFile) writeFileSync(outFile, JSON.stringify({ comment: md, labels }, null, 2));
    else process.stdout.write(md);
  } else {
    console.error("Usage: node scripts/roadmap-bots.js <status|classify-issue|pr-context>");
    process.exit(2);
  }
}
