# Releasing Slate

The landing page and browser app ship together from the same commit. GitHub Pages serves the landing at `/slate/` and the app at `/slate/app/`; `/slate/demo/` redirects to the Sample Space.

1. Finish the release scope and run `pnpm verify`. WebKit storage tests use isolated persistent profiles and require Playwright 1.65.1 or later. Windows WebKit has additional OPFS limitations; validate the complete suite on Linux/macOS as well as supported Windows engines.
2. Update package/app versions, `CHANGELOG.md`, and `apps/web/public/whats-new.json`. Update the landing copy only for features that now work, and refresh `docs/compare-sources.md` and the dated comparison footnote.
3. Run `pnpm build:site` and `pnpm perf:site`. The build renders shared Lucide icons locally, captures the **real Sample Space** using `pnpm shots`, and assembles and verifies `site-dist/`. Fonts, brand assets and scripts are local. The site checks enforce a 10 KB landing-JS budget and a 250 KB gzip app-shell budget. Lighthouse enforces the landing's score, loading and layout budgets. Marketing font subsets are committed; to regenerate them, install `fonttools[woff]==4.63.0` and run `python scripts/subset-landing-fonts.py`.
4. Commit the source and generated marketing assets, push the commit to `main`, then push the matching `vX.Y.Z` tag.
5. The **Deploy Slate website and app** workflow installs browser engines, rebuilds the site and screenshots, runs Chromium/Firefox/WebKit tests under `/slate/`, publishes the single Pages artifact, then checks the live landing-to-editor save/reopen flow. It creates GitHub Release notes only after deployment verification succeeds.

Publishing a release in GitHub also deploys that release's tag. For an initial landing update or a deliberate redeploy, run the workflow manually against the desired ref. GitHub Pages must use **GitHub Actions** as its build source rather than legacy branch publishing.

Do not use Figma exports as product screenshots or advertise unshipped blocks, templates, Tidy, automation or Sync. Re-run `pnpm shots` after app changes. When Dark mode ships, add its real capture to the landing `<picture>`; the current page only presents the implemented Light workspace.
