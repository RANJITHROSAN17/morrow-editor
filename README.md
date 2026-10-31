<p align="center">
  <img src="src-tauri/icons/icon.png" width="84" alt="Morrow app icon">
</p>

<h1 align="center">Morrow</h1>

<p align="center"><strong>A little space for notes, code, and everything in between.</strong></p>

<p align="center">Free and open source · Windows x64 · 0.4.0 preview · <a href="LICENSE">MIT license</a></p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="#ai-and-privacy">AI &amp; privacy</a> ·
  <a href="docs/USER-GUIDE.md">Full guide</a> ·
  <a href="#contributing">Contributing</a>
</p>

Morrow is a Windows text and code editor designed to be approachable for everyday notes and useful for quick programming tasks. Edit files without an account; AI assistance is optional.

> [!IMPORTANT]
> **Early preview, not a production release.** Keep backups and test with non-critical files first. The Windows installer is unsigned, and consumer Windows 10/11, full accessibility and security audits, and performance benchmarks remain outstanding.

![Morrow's dark editor showing a Python sample, folder sidebar, tabs, and lavender accents](docs/images/morrow-browser-preview.png)

*Browser preview of the editor. The sample is not a saved file; Windows-native integration is not shown.*

## Features

- **A familiar editor:** tabs, open/save dialogs, undo and redo, find and replace, line numbers, word wrap, and dark and light themes.
- **Code and writing:** syntax highlighting for many programming and markup formats, automatic or manual language selection, and a live, inert Markdown preview.
- **Folders and navigation:** add multiple folders to a workspace, create files and folders, search saved files across roots, and use quick open to navigate.
- **Review before applying:** compare a pasted replacement with a selected range, explicitly accept it, and undo it. Applying a change does not automatically save the file.
- **AI on your terms:** optional Ollama suggestions, a browser-first Arena workflow, and a separate optional Arena API panel. See [AI and privacy](#ai-and-privacy) before sharing text.
- **Recovery and file awareness:** optional session recovery and checks for external file changes. Recovery is unencrypted and is **not a backup**.

Morrow is not yet a full IDE: it does not provide a debugger, integrated terminal, extension marketplace, or language-server features. See the [full guide](docs/USER-GUIDE.md) for file formats, limits, shortcuts, and safety details.

## Get started

### Windows app from source

You will need Windows x64, [Git](https://git-scm.com/), [Node.js 20](https://nodejs.org/) or newer, current stable [Rust](https://rustup.rs/), Microsoft C++ Build Tools with **Desktop development with C++**, and the Microsoft Edge WebView2 runtime. See [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

In PowerShell:

```powershell
git clone https://github.com/RANJITHROSAN17/morrow-editor.git
cd morrow-editor
npm ci
npm run tauri dev
```

To build an **unsigned** Windows x64 installer after installing the prerequisites and dependencies:

```powershell
rustup target add x86_64-pc-windows-msvc
npm run tauri build -- --target x86_64-pc-windows-msvc
```

The NSIS installer is written to `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Windows may warn about an unknown publisher. If WebView2 is missing, its bootstrapper may need internet access.

There is no tagged GitHub release as of 1 November 2026. A successful run of the [Windows build workflow](https://github.com/RANJITHROSAN17/morrow-editor/actions/workflows/windows.yml) may provide a temporary unsigned artifact; artifacts expire and may require GitHub sign-in. An artifact is not a signed production release.

### Browser UI preview

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. This shows the editor UI, **not** the Windows application: native dialogs, file associations, and local Ollama integration are not demonstrated. Browser file and folder access also depends on browser support and permission.

## AI and privacy

### Arena in your browser

1. Select the text you want to work with and open **Arena → Website**.
2. Optionally add an instruction, choose **Capture selection**, review the prepared prompt, and explicitly choose **Copy preview**.
3. Choose **Open Arena in browser**, sign in there, and paste and submit the prompt yourself.
4. Back in Morrow, choose **Review a pasted change**, paste the replacement, review it, and explicitly apply or reject it.

Morrow does **not** embed the Arena website, transfer cookies or login sessions, or automatically send your text to it. An Arena website login is not an API key.

### Optional API and local suggestions

- **Arena API:** the separate **API key** panel requires an eligible key and model. Morrow asks for confirmation before sending your instruction and any captured selection to the cloud provider. Availability, privacy terms and charges depend on your account. The key is held in panel memory and cleared when the panel closes.
- **Ollama:** inline suggestions start off each time. If you explicitly enable them in the desktop app, nearby editor text is sent to your Ollama service at `127.0.0.1:11434`. A loopback address does not guarantee the service or model is offline; choose and configure a genuinely local model if needed. Suggestions are single-line and can be wrong.
- **Your data:** session recovery is on by default and stores document contents and related metadata locally without Morrow-provided encryption. Folder-access permissions may persist after closing the view. The secret warning is only a fallible heuristic—review text yourself before sharing it.

[Read the full privacy, setup, and safety notes →](docs/USER-GUIDE.md#privacy-and-storage)

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| New / open / save | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` |
| Find / replace | `Ctrl+F` / `Ctrl+H` |
| Find in folders / quick open | `Ctrl+Shift+F` / `Ctrl+P` |
| Go to line / command palette | `Ctrl+G` / `Ctrl+Shift+P` |
| Settings | `Ctrl+,` |
| Request / accept / dismiss an AI suggestion | `Ctrl+Shift+Space` / `Tab` / `Esc` |

## Development and testing

The frontend uses TypeScript, CodeMirror 6 and Vite; the desktop shell uses Tauri 2, Rust and WebView2. To run the frontend checks:

```sh
npm ci
npm run build
npm test
npx playwright install --only-shell chromium
npm run test:e2e
```

With the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) installed, run native tests with:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
```

The 0.4.0 candidate received automated tests and a targeted installed-app smoke test using synthetic data on a Windows Server 2025 VM. This is not a substitute for testing on consumer Windows, a real model or an authenticated Arena account. The Tauri IPC mock test runs on Linux; the Windows test binary containing it failed to start on the hosted runner. See [verification and limits](docs/IMPLEMENTATION-0.4.0.md#verification-and-limits).

## Branches

As checked on 1 November 2026, `main` and [`feature/morrow-0.4.0-design`](https://github.com/RANJITHROSAN17/morrow-editor/tree/feature/morrow-0.4.0-design) contain the same 0.4.0 files; their merge histories differ. `main` is the default development branch. The feature branch may evolve independently; neither branch is a signed release.

## Contributing

Issues and pull requests are welcome. Describe the problem, your Windows version, steps to reproduce, and expected versus actual behavior. Please **do not post API keys, private files, or sensitive text** in public issues.

- [Report a bug or suggest an improvement](https://github.com/RANJITHROSAN17/morrow-editor/issues)
- [Changelog](CHANGELOG.md) · [Product research](docs/PRODUCT-RESEARCH-2026.md) · [README comparison](docs/README-RESEARCH-2026-11-01.md)

## License

Morrow's source code is available under the [MIT License](LICENSE). Dependencies and separately downloaded models have their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
