import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NativeApp } from "@slate/ui/native";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Slate root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <NativeApp />
  </StrictMode>
);
