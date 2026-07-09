import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SlateApp, createTauriAutosaveWriter } from "@slate/ui";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Slate root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <SlateApp autosaveWriter={createTauriAutosaveWriter()} />
  </StrictMode>
);
