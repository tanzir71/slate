import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserApp } from "@slate/ui/browser";
import { registerSW } from "virtual:pwa-register";
import { createBrowserIndex } from "./indexClient";
import { observeFirstUseAssets } from "./firstUseCache";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Slate root element was not found.");
}

function App() {
  const [updateReady, setUpdateReady] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string>();
  useEffect(() => {
    let active = true;
    const firstUse = observeFirstUseAssets();
    registerSW({ onRegisteredSW: (_url, registration) => { if (active) firstUse.registered(registration); }, onNeedRefresh: () => {
      if (!active) return;
      setUpdateReady(true);
      void waitingVersion().then((version) => { if (active) setUpdateVersion(version); }).catch(() => undefined);
    }, onNeedReload: () => undefined });
    return () => { active = false; firstUse.dispose(); };
  }, []);
  return <BrowserApp version={__SLATE_VERSION__} createIndex={createBrowserIndex} updateReady={updateReady} updateVersion={updateVersion} onReload={reloadWaitingWorker} />;
}

async function waitingVersion(): Promise<string | undefined> {
  const response = await fetch(new URL("./whats-new.json?update=ready", document.baseURI), { cache: "no-store" });
  if (!response.ok) return undefined;
  const value: unknown = await response.json();
  return typeof value === "object" && value !== null && "version" in value && typeof value.version === "string" ? value.version : undefined;
}

async function reloadWaitingWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) { location.reload(); return; }
  // A worker detected through registration.update() can be classified as external by Workbox.
  // Explicit user approval, after the workspace flush, is the condition for this reload.
  await new Promise<void>((resolve, reject) => {
    const changed = () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      resolve();
      location.reload();
    };
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      reject(new Error("The update could not activate. Please try Reload again."));
    }, 10_000);
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    registration.waiting!.postMessage({ type: "SKIP_WAITING" });
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

