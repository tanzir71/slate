import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserApp } from "@slate/ui/browser";
import { registerSW } from "virtual:pwa-register";
import { createBrowserIndex } from "./indexClient";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Slate root element was not found.");
}

function App() {
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    let active = true;
    registerSW({ onNeedRefresh: () => { if (active) setUpdateReady(true); }, onNeedReload: () => undefined });
    return () => { active = false; };
  }, []);
  return <BrowserApp createIndex={createBrowserIndex} updateReady={updateReady} onReload={reloadWaitingWorker} />;
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

