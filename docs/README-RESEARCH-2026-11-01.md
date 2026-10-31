# README comparison: 10 editor repositories

Reviewed on 1 November 2026 for Morrow's 0.4.0 README. This is a qualitative sample of prominent open-source text/code editors, including Windows notepad alternatives—not a verified worldwide top-10 ranking by stars, downloads or user satisfaction. The source links point to each project's own README; practices and projects can change.

| Repository | README practices observed | How Morrow applies the lesson |
| --- | --- | --- |
| [VS Code / Code - OSS](https://github.com/microsoft/vscode#readme) | Distinguishes the source repository from the branded product, shows the editor, and links to contribution and feedback information. | Distinguish a browser screenshot, source, CI artifact and unsigned preview; provide issue and contribution links. |
| [Neovim](https://github.com/neovim/neovim#readme) | Explains key features and separates package installation from source builds and platform guidance. | Give clear prerequisites, runnable source commands and links to more detailed platform guidance. |
| [Zed](https://github.com/zed-industries/zed#readme) | Gives a compact introduction, platform-aware installation, development links, contribution guidance and licensing. | Put a short product description and practical Windows setup before deeper documentation. |
| [Helix](https://github.com/helix-editor/helix#readme) | Presents a screenshot, a concise feature list, installation documentation and help links. | Lead with a real Morrow screenshot, scannable features and a separate detailed guide. |
| [Vim](https://github.com/vim/vim#readme) | Makes the project's purpose, supported systems, distribution, compilation and help paths easy to find. | Explain the Windows target, source build, help/issue path and supported-versus-untested boundaries. |
| [Lapce](https://github.com/lapce/lapce#readme) | Combines a visual introduction and focused features with installation, feedback and license sections. | Keep the front page concise and give clear routes to build, report problems and find the license. |
| [VSCodium](https://github.com/VSCodium/vscodium#readme) | Explains what its binaries are and places distribution and installation routes prominently. | Explain that Morrow's optional Actions artifact is temporary and unsigned, rather than calling it a released installer. |
| [Notepad++](https://github.com/notepad-plus-plus/notepad-plus-plus#readme) | Identifies its Windows audience, license, supported-system information, release signing and build/contribution guides. | State the Windows focus and MIT license, disclose that Morrow is unsigned, and link the build and issue guidance. |
| [micro](https://github.com/micro-editor/micro#readme) | Uses a real screenshot, explains intended users, lists features and familiar keybindings, and documents installation choices. | Show an authentic screenshot, identify general and developer use cases, and surface common shortcuts. |
| [Notepad Next](https://github.com/dail8859/NotepadNext#readme) | Shows an early safety warning and screenshot, then provides platform-specific installation information. | Put Morrow's preview/backup warning near the top and make Windows installation instructions explicit. |

## Decisions and boundaries

- Keep the README a clear first stop; move the existing detailed feature, privacy and safety material to [`USER-GUIDE.md`](USER-GUIDE.md) rather than discarding it.
- Prefer an actual screenshot with descriptive alternative text over decorative images. Avoid fabricated build, coverage, download or performance badges.
- State what exists **now**. Morrow's Arena website opens in a system browser; its separate API is opt-in. Neither a signed release nor verified consumer-Windows compatibility is implied.
- As of the comparison, both public branches had the same 0.4.0 file tree but different merge histories. The README records that dated observation without promising they will stay identical.
- This review does not measure Morrow's popularity, performance, security, accessibility or user satisfaction. It assesses README presentation, not product feature parity.
