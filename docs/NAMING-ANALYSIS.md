# Product naming analysis: replacing “Morrow”

Research date: 2026-11-13  
Product: free/open-source Windows x64 text + code editor with a local-first Markdown notes layer, optional AI, Tauri 2 + Rust + CodeMirror 6 + TypeScript.

## Recommendation

**Status: accepted and implemented in the repository rename PR.**

**Rename the product to `Wrytrove`.**

Pronunciation: **RYE-trove**  
Suggested tagline: **“Your local trove of notes and code.”**  
Short descriptor: **A local-first text and code editor for Windows.**

`Wrytrove` is the strongest candidate found in this research pass because it is:

- **Distinctive:** a coined compound, not a generic editor name such as “TextPad”, “CodeFlow”, or “NoteHub”.
- **Product-relevant:** “trove” suggests a valuable collection kept in one place, which fits local files, notes, tags, backlinks, and code snippets.
- **Not AI-first:** the name does not depend on the optional AI features, so the brand still works if AI is disabled or removed.
- **Not IDE-overclaiming:** it does not promise a full IDE, debugger, terminal, LSP, or extension ecosystem.
- **Technically available in the namespaces checked:** npm and PyPI returned 404; no exact GitHub user/org handle was found; GitHub repository-name search returned zero exact `wrytrove` matches.

This is a **branding recommendation**, not legal clearance. Domain registration and trademark availability still need formal verification before public launch.

---

## Why “Morrow” should be replaced

The current name has direct overlap with other software products, including a very close product-category collision:

- `Aarav2709/Morrow` is an open-source, privacy-first, offline/local-first workspace for notes, databases, and ideas. It is also built with Tauri/Rust, stores pages as Markdown files, and ships for Windows/macOS/Linux. This is close enough to create confusion in GitHub search, release discovery, and user support.  
  Source: https://github.com/Aarav2709/Morrow
- Another `morrow` repository exists as an Electron/Monaco local-first AI workspace.  
  Source: https://github.com/hamshamb/morrow
- “Morrow” also appears in consumer app stores and trademark records, which increases long-term brand risk even where the product category is different.  
  Sources: https://apps.apple.com/us/app/id6789944325, https://trademarks.justia.com/793/11/morrow-79311425.html

The goal should not be merely “a name that is not exactly this repo”. The goal is a name that can own search results, package names, installer names, and user trust without pointing people to another product.

---

## Product positioning used for the name

The name was evaluated against what the product actually is today:

- Windows x64 desktop app, early preview.
- Text and code editor, not a full IDE.
- Markdown notes layer over ordinary files: tags, `[[wiki links]]`, backlinks, orphans, daily notes, templates.
- Local-first and privacy-conscious: no account required, files stay under user control.
- Optional AI: local Ollama suggestions, browser-first Arena workflow, optional Arena API.
- Calm, small, approachable, open-source.

A good name should therefore feel:

1. **Local / owned** — not cloud-first.
2. **Calm / focused** — not noisy or enterprise-heavy.
3. **Technical enough** — credible for code editing.
4. **Flexible** — able to cover both notes and code.
5. **Distinctive** — not another `NoteFlow`, `WriteFlow`, `TextFlow`, `CodeNest`, or `MarkLeaf`.

---

## Method

This was a multi-stage screening process, not a single name-generator list.

1. Read the product identity surfaces: README, docs, package metadata, Tauri config, Cargo metadata, IPC headers, storage keys, workflows, and roadmap identifiers.
2. Generated candidate families around writing, text, code, notes, local ownership, calm workspaces, folds, leaves, looms, hearths, coves, glades, troves, and coined tech-style suffixes.
3. Screened candidates with exact-phrase web searches.
4. Checked npm and PyPI package-name availability for finalists.
5. Checked GitHub user/org handles and exact repository-name matches for finalists.
6. Rejected names with direct software collisions, strong phonetic collisions, established non-software brands in adjacent categories, or awkward spelling/pronunciation.
7. Ranked the remaining candidates by collision safety, distinctiveness, product fit, pronounceability, namespace availability, and longevity.

Important limitation: **npm/PyPI/GitHub availability is not trademark clearance.** A name can be unused as a package and still conflict with a registered or common-law trademark.

---

## Final shortlist

Scores are subjective branding scores, not legal opinions.

