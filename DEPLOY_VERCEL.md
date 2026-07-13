# Deploy Slate

The deployment assembles the static landing page from `docs/` and the real seeded PWA under `site-dist/demo/`.

```powershell
$env:NODE_OPTIONS='--use-system-ca'
pnpm build:site
vercel deploy --prod --yes --name slate-local-workspace --scope tanzir71s-projects
```

Production: <https://slate-local-workspace.vercel.app/>

Demo: <https://slate-local-workspace.vercel.app/demo/>
