# Third-party components and license review

This is an **inventory of the principal direct dependencies**, not legal advice or a substitute for reviewing each package's notices. The source archive does not include `node_modules`, Rust build artifacts, an AI model, or the WebView2 runtime. The tagged Windows workflow generates a complete transitive SBOM and license report from the npm and Cargo lockfiles, then rejects publication when license metadata or approved SPDX coverage is missing. Maintainers must still check changed package and crate contents, including `LICENSE`, `COPYING` and `NOTICE` files; some crates have target-specific dependencies.

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

## Tagged-release SBOM and license gate

The tagged Windows workflow generates `npm-sbom.cdx.json` with `npm sbom --package-lock-only --sbom-format cyclonedx`, `cargo-metadata.json` with `cargo metadata --locked`, and a machine-readable `LICENSE-REPORT.json`. The release job refuses to publish when a resolved package has no license metadata or when an SPDX identifier emitted by either dependency graph is absent from this file. The generated SBOM is the complete transitive inventory; this document is the reviewed license-identifier and attribution index, not legal advice.

The current lockfiles and target-specific Cargo graph use these SPDX identifiers (the gate reports any new identifier for review before a tag can publish):

`0BSD`, `Apache-2.0`, `Apache-2.0 WITH LLVM-exception`, `BSD-2-Clause`, `BSD-3-Clause`, `CC0-1.0`, `ISC`, `LGPL-2.1-or-later`, `LGPL-3.0-only`, `MIT`, `MIT-0`, `MPL-2.0`, `NCSA`, `OFL-1.1`, `OpenSSL`, `Python-2.0`, `Unicode-3.0`, `Unlicense`, and `Zlib`.

A generated report is retained with every tagged release. It is not a substitute for checking the actual package/crate `LICENSE`, `COPYING`, `NOTICE` and attribution files when dependencies change.

## Separately obtained software

- The suggested [`qwen2.5-coder:1.5b` model](https://ollama.com/library/qwen2.5-coder:1.5b) is not included in the app or source archive; its Ollama model page lists Apache License 2.0. Check model provenance, the current model license and any other applicable terms before use or redistribution.
- [Ollama](https://github.com/ollama/ollama) is installed separately, with its own license and terms.
- The app uses Microsoft's WebView2 runtime on Windows. The runtime/installer is obtained separately and is subject to Microsoft's terms; it is not covered by Morrow's MIT license.
- Windows installation tooling, NSIS and any WebView2 bootstrapper have their own terms. Review those terms separately before redistributing a packaged installer; they are not covered by Morrow's MIT license.
