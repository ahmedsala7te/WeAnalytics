import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useAppStore } from "./store/useAppStore";
import "./index.css";

// dev-only debug handles: inspect state / drive the upload path from the console
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__netpulse = useAppStore;
  void import("./agents/ingestion").then((m) => {
    (window as unknown as Record<string, unknown>).__ingestFile = m.ingestFile;
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