| Rank | Name | Pronunciation | Score | Main reason |
|---:|---|---|---:|---|
| 1 | **Wrytrove** | RYE-trove | 8.2/10 | Most distinctive clean candidate; fits a local collection of notes/code |
| 2 | **Noteglade** | NOTE-glade | 7.4/10 | Calm, readable, good notes fit; weaker because of NoteLedge/Glade neighbors |
| 3 | **Notehearth** | NOTE-harth | 7.3/10 | Warm “home for notes” meaning; weaker because of Note Heart/Hearth neighbors |
| 4 | **Writecove** | WRITE-cove | 7.0/10 | Clear writing/safe-harbor meaning; weaker because Cove/NoteCove/TextCove are crowded |
| 5 | **Localglade** | LO-cal-glade | 6.7/10 | Local-first fit; less catchy and still near Glade-style names |

### 1. Wrytrove — recommended

**Meaning:** a coined blend suggesting “write” + “trove”: a place where writing, notes, and code are kept as a valuable local collection.

**Why it works:**

- Rare exact string; no exact product collision found in the searches performed.
- More ownable than descriptive names built from `Note`, `Text`, `Write`, or `Code`.
- Works for both notes and code because a “trove” can contain many kinds of valuable material.
- Does not lock the product into AI, Markdown-only, or IDE-only positioning.
- Short enough for an app icon, installer, CLI-style repo name, and window title.

**Checks performed:**

- npm: `wrytrove` returned 404.
- PyPI: `wrytrove` returned 404.
- GitHub user/org handle: no exact `wrytrove` handle found.
- GitHub repository-name search: zero exact `wrytrove` repository-name matches.
- Exact web searches: no exact product/brand hit found; results were near-misses such as WorthTrove, Wyrm’s Trove, YourTrove, and Viral Trove.

**Risks:**

- Spelling is not fully phonetic. Some people may try `Writrove`, `WryTrove`, or `Writetrove`.
- “Wry” can mean dryly humorous, so the brand should lean into the “trove” meaning rather than the dictionary meaning of “wry”.
- Domain and trademark status are not formally cleared.

**Suggested brand usage:**

- App name: **Wrytrove**
- Repo/package: `wrytrove` or `wrytrove-editor`
- Window title: `Wrytrove`
- Tagline: **Your local trove of notes and code.**
- About text: **Wrytrove is a local-first text and code editor for Windows. Your files stay yours.**

### 2. Noteglade — backup if you want a softer, clearer name

**Meaning:** “note” + “glade”: an open, calm space for notes.

**Pros:**

- Easy to read and pronounce.
- Calm, local-first, writer-friendly feel.
- npm/PyPI returned 404; no exact GitHub handle or repo-name match found.

**Cons:**

- Near `NoteLedge`, an established note-taking product.
- Near `Glade`, including a local-first Markdown/Tauri note app and the GTK Glade ecosystem.
- Less distinctive than `Wrytrove` because both parts are ordinary words.

Use this only if you prefer approachability over maximum distinctiveness and after a trademark check.

### 3. Notehearth — backup if you want a warm “home for notes” brand

**Meaning:** a hearth is a home center; `Notehearth` suggests a local home for notes.

**Pros:**

- Strong emotional fit for local-first, private, no-account notes.
- npm/PyPI returned 404; no exact GitHub handle or repo-name match found.

**Cons:**

- Near `Note Heart`, a Windows text/notes editor.
- Near `Hearth`, a writing app, and `CodeHearth`, a local-first AI coding assistant.
- Longer and less “tech product” than `Wrytrove`.

### 4. Writecove — backup if you want a safe-harbor writing brand

**Meaning:** a cove is a sheltered place; `Writecove` suggests a protected place to write.

**Pros:**

- Clear, calm, easy to pronounce.
- npm/PyPI returned 404; no exact GitHub handle or repo-name match found.

**Cons:**

- The `Cove` naming space is crowded in local-first/private software: `NoteCove`, `TextCove`, and `Cove` itself.
- Higher confusion risk than `Wrytrove`.

---

## Names rejected and why

These should not be reused unless new evidence appears.

### Direct software/product collisions

