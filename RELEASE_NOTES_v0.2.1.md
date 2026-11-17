# Slate 0.2.1 — Safer tab recovery

This patch fixes a two-tab recovery issue in 0.2.0. When a writer disappeared after a failed save, another tab could take over using an older recovery snapshot.

Slate now reads the latest recovery entry before enabling writing and updates the editor buffer immediately. If the previous writer already saved successfully, the tab discards its stale recovery snapshot instead of saving it again. The journal and Markdown formats are unchanged.

Reload every open Slate tab after updating so each tab uses the fix. Keep a tab with a saving error open until you have exported or copied its latest words.

[Open Slate](https://tanzir71.github.io/slate/app/) · Designed & built by [tanziro.com](https://tanziro.com).
