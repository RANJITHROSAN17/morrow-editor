# Third-party components and license review

This is an **inventory of the principal direct dependencies**, not a complete third-party notices file or a legal audit. The source archive does not include `node_modules`, Rust build artifacts, an AI model, or the WebView2 runtime. Building or distributing an executable brings in additional transitive dependencies; before distributing binaries, generate a complete dependency/SBOM and license inventory from both lockfiles and include all required copyright, license and attribution notices. Check the actual downloaded package and crate contents, including `LICENSE`, `COPYING` and `NOTICE` files. Some crates have target-specific dependencies.

The following license expressions and versions were read from the installed package/crate metadata and lockfiles on 30 October 2026. They may change when dependencies are updated. An `OR` expression permits a choice between the named licenses, subject to their terms. This information is not legal advice.

## Direct JavaScript runtime packages

| Component | Locked version(s) | Declared license |
|---|---|---|
| [CodeMirror](https://github.com/codemirror), including `@codemirror/autocomplete`, `commands`, `language`, `language-data`, `search`, `state` and `view` | 6.20.4, 6.11.1, 6.13.1, 6.5.2, 6.7.2, 6.7.6, 6.43.15 respectively | MIT |
| [`@lezer/highlight`](https://github.com/lezer-parser/highlight) | 1.2.5 | MIT |
| [`@tauri-apps/api`](https://github.com/tauri-apps/tauri) | 2.12.4 | Apache-2.0 OR MIT |
| [`@tauri-apps/plugin-dialog`, `plugin-fs`, `plugin-http`, `plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | 2.8.4, 2.7.1, 2.8.3, 2.7.2 respectively | MIT OR Apache-2.0 |
| [`diff`](https://github.com/kpdecker/jsdiff) | 9.0.0 | BSD-3-Clause |
| [`markdown-it`](https://github.com/markdown-it/markdown-it) | 14.3.3 | MIT |

Development/build-only packages (including TypeScript, Vite, Vitest, Playwright and the Tauri CLI) and transitive language parsers also have separate licenses. Refer to `package-lock.json` and the installed packages for their exact versions and terms.

## Direct Rust crates

| Component | Locked version | Declared license |
|---|---:|---|
| [`tauri`](https://github.com/tauri-apps/tauri) | 2.12.5 | Apache-2.0 OR MIT |
| `tauri-build` | 2.7.4 | Apache-2.0 OR MIT |
| [`tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-http`, `tauri-plugin-opener`](https://github.com/tauri-apps/plugins-workspace) | 2.8.4, 2.7.1, 2.8.3, 2.7.2 respectively | Apache-2.0 OR MIT |
| [`libc`](https://github.com/rust-lang/libc) (Unix only) | 0.2.191 | MIT OR Apache-2.0 |
| `tauri-plugin-persisted-scope`, `tauri-plugin-single-instance` | 2.4.2, 2.5.5 respectively | Apache-2.0 OR MIT |
| [`serde_json`](https://github.com/serde-rs/json) | 1.0.154 | MIT OR Apache-2.0 |
| [`sha2`](https://github.com/RustCrypto/hashes) | 0.10.9 | MIT OR Apache-2.0 |
| [`tempfile`](https://github.com/Stebalien/tempfile) | 3.27.0 | MIT OR Apache-2.0 |
| [`percent-encoding`](https://github.com/servo/rust-url) | 2.3.2 | MIT OR Apache-2.0 |

See `src-tauri/Cargo.lock` and the source of each crate for the complete resolved dependency graph and notices.

## Separately obtained software

- The suggested [`qwen2.5-coder:1.5b` model](https://ollama.com/library/qwen2.5-coder:1.5b) is not included in the app or source archive; its Ollama model page lists Apache License 2.0. Check model provenance, the current model license and any other applicable terms before use or redistribution.
- [Ollama](https://github.com/ollama/ollama) is installed separately, with its own license and terms.
- The app uses Microsoft's WebView2 runtime on Windows. The runtime/installer is obtained separately and is subject to Microsoft's terms; it is not covered by Morrow's MIT license.
- Windows installation tooling and any installer bootstrapper have their own terms. This prototype's unsigned installer workflow has not yet been audited for redistribution.