| Name | Reason rejected |
|---|---|
| Morrow | Existing local-first Tauri/Rust notes workspace and other software/consumer brands |
| Inkfold | npm taken and multiple product collisions |
| Texora | Existing LaTeX/editor products |
| Notara | Existing repos including Tauri notes apps |
| Draftiq | Existing software/products |
| Wryta | Existing repos and crowded Wryte-family neighborhood |
| Quillix | Existing notepad/editor with very similar positioning |
| Glyphra | Existing Tauri Markdown workspace |
| Notiq | Existing Tauri/iOS apps |
| Foldra | Multiple products |
| Stillo | Existing apps and Stilo editor neighborhood |
| Novique | Multiple apps |
| Textide | Existing repo/product neighborhood |
| Inktra | Existing Inkra cluster |
| Typrix | GitHub handles taken and near Tyrix/Typix |
| Inkweft | Existing knowledge-card app |
| Textloom | Existing Rust rich-text editor crate |
| Inkloom | Existing local-first manuscript product |
| Writeloom | Existing writer workspace |
| Textfold | Multiple editors/text tools |
| Plainfold | Existing repos/org |
| Inkhearth | Existing reading tracker |
| Noteden | Existing repo |
| Inknest | Multiple local Markdown apps |
| Notenest | Existing collaborative editor |
| Codenest | Multiple repos/products |
| Codeleaf | Existing live text editor/preview |
| Quillora | Multiple writing/Markdown products |
| Textora | Existing text/OCR products |
| Markiva | Existing Markdown/label software |
| Notora | Existing notes app |
| Inkleaf | Existing offline PDF editor |
| Plainleaf | Existing local-first Markdown app |
| Noteleaf | Existing CLI/startup neighborhood |
| Notefold | Existing VS Code extension |
| Markleaf | Multiple Markdown/editor products |
| Papyrix | Existing e-paper firmware |
| Quillium | Multiple writing/study/social products |
| Scribix | Existing sticky-notes/transcription products |
| Quietext | Existing Windows text editor and Android app |
| Wrylo | Existing AI writing studio |
| Wryve | Existing AI content-writing product |
| Writora | Existing writing/drafting products |
| Writiva | Existing AI writing products |
| Markexa | Existing digital marketing brand |
| Notexa | Existing AI meeting-notes product |
| Writexa | Existing writing/academic services and AI tool neighborhood |
| Codefold | Existing PyPI/GitHub structural code reader |
| Quillo | Existing app and Rust web language |
| Textcove | Existing macOS Markdown/code editor and PWA notes apps |
| Notecove | Multiple local-first notes/meeting/PDF products |
| Inkgrove | Existing local-first novel-writing studio |
| Codegrove | Existing code-snippet/learning products and company |
| Textgrove | Near Text Groove, an established texting platform |
| Olai | Multiple notes/outliner/document apps |
| Serenix | Existing supplement brand/trademark |
| Kuripo | Existing app/social neighborhood |
| Varaix | Near Variax guitar brand and existing company name |
| Plainix | Existing Nix environment tool |
| Localora | Existing local-commerce startup |
| Ownix | Existing household organizer/NFT/private-market products |
| Weftly | Existing AI media/MCP API |
| Serenfold | Existing skincare site |
| Dawnfold | Existing sunrise alarm app/game/band neighborhood |
| Eoscribe | Existing Evolved Office AI assistant |
| Codefloe | Existing Git hosting platform |
| Wryft | GitHub org exists; Ryft software trademark neighborhood; Wryft chat repos |
| Markfold | GitHub repos exist; Mark+Fold brand; MarkFolder local-first Markdown manager |
| Textden | Existing textden.com site |
| Textleaf | Existing lightweight text editor repo |
| Writenest | Existing blogging platform/blog neighborhood |
| Textnest | Existing messaging app and text-tool repo |
| Leafwrite | Existing journaling app repo |
| Calmpad | Existing sensory/fidget product brand |

### Strong phonetic or category neighbors

| Name | Reason rejected |
|---|---|
| Notefloe | Sounds like NoteFlow, which is crowded with notes/productivity apps |
| Writefloe | Sounds like WriteFlow, which is crowded with writing apps |
| Textfloe | Sounds like TextFlow, which is crowded with text/editing/layout products |
| Localoom | Awkward double-L spelling; weak distinctiveness; domain-list noise |
| Ownwrite | Reads like a generic code identifier (`ownWrite`) rather than a product brand |
| Writefold | Reads like a generic programming operation rather than a brand |
| Writeleaf | Mostly appears as a generic API/function name; weak brand signal |
| Texthearth | Clean exact string, but awkward `thh` cluster and weaker pronounceability |
| Writehearth | Near Writer’s Hearth and Write Hearted writing brands |
| Caretra | Weak survivor; near Caret/Caretta neighborhood |
| Aubra | Weak survivor; near Ubra/Umbra and unrelated product associations |

---

## Availability snapshot for the recommended name

Checked on 2026-11-13:

