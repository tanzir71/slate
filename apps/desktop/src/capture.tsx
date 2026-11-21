import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CaptureApp } from "@slate/ui/native-capture";

const root = document.getElementById("root");
if (!root) throw new Error("Slate capture root element was not found.");
createRoot(root).render(<StrictMode><CaptureApp /></StrictMode>);
