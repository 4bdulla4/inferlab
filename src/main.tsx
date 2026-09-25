import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, useUIStore } from "./store/uiStore";

// Resolve the theme before the first paint so there is no flash of the wrong palette.
applyTheme(useUIStore.getState().theme);
window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (useUIStore.getState().theme === "system") applyTheme("system");
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