| Surface | Result for `wrytrove` |
|---|---|
| npm package name | 404 / not found |
| PyPI package name | 404 / not found |
| GitHub user/org handle | No exact handle found |
| GitHub repository-name search | 0 exact `wrytrove` matches |
| Exact web product search | No exact product/brand hit found |
| Domain registration | **Not verified** |
| Trademark registration | **Not verified** |
| Social handles | **Not verified** |

Before launch, verify at least:

1. `wrytrove.com`
2. `wrytrove.app`
3. `wrytrove.dev`
4. `wrytrove.io`
5. GitHub org/user: `wrytrove`
6. npm: `wrytrove`
7. PyPI: `wrytrove`
8. crates.io if a Rust crate will be published
9. Trademark databases in target markets, especially Class 9 for downloadable software and Class 42 if software/services are offered online.

If the exact `.com` is unavailable or expensive, `wrytrove.app` or `wrytrove.dev` would be acceptable for a desktop developer tool, but the exact brand string should still be cleared.

---

## Rename blast radius in this repository

A rename is not just a README change. A case-insensitive search found **316 matching lines across 55 files** outside `node_modules`, `target`, and `dist`.

### Public identity

- `README.md`
- `docs/MORROW-AT-A-GLANCE.md`
- `docs/USER-GUIDE.md`
- `docs/IMPLEMENTATION-0.4.0.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `SECURITY.md`
- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- screenshot path: `docs/images/morrow-browser-preview.png`
- installer name: `Morrow_0.4.0_x64-setup.exe`

### Package/build identity

- `package.json`: `"name": "morrow-editor"`
- `package-lock.json`
- `src-tauri/Cargo.toml`: package `morrow-editor`, lib `morrow_editor_lib`, authors
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`:
  - `productName: "Morrow"`
  - `identifier: "app.morrow.editor"`
  - window title
  - file-association description
- `.github/workflows/windows.yml`: artifact names
- `.github/roadmap.json`: item IDs and descriptions
- roadmap/status bot scripts and issue templates

### Runtime identifiers that need careful migration

These are more sensitive than marketing text:

- `src/storage.ts`
  - `SETTINGS_KEY = 'morrow.settings.v1'`
  - IndexedDB name: `morrow-local-session-v1`
- `src/goal.ts` and `src/main.ts`
  - `GOAL_KEY = 'morrow.goal.v1'`
- `src/platform.ts` and `src-tauri/src/lib.rs`
  - IPC headers: `x-morrow-path`, `x-morrow-expected`, `x-morrow-force`
  - error sentinel: `MORROW_FILE_CHANGED`
  - temp-file prefix: `.morrow-`
- `src-tauri/src/lib.rs` and `src/main.ts`
  - event name: `morrow-open-files`
- `src/ai-actions.ts`
  - prompt passage markers: `MORROW_PASSAGE`, `END_MORROW_PASSAGE`
- `src/main.ts`
  - class name: `MorrowApp`
  - window title suffix
  - About dialog text
- `src/samples.ts`
  - welcome/sample text

### Migration concerns

Changing `src-tauri/tauri.conf.json` identifier can change where the app stores data and how the OS associates files. Changing localStorage/IndexedDB keys can make existing settings, goals, and recovery sessions appear missing unless migrated.

A safe rename should therefore be phased:

1. **Brand decision and clearance**
   - Confirm domain/handles/trademark risk.
   - Choose final spelling and capitalization.
2. **Public branding PR**
   - README/docs/window title/product name/installer artifact names.
   - Keep runtime storage keys and IPC identifiers temporarily stable if needed.
3. **Runtime identifier PR**
   - Rename package/Cargo/Tauri identifiers.
   - Add migration from old localStorage/IndexedDB keys if users already have preview data.
   - Rename IPC headers/events atomically across TypeScript and Rust.
4. **Repository/release cleanup**
   - Rename GitHub repo only after redirects and release links are considered.
   - Update roadmap IDs, bots, badges, screenshots, and installer checksums.
   - Announce the rename clearly in changelog/release notes.

Do **not** do a blind global find-and-replace without testing storage migration, file associations, IPC, and Windows installer behavior.

---

## Final decision

Use:

> **Wrytrove**  
> **Your local trove of notes and code.**

If you want a softer, more literal backup, choose **Noteglade**.  
If you want a warmer “home for notes” backup, choose **Notehearth**.

But for a unique, catchy, tech-product name with the cleanest exact-string screening in this pass, **Wrytrove** is the best recommendation.
