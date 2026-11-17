# Desktop preview

From v0.3, each release includes three **unsigned preview** downloads. The browser app remains the recommended writing workspace while native folder integration is completed for v0.9. These previews let you try the native window, editor, commands, themes and focus modes. They are not signed or notarized and have no automatic updater.

| Download suffix | System | Open |
|---|---|---|
| `windows-x64-preview-unsigned.exe` | Windows x64 | Run the per-user installer; administrator access is not required. WebView2 must be available; the installer can download it on first install. Windows may show an unknown-publisher warning. |
| `linux-x64-preview-unsigned.AppImage` | Linux x64, built on Ubuntu 22.04 | Make the downloaded file executable, then run it. AppImage may require FUSE 2; `--appimage-extract-and-run` is available on systems without FUSE. Older glibc systems are unsupported. |
| `macos-universal-preview-unsigned.app.zip` | macOS 11+, Intel and Apple Silicon | Extract the ZIP and open Slate Preview. macOS may block this unsigned, unnotarized build. Only open it if you trust this repository; use the browser app if your device policy blocks it. |

The filename includes the exact version. Each download has a matching `.sha256` file and `.json` manifest with the source commit, platform, size and SHA-256. Local builds with working changes are marked `dirty: true` and cannot be published by release automation. Compare the checksum before opening a download. On Windows, use `Get-FileHash -Algorithm SHA256 <download>`; on Linux use `sha256sum -c <download>.sha256`; on macOS use `shasum -a 256 -c <download>.sha256` in the download directory.

Preview data uses the separate application identifier `com.slate.workspace.preview`. It cannot overwrite a stable installation's app-data directory. Native writes are conflict-safe, but this early shell still starts with sample sheets and does not yet reopen or browse its saved files through the UI. Do not use it for the only copy of important writing. Use the browser's folder/library workspace for save/reopen/export today; native folder selection, watching, move/trash and complete reopen are scheduled for v0.9.

To build locally, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), run `pnpm install`, then `pnpm build:desktop-preview`. macOS additionally needs both Rust targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`. Bundles and manifests are staged under `artifacts/desktop-preview/<platform>/<version>/`. The standard `pnpm build` still builds an unpackaged debug executable for verification.

The release pipeline builds all three packages from one resolved commit before allowing Pages deployment. It installs the Windows package and extracts the Linux/macOS packages on isolated runners, then checks that each native process survives startup. These checks do not establish native save/reopen support. After the live browser app save/reopen smoke passes, it checks all nine release files and their bytes against that commit, uploads them to a draft GitHub Release, and publishes it. A failed package build, startup smoke or checksum check prevents publication. A manually published release can receive its matching assets on a redeploy; the same verification still applies.
